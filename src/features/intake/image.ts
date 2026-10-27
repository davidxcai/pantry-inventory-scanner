type DecodedPhoto = {
  image: CanvasImageSource
  width: number
  height: number
  close: () => void
}

const READ_ERROR = 'Could not read that photo. Choose a JPG, PNG, WebP, or HEIC image, or try another photo.'

async function decodeNative(source: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Some browsers can display an image even when their bitmap decoder refuses it.
    }
  }

  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(READ_ERROR))
      image.src = url
    })
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function decodePhoto(source: Blob): Promise<DecodedPhoto> {
  if (!source.size) throw new Error('That photo is empty. Choose the original image and try again.')
  try {
    return await decodeNative(source)
  } catch {
    // Inspect the file itself: phone photos may have no MIME type or a misleading extension.
    const header = new TextDecoder('ascii').decode(await source.slice(0, 12).arrayBuffer())
    if (!/^ftyp(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(header.slice(4))) {
      throw new Error(READ_ERROR)
    }
    try {
      // Load the decoder only for HEIC/HEIF photos the browser cannot read itself.
      const { heicTo } = await import('heic-to/csp')
      const jpeg = await heicTo({ blob: source, type: 'image/jpeg', quality: 1 })
      return await decodeNative(jpeg)
    } catch {
      throw new Error('Could not convert this HEIC photo. Try another photo or save it as JPG and choose it again.')
    }
  }
}

function encodeJpeg(decoded: DecodedPhoto, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(decoded.width * scale))
  canvas.height = Math.max(1, Math.round(decoded.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the photo. Reload the page and try again.')
  context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo. Try a smaller image.'))), 'image/jpeg', quality),
  )
}

// Phone photos are 10+ MB; resize on the device before upload.
export async function resizeToJpeg(source: Blob, maxSide: number, quality: number): Promise<Blob> {
  const decoded = await decodePhoto(source)
  try {
    return await encodeJpeg(decoded, maxSide, quality)
  } finally {
    decoded.close()
  }
}

export async function makeCapture(source: Blob) {
  // Decode large originals (and convert HEIC) once for both upload sizes.
  const decoded = await decodePhoto(source)
  try {
    return {
      photo: await encodeJpeg(decoded, 1568, 0.88),
      thumb: await encodeJpeg(decoded, 512, 0.8),
    }
  } finally {
    decoded.close()
  }
}
