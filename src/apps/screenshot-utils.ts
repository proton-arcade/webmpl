import { useOS } from '../os/store'
import { HOME, vfs, join } from '../os/vfs'

function stamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function saveToPictures(dataUrl: string, name: string) {
  const path = join(`${HOME}/Pictures`, name)
  vfs.write(path, '', 'image/png', dataUrl)
  return path
}

/** Renders the current desktop background into a PNG and writes it to ~/Pictures. */
export async function saveWallpaperShot(): Promise<string> {
  const wallpaper = useOS.getState().settings.wallpaper
  const name = `Screenshot_${stamp()}.png`
  if (wallpaper.startsWith('#')) {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = wallpaper
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '500 22px Ubuntu, sans-serif'
    ctx.fillText(`Mixt Web OS — solid colour background ${wallpaper}`, 28, 48)
    saveToPictures(canvas.toDataURL('image/png'), name)
    return `Saved ${name} to ~/Pictures`
  }
  try {
    const img = await loadImage(wallpaper)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1280
    canvas.height = img.naturalHeight || 720
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(20,32,16,0.55)'
    ctx.fillRect(0, canvas.height - 46, canvas.width, 46)
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.font = '500 18px Ubuntu, sans-serif'
    ctx.fillText(`Mixt Web OS ${new Date().toLocaleString()}`, 20, canvas.height - 17)
    saveToPictures(canvas.toDataURL('image/png'), name)
    return `Saved ${name} to ~/Pictures`
  } catch {
    return 'Could not read the wallpaper image.'
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

export interface CaptureResult {
  ok: boolean
  path?: string
  message: string
}

/**
 * Attempts a real screen capture with getDisplayMedia. Browsers require a user
 * gesture and (outside a sandbox) show a picker; inside an iframe the API may be
 * blocked entirely, in which case we explain why and fall back to a rendering.
 */
export async function captureScreen(opts: { delaySeconds?: number; includePointer?: boolean } = {}): Promise<CaptureResult> {
  if (opts.delaySeconds) {
    await new Promise((r) => setTimeout(r, opts.delaySeconds! * 1000))
  }
  const md: any = navigator.mediaDevices
  if (!md?.getDisplayMedia) {
    const fallback = await saveWallpaperShot()
    return { ok: false, message: `Screen capture is not available here. ${fallback}` }
  }
  try {
    const stream = await md.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: false,
      preferCurrentTab: true,
    } as any)
    const track = stream.getVideoTracks()[0]
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((r) => setTimeout(r, 220))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    if (opts.includePointer) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    track.stop()
    stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    const name = `Screenshot_${stamp()}.png`
    const path = saveToPictures(canvas.toDataURL('image/png'), name)
    return { ok: true, path, message: `Saved ${name} to ~/Pictures` }
  } catch (e: any) {
    const fallback = await saveWallpaperShot()
    return {
      ok: false,
      message: `${e?.name === 'NotAllowedError' ? 'Screen capture was denied' : 'Screen capture failed'} — ${e?.message ?? 'unknown reason'}.\n${fallback}`,
    }
  }
}
