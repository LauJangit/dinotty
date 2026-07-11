export interface UploadResponse {
  ok?: boolean
  saved?: string[]
  deleted?: number
  managed?: boolean
  foreign?: boolean
  empty?: boolean
}
