"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Slider } from "@/components/ui/slider"
import { Waves, CameraOff, Settings2, Volume2, VolumeX } from "lucide-react"

declare global {
  interface Window {
    cv: any
  }
}

// Optimized Water ripple simulation class
class WaterSimulation {
  width: number
  height: number
  current: Float32Array
  previous: Float32Array
  damping: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.current = new Float32Array(width * height)
    this.previous = new Float32Array(width * height)
    this.damping = 0.96
  }

  addRipple(x: number, y: number, radius: number, strength: number) {
    const w = this.width
    const h = this.height
    const r = Math.ceil(radius)
    const r2 = radius * radius
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    
    const minY = Math.max(0, cy - r)
    const maxY = Math.min(h - 1, cy + r)
    const minX = Math.max(0, cx - r)
    const maxX = Math.min(w - 1, cx + r)
    
    for (let py = minY; py <= maxY; py++) {
      const dy = py - cy
      const dy2 = dy * dy
      const rowIdx = py * w
      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx
        const d2 = dx * dx + dy2
        if (d2 < r2) {
          this.current[rowIdx + px] += strength * (1 - Math.sqrt(d2) / radius)
        }
      }
    }
  }

  update() {
    const w = this.width
    const h = this.height
    const curr = this.current
    const prev = this.previous
    const damp = this.damping

    for (let y = 1; y < h - 1; y++) {
      const row = y * w
      const rowUp = row - w
      const rowDown = row + w
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x
        curr[idx] = ((prev[idx - 1] + prev[idx + 1] + prev[rowUp + x] + prev[rowDown + x]) * 0.5 - curr[idx]) * damp
      }
    }

    // Swap
    this.previous = curr
    this.current = prev
  }
}

export default function WaterRipplePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waterCanvasRef = useRef<HTMLCanvasElement>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [cvReady, setCvReady] = useState(false)
  const [motionAreas, setMotionAreas] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Motion detection settings
  const [motionThreshold, setMotionThreshold] = useState(90)
  const [minMotionArea, setMinMotionArea] = useState(200)
  const [rippleStrength, setRippleStrength] = useState(50)
  const [waterOpacity, setWaterOpacity] = useState(0.95)
  
  // Audio settings
  const [isMuted, setIsMuted] = useState(false)
  const [splashVolume, setSplashVolume] = useState(0.3)
  const [ambientVolume, setAmbientVolume] = useState(0.2)

  const animationRef = useRef<number>()
  const streamRef = useRef<MediaStream | null>(null)
  const prevFrameRef = useRef<any>(null)
  const waterSimRef = useRef<WaterSimulation | null>(null)
  const frameCountRef = useRef(0)
  
  // Audio refs
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null)
  const lastSplashTimeRef = useRef<number>(0)

  // Load OpenCV.js
  useEffect(() => {
    const loadOpenCV = () => {
      if (window.cv && window.cv.Mat) {
        setCvReady(true)
        return
      }

      const script = document.createElement("script")
      script.src = "https://docs.opencv.org/4.x/opencv.js"
      script.async = true
      script.onload = () => {
        const checkCV = () => {
          if (window.cv && window.cv.Mat) {
            setCvReady(true)
          } else {
            setTimeout(checkCV, 100)
          }
        }
        checkCV()
      }
      script.onerror = () => setError("Failed to load OpenCV.js")
      document.body.appendChild(script)
    }

    loadOpenCV()
  }, [])

  // Audio URLs (public domain water sounds)
  const SPLASH_SOUND_URL = "https://cdn.freesound.org/previews/398/398032_1676145-lq.mp3"
  const AMBIENT_SOUND_URL = "https://cdn.freesound.org/previews/531/531015_6170507-lq.mp3"

  // Play water splash sound
  const playSplashSound = useCallback(() => {
    if (isMuted) return
    
    const now = Date.now()
    if (now - lastSplashTimeRef.current < 150) return
    lastSplashTimeRef.current = now
    
    const splash = new Audio(SPLASH_SOUND_URL)
    splash.volume = splashVolume
    splash.playbackRate = 0.8 + Math.random() * 0.4
    splash.play().catch(() => {})
  }, [isMuted, splashVolume])

  // Start ambient music
  const startAmbientMusic = useCallback(() => {
    if (!ambientAudioRef.current) {
      ambientAudioRef.current = new Audio(AMBIENT_SOUND_URL)
      ambientAudioRef.current.loop = true
    }
    ambientAudioRef.current.volume = isMuted ? 0 : ambientVolume
    ambientAudioRef.current.play().catch(() => {})
  }, [isMuted, ambientVolume])

  // Stop ambient music
  const stopAmbientMusic = useCallback(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.pause()
      ambientAudioRef.current.currentTime = 0
    }
  }, [])

  // Update ambient volume when settings change
  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = isMuted ? 0 : ambientVolume
    }
  }, [isMuted, ambientVolume])

  const startCamera = async () => {
    setError(null)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API is not supported in this browser.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1920 }, 
          height: { ideal: 1080 }, 
          facingMode: "user"
        }
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            // Initialize water simulation at low resolution for performance
            const w = videoRef.current!.videoWidth
            const h = videoRef.current!.videoHeight
            waterSimRef.current = new WaterSimulation(Math.floor(w / 8), Math.floor(h / 8))
            setIsRunning(true)
            startAmbientMusic()
          }).catch((err) => {
            setError(`Error starting playback: ${err?.message}`)
          })
        }
      }
    } catch (err: any) {
      const name = err?.name ?? ""
      
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Camera access was denied. If you're viewing this in an embedded preview, please open the app in a new browser tab (click the external link icon) to allow camera permissions.")
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("No camera found on this device.")
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("Camera is already in use by another application.")
      } else {
        setError(`Could not access camera: ${err?.message ?? "Unknown error"}`)
      }
    }
  }

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (prevFrameRef.current) {
      prevFrameRef.current.delete()
      prevFrameRef.current = null
    }
    stopAmbientMusic()
    setIsRunning(false)
    setMotionAreas(0)
  }, [stopAmbientMusic])

  const detectMotionAndRipple = useCallback(() => {
    if (!cvReady || !videoRef.current || !canvasRef.current || !waterCanvasRef.current || !isRunning) return

    const cv = window.cv
    const video = videoRef.current
    const canvas = canvasRef.current
    const waterCanvas = waterCanvasRef.current
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    const waterCtx = waterCanvas.getContext("2d", { willReadFrequently: true })

    if (!ctx || !waterCtx || video.readyState !== 4) {
      animationRef.current = requestAnimationFrame(detectMotionAndRipple)
      return
    }

    const vw = video.videoWidth
    const vh = video.videoHeight
    
    // Set canvas sizes once
    if (canvas.width !== vw) {
      canvas.width = vw
      canvas.height = vh
      waterCanvas.width = vw
      waterCanvas.height = vh
    }

    // Draw video frame
    ctx.drawImage(video, 0, 0)
    
    frameCountRef.current++
    const waterSim = waterSimRef.current
    
    // Only do motion detection every 3rd frame for performance
    if (frameCountRef.current % 3 === 0 && waterSim) {
      try {
        const src = cv.imread(canvas)
        const gray = new cv.Mat()
        const blurred = new cv.Mat()
        
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
        cv.GaussianBlur(gray, blurred, new cv.Size(11, 11), 0)

        if (!prevFrameRef.current) {
          prevFrameRef.current = blurred.clone()
          src.delete()
          gray.delete()
          blurred.delete()
          animationRef.current = requestAnimationFrame(detectMotionAndRipple)
          return
        }

        const diff = new cv.Mat()
        cv.absdiff(prevFrameRef.current, blurred, diff)
        
        const thresh = new cv.Mat()
        cv.threshold(diff, thresh, motionThreshold, 255, cv.THRESH_BINARY)
        
        const contours = new cv.MatVector()
        const hierarchy = new cv.Mat()
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

        const scaleX = waterSim.width / vw
        const scaleY = waterSim.height / vh
        let areaCount = 0
        let triggeredSplash = false

        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i)
          const area = cv.contourArea(contour)
          
          if (area > minMotionArea) {
            areaCount++
            const rect = cv.boundingRect(contour)
            const centerX = (rect.x + rect.width / 2) * scaleX
            const centerY = (rect.y + rect.height / 2) * scaleY
            const rippleRadius = Math.min(Math.sqrt(area) / 25, 12)
            waterSim.addRipple(centerX, centerY, rippleRadius, rippleStrength)
            
            if (area > minMotionArea * 2 && !triggeredSplash) {
              playSplashSound()
              triggeredSplash = true
            }
          }
        }

        setMotionAreas(areaCount)
        
        prevFrameRef.current.delete()
        prevFrameRef.current = blurred.clone()

        src.delete()
        gray.delete()
        blurred.delete()
        diff.delete()
        thresh.delete()
        contours.delete()
        hierarchy.delete()
      } catch (err) {
        // Silent error handling
      }
    }

    // Always update water simulation and render
    if (waterSim) {
      waterSim.update()
      
      const simW = waterSim.width
      const simH = waterSim.height
      const curr = waterSim.current
      const stepX = vw / simW
      const stepY = vh / simH
      
      // Draw original video
      waterCtx.drawImage(video, 0, 0)
      
      // Get image data for pixel manipulation (more visible effect)
      const imageData = waterCtx.getImageData(0, 0, vw, vh)
      const data = imageData.data
      
      // Apply displacement and color shift based on water height
      for (let sy = 1; sy < simH - 1; sy++) {
        const row = sy * simW
        for (let sx = 1; sx < simW - 1; sx++) {
          const idx = row + sx
          const val = curr[idx]
          
          if (Math.abs(val) > 0.3) {
            // Calculate gradient (for displacement direction)
            const dx = (curr[idx + 1] - curr[idx - 1]) * 3
            const dy = (curr[idx + simW] - curr[idx - simW]) * 3
            
            const px = Math.floor(sx * stepX)
            const py = Math.floor(sy * stepY)
            const pw = Math.ceil(stepX)
            const ph = Math.ceil(stepY)
            
            // Source position with displacement
            const srcX = Math.max(0, Math.min(vw - 1, Math.floor(px + dx)))
            const srcY = Math.max(0, Math.min(vh - 1, Math.floor(py + dy)))
            
            // Apply to block of pixels
            for (let y = py; y < py + ph && y < vh; y++) {
              for (let x = px; x < px + pw && x < vw; x++) {
                const dstIdx = (y * vw + x) * 4
                const srcIdx = (srcY * vw + srcX) * 4
                
                // Displacement + color tint based on wave height
                const intensity = Math.min(Math.abs(val) * waterOpacity * 0.15, 1)
                const highlight = val > 0 ? val * waterOpacity * 2 : 0
                
                data[dstIdx] = data[srcIdx] * (1 - intensity * 0.1) + highlight * 0.3
                data[dstIdx + 1] = data[srcIdx + 1] * (1 - intensity * 0.05) + highlight * 0.5
                data[dstIdx + 2] = Math.min(255, data[srcIdx + 2] + intensity * 60 + highlight)
                data[dstIdx + 3] = 255
              }
            }
          }
        }
      }
      
      waterCtx.putImageData(imageData, 0, 0)
      
      // Draw bright ripple rings overlay
      waterCtx.save()
      waterCtx.globalCompositeOperation = "screen"
      
      for (let sy = 0; sy < simH; sy++) {
        for (let sx = 0; sx < simW; sx++) {
          const val = curr[sy * simW + sx]
          const absVal = Math.abs(val)
          
          if (absVal > 1) {
            const px = sx * stepX
            const py = sy * stepY
            
            // Draw glowing dot/ring effect
            const radius = Math.min(absVal * 0.8, 15)
            const alpha = Math.min(absVal / 15, 0.8) * waterOpacity
            
            const gradient = waterCtx.createRadialGradient(px, py, 0, px, py, radius * 2)
            if (val > 0) {
              gradient.addColorStop(0, `rgba(220, 240, 255, ${alpha})`)
              gradient.addColorStop(0.5, `rgba(100, 180, 255, ${alpha * 0.5})`)
              gradient.addColorStop(1, `rgba(50, 100, 200, 0)`)
            } else {
              gradient.addColorStop(0, `rgba(30, 80, 150, ${alpha * 0.6})`)
              gradient.addColorStop(1, `rgba(20, 50, 100, 0)`)
            }
            
            waterCtx.fillStyle = gradient
            waterCtx.beginPath()
            waterCtx.arc(px, py, radius * 2, 0, Math.PI * 2)
            waterCtx.fill()
          }
        }
      }
      
      waterCtx.restore()
      
      // Add subtle water surface lines
      waterCtx.save()
      waterCtx.strokeStyle = "rgba(150, 200, 255, 0.15)"
      waterCtx.lineWidth = 1
      
      for (let sy = 0; sy < simH; sy += 4) {
        waterCtx.beginPath()
        for (let sx = 0; sx < simW; sx++) {
          const val = curr[sy * simW + sx]
          const px = sx * stepX
          const py = sy * stepY + val * 0.5
          if (sx === 0) {
            waterCtx.moveTo(px, py)
          } else {
            waterCtx.lineTo(px, py)
          }
        }
        waterCtx.stroke()
      }
      
      waterCtx.restore()
    }

    animationRef.current = requestAnimationFrame(detectMotionAndRipple)
  }, [cvReady, isRunning, motionThreshold, minMotionArea, rippleStrength, waterOpacity, playSplashSound])

  useEffect(() => {
    if (isRunning && cvReady) {
      detectMotionAndRipple()
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isRunning, cvReady, detectMotionAndRipple])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <main className="fixed inset-0 bg-black overflow-hidden">
      {/* Fullscreen camera view */}
      <div className="relative w-full h-full">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          style={{ display: "none" }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ display: "none" }}
        />
        <canvas
          ref={waterCanvasRef}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ display: isRunning ? "block" : "none", transform: "scaleX(-1)" }}
        />
        
        {/* Water surface overlay effect */}
        {isRunning && (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "linear-gradient(180deg, rgba(100, 200, 255, 0.05) 0%, rgba(50, 150, 255, 0.1) 100%)",
              mixBlendMode: "overlay"
            }}
          />
        )}

        {/* Start screen */}
        {!isRunning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90">
            <button
              onClick={startCamera}
              disabled={!cvReady}
              className="group flex flex-col items-center gap-4 p-8 rounded-2xl transition-all hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="relative">
                <Waves className="h-20 w-20 text-cyan-500/60 group-hover:text-cyan-400 transition-colors" />
                <div className="absolute inset-0 animate-ping opacity-20">
                  <Waves className="h-20 w-20 text-cyan-400" />
                </div>
              </div>
              <span className="text-white/60 group-hover:text-white/80 text-sm transition-colors">
                {cvReady ? "Tap to start" : "Loading..."}
              </span>
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="absolute top-4 left-4 right-4 z-20">
            <div className="rounded-lg bg-red-500/20 backdrop-blur-sm border border-red-500/30 p-3 text-red-300 text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Minimal floating controls */}
        {isRunning && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-3 rounded-full bg-black/30 backdrop-blur-sm text-white/50 hover:text-white/80 hover:bg-black/50 transition-all"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-3 rounded-full bg-black/30 backdrop-blur-sm text-white/50 hover:text-white/80 hover:bg-black/50 transition-all"
            >
              <Settings2 className="h-5 w-5" />
            </button>
            <button
              onClick={stopCamera}
              className="p-3 rounded-full bg-black/30 backdrop-blur-sm text-white/50 hover:text-red-400 hover:bg-black/50 transition-all"
            >
              <CameraOff className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div className="absolute top-4 right-4 z-20 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="rounded-xl bg-black/60 backdrop-blur-md border border-white/10 p-4 space-y-4">
              <div className="space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Motion Threshold: {motionThreshold}</label>
                <Slider
                  value={[motionThreshold]}
                  onValueChange={([v]) => setMotionThreshold(v)}
                  min={5}
                  max={100}
                  step={1}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                />
              </div>
              <div className="space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Min Motion Area: {minMotionArea}px</label>
                <Slider
                  value={[minMotionArea]}
                  onValueChange={([v]) => setMinMotionArea(v)}
                  min={100}
                  max={5000}
                  step={100}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                />
              </div>
              <div className="space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Ripple Strength: {rippleStrength}</label>
                <Slider
                  value={[rippleStrength]}
                  onValueChange={([v]) => setRippleStrength(v)}
                  min={50}
                  max={300}
                  step={10}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                />
              </div>
              <div className="space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Water Opacity: {Math.round(waterOpacity * 100)}%</label>
                <Slider
                  value={[waterOpacity]}
                  onValueChange={([v]) => setWaterOpacity(v)}
                  min={0.1}
                  max={1}
                  step={0.05}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                />
              </div>
              <div className="border-t border-white/10 pt-4 space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Splash Volume: {Math.round(splashVolume * 100)}%</label>
                <Slider
                  value={[splashVolume]}
                  onValueChange={([v]) => setSplashVolume(v)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                  disabled={isMuted}
                />
              </div>
              <div className="space-y-3">
                <label className="text-white/60 text-xs uppercase tracking-wide">Ambient Volume: {Math.round(ambientVolume * 100)}%</label>
                <Slider
                  value={[ambientVolume]}
                  onValueChange={([v]) => setAmbientVolume(v)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="[&_[role=slider]]:bg-cyan-500/80"
                  disabled={isMuted}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
