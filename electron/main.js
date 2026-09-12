const { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage } = require('electron')
const path = require('node:path')
const store = require('./store')
const settings = require('./settings')
const { clampPetScale } = require('./config')
const { streamChat } = require('./zhipu')

// 静态资源文件名(gif状态 / 表情包)
const IDLE_GIFS = ['发呆.gif', '思考.gif', '欣赏.gif']
const APPRECIATE_GIFS = ['欣赏.gif', '自豪.gif']
const DONE_GIF = '创作并完成.gif'
const CREATING_GIF = '创作.gif'
const EMOJIS = [
  '表情包-哭.png', '表情包-困倦.png', '表情包-坏笑.png', '表情包-害羞.png',
  '表情包-开心.png', '表情包-惊讶.png', '表情包-生气.png', '表情包-鼓励.png',
]

const random = arr => arr[Math.floor(Math.random() * arr.length)]
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

let petWin = null
let homeWin = null

let petGif = random(IDLE_GIFS)
let petTimer = null        // 欣赏阶段计时
let emojiTimer = null      // 创作阶段随机表情
let streaming = false
let current = store.newConversation()

Menu.setApplicationMenu(null)

// ===== 透明窗口渲染稳定性修复(必须在 app ready 之前) =====
// 1) Windows原生窗口遮挡计算会对透明窗口误判"不可见"而停止绘制,
//    导致GIF动画消失(静态PNG因只绘制一次反而保留)——桌宠项目经典问题
// 2) 同时关闭后台遮挡跟踪,防止窗口被判定遮挡后动画停止重绘
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,BackgroundOcclusionTracking')
// 3) 透明窗口下GIF在部分GPU/驱动上不渲染(加载成功但绘制为空),改用软件合成
app.disableHardwareAcceleration()

function sendToPet(channel, ...args) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, ...args)
}
function sendToHome(channel, ...args) {
  if (homeWin && !homeWin.isDestroyed()) homeWin.webContents.send(channel, ...args)
}

// 诊断日志(渲染进程错误/资源加载失败也记录到这里)
function logError(text) {
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'error.log'),
      `[${new Date().toISOString()}] ${text}\n`
    )
  } catch { /* 日志失败时静默 */ }
}

// 空闲阶段的动画轮换(发呆/思考/欣赏)
const IDLE_ROTATE = {
  CLICK_COOLDOWN: 30 * 1000,  // 点击切换动画的冷却:冷却期内点击不再切换
  NO_CLICK_WAIT: 60 * 1000,   // 冷却走完后再等这么久仍无点击,则自动切换
}

function setPetGif(gif) {
  petGif = gif
  sendToPet('pet:state', gif)
}

// 当前阶段:idle(空闲) / creating(创作) / done(创作并完成) / appreciate(欣赏)
// 只有 idle 允许点击切换与自动轮换
let phase = 'idle'
let idleSwitchAt = 0        // 上次空闲动画切换时间(冷却计时起点)
let idleRotateTimer = null  // 无点击时自动轮换的计时器

// 随机挑一个与当前不同的空闲动画,避免"点了没反应"的观感
function randomIdleGif() {
  const pool = IDLE_GIFS.filter(g => g !== petGif)
  return random(pool.length ? pool : IDLE_GIFS)
}

function scheduleIdleRotate() {
  clearTimeout(idleRotateTimer)
  // 冷却期 + 无点击等待期都走完仍未切换 → 自动轮换
  idleRotateTimer = setTimeout(() => {
    if (phase === 'idle') rotateIdleGif()
  }, IDLE_ROTATE.CLICK_COOLDOWN + IDLE_ROTATE.NO_CLICK_WAIT)
}

// 随机切换空闲动画,并重置冷却 / 自动轮换计时
function rotateIdleGif() {
  clearTimeout(idleRotateTimer)
  idleSwitchAt = Date.now()
  setPetGif(randomIdleGif())
  scheduleIdleRotate()
}

// 点击桌宠主体:仅空闲阶段、且冷却已过才切换动画
function onPetClicked() {
  if (phase !== 'idle') return
  if (Date.now() - idleSwitchAt < IDLE_ROTATE.CLICK_COOLDOWN) return
  rotateIdleGif()
}

function enterIdle() {
  clearTimeout(petTimer)
  followable = true
  phase = 'idle'
  rotateIdleGif()
}

function enterAppreciate() {
  clearTimeout(petTimer)
  followable = true
  phase = 'appreciate'
  clearTimeout(idleRotateTimer)
  setPetGif(random(APPRECIATE_GIFS))
  const duration = randInt(10, 60) * 1000
  petTimer = setTimeout(enterIdle, duration)
}

// ---------- 光标跟随(空闲时) ----------
const FOLLOW = {
  INTERVAL: 30,   // ms/次(约33fps)
  LERP: 0.16,     // 每次tick的逼近比例
  MAX_STEP: 14,   // 单次tick最大位移px(≈460px/s,防止瞬移)
  OFFSET_X: 110,  // 身体中心停在光标右下方(110,70),不遮挡指针
  OFFSET_Y: 70,
  DEADZONE: 24,   // 距目标小于该值停止,避免抖动
  BODY_CX: 130,   // 缩放1.0时身体中心在窗内坐标 = CSS(top:60,left:10,240×240)+ 120
  BODY_CY: 180,
}
// 桌宠窗口基准宽高(缩放 1.0 时,与 pet/App.vue 的 .pet-stage 一致)。
// 夹取范围与 setBounds 必须用这个基准乘缩放后的值,不能用 getSize():
// 在 Windows 高 DPI 下,setPosition 把窗口移到屏幕底部时会触发窗口尺寸逐帧膨胀,
// 导致下边界约束持续收缩、桌宠向上漂移甚至被挤出屏幕。
const PET_W = 260
const PET_H = 360
// 桌宠缩放(0.1~2.0,持久化于 settings.json)。窗口尺寸、跟随锚点、菜单位置
// 全部按同一比例换算;渲染进程用 CSS transform 缩放整个 stage,两者保持一致。
let petScale = clampPetScale(settings.load().petScale)
const petW = () => Math.round(PET_W * petScale)
const petH = () => Math.round(PET_H * petScale)
let followEnabled = settings.load().followEnabled  // 光标跟随开关,持久化于 settings.json(默认开启)
let followable = true     // 状态机允许(启动即空闲,初始true)
let petHold = false       // 渲染进程在桌宠上按住指针(拖动/点击/右键)
let menuOpen = false      // 右键菜单打开中
let lastFlip = 0          // 1朝右 / -1朝左

function followAllowed() {
  return followEnabled && followable && !pinned && !petHold && !menuOpen
    && petWin && !petWin.isDestroyed()
    && !(homeWin && !homeWin.isDestroyed() && homeWin.isVisible())
}

// cursor 参数默认取真实光标,自测时注入合成坐标(与显示器无关)
function followTick(cursor = screen.getCursorScreenPoint()) {
  if (!followAllowed()) return false
  const [x, y] = petWin.getPosition()
  const w = petW()
  const h = petH()
  // 身体中心停在光标右下方:身体中心距窗口左上角 (BODY_CX, BODY_CY) * 缩放
  const tx = cursor.x + (FOLLOW.OFFSET_X - FOLLOW.BODY_CX) * petScale
  const ty = cursor.y + (FOLLOW.OFFSET_Y - FOLLOW.BODY_CY) * petScale
  const dx = tx - x
  const dy = ty - y
  const dist = Math.hypot(dx, dy)
  if (dist <= FOLLOW.DEADZONE) return false
  const step = Math.min(dist * FOLLOW.LERP, FOLLOW.MAX_STEP)
  let nx = x + (dx / dist) * step
  let ny = y + (dy / dist) * step
  // 夹在光标所在显示器工作区内(支持多显示器,不出屏);Math.max 兜底窗口比工作区还大的极端缩放
  const wa = screen.getDisplayNearestPoint(cursor).workArea
  nx = Math.min(Math.max(nx, wa.x), Math.max(wa.x, wa.x + wa.width - w))
  ny = Math.min(Math.max(ny, wa.y), Math.max(wa.y, wa.y + wa.height - h))
  // 用 setBounds 显式带回固定宽高,避免 setPosition 在屏幕底部引发窗口尺寸漂移
  petWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h })
  // 朝移动方向转身(素材为微朝右的3/4正面,右移不翻转、左移镜像)
  if (Math.abs(dx) > 4) {
    const dir = dx > 0 ? 1 : -1
    if (dir !== lastFlip) { lastFlip = dir; sendToPet('pet:flip', dir) }
  }
  return true
}

// 应用缩放:窗口尺寸随之变化,并以身体中心为锚点重定位,避免缩放时桌宠跳动。
// 返回收敛后的实际缩放值(调用方可用它回显/夹取)。
function applyPetScale(next) {
  const prev = petScale
  const s = clampPetScale(next)
  petScale = s
  sendToPet('pet:scale', s)
  if (s === prev) return s
  if (petWin && !petWin.isDestroyed()) {
    const [x, y] = petWin.getPosition()
    // 缩放前后身体中心的屏幕坐标保持不变
    const cx = x + FOLLOW.BODY_CX * prev
    const cy = y + FOLLOW.BODY_CY * prev
    const w = petW()
    const h = petH()
    let nx = cx - FOLLOW.BODY_CX * s
    let ny = cy - FOLLOW.BODY_CY * s
    const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea
    nx = Math.min(Math.max(nx, wa.x), Math.max(wa.x, wa.x + wa.width - w))
    ny = Math.min(Math.max(ny, wa.y), Math.max(wa.y, wa.y + wa.height - h))
    petWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h })
  }
  return s
}

// ---------- 桌宠窗口 ----------
function createPetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const w = petW()
  const h = petH()
  petWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(width / 2 - w / 2),
    y: Math.round(height / 2 - h / 2),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  petWin.on('closed', () => { petWin = null })
  petWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logError(`pet window did-fail-load: ${code} ${desc} ${url}`)
  })
  // 页面就绪后推送当前状态。渲染进程内置的默认动画是"发呆",主进程若不在启动时
  // 推送随机结果,空闲阶段就会永远停在发呆;重载时也需要重新同步。
  petWin.webContents.on('did-finish-load', () => sendToPet('pet:state', petGif))
  // 初始缩放随 URL 传入,渲染进程在首次渲染前就能拿到,避免先按 1.0 画一帧再跳变
  loadPage(petWin, 'pet.html', { scale: String(petScale) })
}

// ---------- 主页窗口 ----------
function createHomeWindow() {
  // 主页可见期间:桌宠取消置顶(避免遮挡主页/抢焦点)并隐藏桌宠输入框
  if (petWin && !petWin.isDestroyed()) {
    petWin.setAlwaysOnTop(false)
    sendToPet('pet:hideInput')
  }
  if (homeWin && !homeWin.isDestroyed()) {
    homeWin.show()
    homeWin.focus()
    return
  }
  homeWin = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: '蕾米埃尔',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  homeWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logError(`home window did-fail-load: ${code} ${desc} ${url}`)
  })
  // 关闭时隐藏,保留对话状态;同时恢复桌宠置顶
  homeWin.on('close', e => {
    if (app.quitting) return
    e.preventDefault()
    homeWin.hide()
    if (petWin && !petWin.isDestroyed()) petWin.setAlwaysOnTop(true)
  })
  loadPage(homeWin, 'home.html')
}

function loadPage(win, page, query) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL + '/' + page + qs)
  } else {
    win.loadFile(path.join(__dirname, '../dist/src', page), query ? { query } : undefined)
  }
}

// ---------- 右键菜单(桌宠主体与托盘共用同一份选项) ----------
function buildPetMenu() {
  return Menu.buildFromTemplate([
    { label: '对话框', click: () => sendToPet('pet:toggleInput') },
    { label: '主页', click: () => createHomeWindow() },
    {
      label: pinned ? '解除固定' : '固定',
      click: () => { pinned = !pinned; sendToPet('pet:pinned', pinned) },
    },
    { label: '跟随光标', type: 'checkbox', checked: followEnabled, click: m => { followEnabled = settings.save({ followEnabled: m.checked }).followEnabled } },
    { label: '设置', click: () => openHomeSettings() },
    { label: '退出', click: () => { app.quitting = true; app.quit() } },
  ])
}

// ---------- 系统托盘 ----------
// 软件图标的位置:开发态在项目 build/ 下;打包后 build/ 不进入 asar,
// 由 package.json 的 extraResources 复制到 resources/icon.png
function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../build/icon.png')
}

// 托盘图标需保持模块级引用,否则会被GC回收导致图标消失
let tray = null
function createTray() {
  const src = nativeImage.createFromPath(appIconPath())
  if (src.isEmpty()) {
    logError(`tray icon load failed: ${appIconPath()}`)
    return
  }
  // 按显示器DPI缩放到托盘实际需要的像素尺寸(Windows托盘基准16px),避免放大模糊
  const scale = screen.getPrimaryDisplay().scaleFactor || 1
  const px = Math.max(16, Math.round(16 * scale))
  tray = new Tray(src.resize({ width: px, height: px, quality: 'best' }))
  tray.setToolTip('蕾米埃尔')
  logError(`tray ready | icon=${appIconPath()} px=${px}`)
  // 左键:打开主页;右键:与桌宠主体一致的选项卡
  tray.on('click', () => createHomeWindow())
  tray.on('right-click', () => {
    const menu = buildPetMenu()
    // 菜单打开期间暂停跟随(与桌宠自身菜单一致),避免光标在托盘角时桌宠乱跑
    menuOpen = true
    menu.on('menu-will-close', () => { menuOpen = false })
    tray.popUpContextMenu(menu)
  })
}

// ---------- 对话 ----------
function startNewConversation() {
  if (current.messages.length) store.archive(current)
  current = store.newConversation()
  return current
}

// 提示用户前往设置配置大模型(配置为空或连接失败时)
let pendingConfigPrompt = false
function promptGoSettings() {
  pendingConfigPrompt = true
  sendToHome('chat:configMissing')
}

// 打开主页并切到设置页(右键菜单"设置"入口)。
// 主页窗口首次创建时页面还没就绪,事件会丢,故用标记位在挂载后补发。
let pendingGotoSettings = false
function openHomeSettings() {
  const needFlag = !homeWin || homeWin.isDestroyed()
  createHomeWindow()
  if (needFlag) pendingGotoSettings = true
  else sendToHome('home:gotoSettings')
}

async function handleSend(text) {
  text = (text || '').trim()
  if (!text || streaming) return
  createHomeWindow()

  // 配置检查:模型ID或API key为空时不发起请求
  if (!settings.isConfigured()) {
    promptGoSettings()
    return
  }

  current.messages.push({ role: 'user', content: text })
  sendToHome('chat:reset', current)

  streaming = true
  followable = false
  phase = 'creating'
  clearTimeout(idleRotateTimer)   // 离开空闲:停止空闲动画轮换
  setPetGif(CREATING_GIF)
  clearTimeout(petTimer)
  // 创作过程中随机弹表情
  clearInterval(emojiTimer)
  emojiTimer = setInterval(() => sendToPet('pet:emoji', random(EMOJIS)), randInt(2500, 5000))

  let reply = ''
  try {
    reply = await streamChat(current.messages, chunk => sendToHome('chat:chunk', chunk), settings.load())
  } catch (err) {
    logError(`chat failed: ${err.message || err}`)
    // 连接失败:提示前往设置
    sendToHome('chat:done', {})
    promptGoSettings()
  } finally {
    clearInterval(emojiTimer)
    streaming = false
    if (reply) {
      current.messages.push({ role: 'assistant', content: reply })
      sendToHome('chat:done', {})
      // 对话完成:创作并完成.gif 播放1秒 -> 欣赏阶段
      setPetGif(DONE_GIF)
      phase = 'done'
      petTimer = setTimeout(enterAppreciate, 1000)
    } else {
      // 出错时回到空闲
      enterIdle()
    }
  }
}

// ---------- IPC ----------
function registerIpc() {
  // 桌宠右键菜单(原生菜单,避免被小窗口裁剪)
  ipcMain.on('app:contextmenu', () => {
    if (!petWin) return
    const menu = buildPetMenu()
    // 弹出在主体右方(按缩放换算,小尺寸时菜单仍贴着桌宠)
    menuOpen = true
    menu.popup({
      window: petWin,
      x: Math.round(262 * petScale),
      y: Math.round(60 * petScale),
      callback: () => { menuOpen = false },
    })
  })

  // 桌宠拖动(未固定时可拖动);高DPI/触摸板下dx/dy为小数,累积后取整,避免抖动和崩溃
  let accX = 0, accY = 0
  ipcMain.on('pet:moveBy', (_e, dx, dy) => {
    if (!petWin || pinned) return
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    accX += dx
    accY += dy
    const mx = Math.round(accX)
    const my = Math.round(accY)
    if (mx === 0 && my === 0) return
    accX -= mx
    accY -= my
    const [x, y] = petWin.getPosition()
    petWin.setBounds({ x: x + mx, y: y + my, width: petW(), height: petH() })
  })

  // 渲染进程按住桌宠(拖动/点击/右键按下)时暂停跟随
  ipcMain.on('pet:hold', (_e, v) => { petHold = !!v })

  // 渲染进程点击桌宠主体:空闲阶段据此随机切换动画(冷却与阶段判定在主进程)
  ipcMain.on('pet:clicked', () => onPetClicked())

  ipcMain.handle('chat:send', (_e, text) => handleSend(text))
  ipcMain.handle('chat:new', () => {
    if (streaming) return { busy: true }
    const conv = startNewConversation()
    sendToHome('chat:reset', conv)
    return { conversation: conv }
  })
  ipcMain.handle('chat:current', () => current)
  ipcMain.handle('chat:history', () => store.getHistory())
  ipcMain.handle('chat:load', (_e, id) => {
    if (streaming) return { busy: true }
    const conv = store.getConversation(id)
    if (!conv) return { error: 'not found' }
    if (current.messages.length && current.id !== id) store.archive(current)
    current = { ...conv, messages: conv.messages.map(m => ({ ...m })) }
    sendToHome('chat:reset', current)
    return { conversation: current }
  })
  ipcMain.handle('app:openHome', () => createHomeWindow())
  ipcMain.handle('app:quit', () => {
    app.quitting = true
    app.quit()
  })

  // 渲染进程诊断上报(资源加载失败等)
  ipcMain.on('diag:error', (_e, msg) => logError(`[renderer] ${msg}`))

  // 设置:大模型配置 / 光标跟随开关 / 桌宠缩放读写(保存后同步主进程状态)
  ipcMain.handle('settings:get', () => settings.load())
  ipcMain.handle('settings:save', (_e, cfg) => {
    const saved = settings.save(cfg || {})
    followEnabled = saved.followEnabled
    applyPetScale(saved.petScale)
    return saved
  })

  // 缩放滑块的实时预览:只应用不落盘,松手(change)时走 settings:save 持久化
  ipcMain.on('pet:setScale', (_e, v) => applyPetScale(v))

  // 主页加载晚于事件时的补发标记(如配置缺失提示)
  ipcMain.handle('chat:promptFlags', () => {
    const flags = { configMissing: pendingConfigPrompt, gotoSettings: pendingGotoSettings }
    pendingConfigPrompt = false
    pendingGotoSettings = false
    return flags
  })
}

let pinned = false
ipcMain.handle('app:setPinned', (_e, v) => { pinned = !!v })

// ---------- 启动 ----------
// 兜底:主进程未捕获异常只记录日志,不弹崩溃对话框(保证桌宠持续可用)
process.on('uncaughtException', err => {
  logError(err.stack || String(err))
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createHomeWindow())

  app.whenReady().then(() => {
    // 启动标记:确认实际运行的构建版本与修复开关
    logError(`app started | occlusion-fix=on | sw-render=on | electron=${process.versions.electron}`)
    createPetWindow()
    registerIpc()
    createTray()
    enterIdle()   // 启动即空闲:随机挑一个空闲动画,并开始冷却/自动轮换计时
    // 光标跟随常驻轮询(守卫不满足时空转,33次/秒布尔检查开销可忽略)
    setInterval(() => followTick(), FOLLOW.INTERVAL)
    // 自动化测试:PET_AUTOTEST=1 时在主进程直接驱动对话链路(密钥经环境变量传入,不进源码)
    if (!app.isPackaged && process.env.PET_AUTOTEST === '1') {
      setTimeout(async () => {
        try {
          logError('[autotest] === begin ===')
          settings.save({ model: '', apiKey: '' })
          logError(`[autotest] T1 clear-config: isConfigured=${settings.isConfigured()} (expect false)`)
          await handleSend('autotest-no-config')
          logError(`[autotest] T2 send-unconfigured: pendingPrompt=${pendingConfigPrompt} (expect true) msgs=${current.messages.length} (expect 0)`)
          pendingConfigPrompt = false
          const cfg = settings.save({ model: process.env.PET_TEST_MODEL || 'glm-4-flash', apiKey: process.env.PET_TEST_KEY || '' })
          logError(`[autotest] T3 save-config: model=${cfg.model} keyLen=${cfg.apiKey.length} isConfigured=${settings.isConfigured()} (expect true)`)
          if (cfg.apiKey) {
            await handleSend('用一句话打个招呼')
            const last = current.messages[current.messages.length - 1]
            logError(`[autotest] T4 send-configured: msgs=${current.messages.length} reply=${JSON.stringify((last && last.content) || '').slice(0, 60)} gif=${petGif}`)
          } else {
            logError('[autotest] T4 skipped (no PET_TEST_KEY)')
          }
          // T5/T6: 光标跟随逻辑(注入合成光标坐标)
          if (homeWin) homeWin.hide()
          followEnabled = true; followable = true; pinned = false; petHold = false; menuOpen = false
          let p = petWin.getPosition()
          followTick({ x: p[0] + 300, y: p[1] + 100 })
          let q = petWin.getPosition()
          logError(`[autotest] T5 follow: moved=${Math.hypot(q[0] - p[0], q[1] - p[1]).toFixed(1)}px (expect >0)`)
          followTick({ x: q[0] - 300, y: q[1] })
          logError(`[autotest] T5b follow-flip: lastFlip=${lastFlip} (expect -1)`)
          followable = false
          const f = petWin.getPosition()
          followTick({ x: f[0] + 300, y: f[1] })
          logError(`[autotest] T6 follow-guard: dx=${petWin.getPosition()[0] - f[0]} (expect 0)`)
          followable = true
          // T7: 光标跟随开关持久化(save 合并语义:局部保存不覆盖其它字段)
          const s1 = settings.save({ followEnabled: false })
          logError(`[autotest] T7 follow-persist: saved=${s1.followEnabled} loaded=${settings.load().followEnabled} (expect false false)`)
          const s2 = settings.save({ model: 'glm-4-flash' })
          logError(`[autotest] T7b follow-merge: model=${s2.model} followEnabled=${s2.followEnabled} (expect glm-4-flash false)`)
          settings.save({ followEnabled: true })
          logError(`[autotest] T7c follow-restore: loaded=${settings.load().followEnabled} (expect true)`)
          followEnabled = true
          // T8: 缩放(窗口尺寸联动 / 越界夹取 / 身体中心锚定不跳位)
          applyPetScale(1)
          const [sw1, sh1] = petWin.getSize()
          const [sp1] = petWin.getPosition()
          const got1 = applyPetScale(0.5)
          const [sw2, sh2] = petWin.getSize()
          const [sp2] = petWin.getPosition()
          // 缩放前身体中心 = 位置 + 130*缩放,缩放后应保持不变
          const cx1 = sp1 + 130 * 1
          const cx2 = sp2 + 130 * 0.5
          logError(`[autotest] T8 scale: 1.0->${sw1}x${sh1} 0.5->${sw2}x${sh2} (expect 260x360 then 130x180)`)
          logError(`[autotest] T8b scale-anchor: bodyCX ${cx1}->${Math.round(cx2)} (expect 相同) got=${got1}`)
          logError(`[autotest] T8c scale-clamp: clampPetScale(9)=${clampPetScale(9)} (expect 2) clampPetScale(0.001)=${clampPetScale(0.001)} (expect 0.1) clampPetScale('x')=${clampPetScale('x')} (expect 1)`)
          applyPetScale(1)
          logError('[autotest] === end ===')
        } catch (e) {
          logError(`[autotest] ERROR ${e.stack || e}`)
        }
      }, 3000)
    }
  })

  app.on('before-quit', () => { app.quitting = true })
  app.on('window-all-closed', () => {})
}
