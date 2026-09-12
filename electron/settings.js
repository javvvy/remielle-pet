// 用户设置(大模型ID与API密钥),存储于 userData/settings.json
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { clampPetScale, PET_SCALE_DEFAULT } = require('./config')

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))
    return {
      model: data.model || '',
      apiKey: data.apiKey || '',
      followEnabled: data.followEnabled !== false,
      petScale: clampPetScale(data.petScale),
    }
  } catch {
    return { model: '', apiKey: '', followEnabled: true, petScale: PET_SCALE_DEFAULT }
  }
}

function save(cfg) {
  // 合并语义:未传字段保留原值,避免局部保存(如开关切换)覆盖大模型配置
  const prev = load()
  const data = {
    model: String(cfg.model ?? prev.model ?? '').trim(),
    apiKey: String(cfg.apiKey ?? prev.apiKey ?? '').trim(),
    followEnabled: cfg.followEnabled === undefined ? prev.followEnabled : !!cfg.followEnabled,
    petScale: cfg.petScale === undefined ? prev.petScale : clampPetScale(cfg.petScale),
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

function isConfigured() {
  const cfg = load()
  return !!(cfg.model && cfg.apiKey)
}

module.exports = { load, save, isConfigured }
