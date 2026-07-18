import { reactive } from 'vue'

type PromptOptions = {
  confirmText?: string
  cancelText?: string
  placeholder?: string
}

export const promptState = reactive<{
  visible: boolean
  title: string
  defaultValue: string
  placeholder: string
  confirmText: string
  cancelText: string
  resolve: ((value: string | null) => void) | null
}>({
  visible: false,
  title: '',
  defaultValue: '',
  placeholder: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  resolve: null,
})

function settle(value: string | null) {
  const resolve = promptState.resolve
  promptState.visible = false
  promptState.resolve = null
  resolve?.(value)
}

export function uiPrompt(
  title: string,
  defaultValue = '',
  opts: PromptOptions = {}
): Promise<string | null> {
  if (promptState.resolve) settle(null)

  promptState.title = title
  promptState.defaultValue = defaultValue
  promptState.placeholder = opts.placeholder ?? ''
  promptState.confirmText = opts.confirmText ?? 'OK'
  promptState.cancelText = opts.cancelText ?? 'Cancel'
  promptState.visible = true

  return new Promise<string | null>((resolve) => {
    promptState.resolve = resolve
  })
}

export function promptResolve(value: string) {
  settle(value)
}

export function promptCancel() {
  settle(null)
}
