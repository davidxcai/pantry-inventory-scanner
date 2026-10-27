import { useEffect, useRef, useState } from 'react'
import { IconCamera, IconPhoto } from '@tabler/icons-react'

type Props = {
  onPhoto: (photo: Blob) => void
  hint?: string
  guide?: boolean // dashed box showing where one item should sit
  disabled?: boolean
}

// Saved photos work without camera access. Start a live camera only after the user asks for it.
export function CameraView({ onPhoto, hint = 'One item, label facing the camera', guide = true, disabled = false }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [ready, setReady] = useState(false)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    if (!cameraActive) return
    let stream: MediaStream | undefined
    let cancelled = false
    setReady(false)
    setDenied(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setDenied(true)
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
      })
      .catch(() => { if (!cancelled) setDenied(true) })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraActive])

  function stopCamera() {
    setCameraActive(false)
    setReady(false)
    setDenied(false)
  }

  function snap() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    canvas.toBlob((b) => b && onPhoto(b), 'image/jpeg', 0.92)
  }

  const picker = (
    <label className="btn btn-primary btn-block" onClick={stopCamera}>
      <IconPhoto size={20} /> Choose from library
      <input
        type="file"
        accept="image/*,.heic,.heif"
        aria-label="Choose from library"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) {
            stopCamera()
            onPhoto(f)
          }
        }}
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-3">
      {picker}
      {!cameraActive && (
        <button className="btn btn-outline btn-block" disabled={disabled} onClick={() => setCameraActive(true)}>
          <IconCamera size={20} /> Take a photo
        </button>
      )}
      {cameraActive && !denied && (
        <div className="relative aspect-[3/4] overflow-hidden rounded-box bg-black">
          <video ref={video} autoPlay playsInline muted onPlaying={() => setReady(true)} className="size-full object-cover" />
          {guide && <div className="pointer-events-none absolute inset-[12%] rounded-box border-2 border-dashed border-white/80" />}
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-white/90">{hint}</p>
        </div>
      )}
      {cameraActive && denied && <p className="text-sm opacity-70">Live camera access is unavailable. Use your device camera below or choose a saved photo.</p>}
      {cameraActive && denied && (
        <label className="btn btn-outline btn-block">
          <IconCamera size={20} /> Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Take a photo"
            disabled={disabled}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) {
                stopCamera()
                onPhoto(file)
              }
            }}
          />
        </label>
      )}
      {cameraActive && !denied && (
        <button className="btn btn-primary btn-lg btn-block" disabled={!ready || disabled} onClick={snap}>
          <IconCamera size={24} /> Capture
        </button>
      )}
      {cameraActive && <button className="btn btn-ghost btn-block" disabled={disabled} onClick={stopCamera}>Cancel camera</button>}
    </div>
  )
}
