import { useEffect, useRef } from 'react'

/**
 * Calls `cb(currentTime)` every animation frame while the video plays, and once
 * after seeks / loads while paused. No React state, so 60fps updates are cheap.
 */
export function useVideoClock(video: HTMLVideoElement | null, cb: (t: number) => void): void {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    if (!video) return
    let raf = 0
    const once = (): void => cbRef.current(video.currentTime)
    const loop = (): void => {
      once()
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop)
    }
    const start = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    }
    const events = ['seeked', 'seeking', 'timeupdate', 'loadedmetadata', 'loadeddata', 'pause', 'ended']
    events.forEach((ev) => video.addEventListener(ev, once))
    video.addEventListener('play', start)
    once()
    if (!video.paused) start()
    return () => {
      cancelAnimationFrame(raf)
      events.forEach((ev) => video.removeEventListener(ev, once))
      video.removeEventListener('play', start)
    }
  }, [video])
}
