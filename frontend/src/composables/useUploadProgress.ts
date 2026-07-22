import { ref, type Ref } from 'vue'
import { formatMB, type UploadProgress } from './useUpload'

type TFunc = (key: string, params?: Record<string, string | number>) => string

export interface UploadProgressOptions {
  t: TFunc
  uploadErrorStatus: (err: unknown) => number | undefined
}

export interface UploadProgressState {
  uploadInProgress: Ref<boolean>
  uploadProgress: Ref<number>
  uploadLoaded: Ref<number>
  uploadTotal: Ref<number>
  uploadProcessing: Ref<boolean>
  beginUploadProgress: () => void
  uploadProgressLabel: () => string
  updateUploadProgress: (p: UploadProgress) => void
  finishUploadProgress: () => void
  uploadErrorMessage: (err: unknown) => string
}

export function useUploadProgress(opts: UploadProgressOptions): UploadProgressState {
  const { t, uploadErrorStatus } = opts

  const uploadInProgress = ref(false)
  const uploadProgress = ref(0)
  const uploadLoaded = ref(0)
  const uploadTotal = ref(0)
  const uploadProcessing = ref(false)
  let activeUploads = 0

  function beginUploadProgress() {
    activeUploads += 1
    uploadInProgress.value = true
    uploadProcessing.value = false
    uploadProgress.value = 0
    uploadLoaded.value = 0
    uploadTotal.value = 0
  }

  function uploadProgressLabel() {
    if (uploadProcessing.value) return t('settings.uploads.processing')
    return `${formatMB(uploadLoaded.value)} / ${formatMB(uploadTotal.value)} MB`
  }

  function updateUploadProgress(p: UploadProgress) {
    uploadLoaded.value = p.loaded
    uploadTotal.value = p.total
    const pct = Math.max(0, Math.min(100, Math.round((p.loaded / p.total) * 100)))
    uploadProgress.value = pct
    uploadProcessing.value = pct >= 100
  }

  function finishUploadProgress() {
    activeUploads = Math.max(0, activeUploads - 1)
    if (activeUploads === 0) {
      uploadInProgress.value = false
      uploadProcessing.value = false
      uploadProgress.value = 0
      uploadLoaded.value = 0
      uploadTotal.value = 0
    }
  }

  function uploadErrorMessage(err: unknown) {
    const status = uploadErrorStatus(err)
    if (status === 413) return t('mobileKb.uploadTooLarge')
    if (status === 507) return t('settings.uploads.toastDiskFull')
    return t('mobileKb.uploadFailed')
  }

  return {
    uploadInProgress,
    uploadProgress,
    uploadLoaded,
    uploadTotal,
    uploadProcessing,
    beginUploadProgress,
    uploadProgressLabel,
    updateUploadProgress,
    finishUploadProgress,
    uploadErrorMessage,
  }
}
