"use client"

import { useRef, useMemo, useEffect, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

// Water shader with realistic refraction and ripples
const waterVertexShader = `
  uniform float uTime;
  uniform sampler2D uRippleMap;
  uniform float uRippleStrength;
  
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDisplacement;
  
  void main() {
    vUv = uv;
    
    // Sample ripple map for displacement
    vec4 ripple = texture2D(uRippleMap, uv);
    float displacement = ripple.r * uRippleStrength;
    vDisplacement = displacement;
    
    // Calculate normal from ripple gradient
    float delta = 0.01;
    float dx = texture2D(uRippleMap, uv + vec2(delta, 0.0)).r - texture2D(uRippleMap, uv - vec2(delta, 0.0)).r;
    float dy = texture2D(uRippleMap, uv + vec2(0.0, delta)).r - texture2D(uRippleMap, uv - vec2(0.0, delta)).r;
    
    vec3 normal = normalize(vec3(-dx * uRippleStrength * 2.0, -dy * uRippleStrength * 2.0, 1.0));
    vNormal = normalMatrix * normal;
    
    vec3 pos = position;
    pos.z += displacement * 0.1;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const waterFragmentShader = `
  uniform sampler2D uVideoTexture;
  uniform sampler2D uRippleMap;
  uniform float uTime;
  uniform float uRefractionStrength;
  uniform vec3 uWaterColor;
  uniform float uWaterOpacity;
  
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDisplacement;
  
  void main() {
    // Calculate refraction offset based on ripple normal
    vec4 ripple = texture2D(uRippleMap, vUv);
    
    float delta = 0.005;
    float dx = texture2D(uRippleMap, vUv + vec2(delta, 0.0)).r - texture2D(uRippleMap, vUv - vec2(delta, 0.0)).r;
    float dy = texture2D(uRippleMap, vUv + vec2(0.0, delta)).r - texture2D(uRippleMap, vUv - vec2(0.0, delta)).r;
    
    vec2 refractOffset = vec2(dx, dy) * uRefractionStrength;
    vec2 refractedUv = vUv + refractOffset;
    refractedUv = clamp(refractedUv, 0.0, 1.0);
    
    // Sample video with refraction
    vec4 videoColor = texture2D(uVideoTexture, refractedUv);
    
    // Fresnel effect for edge reflections
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
    
    // Caustic/highlight effect based on ripple intensity
    float rippleIntensity = ripple.r;
    vec3 caustic = vec3(1.0, 1.0, 1.0) * rippleIntensity * 0.4;
    
    // Water tint
    vec3 waterTint = mix(videoColor.rgb, uWaterColor, uWaterOpacity * 0.15);
    
    // Add caustic highlights
    waterTint += caustic;
    
    // Add subtle fresnel reflection
    waterTint = mix(waterTint, uWaterColor + vec3(0.3), fresnel * 0.3 * uWaterOpacity);
    
    // Specular highlights on ripples
    float specular = pow(max(rippleIntensity, 0.0), 2.0) * 0.5;
    waterTint += vec3(specular);
    
    gl_FragColor = vec4(waterTint, 1.0);
  }
`

interface WaterMeshProps {
  videoElement: HTMLVideoElement | null
  rippleData: Float32Array
  rippleWidth: number
  rippleHeight: number
  refractionStrength: number
  waterOpacity: number
}

function WaterMesh({ 
  videoElement, 
  rippleData, 
  rippleWidth, 
  rippleHeight,
  refractionStrength,
  waterOpacity 
}: WaterMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const { size } = useThree()
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null)
  
  // Create video texture when video element is ready
  useEffect(() => {
    if (!videoElement) {
      setVideoTexture(null)
      return
    }
    
    const texture = new THREE.VideoTexture(videoElement)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.format = THREE.RGBAFormat
    texture.colorSpace = THREE.SRGBColorSpace
    setVideoTexture(texture)
    
    return () => {
      texture.dispose()
    }
  }, [videoElement])
  
  // Create ripple data texture
  const rippleTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      new Float32Array(rippleWidth * rippleHeight * 4),
      rippleWidth,
      rippleHeight,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    texture.needsUpdate = true
    return texture
  }, [rippleWidth, rippleHeight])
  
  // Shader uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uVideoTexture: { value: null as THREE.VideoTexture | null },
    uRippleMap: { value: rippleTexture },
    uRippleStrength: { value: 0.5 },
    uRefractionStrength: { value: refractionStrength },
    uWaterColor: { value: new THREE.Color(0.2, 0.5, 0.7) },
    uWaterOpacity: { value: waterOpacity }
  }), [rippleTexture, refractionStrength, waterOpacity])
  
  // Update video texture uniform
  useEffect(() => {
    if (materialRef.current && videoTexture) {
      materialRef.current.uniforms.uVideoTexture.value = videoTexture
      materialRef.current.needsUpdate = true
    }
  }, [videoTexture])
  
  // Update ripple texture from simulation data
  useEffect(() => {
    if (!rippleData || rippleData.length === 0) return
    
    const data = new Float32Array(rippleWidth * rippleHeight * 4)
    for (let i = 0; i < rippleWidth * rippleHeight; i++) {
      const val = Math.abs(rippleData[i]) / 50 // Normalize
      data[i * 4] = val
      data[i * 4 + 1] = val
      data[i * 4 + 2] = val
      data[i * 4 + 3] = 1.0
    }
    rippleTexture.image.data.set(data)
    rippleTexture.needsUpdate = true
  }, [rippleData, rippleTexture, rippleWidth, rippleHeight])
  
  // Update other uniforms
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uRefractionStrength.value = refractionStrength
      materialRef.current.uniforms.uWaterOpacity.value = waterOpacity
    }
  }, [refractionStrength, waterOpacity])
  
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      // Force video texture update
      if (videoTexture) {
        videoTexture.needsUpdate = true
      }
    }
  })
  
  // Calculate plane size to cover viewport
  const planeSize = useMemo(() => {
    const aspect = size.width / size.height
    return { width: 2 * aspect, height: 2 }
  }, [size])
  
  if (!videoTexture) return null
  
  return (
    <mesh ref={meshRef} position={[0, 0, 0]} scale={[-1, 1, 1]}>
      <planeGeometry args={[planeSize.width, planeSize.height, 128, 128]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={waterVertexShader}
        fragmentShader={waterFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

interface ThreeWaterProps {
  videoElement: HTMLVideoElement | null
  rippleData: Float32Array
  rippleWidth: number
  rippleHeight: number
  refractionStrength?: number
  waterOpacity?: number
  isRunning: boolean
}

export default function ThreeWater({ 
  videoElement, 
  rippleData, 
  rippleWidth, 
  rippleHeight,
  refractionStrength = 0.08,
  waterOpacity = 0.95,
  isRunning 
}: ThreeWaterProps) {
  if (!isRunning || !videoElement) {
    return null
  }
  
  return (
    <div className="absolute inset-0 z-10">
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <WaterMesh
          videoElement={videoElement}
          rippleData={rippleData}
          rippleWidth={rippleWidth}
          rippleHeight={rippleHeight}
          refractionStrength={refractionStrength}
          waterOpacity={waterOpacity}
        />
      </Canvas>
    </div>
  )
}
