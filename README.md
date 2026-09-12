# 蕾米埃尔桌宠(remielle-pet)

可对话的 AI 桌宠软件。基于 Electron + Vue3 构建,桌面悬浮一位动画桌宠"蕾米埃尔",由用户接入云端大模型进行角色扮演对话。纯客户端应用,无自建后端。

## 功能
- AI对话
- 桌面陪伴
- 画作创作

### 桌宠主体
- **状态机**:空闲(发呆/思考/欣赏随机)→ 对话中(创作)→ 完成(创作并完成 1 秒)→ 欣赏(欣赏/自豪随机 10~60 秒)→ 回到空闲
- **创作**:右键菜单「创作」触发桌宠自己作画(不经过大模型)——创作动画随机播放 **3~10 秒** → 创作并完成动画 **1 秒** → 欣赏阶段:**欣赏/自豪随机 + 主体上方展示一张随机画作**,随机持续 **10~60 秒** → 回到空闲。画作与主体同尺寸,欣赏结束即收起。对话进行中点击会提示"对话进行中,请稍候~"而不打断
- **空闲动画轮换**:进入空闲时随机播放发呆/思考/欣赏之一;空闲阶段**点击主体**随机切换到另一个空闲动画,带 **30 秒冷却**(冷却期内的点击不切换);冷却走完后再 **60 秒**无点击,自动随机轮换一次(即每次切换后最长 **90 秒**必然轮换)。切换只会选中与当前不同的动画,避免"点了没反应";进入对话/欣赏阶段时停止轮换
- **左键点击**:主体上方随机弹出表情包(0.5 秒冷却);同时按上述规则参与空闲动画轮换
- **右键菜单**(主体右方):对话框(开关桌宠输入框)/ 创作(桌宠作画,见上)/ 主页 / 固定(固定后不可拖动)/ 跟随光标(空闲时跟随鼠标,默认开启)/ 设置(打开主页并切到设置页)/ 退出
- **系统托盘**:托盘图标即软件图标;左键打开主页,右键弹出与桌宠主体完全一致的选项卡(菜单打开期间跟随暂停,避免光标停在托盘角时桌宠乱跑)
- **拖动**:未固定时可左键拖动到任意位置
- **光标跟随**:空闲时向鼠标光标缓动靠近并停在光标右下方,随移动方向转身;对话中/固定/拖动/菜单打开/主页可见时暂停;主页设置页与右键菜单均可开关,状态持久化(默认开启)
- **输入框**:默认隐藏,右键菜单开启;Enter 或点击发送即打开主页开始对话
- **缩放**:主页设置页拖动滑块在 **10%~200%** 间实时缩放主体,松手保存(默认 100%)。窗口尺寸、身体中心锚点、右键菜单位置都按同一比例换算,缩放时以身体中心为锚点,不会跳位

### 主页
- 白色简约风格,左侧导航:对话 / 设置 / 关于
- 对话页:气泡式消息(SSE 流式输出,桌宠头像),左上角"开启新对话",右上角"历史记录"(本地最多 10 条)
- 设置页:配置大模型(模型ID + API Key)、光标跟随开关、桌宠大小滑块(均存储在本机)
- 关于页:软件简介、当前版本号(取运行中的应用版本)、源码地址 `https://github.com/javvvy/remielle-pet`(点击用系统浏览器打开)

## 注意事项
- 目前发行版本只支持Windows端
- 目前默认安装到C:\Users\AppData\Local\Programs目录下,%APPDATA%\remielle-pet目录下存储数据和日志

## 开发进度
- [x] 桌宠主体
- [x] 主页面
- [x] 动画播放逻辑优化(空闲动画轮换,见"空闲动画轮换")
- [x] 关于页面开发(简介 / 版本号 / 源码地址)
- [x] 设置页面新增功能(光标跟随开关、桌宠大小缩放)
- [x] 新增缩放比例功能(10%~200%,见"缩放")
- [x] 创作功能(右键菜单触发,欣赏阶段展示随机画作,见"创作")
- [ ] 后期考虑接入agent

### 大模型
- 调用智谱开放平台 API,模型与密钥由用户在设置页自行配置
- 对话携带系统角色提示词 + 最多 30 条历史消息
- 配置为空或连接失败时提示"大模型配置读取失败,请前往设置配置",可一键前往设置

## 环境要求

- Node.js ≥ 20
- npm
- Windows 10/11(打包目标为 Windows x64)

## 开发运行

```bash
npm install        # 首次安装依赖
npm run dev        # 启动开发模式(Vite + Electron)
```

> 国内网络下 Electron 二进制下载缓慢或失败时,使用镜像:
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

## 打包分发

```bash
npm run dist       # 构建渲染产物并打包 Windows 安装包(NSIS)
```

产物输出在 `release/` 目录(安装包 + win-unpacked 免安装目录)。打包下载 Electron 相关二进制同样建议走镜像:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

安装包未做代码签名,首次运行会触发 Windows SmartScreen 警告,选择"更多信息 → 仍要运行"即可。

## 目录结构

```
pet-project/
├─ electron/              # 主进程
│  ├─ main.js             #   窗口管理、状态机、托盘、IPC 注册、自动化测试钩子
│  ├─ preload.js          #   contextIsolation 安全桥(invoke/send/on)
│  ├─ config.js           #   常量(API 地址、上下文条数等,不含密钥)
│  ├─ prompt.js           #   蕾米埃尔角色系统提示词
│  ├─ settings.js         #   大模型配置读写(userData/settings.json)
│  ├─ store.js            #   历史对话持久化(userData/data.json)
│  └─ zhipu.js            #   智谱 API SSE 流式调用
├─ src/                   # 渲染进程(Vue3)
│  ├─ pet.html / pet/     #   桌宠窗口(透明无边框置顶)
│  ├─ home.html / home/   #   主页窗口(导航/对话/设置)
│  ├─ bridge.js           #   渲染进程 IPC 封装
│  └─ assets/             #   静态资源
│     ├─ *.gif            #     原始状态动画(源资源)
│     ├─ webp/*.webp      #     实际使用的动画(见"渲染兼容性说明")
│     ├─ paintings/*.png  #     创作产物画作(源图在仓库根目录 paintings/,需拷贝到此)
│     └─ 表情包-*.png     #     表情弹层 / 图标1.png 桌宠头像
├─ build/icon.png         # 应用图标(同时作为托盘图标,经 extraResources 复制到 resources/)
├─ vite.config.js         # 双页面入口 + vite-plugin-electron
└─ package.json
```

## 用户数据

| 文件 | 位置 | 内容 |
|---|---|---|
| `settings.json` | `%APPDATA%\remielle-pet\` | 模型ID、API Key(本机明文,注意保管) |
| `data.json` | `%APPDATA%\remielle-pet\` | 历史对话(最多 10 条) |
| `error.log` | `%APPDATA%\remielle-pet\` | 启动标记与错误记录(排查问题时查看) |

## 渲染兼容性说明

桌宠主体动画使用 **WebP 动图**而非原始 GIF:部分 Windows 环境(GPU 驱动/显示配置)下,Electron 透明窗口存在 GIF 加载成功但不绘制的缺陷(表现为主体透明)。WebP 走独立的解码渲染路径,可稳定显示。`src/assets/*.gif` 为原始源资源,`src/assets/webp/` 为实际引用的转换产物;替换素材后需重新转换(如 `sharp --animated`)并重新打包。

主进程已叠加的透明窗口稳定性开关(勿移除):

- `app.disableHardwareAcceleration()` —— 软件合成
- `disable-features: CalculateNativeWinOcclusion,BackgroundOcclusionTracking` —— 规避 Windows 遮挡误判停绘
- 资源加载失败自动重试(0.5s × 6 次)—— 对抗杀软扫描期的瞬时读取失败

### 窗口移动与托盘图标

- 移动窗口统一使用 `setBounds({x,y,width,height})` 而非 `setPosition`:Windows 高 DPI 下,`setPosition` 把窗口移到屏幕底部时会触发窗口尺寸逐帧膨胀,导致光标跟随的下边界约束持续收缩而使桌宠向上漂移、甚至被挤出屏幕。夹取范围使用固定常量 `PET_W/PET_H`,不能用会漂移的 `getSize()`
- 托盘图标按显示器 DPI 缩放到托盘实际像素尺寸(基准 16px,本机 150% 缩放下为 24px),避免放大模糊;`build/` 目录默认不进入 asar,故图标由 `package.json` 的 `extraResources` 复制到 `resources/icon.png`,主进程按 `app.isPackaged` 区分开发/打包路径读取

### 空闲动画状态同步

渲染进程内置的默认动画是"发呆.gif",主进程必须主动推送状态才能显示随机结果:

- 启动时 `enterIdle()` 在主进程侧挑好随机空闲动画,但此刻渲染进程尚未就绪(监听器还没注册),该次 `pet:state` 会丢失
- 因此在 `petWin.webContents` 的 `did-finish-load` 上再补推一次当前 `petGif`;否则空闲阶段会永远停在渲染进程的默认值"发呆"(重载窗口时同样依赖这次补推)

阶段由主进程的 `phase`(idle/creating/done/appreciate)统一判定,点击切动画、自动轮换都只在 `phase === 'idle'` 时生效,进入对话或欣赏阶段会清掉轮换计时器。

### 缩放比例

同一份缩放在两处必须保持一致,改动时注意同步:

- 主进程:`petScale`(0.1~2.0,`config.js` 的 `clampPetScale` 是唯一收敛点)驱动窗口尺寸 `petW()/petH()`、跟随锚点、右键菜单位置。窗口仍统一走 `setBounds` 并带显式宽高
- 渲染进程:`.pet-stage` 用 `transform: scale()`(`transform-origin: top left`)缩放整个 stage,所以"身体中心在窗内坐标"恒为 `(130, 180) × petScale`,与主进程的 `FOLLOW.BODY_CX/BODY_CY` 换算对齐
- 初始缩放经 `loadPage` 的 query(`?scale=`)传入,渲染进程在首帧前就能读到,避免先按 1.0 画一帧再跳变
- 缩放时以**身体中心**为锚点重定位窗口,避免缩放瞬间桌宠位移
- Windows 对无边框窗口有 **32×38** 的最小尺寸下限,因此缩到 10%(理论 26×36)时窗口会被系统兜到 32×38,多出的部分透明不影响观感,主体本身仍按 10% 渲染
- 表情弹层、提示气泡、输入框都随 stage 一起缩放(属于比例缩放的一部分),因此在极小比例下这些元素也会变小

### 创作画作的位置与窗口

画作展示在主体上方且与主体同尺寸,窗口原本放不下,因此画作出现时窗口**向上扩**,而不是把主体往下压:

- 画作区高度 `PAINT_H = 248`(画作 240 + 间距 8)**在两处各有一份**,改动需同步:`electron/main.js` 用于窗口尺寸/身体中心,`src/pet/App.vue` 用于 `translateY` 与画作定位
- 主体在屏幕上的位置必须保持不动:`relayoutPet(oldScale, oldShift)` 统一负责「以身体中心为锚点重设窗口」,缩放变化与画作出现/消失都走它。画作出现时窗口高度 `+248*缩放`、`y` 同步 `-248*缩放`
- 因此窗口尺寸与身体中心都成了动态值:`petW()/petH()` 与 `bodyCX()/bodyCY()` 都受 `paintingVisible` 影响,跟随锚点必须用它们而不是常量
- 画作文件名由渲染进程上报(`pet:paintings`,`import.meta.glob` 的结果),主进程只随机挑名字并通过 `pet:painting` 下发,渲染进程负责把名字解析成打包后的资源 URL——这样主进程不需要知道 Vite 的资源哈希
- 画作源图在仓库根目录 `paintings/`,打包用的副本在 `src/assets/paintings/`(与 `表情包-*.png`、`webp/` 同样的"源资源→应用副本"约定);**新增画作后需拷贝过去再重新打包**

### 关于页

- 版本号走 `app:info` 取 `app.getVersion()`,即运行中应用的版本(打包后为 asar 内 package.json 的 version),不在渲染进程硬编码,避免忘记同步
- 源码地址用系统浏览器打开:渲染进程只发 `app:openExternal`,主进程校验协议**仅放行 https** 后调用 `shell.openExternal`,防止渲染进程借它拉起任意协议;链接本身 `@click.prevent`,不会让主页窗口导航走
- 主页窗口另设 `setWindowOpenHandler` 兜底:任何新窗口请求都交给系统浏览器并 `deny`,避免弹出无样式的空白窗口

## 已知限制

- API Key 本地明文存储,分享 `%APPDATA%\remielle-pet\` 目录前请注意脱敏
- 暂不支持自动更新(electron-updater 需更新服务器,未启用)

## 致谢
- 感谢来自b站的`星语り/星の物语-星语`,米游社的`薛定谔的网络延迟`和`忽悠小昆`提供的蕾米埃尔素材