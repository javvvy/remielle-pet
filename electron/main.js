const { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage } = require('electron')
const path = require('node:path')
const store = require('./store')
const settings = require('./settings')
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

function setPetGif(gif) {
  petGif = gif
  sendToPet('pet:state', gif)
}

function enterIdle() {
  clearTimeout(petTimer)
  followable = true
  setPetGif(random(IDLE_GIFS))
}

function enterAppreciate() {
  clearTimeout(petTimer)
  followable = true
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
  BODY_CX: 130,   // 身体中心在窗内坐标 = CSS(top:60,left:10,240×240)+ 120
  BODY_CY: 180,
}
// 桌宠窗口固定宽高(与 createPetWindow 保持一致)。夹取范围与 setBounds 必须用这个
// 固定值,不能用 getSize():在 Windows 高 DPI 下,setPosition 把窗口移到屏幕底部时
// 会触发窗口尺寸逐帧膨胀,导致下边界约束持续收缩、桌宠向上漂移甚至被挤出屏幕。
const PET_W = 260
const PET_H = 360
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
  const tx = cursor.x + FOLLOW.OFFSET_X - FOLLOW.BODY_CX
  const ty = cursor.y + FOLLOW.OFFSET_Y - FOLLOW.BODY_CY
  const dx = tx - x
  const dy = ty - y
  const dist = Math.hypot(dx, dy)
  if (dist <= FOLLOW.DEADZONE) return false
  const step = Math.min(dist * FOLLOW.LERP, FOLLOW.MAX_STEP)
  let nx = x + (dx / dist) * step
  let ny = y + (dy / dist) * step
  // 夹在光标所在显示器工作区内(支持多显示器,不出屏)
  const wa = screen.getDisplayNearestPoint(cursor).workArea
  nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - PET_W)
  ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - PET_H)
  // 用 setBounds 显式带回固定宽高,避免 setPosition 在屏幕底部引发窗口尺寸漂移
  petWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: PET_W, height: PET_H })
  // 朝移动方向转身(素材为微朝右的3/4正面,右移不翻转、左移镜像)
  if (Math.abs(dx) > 4) {
    const dir = dx > 0 ? 1 : -1
    if (dir !== lastFlip) { lastFlip = dir; sendToPet('pet:flip', dir) }
  }
  return true
}

// ---------- 桌宠窗口 ----------
function createPetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: Math.round(width / 2 - PET_W / 2),
    y: Math.round(height / 2 - PET_H / 2),
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
  loadPage(petWin, 'pet.html')
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

function loadPage(win, page) {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL + '/' + page)
  } else {
    win.loadFile(path.join(__dirname, '../dist/src', page))
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
    { label: '设置', click: () => sendToPet('pet:tip', '该功能正在开发中~') },
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
    // 弹出在主体右方
    menuOpen = true
    menu.popup({ window: petWin, x: 262, y: 60, callback: () => { menuOpen = false } })
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
    petWin.setBounds({ x: x + mx, y: y + my, width: PET_W, height: PET_H })
  })

  // 渲染进程按住桌宠(拖动/点击/右键按下)时暂停跟随
  ipcMain.on('pet:hold', (_e, v) => { petHold = !!v })

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

  // 设置:大模型配置与光标跟随开关读写(保存后同步主进程跟随状态)
  ipcMain.handle('settings:get', () => settings.load())
  ipcMain.handle('settings:save', (_e, cfg) => {
    const saved = settings.save(cfg || {})
    followEnabled = saved.followEnabled
    return saved
  })

  // 主页加载晚于事件时的补发标记(如配置缺失提示)
  ipcMain.handle('chat:promptFlags', () => {
    const flags = { configMissing: pendingConfigPrompt }
    pendingConfigPrompt = false
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
