import { ref } from 'vue'

const selectedPath = ref<string | null>(null)

export function useSelectedPath() {
  return { selectedPath }
}
