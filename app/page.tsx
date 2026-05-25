"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Camera, CameraOff, Settings2, Hand } from "lucide-react"

declare global {
  interface Window {
    cv: any
  }
}

export default function HandDetectionPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [cvReady, setCvReady] = useState(false)
  const [handsDetected, setHandsDetected] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // HSV thresholds for skin detection (adjustable)
  const [hMin, setHMin] = useState(0)
  const [hMax, setHMax] = useState(20)
  const [sMin, setSMin] = useState(30)
  const [sMax, setSMax] = useState(150)
  const [vMin, setVMin] = useState(60)
  const [vMax, setVMax] = useState(255)
  const [minArea, setMinArea] = useState(5000)

  const animationRef = useRef<number>()
  const streamRef = useRef<MediaStream | null>(null)

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
    setIsRunning(false)
    setHandsDetected(0)
  }, [])

  const detectHands = useCallback(() => {
    if (!cvReady || !videoRef.current || !canvasRef.current || !isRunning) return

    const cv = window.cv
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")

    if (!ctx || video.readyState !== 4) {
      animationRef.current = requestAnimationFrame(detectHands)
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0)

    try {
      // Read the frame
      const src = cv.imread(canvas)
      const hsv = new cv.Mat()
      const mask = new cv.Mat()
      const mask2 = new cv.Mat()
      const combined = new cv.Mat()
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U)
      const morphed = new cv.Mat()
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()

      // Convert to HSV
      cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB)
      cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV)

      // Create mask for skin color (two ranges to handle red wrap-around in HSV)
      const lowSkin1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [hMin, sMin, vMin, 0])
      const highSkin1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [hMax, sMax, vMax, 255])
      cv.inRange(hsv, lowSkin1, highSkin1, mask)

      // Second range for skin tones (handles the red hue wrap-around)
      const lowSkin2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [160, sMin, vMin, 0])
      const highSkin2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, sMax, vMax, 255])
      cv.inRange(hsv, lowSkin2, highSkin2, mask2)

      // Combine masks
      cv.add(mask, mask2, combined)

      // Morphological operations to clean up the mask
      cv.morphologyEx(combined, morphed, cv.MORPH_OPEN, kernel)
      cv.morphologyEx(morphed, morphed, cv.MORPH_CLOSE, kernel)
      cv.dilate(morphed, morphed, kernel, new cv.Point(-1, -1), 2)

      // Find contours
      cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

      // Draw bounding boxes around detected regions (potential hands)
      let handCount = 0
      const boundingBoxes: { x: number; y: number; width: number; height: number; area: number }[] = []

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i)
        const area = cv.contourArea(contour)
        
        if (area > minArea) {
          const rect = cv.boundingRect(contour)
          const aspectRatio = rect.width / rect.height
          
          // Filter by aspect ratio (hands are usually somewhat square to tall)
          if (aspectRatio > 0.2 && aspectRatio < 2.5) {
            boundingBoxes.push({ ...rect, area })
          }
        }
      }

      // Sort by area and take largest regions (likely hands)
      boundingBoxes.sort((a, b) => b.area - a.area)
      const maxHands = Math.min(boundingBoxes.length, 10)

      // Draw on canvas
      ctx.drawImage(video, 0, 0)
      
      for (let i = 0; i < maxHands; i++) {
        const { x, y, width, height } = boundingBoxes[i]
        
        // Draw bounding box
        ctx.strokeStyle = "#22c55e"
        ctx.lineWidth = 3
        ctx.strokeRect(x, y, width, height)
        
        // Draw label
        ctx.fillStyle = "#22c55e"
        ctx.fillRect(x, y - 25, 80, 25)
        ctx.fillStyle = "#ffffff"
        ctx.font = "bold 14px sans-serif"
        ctx.fillText(`Hand ${i + 1}`, x + 5, y - 8)
        
        handCount++
      }

      setHandsDetected(handCount)

      // Cleanup
      src.delete()
      hsv.delete()
      mask.delete()
      mask2.delete()
      combined.delete()
      kernel.delete()
      morphed.delete()
      contours.delete()
      hierarchy.delete()
      lowSkin1.delete()
      highSkin1.delete()
      lowSkin2.delete()
      highSkin2.delete()

    } catch (err) {
      console.error("Detection error:", err)
    }

    animationRef.current = requestAnimationFrame(detectHands)
  }, [cvReady, isRunning, hMin, hMax, sMin, sMax, vMin, vMax, minArea])

  useEffect(() => {
    if (isRunning && cvReady) {
      detectHands()
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isRunning, cvReady, detectHands])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center justify-center gap-2">
            <Hand className="h-8 w-8 text-primary" />
            Hand Detection with OpenCV.js
          </h1>
          <p className="text-muted-foreground">
            Real-time hand detection using skin color segmentation and contour analysis
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Camera Feed</CardTitle>
                <CardDescription>
                  {cvReady ? "OpenCV.js loaded successfully" : "Loading OpenCV.js..."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-secondary px-3 py-1 text-sm font-medium">
                  Hands: {handsDetected}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSettings(!showSettings)}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-4 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                style={{ display: isRunning ? "none" : "block" }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ display: isRunning ? "block" : "none" }}
              />
              {!isRunning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <Camera className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {cvReady ? "Click Start to begin detection" : "Loading OpenCV.js..."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-center gap-4">
              <Button
                onClick={startCamera}
                disabled={!cvReady || isRunning}
                className="gap-2"
              >
                <Camera className="h-4 w-4" />
                Start Detection
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Detection Settings</CardTitle>
                  <CardDescription>
                    Adjust HSV thresholds for better skin detection in different lighting
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Hue Min: {hMin}</Label>
                        <Slider
                          value={[hMin]}
                          onValueChange={([v]) => setHMin(v)}
                          max={180}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Hue Max: {hMax}</Label>
                        <Slider
                          value={[hMax]}
                          onValueChange={([v]) => setHMax(v)}
                          max={180}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Saturation Min: {sMin}</Label>
                        <Slider
                          value={[sMin]}
                          onValueChange={([v]) => setSMin(v)}
                          max={255}
                          step={1}
                        />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Saturation Max: {sMax}</Label>
                        <Slider
                          value={[sMax]}
                          onValueChange={([v]) => setSMax(v)}
                          max={255}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Value Min: {vMin}</Label>
                        <Slider
                          value={[vMin]}
                          onValueChange={([v]) => setVMin(v)}
                          max={255}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Value Max: {vMax}</Label>
                        <Slider
                          value={[vMax]}
                          onValueChange={([v]) => setVMax(v)}
                          max={255}
                          step={1}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Min Detection Area: {minArea}px²</Label>
                    <Slider
                      value={[minArea]}
                      onValueChange={([v]) => setMinArea(v)}
                      min={1000}
                      max={20000}
                      step={500}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              <p className="font-medium mb-2">Tips for best detection:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Ensure good, even lighting on your hands</li>
                <li>Keep a plain background if possible</li>
                <li>Adjust HSV settings if detection is poor</li>
                <li>Multiple hands from different people can be detected</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
