# 蕾米埃尔桌宠(remielle-pet)

可对话的 AI 桌宠软件。基于 Electron + Vue3 构建,桌面悬浮一位动画桌宠"蕾米埃尔",接入智谱云端大模型进行角色扮演对话。纯客户端应用,无自建后端。

## 功能
- AI对话
- 桌面陪伴

### 桌宠主体
- **状态机**:空闲(发呆/思考/欣赏随机)→ 对话中(创作)→ 完成(创作并完成 1 秒)→ 欣赏(欣赏/自豪随机 10~60 秒)→ 回到空闲
- **空闲动画轮换**:进入空闲时随机播放发呆/思考/欣赏之一;空闲阶段**点击主体**随机切换到另一个空闲动画,带 **30 秒冷却**(冷却期内的点击不切换);冷却走完后再 **60 秒**无点击,自动随机轮换一次(即每次切换后最长 **90 秒**必然轮换)。切换只会选中与当前不同的动画,避免"点了没反应";进入对话/欣赏阶段时停止轮换
- **左键点击**:主体上方随机弹出表情包(0.5 秒冷却);同时按上述规则参与空闲动画轮换
- **右键菜单**(主体右方):对话框(开关桌宠输入框)/ 主页 / 固定(固定后不可拖动)/ 跟随光标(空闲时跟随鼠标,默认开启)/ 设置(开发中)/ 退出
- **系统托盘**:托盘图标即软件图标;左键打开主页,右键弹出与桌宠主体完全一致的选项卡(菜单打开期间跟随暂停,避免光标停在托盘角时桌宠乱跑)
- **拖动**:未固定时可左键拖动到任意位置
- **光标跟随**:空闲时向鼠标光标缓动靠近并停在光标右下方,随移动方向转身;对话中/固定/拖动/菜单打开/主页可见时暂停;主页设置页与右键菜单均可开关,状态持久化(默认开启)
- **输入框**:默认隐藏,右键菜单开启;Enter 或点击发送即打开主页开始对话

### 主页
- 白色简约风格,左侧导航:对话 / 设置 / 关于
- 对话页:气泡式消息(SSE 流式输出,桌宠头像),左上角"开启新对话",右上角"历史记录"(本地最多 10 条)
- 设置页:配置大模型(模型ID + API Key)、光标跟随开关(均存储在本机)

## 注意事项
- 目前发行版本只支持Windows端
- 目前默认安装到C:\Users\AppData\Local\Programs目录下,%APPDATA%\remielle-pet目录下存储数据和日志

## 开发进度
- [x] 桌宠主体
- [x] 主页面
- [x] 动画播放逻辑优化(空闲动画轮换,见"空闲动画轮换")
- [ ] 解决拖动僵硬问题
- [ ] 关于页面开发
- [ ] 设置页面新增功能
- [ ] 新增缩放比例功能

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

## 已知限制

- "设置"中的其余项与"关于"页内容待开发
- API Key 本地明文存储,分享 `%APPDATA%\remielle-pet\` 目录前请注意脱敏
- 暂不支持自动更新(electron-updater 需更新服务器,未启用)
