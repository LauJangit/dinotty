import { computed } from 'vue'
import { settings } from './useSettings'

export type Locale = 'en' | 'zh'

const messages: Record<Locale, Record<string, string>> = {
  en: {
    'app.settings': 'Settings',
    'app.preview': 'Web preview',
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.lang.zh': '中文',
    'settings.lang.en': 'English',
    'settings.theme': 'Theme',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.dracula': 'Dracula',
    'settings.theme.nord': 'Nord',
    'settings.theme.monokai': 'Monokai',
    'settings.theme.solarized': 'Solarized',
    'settings.actionKeyboard': 'Action Keyboard',
    'settings.akHint':
      'Matches device:  drag right edge for width, tap label to edit; bottom arrows and ↵ are fixed.',
    'settings.dragSort': 'Drag to reorder',
    'settings.dragResize': 'Drag to resize width',
    'settings.deleteRow': 'Remove row',
    'settings.addRow': '+ Add row',
    'settings.resetDefault': 'Reset default',
    'settings.editKey': 'Edit key',
    'settings.label': 'Label',
    'settings.send': 'Send',
    'settings.sendPlaceholder': 'Commands or text; use Record for key chords',
    'settings.record': '⏺ Record',
    'settings.stop': '⏹ Stop',
    'settings.style': 'Style',
    'settings.style.normal': 'Normal',
    'settings.style.danger': 'Danger (red)',
    'settings.appendEnter': 'Append Enter (↵) after send',
    'settings.repeatHold': 'Repeat on hold',
    'settings.save': 'Save',
    'settings.cancel': 'Cancel',
  },
  zh: {
    'app.settings': '设置',
    'app.preview': '网页预览',
    'settings.title': '设置',
    'settings.language': '语言',
    'settings.lang.zh': '中文',
    'settings.lang.en': 'English',
    'settings.theme': '主题',
    'settings.theme.dark': '深色',
    'settings.theme.light': '浅色',
    'settings.theme.dracula': 'Dracula',
    'settings.theme.nord': 'Nord',
    'settings.theme.monokai': 'Monokai',
    'settings.theme.solarized': 'Solarized',
    'settings.actionKeyboard': '快捷键盘',
    'settings.akHint':
      '预览与实机一致：右侧拖宽度，点键帽编辑；底部方向键与 ↵ 固定。',
    'settings.dragSort': '拖动排序',
    'settings.dragResize': '拖动调宽度',
    'settings.deleteRow': '删除此行',
    'settings.addRow': '+ 添加一行',
    'settings.resetDefault': '恢复默认',
    'settings.editKey': '编辑按键',
    'settings.label': '显示文字',
    'settings.send': '发送内容',
    'settings.sendPlaceholder': '命令或文本；可用录制捕获组合键',
    'settings.record': '⏺ 录制',
    'settings.stop': '⏹ 停止',
    'settings.style': '样式',
    'settings.style.normal': '普通',
    'settings.style.danger': '危险（红）',
    'settings.appendEnter': '发送后追加回车（↵）',
    'settings.repeatHold': '长按重复',
    'settings.save': '保存',
    'settings.cancel': '取消',
  },
}

function normalizeLocale(raw: string | undefined): Locale {
  return raw === 'en' ? 'en' : 'zh'
}

export function useI18n() {
  const locale = computed(() => normalizeLocale(settings.locale))

  function t(key: string): string {
    const table = messages[locale.value]
    return table[key] ?? key
  }

  function themeLabel(name: string): string {
    return t(`settings.theme.${name}`)
  }

  return { locale, t, themeLabel }
}
