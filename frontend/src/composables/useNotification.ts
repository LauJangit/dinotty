import { ref, reactive, computed, h, watch } from 'vue'
import { useToast, TYPE } from 'vue-toastification'
import { getApiBase, wsUrlWithToken } from './apiBase'
import { isTauri } from './useTransport'
import { settings } from './useSettings'
import { useI18n } from './useI18n'
import { playSound, type NotificationType, type SoundConfig } from './useNotificationSound'

export interface NotificationItem {
  id: string
  type: NotificationType
  paneId: string
  title: string | null
  body: string
  timestamp: number
}

const notifications = ref<NotificationItem[]>([])
const panelVisible = ref(false)
const unreadByPane = reactive<Record<string, NotificationType>>({})
const unreadCount = computed(() => notifications.value.length)

let ws: WebSocket | null = null
let idCounter = 0
let initialized = false
let reconnectDelay = 3000

function genId(): string {
  return `notif-${++idCounter}-${Date.now()}`
}

function severityRank(t: NotificationType): number {
  const ranks: Record<NotificationType, number> = { info: 0, success: 1, warning: 2, error: 3, urgent: 4 }
  return ranks[t] ?? 0
}

function getNotifConfig() {
  return settings.notification
}

function handleEvent(event: { type: string; pane_id: string; title?: string | null; body?: string; notification_type?: string }) {
  const cfg = getNotifConfig()
  if (!cfg || !cfg.enabled) return

  let notifType: NotificationType = 'info'
  let title: string | null = null
  let body = ''

  if (event.type === 'bell') {
    if (!cfg.bell?.enabled) return
    body = 'Bell'
  } else if (event.type === 'notify') {
    if (!cfg.osc_notify) return
    title = event.title ?? null
    body = event.body ?? ''
    notifType = (event.notification_type as NotificationType) || 'info'
  } else {
    return
  }

  const item: NotificationItem = {
    id: genId(),
    type: notifType,
    paneId: event.pane_id,
    title,
    body,
    timestamp: Date.now(),
  }
  notifications.value.unshift(item)
  if (notifications.value.length > 100) {
    notifications.value.length = 100
  }

  // Track unread per pane (highest severity)
  const current = unreadByPane[event.pane_id]
  if (!current || severityRank(notifType) > severityRank(current)) {
    unreadByPane[event.pane_id] = notifType
  }

  // Sound
  if (cfg.channels?.sound) {
    const soundCfg: SoundConfig | undefined = cfg.sounds?.[notifType]
    if (soundCfg) playSound(soundCfg)
  }

  // Vibration
  if (cfg.channels?.vibration && navigator.vibrate) {
    navigator.vibrate(notifType === 'urgent' ? [100, 50, 100, 50, 100] : [100])
  }

  // Toast notification (reuses panel channel config)
  if (cfg.channels?.panel) {
    showToast(item)
  }
}

const toastTypeMap: Record<NotificationType, any> = {
  info: TYPE.INFO,
  success: TYPE.SUCCESS,
  warning: TYPE.WARNING,
  error: TYPE.ERROR,
  urgent: TYPE.ERROR,
}

function showToast(item: NotificationItem) {
  const toast = useToast()
  const { t } = useI18n()
  const children = [
    item.title ? h('strong', { class: 'notif-toast-title' }, item.title) : null,
    h('span', { class: 'notif-toast-body' }, item.body),
    h('button', {
      class: 'notif-toast-btn',
      onClick: () => { panelVisible.value = true },
    }, t('notification.viewAll')),
  ].filter(Boolean)
  const content = h('div', { class: 'notif-toast-content' }, children)
  toast(content, {
    type: toastTypeMap[item.type] ?? TYPE.INFO,
    timeout: item.type === 'urgent' ? 8000 : 5000,
  })
}


function connectWs() {
  if (ws) return
  const connect = async () => {
    let url: string
    if (isTauri()) {
      const origin = await getApiBase()
      url = `${origin.replace(/^http/, 'ws')}/ws/notify`
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      url = `${proto}//${location.host}/ws/notify`
    }
    ws = new WebSocket(wsUrlWithToken(url))
    ws.onopen = () => {
      reconnectDelay = 3000
    }
    ws.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data))
      } catch {}
    }
    ws.onclose = () => {
      ws = null
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    }
    ws.onerror = () => {}
  }
  connect()
}

export function useNotification() {
  if (!initialized) {
    initialized = true
    connectWs()
  }
  return {
    notifications,
    panelVisible,
    unreadByPane,
    unreadCount,
    dismissOne(id: string) {
      const item = notifications.value.find((n) => n.id === id)
      notifications.value = notifications.value.filter((n) => n.id !== id)
      if (item && !notifications.value.some((n) => n.paneId === item.paneId)) {
        delete unreadByPane[item.paneId]
      }
    },
    clearAll() {
      notifications.value = []
      for (const k of Object.keys(unreadByPane)) delete unreadByPane[k]
      panelVisible.value = false
    },
    clearPaneUnread(paneId: string) {
      delete unreadByPane[paneId]
    },
    togglePanel() {
      panelVisible.value = !panelVisible.value
    },
  }
}
