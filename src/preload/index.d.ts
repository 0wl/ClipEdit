import type { ClipEditApi } from '../shared/api'

declare global {
  interface Window {
    clipedit: ClipEditApi
  }
}

export {}
