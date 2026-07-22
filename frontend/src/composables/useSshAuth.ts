import { ref } from 'vue'
import type { Ref } from 'vue'
import { useSyncWebSocket } from './useSyncWebSocket'

export interface SshAuthPrompt {
  prompt: string
  echo: boolean
}

export interface SshAuthOptions {
  syncWs: ReturnType<typeof useSyncWebSocket>
}

export interface SshAuth {
  sshAuthVisible: Ref<boolean>
  sshAuthHost: Ref<string>
  sshAuthPaneId: Ref<string>
  sshAuthPrompts: Ref<SshAuthPrompt[]>
  showPrompt: (paneId: string, prompts: SshAuthPrompt[], host: string) => void
  submit: (responses: string[]) => void
  cancel: () => void
}

export function useSshAuth(opts: SshAuthOptions): SshAuth {
  const { syncWs } = opts

  const sshAuthVisible = ref(false)
  const sshAuthHost = ref('')
  const sshAuthPaneId = ref('')
  const sshAuthPrompts = ref<SshAuthPrompt[]>([])

  function showPrompt(paneId: string, prompts: SshAuthPrompt[], host: string): void {
    sshAuthPaneId.value = paneId
    sshAuthPrompts.value = prompts
    sshAuthHost.value = host
    sshAuthVisible.value = true
  }

  function submit(responses: string[]): void {
    syncWs.sendSshAuthResponse(sshAuthPaneId.value, responses)
    sshAuthVisible.value = false
  }

  function cancel(): void {
    sshAuthVisible.value = false
  }

  return {
    sshAuthVisible,
    sshAuthHost,
    sshAuthPaneId,
    sshAuthPrompts,
    showPrompt,
    submit,
    cancel,
  }
}
