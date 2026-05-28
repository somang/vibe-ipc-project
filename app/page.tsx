"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Slider } from "@/components/ui/slider"
import { Waves, CameraOff, Settings2, Volume2, VolumeX } from "lucide-react"
import * as Tone from "tone"
import dynamic from "next/dynamic"

const ThreeWater = dynamic(() => import("@/components/ThreeWater"), { ssr: false })

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
    this.damping = 0.85
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
  
  // Floating words from AI analysis
  const [floatingWords, setFloatingWords] = useState<Array<{
    id: number
    text: string
    x: number
    y: number
    opacity: number
    scale: number
    rotation: number
    velocityX: number
    velocityY: number
  }>>([])
  const screenshotIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const wordIdCounterRef = useRef(0)
  const [lastApiResponse, setLastApiResponse] = useState<string[]>([])

  const animationRef = useRef<number>()
  const streamRef = useRef<MediaStream | null>(null)
  const prevFrameRef = useRef<any>(null)
  const waterSimRef = useRef<WaterSimulation | null>(null)
  const [rippleData, setRippleData] = useState<Float32Array>(new Float32Array(0))
  const [rippleDimensions, setRippleDimensions] = useState({ width: 80, height: 60 })
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const frameCountRef = useRef(0)
  
  // Tone.js audio refs - Music for Airports style
  const lastSplashTimeRef = useRef<number>(0)
  const pianoSynthRef = useRef<Tone.PolySynth | null>(null)
  const padSynthRef = useRef<Tone.PolySynth | null>(null)
  const reverbRef = useRef<Tone.Reverb | null>(null)
  const delayRef = useRef<Tone.FeedbackDelay | null>(null)
  const audioInitializedRef = useRef(false)
  const loopIntervalsRef = useRef<NodeJS.Timeout[]>([])
  const activeNotesRef = useRef<Set<string>>(new Set())
  const ambientStartedRef = useRef(false)

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

  // Initialize Tone.js audio - Music for Airports style
  const initAudio = useCallback(async () => {
    if (audioInitializedRef.current) return
    
    await Tone.start()
    
    // Shorter reverb to sync with visual ripples
    reverbRef.current = new Tone.Reverb({
      decay: 2,
      wet: 0.4,
      preDelay: 0.02
    }).toDestination()
    await reverbRef.current.generate()
    
    // Tighter delay for visual sync
    delayRef.current = new Tone.FeedbackDelay({
      delayTime: "16n",
      feedback: 0.15,
      wet: 0.25
    }).connect(reverbRef.current)
    
    // Piano synth - fast attack/decay to match ripple visuals
    pianoSynthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { 
        type: "sine",
        partialCount: 3
      },
      envelope: {
        attack: 0.02,
        decay: 0.4,
        sustain: 0.1,
        release: 0.8
      },
      volume: -6
    }).connect(delayRef.current)
    
    // Pad synth - faster envelope for visual sync
    padSynthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.5,
        decay: 0.6,
        sustain: 0.2,
        release: 1.2
      },
      volume: -12
    }).connect(reverbRef.current)
    
    audioInitializedRef.current = true
  }, [])

  // Play a single ambient note - Music for Airports style
  // Uses pentatonic scale and random timing for generative feel
  const playAmbientNote = useCallback((velocity: number = 0.5) => {
    if (isMuted || !pianoSynthRef.current) return
    
    // Pentatonic scale notes used in Music for Airports style
    // Multiple octaves for variety
    const notes = [
      "C3", "D3", "E3", "G3", "A3",
      "C4", "D4", "E4", "G4", "A4",
      "C5", "D5", "E5", "G5", "A5",
      "C6", "D6", "E6"
    ]
    
    const note = notes[Math.floor(Math.random() * notes.length)]
    
    // Avoid playing the same note if it's still ringing
    if (activeNotesRef.current.has(note)) return
    activeNotesRef.current.add(note)
    
    // Short duration to sync with visual ripples (0.3-1.2 seconds)
    const duration = 0.3 + Math.random() * 0.9
    
    pianoSynthRef.current.volume.value = -8 + (splashVolume * 10)
    pianoSynthRef.current.triggerAttackRelease(note, duration, undefined, velocity * 0.6)
    
    // Remove from active notes after release
    setTimeout(() => {
      activeNotesRef.current.delete(note)
    }, duration * 1000 + 800)
  }, [isMuted, splashVolume])

  // Play water splash - triggers ambient piano note
  const playSplashSound = useCallback(() => {
    if (isMuted || !pianoSynthRef.current) return
    
    const now = Date.now()
    // Longer debounce for more sparse, meditative feel
    if (now - lastSplashTimeRef.current < 150) return
    lastSplashTimeRef.current = now
    
    // Random velocity for dynamic variation
    const velocity = 0.3 + Math.random() * 0.4
    playAmbientNote(velocity)
  }, [isMuted, playAmbientNote])

  // Start ambient music - Music for Airports style generative loops
  // Different loop lengths create non-repeating patterns
  const startAmbientMusic = useCallback(async () => {
    await initAudio()
    
    if (!padSynthRef.current || isMuted) return
    
    padSynthRef.current.volume.value = -15 + (ambientVolume * 15)
    
    // Soft sustained pad chord
    const padNotes = ["C3", "G3", "D4"]
    padSynthRef.current.triggerAttack(padNotes)
    
    // Create multiple overlapping loops with different intervals
    // This is the key technique from Music for Airports
    const loopConfigs = [
      { interval: 8000, notes: ["C4", "E4", "G4"] },
      { interval: 11000, notes: ["D4", "A4", "E5"] },
      { interval: 13000, notes: ["G4", "C5", "D5"] },
      { interval: 17000, notes: ["E4", "A4", "C5"] },
      { interval: 23000, notes: ["C5", "G5", "E5"] }
    ]
    
    // Clear any existing loops
    loopIntervalsRef.current.forEach(clearInterval)
    loopIntervalsRef.current = []
    
    // Start each loop with random initial delay
    loopConfigs.forEach(({ interval, notes }) => {
      const initialDelay = Math.random() * interval * 0.5
      
      setTimeout(() => {
        if (!pianoSynthRef.current || isMuted) return
        
        const playLoop = () => {
          if (!pianoSynthRef.current || isMuted) return
          
          // Randomly pick one or two notes from the set
          const numNotes = Math.random() > 0.5 ? 1 : 2
          const selectedNotes = [...notes]
            .sort(() => Math.random() - 0.5)
            .slice(0, numNotes)
          
          // Random velocity for organic feel
          const velocity = 0.2 + Math.random() * 0.3
          
          pianoSynthRef.current.volume.value = -10 + (ambientVolume * 12)
          selectedNotes.forEach((note, i) => {
            // Slight delay between notes for arpeggiated feel
            setTimeout(() => {
              if (pianoSynthRef.current && !isMuted) {
                pianoSynthRef.current.triggerAttackRelease(note, 1.2, undefined, velocity)
              }
            }, i * 200)
          })
        }
        
        playLoop()
        const loopInterval = setInterval(playLoop, interval)
        loopIntervalsRef.current.push(loopInterval)
      }, initialDelay)
    })
  }, [initAudio, isMuted, ambientVolume])

  // Stop ambient music
  const stopAmbientMusic = useCallback(() => {
    // Clear all loop intervals
    loopIntervalsRef.current.forEach(clearInterval)
    loopIntervalsRef.current = []
    activeNotesRef.current.clear()
    
    if (padSynthRef.current) {
      padSynthRef.current.releaseAll()
    }
    if (pianoSynthRef.current) {
      pianoSynthRef.current.releaseAll()
    }
  }, [])

  // Update ambient volume when settings change
  useEffect(() => {
    if (padSynthRef.current && !isMuted) {
      padSynthRef.current.volume.value = -15 + (ambientVolume * 15)
    }
    if (pianoSynthRef.current && !isMuted) {
      pianoSynthRef.current.volume.value = -10 + (ambientVolume * 12)
    }
    if (isMuted) {
      loopIntervalsRef.current.forEach(clearInterval)
      loopIntervalsRef.current = []
      if (padSynthRef.current) {
        padSynthRef.current.releaseAll()
      }
      if (pianoSynthRef.current) {
        pianoSynthRef.current.releaseAll()
      }
    }
  }, [isMuted, ambientVolume])

  // Capture screenshot and send to AI for analysis
  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !isRunning) return
    
    console.log("[v0] Capturing screenshot for AI analysis...")
    
    const video = videoRef.current
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = video.videoWidth
    tempCanvas.height = video.videoHeight
    const ctx = tempCanvas.getContext("2d")
    if (!ctx) return
    
    ctx.drawImage(video, 0, 0)
    
    // Convert to base64 (remove data URL prefix)
    const base64 = tempCanvas.toDataURL("image/jpeg", 0.7).split(",")[1]
    
    try {
      console.log("[v0] Sending to API...")
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      })
      
      if (!response.ok) {
        console.error("[v0] API response not ok:", response.status)
        throw new Error("API request failed")
      }
      
      const data = await response.json()
      console.log("[v0] API response data:", data)
      const words: string[] = data.words || []
      
      if (words.length === 0) {
        console.log("[v0] No words returned from API")
        return
      }
      
      console.log("[v0] Creating floating words:", words)
      setLastApiResponse(words)
      
      // Create floating word objects with random positions and animations
      const newWords = words.map((text: string) => ({
        id: wordIdCounterRef.current++,
        text,
        x: 10 + Math.random() * 80, // percentage
        y: 10 + Math.random() * 80,
        opacity: 1,
        scale: 0.8 + Math.random() * 0.6,
        rotation: -15 + Math.random() * 30,
        velocityX: -0.3 + Math.random() * 0.6,
        velocityY: -0.5 + Math.random() * 0.3,
      }))
      
      setFloatingWords(prev => [...prev, ...newWords])
    } catch (err) {
      console.error("[v0] Failed to analyze screenshot:", err)
    }
  }, [isRunning])

  // Animate floating words - fade out and drift
  useEffect(() => {
    const animateWords = () => {
      setFloatingWords(prev => {
        if (prev.length === 0) return prev
        return prev
          .map(word => ({
            ...word,
            x: word.x + word.velocityX * 0.5,
            y: word.y + word.velocityY * 0.5,
            opacity: word.opacity - 0.002,
            velocityY: word.velocityY - 0.005, // float upward slowly
          }))
          .filter(word => word.opacity > 0)
      })
    }
    
    const interval = setInterval(animateWords, 50)
    return () => clearInterval(interval)
  }, [])

  // Start/stop screenshot interval when running
  useEffect(() => {
    if (isRunning) {
      // Initial capture after 2 seconds
      const initialTimeout = setTimeout(() => {
        captureAndAnalyze()
      }, 2000)
      
      // Then every 10 seconds
      screenshotIntervalRef.current = setInterval(() => {
        captureAndAnalyze()
      }, 10000)
      
      return () => {
        clearTimeout(initialTimeout)
        if (screenshotIntervalRef.current) {
          clearInterval(screenshotIntervalRef.current)
        }
      }
    } else {
      if (screenshotIntervalRef.current) {
        clearInterval(screenshotIntervalRef.current)
      }
      setFloatingWords([])
    }
  }, [isRunning, captureAndAnalyze])

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
  const simW = Math.floor(w / 8)
  const simH = Math.floor(h / 8)
  waterSimRef.current = new WaterSimulation(simW, simH)
  setRippleDimensions({ width: simW, height: simH })
  setVideoElement(videoRef.current)
  setIsRunning(true)
  // Audio will start when motion is first detected
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
    if (screenshotIntervalRef.current) {
      clearInterval(screenshotIntervalRef.current)
      screenshotIntervalRef.current = null
    }
  stopAmbientMusic()
  ambientStartedRef.current = false
  setIsRunning(false)
  setMotionAreas(0)
  setFloatingWords([])
  setVideoElement(null)
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
  
  // Start ambient music when motion is first detected
  if (!ambientStartedRef.current) {
    ambientStartedRef.current = true
    startAmbientMusic()
  }
  
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

    // Always update water simulation and pass data to Three.js
    if (waterSim) {
      waterSim.update()
      
      // Update ripple data for Three.js water shader
      setRippleData(new Float32Array(waterSim.current))
      
      // Draw original video to canvas (fallback/hidden)
      waterCtx.drawImage(video, 0, 0)
    }

    animationRef.current = requestAnimationFrame(detectMotionAndRipple)
  }, [cvReady, isRunning, motionThreshold, minMotionArea, rippleStrength, waterOpacity, playSplashSound, startAmbientMusic])

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
      // Clear loop intervals
      loopIntervalsRef.current.forEach(clearInterval)
      loopIntervalsRef.current = []
      // Cleanup Tone.js
      if (padSynthRef.current) {
        padSynthRef.current.dispose()
      }
      if (pianoSynthRef.current) {
        pianoSynthRef.current.dispose()
      }
      if (delayRef.current) {
        delayRef.current.dispose()
      }
      if (reverbRef.current) {
        reverbRef.current.dispose()
      }
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
          style={{ display: "none" }}
        />
        
        {/* Three.js Water Visualization */}
        <ThreeWater
          videoElement={videoElement}
          rippleData={rippleData}
          rippleWidth={rippleDimensions.width}
          rippleHeight={rippleDimensions.height}
          refractionStrength={rippleStrength / 150}
          waterOpacity={waterOpacity}
          isRunning={isRunning}
        />
        
        {/* Water surface blue tint overlay */}
        {isRunning && (
          <div 
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              background: "linear-gradient(180deg, rgba(30, 100, 180, 0.08) 0%, rgba(20, 80, 150, 0.12) 100%)",
              mixBlendMode: "multiply"
            }}
          />
        )}

        {/* Floating AI-generated words - Pop Art Style */}
        {floatingWords.map((word) => {
          const popColors = [
            { bg: "#FF3B30", stroke: "#000", text: "#FFF" },
            { bg: "#FFCC00", stroke: "#000", text: "#000" },
            { bg: "#FF2D92", stroke: "#000", text: "#FFF" },
            { bg: "#00D4FF", stroke: "#000", text: "#000" },
            { bg: "#4CD964", stroke: "#000", text: "#000" },
            { bg: "#FF9500", stroke: "#000", text: "#000" },
          ]
          const color = popColors[word.id % popColors.length]
          return (
            <div
              key={word.id}
              className="absolute pointer-events-none select-none z-50"
              style={{
                left: `${word.x}%`,
                top: `${word.y}%`,
                opacity: word.opacity,
                transform: `scale(${word.scale * 1.2}) rotate(${word.rotation}deg)`,
                willChange: "transform, opacity, left, top",
              }}
            >
              <span
                className="font-black uppercase tracking-tight"
                style={{
                  fontSize: `${1.8 + word.scale}rem`,
                  color: color.text,
                  backgroundColor: color.bg,
                  padding: "4px 12px",
                  border: `4px solid ${color.stroke}`,
                  boxShadow: `6px 6px 0px ${color.stroke}`,
                  display: "inline-block",
                  WebkitTextStroke: `1px ${color.stroke}`,
                }}
              >
                {word.text}
              </span>
            </div>
          )
        })}

        {/* API Response Display - Pop Art Style */}
        {isRunning && lastApiResponse.length > 0 && (
          <div 
            className="absolute bottom-4 left-4 z-50 p-4 max-w-sm"
            style={{
              backgroundColor: "#FFF",
              border: "4px solid #000",
              boxShadow: "8px 8px 0px #000",
            }}
          >
            <p 
              className="text-xs uppercase tracking-wider mb-3 font-black"
              style={{ color: "#FF2D92" }}
            >
              AI Keywords
            </p>
            <div className="flex flex-wrap gap-2">
              {lastApiResponse.map((word, i) => {
                const colors = ["#FF3B30", "#FFCC00", "#FF2D92", "#00D4FF", "#4CD964"]
                return (
                  <span 
                    key={i} 
                    className="text-sm font-black uppercase px-2 py-1"
                    style={{
                      backgroundColor: colors[i % colors.length],
                      color: i === 1 || i === 3 || i === 4 ? "#000" : "#FFF",
                      border: "2px solid #000",
                      boxShadow: "3px 3px 0px #000",
                    }}
                  >
                    {word}
                  </span>
                )
              })}
            </div>
          </div>
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
                <label className="text-white/60 text-xs uppercase tracking-wide">Piano Notes: {Math.round(splashVolume * 100)}%</label>
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
                <label className="text-white/60 text-xs uppercase tracking-wide">Ambient Loops: {Math.round(ambientVolume * 100)}%</label>
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
