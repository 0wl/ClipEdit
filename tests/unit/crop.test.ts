import { describe, expect, it } from 'vitest'
import { aspectLabel, clampCrop, dragCrop, evenCrop, fitAspect, fullCrop, isFullCrop, moveCrop } from '@shared/crop'
import { buildExportArgs, estimateSize, targetVideoBitrate } from '@shared/ffargs'

const W = 1280
const H = 720

describe('crop math', () => {
  it('fits aspect presets inside the frame, centred', () => {
    expect(fitAspect(16 / 9, W, H)).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(fitAspect(1, W, H)).toEqual({ x: 280, y: 0, w: 720, h: 720 })
    const v = fitAspect(9 / 16, W, H)
    expect(v.h).toBe(720)
    expect(v.w).toBeCloseTo(405)
    expect(v.x).toBeCloseTo((1280 - 405) / 2)
  })

  it('free edges move independently and keep a minimum size', () => {
    const r0 = fullCrop(W, H)
    expect(dragCrop(r0, 'w', 100, 0, W, H, null)).toEqual({ x: 100, y: 0, w: 1180, h: 720 })
    expect(dragCrop(r0, 'n', 0, 50, W, H, null)).toEqual({ x: 0, y: 50, w: 1280, h: 670 })
    expect(dragCrop(r0, 'se', -280, -120, W, H, null)).toEqual({ x: 0, y: 0, w: 1000, h: 600 })
    // Can't drag past the frame or invert the box.
    expect(dragCrop(r0, 'e', 500, 0, W, H, null).w).toBe(1280)
    expect(dragCrop(r0, 'w', 5000, 0, W, H, null).w).toBe(32)
  })

  it('aspect-locked edges keep the ratio around the centre line', () => {
    const sq = fitAspect(1, W, H) // 720x720 at x=280
    const r = dragCrop(sq, 'e', -120, 0, W, H, 1)
    expect(r.w).toBeCloseTo(600)
    expect(r.h).toBeCloseTo(600)
    expect(r.x).toBe(280) // left edge anchored
    expect(r.y).toBeCloseTo(60) // centred vertically
    // Growing is limited by the frame height.
    expect(dragCrop(sq, 'e', 400, 0, W, H, 1).w).toBeCloseTo(720)
  })

  it('aspect-locked corners anchor the opposite corner', () => {
    const r0 = fitAspect(16 / 9, W, H)
    const r = dragCrop(r0, 'nw', 320, 0, W, H, 16 / 9)
    expect(r.x + r.w).toBeCloseTo(1280)
    expect(r.y + r.h).toBeCloseTo(720)
    expect(r.w / r.h).toBeCloseTo(16 / 9)
    expect(r.w).toBeCloseTo(960)
  })

  it('moves inside the frame', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 }
    expect(moveCrop(r, 2000, -2000, W, H)).toEqual({ x: 880, y: 0, w: 400, h: 300 })
    expect(clampCrop({ x: -50, y: 700, w: 5000, h: 10 }, W, H)).toEqual({ x: 0, y: 688, w: 1280, h: 32 })
  })

  it('produces even integer crops for encoding and labels presets', () => {
    expect(evenCrop({ x: 437.5, y: 0, w: 405, h: 720 }, W, H)).toEqual({ x: 438, y: 0, w: 404, h: 720 })
    expect(evenCrop({ x: 1279, y: 719, w: 3, h: 3 }, W, H)).toEqual({ x: 1278, y: 718, w: 2, h: 2 })
    expect(isFullCrop(fullCrop(W, H), W, H)).toBe(true)
    expect(isFullCrop({ x: 0, y: 0, w: 1270, h: 720 }, W, H)).toBe(false)
    expect(aspectLabel(404, 720)).toBe('9:16')
    expect(aspectLabel(720, 720)).toBe('1:1')
    expect(aspectLabel(1000, 600)).toBeNull()
  })
})

describe('crop in export', () => {
  const info = { videoBitrate: 4_000_000, bitRate: 0, audioBitrate: 0, hasAudio: true, size: 0, duration: 10, videoCodec: 'h264' }
  it('scales bitrate and size estimate with the cropped area', () => {
    expect(targetVideoBitrate(info, 0.25)).toBe(1_000_000)
    expect(estimateSize(info, 10, 0.25)).toBeLessThan(estimateSize(info, 10))
  })
  it('adds a crop filter before encoding', () => {
    const a = buildExportArgs({
      input: 'in.mp4', output: 'out.mp4', start: 0, end: 5, encoder: 'libx264', videoBitrate: 1_000_000,
      hasAudio: true, container: 'mp4', crop: { x: 438, y: 0, w: 404, h: 720 }
    })
    expect(a[a.indexOf('-vf') + 1]).toBe('crop=404:720:438:0')
    expect(a.indexOf('-vf')).toBeLessThan(a.indexOf('-pix_fmt'))
    const none = buildExportArgs({
      input: 'in.mp4', output: 'out.mp4', start: 0, end: 5, encoder: 'libx264', videoBitrate: 1_000_000, hasAudio: true, container: 'mp4'
    })
    expect(none).not.toContain('-vf')
  })
})
