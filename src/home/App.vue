<template>
  <div class="layout">
    <!-- 左侧导航栏 -->
    <aside class="nav">
      <img class="logo" :src="avatar" draggable="false" />
      <div class="nav-items">
        <div
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: tab === item.key }"
          @click="switchTab(item.key)"
        >{{ item.label }}</div>
      </div>
    </aside>

    <!-- 主区域 -->
    <main class="content">
      <!-- 对话栏 -->
      <section v-if="tab === 'chat'" class="chat">
        <header class="chat-header">
          <button class="ghost-btn" @click="newChat">＋ 新对话</button>
          <div class="header-right">
            <div v-if="historyVisible" class="history-panel">
              <div class="history-title">历史记录</div>
              <div v-if="!history.length" class="history-empty">暂无历史对话</div>
              <div
                v-for="c in history"
                :key="c.id"
                class="history-item"
                :class="{ current: c.id === conversation?.id }"
                @click="loadHistory(c.id)"
              >
                <div class="history-item-title">{{ c.title || '新对话' }}</div>
                <div class="history-item-time">{{ formatTime(c.createdAt) }}</div>
              </div>
            </div>
            <button class="ghost-btn" @click="historyVisible = !historyVisible">历史记录</button>
          </div>
        </header>

        <div class="messages" ref="messagesEl">
          <div v-if="!conversation || !conversation.messages.length" class="empty-hint">
            和蕾米埃尔开始一段新的对话吧~
          </div>
          <div
            v-for="(m, i) in conversation?.messages || []"
            :key="i"
            class="msg-row"
            :class="m.role"
          >
            <img v-if="m.role === 'assistant'" class="avatar" :src="avatar" />
            <div class="bubble">{{ m.content }}<span v-if="streaming && i === conversation.messages.length - 1" class="cursor">▍</span></div>
          </div>
        </div>

        <footer class="input-bar">
          <textarea
            v-model="draft"
            placeholder="输入消息,Enter 发送…"
            @keydown.enter="onEnterKey"
          ></textarea>
          <button class="send-btn" :class="{ active: canSend }" :disabled="!canSend" @click="send">发送</button>
        </footer>
      </section>

      <!-- 设置栏 -->
      <section v-else-if="tab === 'settings'" class="settings-page">
        <div class="settings-card" @click="openModelConfig">
          <div class="settings-card-title">配置大模型</div>
          <div class="settings-card-desc">
            {{ modelCfg.model ? `当前模型:${modelCfg.model}` : '未配置,对话前需要配置模型ID和API Key' }}
          </div>
        </div>

        <!-- 光标跟随开关 -->
        <div class="settings-card" @click="toggleFollow">
          <div class="settings-card-row">
            <div>
              <div class="settings-card-title">光标跟随</div>
              <div class="settings-card-desc">空闲时桌宠跟随鼠标移动,对话/拖动/固定时自动暂停</div>
            </div>
            <div class="switch" :class="{ on: followEnabled }"><div class="knob"></div></div>
          </div>
        </div>
      </section>

      <!-- 关于栏(空内容) -->
      <section v-else class="placeholder-page"></section>
    </main>

    <!-- 模型配置弹窗 -->
    <div v-if="configModalVisible" class="modal-mask" @click.self="closeModelConfig">
      <div class="modal">
        <div class="modal-title">配置大模型</div>
        <div class="modal-field">
          <label>模型ID</label>
          <input v-model="modelCfgDraft.model" type="text" placeholder="例如:glm-4-flash" />
        </div>
        <div class="modal-field">
          <label>API Key</label>
          <input v-model="modelCfgDraft.apiKey" type="password" placeholder="请输入API Key" />
        </div>
        <div class="modal-btns">
          <button class="ghost-btn" @click="closeModelConfig">取消</button>
          <button class="primary-btn" :disabled="!modelCfgDraft.model.trim() || !modelCfgDraft.apiKey.trim()" @click="saveModelConfig">保存</button>
        </div>
      </div>
    </div>

    <!-- 大模型配置读取失败提示 -->
    <div v-if="configPromptVisible" class="modal-mask">
      <div class="modal">
        <div class="modal-title">提示</div>
        <div class="modal-text">大模型配置读取失败,请前往设置配置</div>
        <div class="modal-btns">
          <button class="ghost-btn" @click="configPromptVisible = false">取消</button>
          <button class="primary-btn" @click="goSettingsFromPrompt">前往</button>
        </div>
      </div>
    </div>

    <!-- toast -->
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { invoke, on as hookOn } from '../bridge'
import avatarUrl from '../assets/图标1.png'

const avatar = avatarUrl
const navItems = [
  { key: 'chat', label: '对话' },
  { key: 'settings', label: '设置' },
  { key: 'about', label: '关于' },
]

const tab = ref('chat')
const conversation = ref(null)
const history = ref([])
const historyVisible = ref(false)
const draft = ref('')
const streaming = ref(false)
const toast = ref('')
const messagesEl = ref(null)

let toastTimer = null
let offs = []

function showToast(text) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1800)
}

function switchTab(key) {
  tab.value = key
  if (key === 'settings') refreshModelCfg()
}

// ---------- 大模型配置 ----------
const modelCfg = ref({ model: '', apiKey: '' })
const modelCfgDraft = ref({ model: '', apiKey: '' })
const configModalVisible = ref(false)
const configPromptVisible = ref(false)

async function refreshModelCfg() {
  modelCfg.value = await invoke('settings:get')
  followEnabled.value = modelCfg.value.followEnabled !== false
}

const followEnabled = ref(true)

async function toggleFollow() {
  const saved = await invoke('settings:save', { followEnabled: !followEnabled.value })
  followEnabled.value = saved.followEnabled
  showToast(saved.followEnabled ? '光标跟随已开启' : '光标跟随已关闭')
}

function openModelConfig() {
  modelCfgDraft.value = { ...modelCfg.value }
  configModalVisible.value = true
}

function closeModelConfig() {
  configModalVisible.value = false
}

async function saveModelConfig() {
  modelCfg.value = await invoke('settings:save', { ...modelCfgDraft.value })
  configModalVisible.value = false
  showToast('大模型配置已保存')
}

function openConfigPrompt() {
  configPromptVisible.value = true
}

function goSettingsFromPrompt() {
  configPromptVisible.value = false
  switchTab('settings')
  openModelConfig()
}

function formatTime(ts) {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function scrollBottom() {
  await nextTick()
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight })
}

async function refreshHistory() {
  history.value = await invoke('chat:history')
}

async function newChat() {
  const res = await invoke('chat:new')
  if (res.busy) { showToast('对话进行中,请稍候~'); return }
  draft.value = ''
  historyVisible.value = false
  await refreshHistory()
  scrollBottom()
}

async function loadHistory(id) {
  const res = await invoke('chat:load', id)
  if (res.busy) { showToast('对话进行中,请稍候~'); return }
  historyVisible.value = false
  scrollBottom()
}

const canSend = computed(() => !streaming.value && !!draft.value.trim())

// 过滤输入法组合中的回车(IME选词),避免误发送
function onEnterKey(e) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  send()
}

async function send() {
  const text = draft.value.trim()
  if (!text || streaming.value) return
  draft.value = ''
  await invoke('chat:send', text)
}

onMounted(async () => {
  conversation.value = await invoke('chat:current')
  await refreshHistory()
  await refreshModelCfg()
  // 窗口加载晚于主进程事件时的补发(如配置缺失提示)
  const flags = await invoke('chat:promptFlags')
  if (flags.configMissing) openConfigPrompt()
  offs.push(hookOn('chat:reset', conv => {
    conversation.value = conv
    streaming.value = true
    scrollBottom()
  }))
  offs.push(hookOn('chat:chunk', chunk => {
    const msgs = conversation.value?.messages
    if (msgs && msgs.length && msgs[msgs.length - 1].role === 'assistant') {
      msgs[msgs.length - 1].content += chunk
    } else {
      msgs.push({ role: 'assistant', content: chunk })
    }
    scrollBottom()
  }))
  offs.push(hookOn('chat:done', async () => {
    // 以主进程中的完整对话为准,规避窗口加载晚于流式事件导致的丢字
    conversation.value = await invoke('chat:current')
    streaming.value = false
    refreshHistory()
    scrollBottom()
  }))
  offs.push(hookOn('chat:configMissing', () => openConfigPrompt()))
  scrollBottom()
})

onBeforeUnmount(() => offs.forEach(off => off()))
</script>

<style scoped>
.layout { display: flex; height: 100%; background: #fff; }

/* 左侧导航 */
.nav {
  width: 190px;
  background: #fafafa;
  border-right: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
  padding: 24px 0;
  flex-shrink: 0;
}
.logo {
  width: 64px;
  height: 64px;
  margin: 0 auto 28px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}
.nav-items { display: flex; flex-direction: column; gap: 4px; padding: 0 12px; }
.nav-item {
  padding: 11px 18px;
  border-radius: 10px;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}
.nav-item:hover { background: #f2edf3; color: #d96ba0; }
.nav-item.active { background: #f8e4ee; color: #c95d94; font-weight: 600; }

/* 对话栏 */
.content { flex: 1; display: flex; min-width: 0; }
.chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #f2f2f2;
}
.header-right { position: relative; }
.ghost-btn {
  border: 1px solid #e8d5e0;
  background: #fff;
  color: #c95d94;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.15s;
}
.ghost-btn:hover { background: #fdf3f8; }

.history-panel {
  position: absolute;
  right: 0;
  top: 46px;
  width: 260px;
  background: #fff;
  border: 1px solid #f0e4ea;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
  z-index: 20;
  max-height: 380px;
  overflow-y: auto;
  padding: 8px;
}
.history-title { font-size: 12px; color: #aaa; padding: 6px 10px; }
.history-empty { font-size: 13px; color: #bbb; padding: 16px 10px; text-align: center; }
.history-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; }
.history-item:hover { background: #faf5f8; }
.history-item.current { background: #f8e4ee; }
.history-item-title { font-size: 13px; color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-item-time { font-size: 11px; color: #bbb; margin-top: 3px; }

.messages { flex: 1; overflow-y: auto; padding: 24px 28px; }
.empty-hint { height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 14px; }
.msg-row { display: flex; margin-bottom: 16px; gap: 10px; }
.msg-row.user { justify-content: flex-end; }
.msg-row .bubble {
  max-width: 62%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-row.user .bubble { background: #f8c9dd; color: #5a3a49; border-top-right-radius: 4px; }
.msg-row.assistant .bubble { background: #f6f6f6; color: #333; border-top-left-radius: 4px; }
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.cursor { animation: blink 0.8s infinite; color: #d96ba0; }
@keyframes blink { 50% { opacity: 0; } }

.input-bar {
  display: flex;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid #f2f2f2;
  align-items: flex-end;
}
.input-bar textarea {
  flex: 1;
  resize: none;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  height: 44px;
  max-height: 120px;
  color: #333;
}
.input-bar textarea:focus { border-color: #e8b7cf; }
.send-btn {
  border: none;
  background: #e9e9e9;
  color: #bbb;
  font-size: 14px;
  padding: 11px 26px;
  border-radius: 12px;
  cursor: not-allowed;
  transition: all 0.15s;
}
/* 有内容可发送时高亮 */
.send-btn.active {
  background: #f062ab;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(240, 98, 171, 0.35);
}
.send-btn.active:hover { background: #e04f9a; }

.placeholder-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-text { color: #ccc; font-size: 15px; }

/* 设置页 */
.settings-page { flex: 1; padding: 32px 36px; }
.settings-card {
  max-width: 420px;
  background: #fff;
  border: 1px solid #f0e4ea;
  border-radius: 14px;
  padding: 20px 24px;
  cursor: pointer;
  transition: all 0.15s;
}
.settings-card:hover { border-color: #e8b7cf; box-shadow: 0 6px 18px rgba(240, 98, 171, 0.1); }
.settings-card-title { font-size: 15px; font-weight: 600; color: #444; margin-bottom: 8px; }
.settings-card-desc { font-size: 13px; color: #999; }
.settings-card + .settings-card { margin-top: 12px; }
.settings-card-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.settings-card-row .settings-card-title { margin-bottom: 4px; }
.switch {
  flex: none;
  width: 42px;
  height: 24px;
  border-radius: 12px;
  background: #e0d5dc;
  padding: 2px;
  box-sizing: border-box;
  transition: background 0.15s;
}
.switch.on { background: #f3b6cf; }
.switch .knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s;
}
.switch.on .knob { transform: translateX(18px); }

/* 弹窗 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 26px 28px 22px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}
.modal-title { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 18px; }
.modal-text { font-size: 14px; color: #555; margin-bottom: 22px; }
.modal-field { margin-bottom: 16px; }
.modal-field label { display: block; font-size: 12px; color: #999; margin-bottom: 6px; }
.modal-field input {
  width: 100%;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  outline: none;
  color: #333;
}
.modal-field input:focus { border-color: #e8b7cf; }
.modal-btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.primary-btn {
  border: none;
  background: #f062ab;
  color: #fff;
  font-size: 13px;
  padding: 9px 24px;
  border-radius: 18px;
  cursor: pointer;
}
.primary-btn:hover:not(:disabled) { background: #e04f9a; }
.primary-btn:disabled { background: #e9e9e9; color: #bbb; cursor: not-allowed; }

.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(60, 50, 55, 0.85);
  color: #fff;
  font-size: 13px;
  padding: 9px 20px;
  border-radius: 18px;
  z-index: 99;
  animation: fadeup 0.25s ease;
}
@keyframes fadeup { from { opacity: 0; transform: translateX(-50%) translateY(8px); } }
</style>
