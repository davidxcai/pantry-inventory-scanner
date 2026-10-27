import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCapture, resizeToJpeg } from '../src/features/intake/image'

const { heicTo } = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to/csp', () => ({ heicTo }))

const jpg = new Blob(['jpeg'], { type: 'image/jpeg' })
const heic = new Blob(['\0\0\0\x18ftypheic\0\0\0\0heic'], { type: 'application/octet-stream' })
const close = vi.fn()
const bitmap = { width: 4000, height: 3000, close }
const drawImage = vi.fn()
let canvases: { width: number; height: number; toBlob: ReturnType<typeof vi.fn> }[]
let imageFails: boolean
let encodeFails: boolean

beforeEach(() => {
  vi.resetAllMocks()
  canvases = []
  imageFails = false
  encodeFails = false
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('Image', class {
    naturalWidth = 4000
    naturalHeight = 3000
    onload?: () => void
    onerror?: () => void
    set src(_value: string) {
      queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.())
    }
  })
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(encodeFails ? null : jpg)),
      }
      canvases.push(canvas)
      return canvas
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saved restock photos', () => {
  it('decodes an original once and produces the photo and thumbnail at their upload sizes', async () => {
    const result = await makeCapture(jpg)
    expect(result).toEqual({ photo: jpg, thumb: jpg })
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(canvases.map(({ width, height }) => [width, height])).toEqual([[1568, 1176], [512, 384]])
    expect(canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.88)
    expect(close).toHaveBeenCalledTimes(1)
    expect(heicTo).not.toHaveBeenCalled()
  })

  it('uses the display decoder when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await resizeToJpeg(jpg, 2048, 0.85)
    expect(canvases[0]).toMatchObject({ width: 2048, height: 1536 })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('falls back when the bitmap decoder rejects a saved image', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('Cannot decode'))
    await makeCapture(jpg)
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('converts a HEIC original with no image MIME type once before making both JPEGs', async () => {
    imageFails = true
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Unsupported format')).mockResolvedValue(bitmap as ImageBitmap)
    heicTo.mockResolvedValue(jpg)
    await makeCapture(heic)
    expect(heicTo).toHaveBeenCalledExactlyOnceWith({ blob: heic, type: 'image/jpeg', quality: 1 })
    expect(canvases).toHaveLength(2)
    expect(close).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('also converts HEIF photos for whole-shelf uploads', async () => {
    imageFails = true
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Unsupported format')).mockResolvedValue(bitmap as ImageBitmap)
    heicTo.mockResolvedValue(jpg)
    await resizeToJpeg(new Blob(['\0\0\0\x18ftypmif1']), 2048, 0.85)
    expect(heicTo).toHaveBeenCalledTimes(1)
    expect(canvases[0]).toMatchObject({ width: 2048, height: 1536 })
  })

  it('does not upscale small images', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ ...bitmap, width: 240, height: 320 } as ImageBitmap)
    await makeCapture(jpg)
    expect(canvases.map(({ width, height }) => [width, height])).toEqual([[240, 320], [240, 320]])
  })

  it('rejects empty and corrupt files with actionable errors and releases temporary URLs', async () => {
    await expect(makeCapture(new Blob())).rejects.toThrow('photo is empty')
    imageFails = true
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('Cannot decode'))
    await expect(makeCapture(jpg)).rejects.toThrow('Choose a JPG, PNG, WebP, or HEIC image')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(heicTo).not.toHaveBeenCalled()
  })

  it('reports failed HEIC conversion and lets the next valid photo succeed', async () => {
    imageFails = true
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Cannot decode'))
    heicTo.mockRejectedValue(new Error('Bad HEIC data'))
    await expect(makeCapture(heic)).rejects.toThrow('Could not convert this HEIC photo')
    await expect(makeCapture(jpg)).resolves.toEqual({ photo: jpg, thumb: jpg })
  })

  it('releases the decoded original when JPEG encoding fails', async () => {
    encodeFails = true
    await expect(makeCapture(jpg)).rejects.toThrow('Try a smaller image')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
