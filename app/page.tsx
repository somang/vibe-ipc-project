"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Slider } from "@/components/ui/slider"
import { Waves, CameraOff, Settings2, Volume2, VolumeX } from "lucide-react"

declare global {
  interface Window {
    cv: any
  }
}

// Water ripple simulation class
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
    this.damping = 0.97
  }

  addRipple(x: number, y: number, radius: number, strength: number) {
    const radiusSq = radius * radius
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = Math.floor(x + dx)
        const py = Math.floor(y + dy)
        if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
          const distSq = dx * dx + dy * dy
          if (distSq < radiusSq) {
            const factor = 1 - Math.sqrt(distSq) / radius
            this.current[py * this.width + px] += strength * factor
          }
        }
      }
    }
  }

  update() {
    const w = this.width
    const h = this.height

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x
        // Wave propagation formula
        this.current[idx] = (
          this.previous[idx - 1] +
          this.previous[idx + 1] +
          this.previous[idx - w] +
          this.previous[idx + w]
        ) / 2 - this.current[idx]
        
        // Apply damping
        this.current[idx] *= this.damping
      }
    }

    // Swap buffers
    const temp = this.previous
    this.previous = this.current
    this.current = temp
  }

  getDisplacement(x: number, y: number): { dx: number; dy: number } {
    if (x <= 0 || x >= this.width - 1 || y <= 0 || y >= this.height - 1) {
      return { dx: 0, dy: 0 }
    }
    const idx = Math.floor(y) * this.width + Math.floor(x)
    const dx = (this.current[idx - 1] - this.current[idx + 1]) * 8
    const dy = (this.current[idx - this.width] - this.current[idx + this.width]) * 8
    return { dx, dy }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.current = new Float32Array(width * height)
    this.previous = new Float32Array(width * height)
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
    console.log("[v0] playSplashSound called, isMuted:", isMuted)
    if (isMuted) return
    
    const now = Date.now()
    // Throttle splash sounds to avoid overlap (min 150ms between splashes)
    if (now - lastSplashTimeRef.current < 150) return
    lastSplashTimeRef.current = now
    
    console.log("[v0] Creating splash audio with volume:", splashVolume)
    const splash = new Audio(SPLASH_SOUND_URL)
    splash.volume = splashVolume
    splash.playbackRate = 0.8 + Math.random() * 0.4 // Slight variation
    splash.play().then(() => {
      console.log("[v0] Splash audio playing")
    }).catch((err) => {
      console.log("[v0] Splash audio error:", err)
    })
  }, [isMuted, splashVolume])

  // Start ambient music
  const startAmbientMusic = useCallback(() => {
    console.log("[v0] startAmbientMusic called, isMuted:", isMuted, "ambientVolume:", ambientVolume)
    if (!ambientAudioRef.current) {
      ambientAudioRef.current = new Audio(AMBIENT_SOUND_URL)
      ambientAudioRef.current.loop = true
      console.log("[v0] Created new ambient audio element")
    }
    ambientAudioRef.current.volume = isMuted ? 0 : ambientVolume
    ambientAudioRef.current.play().then(() => {
      console.log("[v0] Ambient audio playing")
    }).catch((err) => {
      console.log("[v0] Ambient audio error:", err)
    })
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
            // Initialize water simulation
            const w = videoRef.current!.videoWidth
            const h = videoRef.current!.videoHeight
            waterSimRef.current = new WaterSimulation(Math.floor(w / 4), Math.floor(h / 4))
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
    const ctx = canvas.getContext("2d")
    const waterCtx = waterCanvas.getContext("2d")

    if (!ctx || !waterCtx || video.readyState !== 4) {
      animationRef.current = requestAnimationFrame(detectMotionAndRipple)
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    waterCanvas.width = video.videoWidth
    waterCanvas.height = video.videoHeight

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0)

    try {
      // Read the frame
      const src = cv.imread(canvas)
      const gray = new cv.Mat()
      const blurred = new cv.Mat()
      
      // Convert to grayscale
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, blurred, new cv.Size(21, 21), 0)

      // Initialize previous frame if needed
      if (!prevFrameRef.current) {
        prevFrameRef.current = blurred.clone()
        src.delete()
        gray.delete()
        blurred.delete()
        animationRef.current = requestAnimationFrame(detectMotionAndRipple)
        return
      }

      // Compute frame difference
      const diff = new cv.Mat()
      cv.absdiff(prevFrameRef.current, blurred, diff)
      
      // Threshold the difference
      const thresh = new cv.Mat()
      cv.threshold(diff, thresh, motionThreshold, 255, cv.THRESH_BINARY)
      
      // Dilate to fill holes
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U)
      const dilated = new cv.Mat()
      cv.dilate(thresh, dilated, kernel, new cv.Point(-1, -1), 2)

      // Find contours
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

      // Process motion areas and create ripples
      let areaCount = 0
      const waterSim = waterSimRef.current
      
      if (waterSim) {
        const scaleX = waterSim.width / video.videoWidth
        const scaleY = waterSim.height / video.videoHeight
        let triggeredSplash = false

        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i)
          const area = cv.contourArea(contour)
          
          if (area > minMotionArea) {
            areaCount++
            const rect = cv.boundingRect(contour)
            
            // Add ripple at center of motion
            const centerX = (rect.x + rect.width / 2) * scaleX
            const centerY = (rect.y + rect.height / 2) * scaleY
            const rippleRadius = Math.min(Math.sqrt(area) / 20, 15)
            waterSim.addRipple(centerX, centerY, rippleRadius, rippleStrength)
            
            // Trigger splash sound for significant motion
            if (area > minMotionArea * 2 && !triggeredSplash) {
              playSplashSound()
              triggeredSplash = true
            }
          }
        }

        // Update water simulation
        waterSim.update()

        // Render water effect
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const waterImageData = waterCtx.createImageData(canvas.width, canvas.height)
        const srcData = imageData.data
        const dstData = waterImageData.data

        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const simX = x * scaleX
            const simY = y * scaleY
            const { dx, dy } = waterSim.getDisplacement(simX, simY)
            
            // Get displaced pixel coordinates
            let srcX = Math.floor(x + dx)
            let srcY = Math.floor(y + dy)
            
            // Clamp to bounds
            srcX = Math.max(0, Math.min(canvas.width - 1, srcX))
            srcY = Math.max(0, Math.min(canvas.height - 1, srcY))
            
            const srcIdx = (srcY * canvas.width + srcX) * 4
            const dstIdx = (y * canvas.width + x) * 4
            
            // Copy pixel with slight blue tint for water effect
            const displacement = Math.abs(dx) + Math.abs(dy)
            const blueTint = Math.min(displacement * 2, 40)
            
            dstData[dstIdx] = Math.max(0, srcData[srcIdx] - blueTint * 0.3)
            dstData[dstIdx + 1] = Math.max(0, srcData[srcIdx + 1] - blueTint * 0.1)
            dstData[dstIdx + 2] = Math.min(255, srcData[srcIdx + 2] + blueTint)
            dstData[dstIdx + 3] = 255
          }
        }

        waterCtx.putImageData(waterImageData, 0, 0)

        // Draw water surface overlay with caustics
        waterCtx.globalAlpha = waterOpacity * 0.3
        waterCtx.fillStyle = "rgba(100, 180, 255, 0.1)"
        
        // Draw some caustic-like highlights based on water displacement
        for (let y = 0; y < canvas.height; y += 8) {
          for (let x = 0; x < canvas.width; x += 8) {
            const simX = x * scaleX
            const simY = y * scaleY
            const { dx, dy } = waterSim.getDisplacement(simX, simY)
            const intensity = Math.abs(dx) + Math.abs(dy)
            
            if (intensity > 2) {
              waterCtx.globalAlpha = Math.min(intensity / 20, 0.4) * waterOpacity
              waterCtx.fillStyle = `rgba(200, 230, 255, ${Math.min(intensity / 15, 0.6)})`
              waterCtx.fillRect(x - 2, y - 2, 4, 4)
            }
          }
        }
        
        waterCtx.globalAlpha = 1
      }

      setMotionAreas(areaCount)

      // Update previous frame
      prevFrameRef.current.delete()
      prevFrameRef.current = blurred.clone()

      // Cleanup
      src.delete()
      gray.delete()
      blurred.delete()
      diff.delete()
      thresh.delete()
      kernel.delete()
      dilated.delete()
      contours.delete()
      hierarchy.delete()

    } catch (err) {
      console.error("Detection error:", err)
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
