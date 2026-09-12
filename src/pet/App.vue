<template>
  <div class="pet-stage" :style="stageStyle" @contextmenu.prevent="openMenu">
    <!-- 随机表情弹层 -->
    <div v-if="emoji" class="emoji-pop" :key="emojiKey">
      <img :src="emojiSrc" draggable="false" @error="onImgError(emoji)" />
    </div>

    <!-- 提示气泡 -->
    <div v-if="tip" class="tip-bubble">{{ tip }}</div>

    <!-- 桌宠主体 -->
    <img
      ref="petEl"
      class="pet-body"
      :class="{ flipped }"
      :key="gif"
      :src="gifSrc"
      draggable="false"
      @error="onImgError(gif)"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />

    <!-- 对话输入框(默认隐藏) -->
    <div v-if="inputVisible" class="chat-input">
      <input
        ref="inputEl"
        v-model="draft"
        type="text"
        placeholder="和蕾米埃尔说点什么…"
        @keydown.enter="onEnterKey"
      />
      <button class="send-btn" @click="send">发送</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { on as hookOn, send as ipcSend } from '../bridge'

// 主体使用动画WebP(规避Chromium透明窗口下GIF绘制缺陷),状态名仍沿用.gif后缀
const webpFiles = import.meta.glob('../assets/webp/*.webp', { eager: true, query: '?url', import: 'default' })
const gifFiles = import.meta.glob('../assets/*.gif', { eager: true, query: '?url', import: 'default' })
const gifs = {
  ...Object.fromEntries(Object.entries(gifFiles).map(([k, v]) => [k.split('/').pop(), v])),
  ...Object.fromEntries(Object.entries(webpFiles).map(([k, v]) => [k.split('/').pop().replace(/\.webp$/, '.gif'), v])),
}
const pngs = import.meta.glob('../assets/*.png', { eager: true, query: '?url', import: 'default' })
const emojis = Object.fromEntries(
  Object.entries(pngs).filter(([k]) => k.includes('表情包')).map(([k, v]) => [k.split('/').pop(), v])
)
const emojiNames = Object.keys(emojis)

// 桌宠缩放:初始值随 URL 传入(主进程 loadPage 的 query),避免首帧按 1.0 渲染后跳变
const petScale = ref(Number(new URLSearchParams(location.search).get('scale')) || 1)
const stageStyle = computed(() => ({ transform: `scale(${petScale.value})` }))

const gif = ref('发呆.gif')
const gifSrc = ref('')
const emojiSrc = ref('')

// 资源加载失败重试(对抗杀软扫描期等瞬时读取失败)
const retryCounts = new Map()
function retryableSrc(name) {
  const url = name.endsWith('.gif') ? gifs[name] : emojis[name]
  const n = (retryCounts.get(name) || 0) + 1
  if (!url) return ''
  if (n > 1) return `${url}${url.includes('?') ? '&' : '?'}retry=${n}`
  return url
}
function onImgError(name) {
  const n = retryCounts.get(name) || 0
  if (n < 6) {
    retryCounts.set(name, n + 1)
    setTimeout(() => {
      if (name.endsWith('.gif')) gifSrc.value = retryableSrc(name)
      else emojiSrc.value = retryableSrc(name)
    }, 500)
  } else {
    window.electron.send('diag:error', `asset load failed: ${name}`)
  }
}
function showGif(name) {
  gif.value = name
  gifSrc.value = retryableSrc(name)
}
const emoji = ref('')
const emojiKey = ref(0)
const inputVisible = ref(false)
const pinned = ref(false)
const flipped = ref(false)
const tip = ref('')
const draft = ref('')
const petEl = ref(null)
const inputEl = ref(null)

let emojiTimer = null
let tipTimer = null
let lastClickAt = 0

// 左键点击:随机表情,0.5秒冷却
function popRandomEmoji() {
  const now = Date.now()
  if (now - lastClickAt < 500) return
  lastClickAt = now
  showEmoji(emojiNames[Math.floor(Math.random() * emojiNames.length)])
}

function showEmoji(name) {
  emoji.value = name
  emojiSrc.value = retryableSrc(name)
  emojiKey.value++
  clearTimeout(emojiTimer)
  emojiTimer = setTimeout(() => (emoji.value = ''), 1300)
}

function showTip(text) {
  tip.value = text
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 1800)
}

// ---------- 右键菜单(主进程原生菜单) ----------
function openMenu() {
  ipcSend('app:contextmenu')
}

function toggleInput() {
  inputVisible.value = !inputVisible.value
  if (inputVisible.value) setTimeout(() => inputEl.value?.focus(), 50)
}

// ---------- 拖动(未固定时) ----------
let dragging = false
let moved = false
let lastX = 0
let lastY = 0

function onPointerDown(e) {
  ipcSend('pet:hold', true)
  if (e.button !== 0) return
  dragging = true
  moved = false
  lastX = e.clientX
  lastY = e.clientY
  petEl.value.setPointerCapture(e.pointerId)
}

function onPointerMove(e) {
  if (!dragging) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  if (!moved && Math.abs(dx) + Math.abs(dy) > 2) moved = true
  if (moved && !pinned.value) window.electron.send('pet:moveBy', dx, dy)
}

function onPointerUp() {
  ipcSend('pet:hold', false)
  if (dragging && !moved) {
    popRandomEmoji()
    // 通知主进程点击:空闲阶段据此随机切换空闲动画(阶段判定与30秒冷却在主进程)
    ipcSend('pet:clicked')
  }
  dragging = false
}

// ---------- 发送 ----------
// 过滤输入法组合中的回车(IME选词),避免误发送
function onEnterKey(e) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  send()
}

async function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  await window.electron.invoke('chat:send', text)
}

let offs = []
onMounted(() => {
  showGif(gif.value)
  // 渲染进程错误上报,便于排查"主体透明"类问题
  window.addEventListener('error', e => {
    window.electron.send('diag:error', `pet renderer: ${e.message} ${e.filename || ''}`)
  })
  window.addEventListener('unhandledrejection', e => {
    window.electron.send('diag:error', `pet renderer rejection: ${e.reason}`)
  })
  offs.push(hookOn('pet:state', g => showGif(g)))
  offs.push(hookOn('pet:emoji', name => showEmoji(name)))
  offs.push(hookOn('pet:toggleInput', () => toggleInput()))
  offs.push(hookOn('pet:hideInput', () => (inputVisible.value = false)))
  offs.push(hookOn('pet:pinned', v => {
    pinned.value = v
    showTip(v ? '已固定' : '已解除固定')
  }))
  offs.push(hookOn('pet:tip', t => showTip(t)))
  offs.push(hookOn('pet:flip', d => (flipped.value = d === -1)))
  offs.push(hookOn('pet:scale', s => (petScale.value = s)))
})

onBeforeUnmount(() => offs.forEach(off => off()))
</script>

<style scoped>
.pet-stage {
  position: relative;
  width: 260px;
  height: 360px;
  /* 缩放以左上角为原点,与主进程按 260/360 基准换算窗口尺寸保持一致 */
  transform-origin: top left;
}
.pet-body {
  position: absolute;
  top: 60px;
  left: 10px;
  width: 240px;
  height: 240px;
  object-fit: contain;
  cursor: pointer;
}
.pet-body.flipped {
  transform: scaleX(-1);
}
.emoji-pop {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  animation: pop 1.3s ease forwards;
  pointer-events: none;
  z-index: 10;
}
.emoji-pop img {
  width: 90px;
  height: 90px;
  object-fit: contain;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
}
@keyframes pop {
  0% { transform: translateX(-50%) scale(0.3); opacity: 0; }
  20% { transform: translateX(-50%) scale(1.15); opacity: 1; }
  35% { transform: translateX(-50%) scale(1); }
  75% { transform: translateX(-50%) scale(1); opacity: 1; }
  100% { transform: translateX(-50%) scale(0.9) translateY(-10px); opacity: 0; }
}
.tip-bubble {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: #ffffff;
  color: #555;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  z-index: 15;
  animation: fadein 0.2s ease;
}
@keyframes fadein { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
.chat-input {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  background: #ffffff;
  border-radius: 20px;
  padding: 6px 6px 6px 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 12;
}
.chat-input input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  background: transparent;
  color: #333;
}
.send-btn {
  border: none;
  background: #f3b6cf;
  color: #fff;
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 14px;
  cursor: pointer;
}
.send-btn:hover { background: #e89bbd; }
</style>
