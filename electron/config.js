// API 密钥与模型由用户在设置中配置,持久化于本地 settings.json,源码不包含任何密钥
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

// 上下文携带的最大历史消息条数
const MAX_CONTEXT_MESSAGES = 30
// 本地保存的最大历史对话数
const MAX_HISTORY_CONVERSATIONS = 10

// 桌宠缩放比例(相对原大小):10% ~ 200%
const PET_SCALE_MIN = 0.1
const PET_SCALE_MAX = 2
const PET_SCALE_DEFAULT = 1

// 缩放的唯一收敛点:非数字回落默认值,越界夹到范围内
function clampPetScale(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return PET_SCALE_DEFAULT
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, n))
}

module.exports = {
  ZHIPU_API_URL,
  MAX_CONTEXT_MESSAGES,
  MAX_HISTORY_CONVERSATIONS,
  PET_SCALE_MIN,
  PET_SCALE_MAX,
  PET_SCALE_DEFAULT,
  clampPetScale,
}
