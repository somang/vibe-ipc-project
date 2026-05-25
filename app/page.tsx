"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Camera, CameraOff, Settings2, Waves } from "lucide-react"

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
  const [motionThreshold, setMotionThreshold] = useState(25)
  const [minMotionArea, setMinMotionArea] = useState(500)
  const [rippleStrength, setRippleStrength] = useState(150)
  const [waterOpacity, setWaterOpacity] = useState(0.4)

  const animationRef = useRef<number>()
  const streamRef = useRef<MediaStream | null>(null)
  const prevFrameRef = useRef<any>(null)
  const waterSimRef = useRef<WaterSimulation | null>(null)

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

  const startCamera = async () => {
    setError(null)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API is not supported in this browser.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
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
    setIsRunning(false)
    setMotionAreas(0)
  }, [])

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
  }, [cvReady, isRunning, motionThreshold, minMotionArea, rippleStrength, waterOpacity])

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
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            <Waves className="h-8 w-8 text-cyan-400" />
            Interactive Water Ripples
          </h1>
          <p className="text-slate-400">
            Move in front of the camera to create realistic water ripple effects
          </p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white">Camera Feed</CardTitle>
                <CardDescription className="text-slate-400">
                  {cvReady ? "OpenCV.js loaded - Ready to detect motion" : "Loading OpenCV.js..."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-cyan-500/20 text-cyan-400 px-3 py-1 text-sm font-medium">
                  Motion Areas: {motionAreas}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSettings(!showSettings)}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
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
                style={{ display: isRunning ? "block" : "none" }}
              />
              {!isRunning && (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900">
                  <div className="text-center space-y-3">
                    <div className="relative">
                      <Waves className="h-16 w-16 mx-auto text-cyan-500/50" />
                      <div className="absolute inset-0 h-16 w-16 mx-auto animate-ping opacity-20">
                        <Waves className="h-16 w-16 text-cyan-400" />
                      </div>
                    </div>
                    <p className="text-slate-400">
                      {cvReady ? "Click Start to begin the water simulation" : "Loading OpenCV.js..."}
                    </p>
                  </div>
                </div>
              )}
              
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
            </div>

            <div className="flex justify-center gap-4">
              <Button
                onClick={startCamera}
                disabled={!cvReady || isRunning}
                className="gap-2 bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <Camera className="h-4 w-4" />
                Start Water Effect
              </Button>
              <Button
                variant="destructive"
                onClick={stopCamera}
                disabled={!isRunning}
                className="gap-2"
              >
                <CameraOff className="h-4 w-4" />
                Stop
              </Button>
            </div>

            {showSettings && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-lg text-white">Water & Motion Settings</CardTitle>
                  <CardDescription className="text-slate-400">
                    Adjust sensitivity and visual effects
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-slate-300">Motion Threshold: {motionThreshold}</Label>
                        <Slider
                          value={[motionThreshold]}
                          onValueChange={([v]) => setMotionThreshold(v)}
                          min={5}
                          max={100}
                          step={1}
                          className="[&_[role=slider]]:bg-cyan-500"
                        />
                        <p className="text-xs text-slate-500">Lower = more sensitive to motion</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-300">Min Motion Area: {minMotionArea}px²</Label>
                        <Slider
                          value={[minMotionArea]}
                          onValueChange={([v]) => setMinMotionArea(v)}
                          min={100}
                          max={5000}
                          step={100}
                          className="[&_[role=slider]]:bg-cyan-500"
                        />
                        <p className="text-xs text-slate-500">Filter out small movements/noise</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-slate-300">Ripple Strength: {rippleStrength}</Label>
                        <Slider
                          value={[rippleStrength]}
                          onValueChange={([v]) => setRippleStrength(v)}
                          min={50}
                          max={300}
                          step={10}
                          className="[&_[role=slider]]:bg-cyan-500"
                        />
                        <p className="text-xs text-slate-500">Intensity of water displacement</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-300">Water Opacity: {Math.round(waterOpacity * 100)}%</Label>
                        <Slider
                          value={[waterOpacity]}
                          onValueChange={([v]) => setWaterOpacity(v)}
                          min={0.1}
                          max={1}
                          step={0.05}
                          className="[&_[role=slider]]:bg-cyan-500"
                        />
                        <p className="text-xs text-slate-500">Visibility of water surface effect</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-4 text-sm text-slate-400">
              <p className="font-medium mb-2 text-slate-300">How it works:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Motion detection tracks movement between video frames</li>
                <li>Moving body parts (hands, head, arms) create ripples in the water</li>
                <li>The water simulation uses wave propagation physics</li>
                <li>Adjust settings for different lighting conditions and sensitivity</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
