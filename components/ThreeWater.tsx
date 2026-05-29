"use client"

import { useRef, useMemo, useEffect, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

// Realistic water shader with refraction, caustics, and wave displacement
const waterVertexShader = `
  uniform float uTime;
  uniform sampler2D uRippleMap;
  uniform float uRippleStrength;
  
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDisplacement;
  varying vec2 vRippleGradient;
  
  void main() {
    vUv = uv;
    
    // Sample ripple map for displacement with larger sample area
    vec4 ripple = texture2D(uRippleMap, uv);
    float displacement = ripple.r * uRippleStrength;
    vDisplacement = displacement;
    
    // Calculate normal from ripple gradient with wider sampling
    float delta = 0.02;
    float rippleLeft = texture2D(uRippleMap, uv + vec2(-delta, 0.0)).r;
    float rippleRight = texture2D(uRippleMap, uv + vec2(delta, 0.0)).r;
    float rippleUp = texture2D(uRippleMap, uv + vec2(0.0, delta)).r;
    float rippleDown = texture2D(uRippleMap, uv + vec2(0.0, -delta)).r;
    
    float dx = rippleRight - rippleLeft;
    float dy = rippleUp - rippleDown;
    vRippleGradient = vec2(dx, dy);
    
    vec3 normal = normalize(vec3(-dx * uRippleStrength * 4.0, -dy * uRippleStrength * 4.0, 1.0));
    vNormal = normalMatrix * normal;
    
    vec3 pos = position;
    pos.z += displacement * 0.15;
    
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
  varying vec2 vRippleGradient;
  
  // Improved noise function for caustics
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  
  float caustics(vec2 uv, float time) {
    float c = 0.0;
    vec2 p = uv * 8.0;
    c += noise(p + time * 0.5) * 0.5;
    c += noise(p * 2.0 - time * 0.3) * 0.25;
    c += noise(p * 4.0 + time * 0.7) * 0.125;
    return c;
  }
  
  void main() {
    // Calculate refraction offset based on ripple gradient - increased range
    vec2 refractOffset = vRippleGradient * uRefractionStrength * 3.0;
    
    // Add subtle animated water movement
    float waveTime = uTime * 0.5;
    vec2 waveOffset = vec2(
      sin(vUv.y * 10.0 + waveTime) * 0.002,
      cos(vUv.x * 10.0 + waveTime) * 0.002
    );
    
    vec2 refractedUv = vUv + refractOffset + waveOffset;
    refractedUv = clamp(refractedUv, 0.001, 0.999);
    
    // Sample video with refraction
    vec4 videoColor = texture2D(uVideoTexture, refractedUv);
    
    // Fresnel effect for realistic water surface
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
    
    // Ripple intensity for effects
    float rippleIntensity = length(vRippleGradient) * 10.0;
    rippleIntensity = clamp(rippleIntensity, 0.0, 1.0);
    
    // Caustic light patterns
    float causticPattern = caustics(vUv + refractOffset * 0.5, uTime);
    vec3 causticColor = vec3(0.7, 0.85, 1.0) * causticPattern * rippleIntensity * 0.6;
    
    // Water color with blue hue - blend with video
    vec3 deepWaterColor = vec3(0.1, 0.3, 0.5);
    vec3 shallowWaterColor = vec3(0.2, 0.5, 0.7);
    vec3 waterTint = mix(shallowWaterColor, deepWaterColor, fresnel);
    
    // Blend video with water tint - keep video visible with blue overlay
    float blueIntensity = 0.15 + rippleIntensity * 0.1;
    vec3 tintedVideo = mix(videoColor.rgb, videoColor.rgb * waterTint * 1.5, blueIntensity);
    
    // Add overall blue hue
    tintedVideo = tintedVideo * vec3(0.9, 0.95, 1.1);
    
    // Add caustic highlights
    tintedVideo += causticColor;
    
    // Specular highlights on ripples - bright spots
    float specularIntensity = pow(rippleIntensity, 1.5) * 0.8;
    vec3 specular = vec3(1.0, 1.0, 1.0) * specularIntensity;
    tintedVideo += specular;
    
    // Edge foam/highlight effect on strong ripples
    float foam = smoothstep(0.4, 0.8, rippleIntensity) * 0.3;
    tintedVideo = mix(tintedVideo, vec3(0.9, 0.95, 1.0), foam);
    
    // Subtle fresnel reflection of sky color
    vec3 skyReflection = vec3(0.6, 0.75, 0.9);
    tintedVideo = mix(tintedVideo, skyReflection, fresnel * 0.25 * uWaterOpacity);
    
    // Subtle vignette for depth
    float vignette = 1.0 - length(vUv - 0.5) * 0.3;
    tintedVideo *= vignette;
    
    gl_FragColor = vec4(tintedVideo, 1.0);
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
  
  // Create ripple data texture with linear filtering for smoother ripples
  const rippleTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      new Float32Array(rippleWidth * rippleHeight * 4),
      rippleWidth,
      rippleHeight,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }, [rippleWidth, rippleHeight])
  
  // Shader uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uVideoTexture: { value: null as THREE.VideoTexture | null },
    uRippleMap: { value: rippleTexture },
    uRippleStrength: { value: 1.2 },
    uRefractionStrength: { value: refractionStrength },
    uWaterColor: { value: new THREE.Color(0.15, 0.4, 0.6) },
    uWaterOpacity: { value: waterOpacity }
  }), [rippleTexture, refractionStrength, waterOpacity])
  
  // Update video texture uniform
  useEffect(() => {
    if (materialRef.current && videoTexture) {
      materialRef.current.uniforms.uVideoTexture.value = videoTexture
      materialRef.current.needsUpdate = true
    }
  }, [videoTexture])
  
  // Update ripple texture from simulation data with larger range
  useEffect(() => {
    if (!rippleData || rippleData.length === 0) return
    
    const data = new Float32Array(rippleWidth * rippleHeight * 4)
    for (let i = 0; i < rippleWidth * rippleHeight; i++) {
      // Increased normalization range and added smoothing
      const val = Math.min(Math.abs(rippleData[i]) / 25, 1.0)
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
  refractionStrength = 0.15,
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
