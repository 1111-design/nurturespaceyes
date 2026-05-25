import { useRef, useMemo, useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Plane, useHelper, Sky, Cloud, Stars, Center, Text, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { SandboxObject } from "../constants";

const GRID_SIZE = 64;
const PLANE_SIZE = 40;

const getTerrainHeight = (x: number, z: number, heights: Float32Array) => {
  const gx = Math.round(((x + PLANE_SIZE / 2) / PLANE_SIZE) * GRID_SIZE);
  const gy = Math.round(((z + PLANE_SIZE / 2) / PLANE_SIZE) * GRID_SIZE);
  if (gx >= 0 && gx <= GRID_SIZE && gy >= 0 && gy <= GRID_SIZE) {
    const idx = gy * (GRID_SIZE + 1) + gx;
    return heights[idx] || 0;
  }
  return 0;
};



interface Sandbox3DProps {
  objects: SandboxObject[];
  onObjectMove: (id: string, x: number, z: number, y: number) => void;
  onObjectSelect: (id: string | null) => void;
  selectedId: string | null;
  mode: 'sculpt' | 'water' | 'grass' | 'object' | 'clear_terrain';
  activeObjectId: string | null;
  onAddObjectAt: (x: number, z: number, y: number) => void;
  onStartAction?: () => void;
}

export const Sandbox3D = forwardRef<any, Sandbox3DProps>(({ 
  objects, 
  onObjectMove, 
  onObjectSelect, 
  selectedId, 
  mode, 
  activeObjectId,
  onAddObjectAt,
  onStartAction
}, ref) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useImperativeHandle(ref, () => ({
    getTerrainSnapshot: () => {
      return {
        heights: new Float32Array(heightsRef.current),
        types: new Uint8Array(typesRef.current)
      };
    },
    restoreTerrainSnapshot: (snapshot: { heights: Float32Array; types: Uint8Array }) => {
      heightsRef.current.set(snapshot.heights);
      typesRef.current.set(snapshot.types);
      setNeedsGeomUpdate(true);
      setTextureTrigger(t => t + 1);
    },
    clearTerrain: () => {
      heightsRef.current.fill(0);
      typesRef.current.fill(0);
      setNeedsGeomUpdate(true);
      setTextureTrigger(t => t + 1);
    }
  }));

  // Use refs for performance-critical data
  const heightsRef = useRef(new Float32Array((GRID_SIZE + 1) * (GRID_SIZE + 1)));
  const typesRef = useRef(new Uint8Array((GRID_SIZE + 1) * (GRID_SIZE + 1))); 
  
  const [hoverPoint, setHoverPoint] = useState<THREE.Vector3 | null>(null);
  const [isSculpting, setIsSculpting] = useState(false);
  
  const [textureTrigger, setTextureTrigger] = useState(0);
  
  const { scene } = useThree();

  // Set scene background
  useEffect(() => {
    scene.background = new THREE.Color("#FDFBF7");
  }, [scene]);

  const [needsGeomUpdate, setNeedsGeomUpdate] = useState(true);
  const frameCountRef = useRef(0);

  // Update geometry vertices based on heights
  useFrame(() => {
    frameCountRef.current++;

    if (meshRef.current && (isSculpting || needsGeomUpdate)) {
      const geom = meshRef.current.geometry as THREE.PlaneGeometry;
      const posAttr = geom.getAttribute('position');
      const hData = heightsRef.current;
      for (let i = 0; i < hData.length; i++) {
        posAttr.setZ(i, hData[i]);
      }
      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
      if (needsGeomUpdate) setNeedsGeomUpdate(false);
    }
  });

  const MAX_HEIGHT = 4; // 限制高度，防止堆得过高

  const updateTerrainAtPoint = (point: THREE.Vector3) => {
    const gx = Math.round(((point.x + PLANE_SIZE / 2) / PLANE_SIZE) * GRID_SIZE);
    const gy = Math.round(((point.z + PLANE_SIZE / 2) / PLANE_SIZE) * GRID_SIZE);

    const radius = 4;
    const strength = 0.15;

    const hData = heightsRef.current;
    const tData = typesRef.current;
    let changed = false;

    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        const nx = gx + i;
        const ny = gy + j;
        if (nx >= 0 && nx <= GRID_SIZE && ny >= 0 && ny <= GRID_SIZE) {
          const idx = ny * (GRID_SIZE + 1) + nx;
          const dist = Math.sqrt(i * i + j * j);
          if (dist <= radius) {
            const factor = Math.cos((dist / radius) * (Math.PI / 2));
            const isBorder = nx <= 2 || nx >= GRID_SIZE - 2 || ny <= 2 || ny >= GRID_SIZE - 2;
            if (mode === 'sculpt' && !isBorder) {
              hData[idx] = Math.min(MAX_HEIGHT, hData[idx] + strength * factor);
              tData[idx] = 0; // Raised sand clears water/grass
              changed = true;
            } else if (mode === 'clear_terrain' && !isBorder) {
              hData[idx] = Math.max(0, hData[idx] - strength * factor);
              tData[idx] = 0; // Digging clears water/grass
              changed = true;
            } else if (mode === 'grass') {
              tData[idx] = 1;
              changed = true;
            } else if (mode === 'water') {
              tData[idx] = 2;
              if (!isBorder) {
                // Carve terrain slightly to form a basin so water pools naturally
                hData[idx] = Math.max(0.01, hData[idx] - strength * 0.9 * factor);
              }
              changed = true;
            }
          }
        }
      }
    }

    if (changed) {
      setTextureTrigger(t => t + 1);
    }
  };

  const handlePointerDown = (e: any) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (mode !== 'object') {
        e.stopPropagation();
        if (onStartAction) onStartAction();
        setIsSculpting(true);
        updateTerrainAtPoint(e.point);
    }
  };

  const handlePointerMove = (e: any) => {
    if (e.point) {
        setHoverPoint(e.point.clone());
        if (isSculpting) {
            updateTerrainAtPoint(e.point);
        }
    }
  };

  const handlePointerUp = () => {
    setIsSculpting(false);
    // Align all placed objects to their post-sculpted terrain Y coordinates
    objects.forEach((obj) => {
      const liveY = getTerrainHeight(obj.x, obj.z, heightsRef.current);
      if (Math.abs(obj.y - liveY) > 0.001) {
        onObjectMove(obj.id, obj.x, obj.z, liveY);
      }
    });
  };

  const handleClick = (e: any) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (mode === 'object' && activeObjectId) {
      const limit = 19.0;
      // Filter out clicks that are way outside, snap the rest inside the sandtray
      if (Math.abs(e.point.x) <= 22.0 && Math.abs(e.point.z) <= 22.0) {
        const px = Math.max(-limit, Math.min(limit, e.point.x));
        const pz = Math.max(-limit, Math.min(limit, e.point.z));
        const terrainY = getTerrainHeight(px, pz, heightsRef.current);
        onAddObjectAt(px, pz, terrainY);
      }
    } else if (!isSculpting) {
      onObjectSelect(null);
    }
  };

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.65} />
      <directionalLight 
        position={[20, 30, 20]} 
        intensity={2.5} 
        castShadow 
        shadow-bias={0.0001}
        shadow-mapSize={[2048, 2048]}
      >
        <orthographicCamera attach="shadow-camera" args={[-30, 30, 30, -30, 0.1, 100]} />
      </directionalLight>
      <pointLight position={[-20, 20, -20]} intensity={0.5} />

      {/* Background Environment */}
      <Sky sunPosition={[100, 50, 100]} turbidity={0.1} rayleigh={0.5} />
      
      {/* Terrain Tray Border (木质边框) */}
      <mesh position={[0, -0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[PLANE_SIZE + 4, 1.2, PLANE_SIZE + 4]} />
        <meshStandardMaterial color="#4A3728" roughness={1} />
      </mesh>
      
      {/* Inner Floor background - Solid dark brown bottom */}
      <mesh position={[0, -1.0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[PLANE_SIZE + 0.1, PLANE_SIZE + 0.1]} />
        <meshStandardMaterial color="#3D2B1F" roughness={1} />
      </mesh>

      {/* Terrain Floor - Binding pointer events directly onto the 3D surface to prioritize front-facing slopes */}
      <mesh 
        ref={meshRef} 
        rotation={[-Math.PI / 2, 0, 0]} 
        castShadow
        receiveShadow 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOut={handlePointerUp}
        onClick={handleClick}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE, GRID_SIZE, GRID_SIZE]} />
        <TerrainMaterial types={typesRef.current} trigger={textureTrigger} />
      </mesh>

      {/* Brush Indicator (Disabled to prevent visual interference) */}



      {/* Objects */}
      {objects.map((obj) => (
        <Object3D 
            key={obj.id} 
            object={obj} 
            onSelect={() => onObjectSelect(obj.id)}
            isSelected={selectedId === obj.id}
            onMove={(x, z, y) => onObjectMove(obj.id, x, z, y)}
            heights={heightsRef.current}
            onStartAction={onStartAction}
        />
      ))}
    </>
  );
});



function TerrainMaterial({ types, trigger }: { types: Uint8Array, trigger: number }) {
    const texture = useMemo(() => {
        const size = GRID_SIZE + 1;
        const data = new Uint8Array(size * size * 4);
        const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }, []); // Only create once

    // Create uniforms for animated fluid flow
    const uniforms = useMemo(() => ({
        uTime: { value: 0 }
    }), []);

    // Drive the time variable for liquid motion animations
    useFrame((state) => {
        uniforms.uTime.value = state.clock.getElapsedTime();
    });

    // Update texture data when types or trigger changes
    useEffect(() => {
        const data = texture.image.data;
        const size = GRID_SIZE + 1;
        for (let gy = 0; gy < size; gy++) {
            for (let gx = 0; gx < size; gx++) {
                const i = gy * size + gx;
                const type = types[i];
                // In Three.js DataTexture, row 0 is the bottom (v = 0), which corresponds to gy = GRID_SIZE
                // So row py should be (size - 1 - gy) for proper standard physical vertical orientation matching terrain vertices.
                const py = size - 1 - gy;
                const texIdx = (py * size + gx) * 4;
                if (type === 0) { // Sand - Semi-darker warm golden sand
                     data[texIdx] = 188; data[texIdx+1] = 142; data[texIdx+2] = 82; data[texIdx+3] = 255; 
                } else if (type === 1) { // Grass - Clean meadows green
                     data[texIdx] = 135; data[texIdx+1] = 175; data[texIdx+2] = 100; data[texIdx+3] = 255;
                } else { // Water - Vivid deep water blue
                     data[texIdx] = 60; data[texIdx+1] = 140; data[texIdx+2] = 210; data[texIdx+3] = 255;
                }
            }
        }
        texture.needsUpdate = true;
    }, [texture, types, trigger]);

    // Custom shader compilation injection for custom physical details
    const handleBeforeCompile = useMemo(() => {
        return (shader: any) => {
            shader.uniforms.uTime = uniforms.uTime;

            shader.fragmentShader = `
                uniform float uTime;
                
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }
                
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
                }
            ` + shader.fragmentShader;

            // Perturb the virtual normal maps for true tactile physical grains & fluid waves under active lighting
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_begin>',
                `
                #include <normal_fragment_begin>
                #ifdef USE_MAP
                    vec4 texCol = texture2D(map, vMapUv);
                    float sandW = clamp((texCol.r - 0.55) * 10.0, 0.0, 1.0);
                    float waterW = clamp((texCol.b - 0.65) * 10.0, 0.0, 1.0);
                    float grassW = clamp((texCol.g - 0.52) * 10.0, 0.0, 1.0) * (1.0 - sandW) * (1.0 - waterW);
                    
                    // SAND PHYSICAL GRAIN TEXTURING
                    // Slight micro-normal offsets to catch lighting (gives physical grains without altering the clean albedo color)
                    if (sandW > 0.01) {
                        vec2 sandUv = vMapUv * 2400.0;
                        float hL = hash(floor(sandUv + vec2(-1.0, 0.0)));
                        float hR = hash(floor(sandUv + vec2(1.0, 0.0)));
                        float hD = hash(floor(sandUv + vec2(0.0, -1.0)));
                        float hU = hash(floor(sandUv + vec2(0.0, 1.0)));
                        
                        vec3 sandBumpNormal = normalize(vec3((hL - hR) * 0.22, (hD - hU) * 0.22, 1.0));
                        normal = normalize(mix(normal, vec3(sandBumpNormal.xy, normal.z), sandW * 0.5));
                    }
                    
                    // GRASS SILKY/ORGANIC MICRO-BUMP TEXTURING
                    // Adds a velvety, natural botanical paper/moss depth that catches soft shadows
                    if (grassW > 0.01) {
                        vec2 grassUv = vMapUv * 800.0;
                        float gL = noise(grassUv + vec2(-1.0, 0.0));
                        float gR = noise(grassUv + vec2(1.0, 0.0));
                        float gD = noise(grassUv + vec2(0.0, -1.0));
                        float gU = noise(grassUv + vec2(0.0, 1.0));
                        
                        vec3 grassBumpNormal = normalize(vec3((gL - gR) * 0.18, (gD - gU) * 0.18, 1.0));
                        normal = normalize(mix(normal, vec3(grassBumpNormal.xy, normal.z), grassW * 0.35));
                    }
                    
                    // WATER LIQUID WAVES & FLOW ACCELERATION
                    // High-density 3-frequency nested waves structure for finer, deeper water bump undulations
                    if (waterW > 0.01) {
                        vec2 waveUv1 = vMapUv * 110.0;
                        vec2 waveUv2 = vMapUv * 260.0;
                        vec2 waveUv3 = vMapUv * 520.0;
                        float offsetTime1 = uTime * 1.5;
                        float offsetTime2 = uTime * 3.1;
                        float offsetTime3 = uTime * 4.8;
                        
                        // Wave Layer 1 (Medium waves)
                        float wL1 = noise(waveUv1 + vec2(-1.0, 0.0) + vec2(offsetTime1 * 0.25, offsetTime1 * 0.15));
                        float wR1 = noise(waveUv1 + vec2(1.0, 0.0) + vec2(offsetTime1 * 0.25, offsetTime1 * 0.15));
                        float wD1 = noise(waveUv1 + vec2(0.0, -1.0) + vec2(-offsetTime1 * 0.15, offsetTime1 * 0.2));
                        float wU1 = noise(waveUv1 + vec2(0.0, 1.0) + vec2(-offsetTime1 * 0.15, offsetTime1 * 0.2));
                        
                        // Wave Layer 2 (Fine wind-blown ripples)
                        float wL2 = noise(waveUv2 + vec2(-1.0, 0.0) - vec2(offsetTime2 * 0.35, -offsetTime2 * 0.25));
                        float wR2 = noise(waveUv2 + vec2(1.0, 0.0) - vec2(offsetTime2 * 0.35, -offsetTime2 * 0.25));
                        float wD2 = noise(waveUv2 + vec2(0.0, -1.0) - vec2(offsetTime2 * 0.25, offsetTime2 * 0.35));
                        float wU2 = noise(waveUv2 + vec2(0.0, 1.0) - vec2(offsetTime2 * 0.25, offsetTime2 * 0.35));

                        // Wave Layer 3 (Micro-shimmer textures)
                        float wL3 = noise(waveUv3 + vec2(-1.0, 1.0) + vec2(offsetTime3 * 0.4, -offsetTime3 * 0.3));
                        float wR3 = noise(waveUv3 + vec2(1.0, -1.0) + vec2(offsetTime3 * 0.4, -offsetTime3 * 0.3));
                        float wD3 = noise(waveUv3 + vec2(-1.0, -1.0) + vec2(offsetTime3 * 0.3, offsetTime3 * 0.5));
                        float wU3 = noise(waveUv3 + vec2(1.0, 1.0) + vec2(offsetTime3 * 0.3, offsetTime3 * 0.5));
                        
                        vec3 waterBump1 = normalize(vec3((wL1 - wR1) * 0.55, (wD1 - wU1) * 0.55, 1.0));
                        vec3 waterBump2 = normalize(vec3((wL2 - wR2) * 0.32, (wD2 - wU2) * 0.32, 1.0));
                        vec3 waterBump3 = normalize(vec3((wL3 - wR3) * 0.18, (wD3 - wU3) * 0.18, 1.0));
                        vec3 combinedWaterBump = normalize(waterBump1 * 0.5 + waterBump2 * 0.35 + waterBump3 * 0.15);
                        
                        normal = normalize(mix(normal, vec3(combinedWaterBump.xy, normal.z), waterW * 0.98));
                    }
                #endif
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                    // Estimate water weight first with base UV
                    vec4 baseCol = texture2D(map, vMapUv);
                    float baseWaterW = clamp((baseCol.b - 0.65) * 10.0, 0.0, 1.0);
                    
                    vec2 refractOffset = vec2(0.0);
                    if (baseWaterW > 0.01) {
                        // Liquid refraction: shift UV texture lookup based on high-frequency waves
                        refractOffset = vec2(
                            noise(vMapUv * 90.0 + vec2(uTime * 1.6, uTime * 0.9)) - 0.5,
                            noise(vMapUv * 90.0 - vec2(uTime * 1.1, -uTime * 1.4)) - 0.5
                        ) * 0.015 * baseWaterW; // Max refraction displacement scaled by water depth
                    }
                    
                    vec4 sampledDiffuseColor = texture2D(map, vMapUv + refractOffset);
                    float sandWeightVal = clamp((sampledDiffuseColor.r - 0.55) * 10.0, 0.0, 1.0);
                    float waterWeightVal = clamp((sampledDiffuseColor.b - 0.65) * 10.0, 0.0, 1.0);
                    
                    vec3 finalAlbedo = sampledDiffuseColor.rgb;
                    
                    // Enhancing Sand Color: Restore sand to its beautiful previous yellow texture with micro-noise subtle variations
                    if (sandWeightVal > 0.01) {
                        float sNoise = noise(vMapUv * 600.0) * 0.12 + noise(vMapUv * 300.0) * 0.18;
                        // Center the multiplier around 1.0 using the original base yellow
                        vec3 detailedSand = finalAlbedo * (0.80 + sNoise);
                        finalAlbedo = mix(finalAlbedo, detailedSand, sandWeightVal);
                    }
                    
                    // Procedural animated flow textures & shimmer waves within the albedo
                    if (waterWeightVal > 0.01) {
                        vec2 uvFlow1 = (vMapUv + refractOffset) * 65.0 + vec2(uTime * 0.045, uTime * 0.024);
                        vec2 uvFlow2 = (vMapUv + refractOffset) * 125.0 - vec2(uTime * 0.035, uTime * 0.055);
                        float n1 = noise(uvFlow1);
                        float n2 = noise(uvFlow2);
                        float combinedNoise = (n1 * 0.55 + n2 * 0.45);
                        
                        // Core tones centered around original vivid deep-water blue (60, 140, 210)
                        vec3 waterDeepColor = vec3(0.08, 0.38, 0.68); // Rich deeper ocean blue
                        vec3 waterMidColor = finalAlbedo; // Original vivid blue base
                        vec3 waterGlintColor = vec3(0.72, 0.90, 0.99); // Sparkling sky-blue crest / light reflection
                        
                        vec3 flowingWater = mix(waterDeepColor, waterMidColor, combinedNoise * 0.6 + 0.2);
                        
                        // Foam crests and reflections glint in specific wave peaks
                        float glintPeak = 0.62;
                        if (combinedNoise > glintPeak) {
                            float glintInt = smoothstep(glintPeak, 0.78, combinedNoise);
                            flowingWater = mix(flowingWater, waterGlintColor, glintInt * 0.72);
                        }
                        
                        // ADD CAUSTICS (焦散折射光影)
                        // Overlaying high-contrast light networks that crawl across the floor
                        vec2 causticUv1 = (vMapUv + refractOffset) * 180.0 + vec2(uTime * 0.08, uTime * 0.04);
                        vec2 causticUv2 = (vMapUv + refractOffset) * 320.0 - vec2(-uTime * 0.06, uTime * 0.09);
                        float c1 = noise(causticUv1);
                        float c2 = noise(causticUv2);
                        // Sharp cellular caustic shape: use absolute differences and multiplication
                        float causticMask = abs(c1 - 0.5) * abs(c2 - 0.5) * 4.0;
                        causticMask = pow(1.0 - causticMask, 4.0); // Create narrow, sharp high-intensity light webs
                        float causticIntensity = smoothstep(0.4, 0.85, causticMask) * 0.45 * waterWeightVal;
                        
                        // Apply caustic brightness and tint
                        flowingWater += vec3(0.55, 0.88, 1.0) * causticIntensity;
                        
                        finalAlbedo = mix(finalAlbedo, flowingWater, waterWeightVal);
                    }
                    
                    diffuseColor *= vec4(finalAlbedo, sampledDiffuseColor.a);
                    
                    // Liquid translucency: Water is 0.5 opacity (transparent clear), Sand and Grass are 1.0 (fully opaque)
                    diffuseColor.a = mix(1.0, 0.50, waterWeightVal);
                #endif
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>
                #ifdef USE_MAP
                    vec4 r_sampledColor = texture2D( map, vMapUv );
                    float r_sandWeight = clamp((r_sampledColor.r - 0.55) * 10.0, 0.0, 1.0);
                    float r_waterWeight = clamp((r_sampledColor.b - 0.65) * 10.0, 0.0, 1.0);
                    float r_grassWeight = clamp((r_sampledColor.g - 0.52) * 10.0, 0.0, 1.0) * (1.0 - r_sandWeight) * (1.0 - r_waterWeight);
                    
                    // Clear, wet water is extremely glossy/reflective and flows dynamically
                    float fineWaterNoise = noise(vMapUv * 140.0 + vec2(uTime * 0.12, -uTime * 0.08));
                    float dynamicWaterRoughness = mix(0.012, 0.05, fineWaterNoise);
                    roughnessFactor = mix(roughnessFactor, dynamicWaterRoughness, r_waterWeight);
                    
                    // Sand is rough and dusty (roughness: 0.92)
                    roughnessFactor = mix(roughnessFactor, 0.92, r_sandWeight);
                    
                    // Grass is rough and velvet matte (roughness: 0.95)
                    roughnessFactor = mix(roughnessFactor, 0.95, r_grassWeight);
                #endif
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <metalnessmap_fragment>',
                `
                #include <metalnessmap_fragment>
                #ifdef USE_MAP
                    vec4 m_sampledColor = texture2D( map, vMapUv );
                    float m_waterWeight = clamp((m_sampledColor.b - 0.65) * 10.0, 0.0, 1.0);
                    // High metalness on water allows specular sparks from the directional light sun
                    metalnessFactor = mix(metalnessFactor, 0.9, m_waterWeight);
                #endif
                `
            );
        };
    }, [uniforms]);

    return <meshStandardMaterial 
        map={texture} 
        roughness={1} 
        metalness={0} 
        transparent={true}
        depthWrite={true}
        onBeforeCompile={handleBeforeCompile} 
    />;
}

function Object3D({ object, onSelect, isSelected, onMove, heights, onStartAction }: { 
    object: SandboxObject, 
    onSelect: () => void, 
    isSelected: boolean,
    onMove: (x: number, z: number, y: number) => void,
    heights: Float32Array,
    onStartAction?: () => void
}) {
    const groupRef = useRef<THREE.Group>(null);
    const [isDragging, setIsDragging] = useState(false);
    const { raycaster, camera } = useThree();

    const handlePointerDown = (e: any) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.stopPropagation();
        onSelect();
        if (onStartAction) onStartAction();
        setIsDragging(true);
    };

    useFrame(() => {
        if (isDragging) {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, target);
            
            // Constrain object dragging coordinates to stay inside sandbox limits (margin-adjusted)
            const limit = 19.0;
            const px = Math.max(-limit, Math.min(limit, target.x));
            const pz = Math.max(-limit, Math.min(limit, target.z));
            
            const currentY = getTerrainHeight(px, pz, heights);
            onMove(px, pz, currentY);
        }
    });

    useEffect(() => {
        const handleUp = () => setIsDragging(false);
        window.addEventListener('pointerup', handleUp);
        return () => window.removeEventListener('pointerup', handleUp);
    }, []);

    const renderModel = () => {
        const scale = object.scale || 1.0;
        switch(object.type) {
            case 'tree': 
                return (
                    <group scale={scale}>
                        <mesh position={[0, 1, 0]} castShadow>
                            <cylinderGeometry args={[0.2, 0.25, 2, 8]} />
                            <meshStandardMaterial color="#5D4037" />
                        </mesh>
                        {[0, 1, 2].map(i => (
                            <mesh key={i} position={[0, 1.8 + i * 0.8, 0]} castShadow>
                                <coneGeometry args={[1 - i * 0.2, 1.5, 12]} />
                                <meshStandardMaterial color={i === 0 ? "#2E7D32" : i === 1 ? "#388E3C" : "#43A047"} />
                            </mesh>
                        ))}
                    </group>
                );
            case 'person_male': 
                return (
                    <group scale={scale * 0.8}>
                        {/* Body (Shirt/Pants) */}
                        <mesh position={[0, 0.9, 0]} castShadow>
                            <capsuleGeometry args={[0.22, 1.0, 4, 12]} />
                            <meshStandardMaterial color="#2E5B82" roughness={0.7} />
                        </mesh>
                        {/* Head */}
                        <mesh position={[0, 1.8, 0]} castShadow>
                            <sphereGeometry args={[0.27, 16, 16]} />
                            <meshStandardMaterial color="#FFE0BD" roughness={0.6} />
                        </mesh>
                        {/* Male Hair / Cap */}
                        <mesh position={[0, 1.94, -0.02]} castShadow>
                            <sphereGeometry args={[0.22, 12, 12]} />
                            <meshStandardMaterial color="#3E2723" roughness={0.9} />
                        </mesh>
                        {/* Simple arms */}
                        <mesh position={[0.3, 1.1, 0]} rotation={[0, 0, 0.2]} castShadow>
                            <capsuleGeometry args={[0.08, 0.55, 4, 8]} />
                            <meshStandardMaterial color="#2E5B82" roughness={0.7} />
                        </mesh>
                        <mesh position={[-0.3, 1.1, 0]} rotation={[0, 0, -0.2]} castShadow>
                            <capsuleGeometry args={[0.08, 0.55, 4, 8]} />
                            <meshStandardMaterial color="#2E5B82" roughness={0.7} />
                        </mesh>
                    </group>
                );
            case 'person_female': 
                return (
                    <group scale={scale * 0.8}>
                        {/* Dress / Body */}
                        <mesh position={[0, 0.85, 0]} castShadow>
                            <cylinderGeometry args={[0.16, 0.32, 1.1, 16]} />
                            <meshStandardMaterial color="#D85A7D" roughness={0.7} />
                        </mesh>
                        {/* Head */}
                        <mesh position={[0, 1.8, 0]} castShadow>
                            <sphereGeometry args={[0.26, 16, 16]} />
                            <meshStandardMaterial color="#FFE0BD" roughness={0.6} />
                        </mesh>
                        {/* Female Hair (Hair back bun or ponytail) */}
                        <mesh position={[0, 1.9, -0.04]} castShadow>
                            <sphereGeometry args={[0.24, 12, 12]} />
                            <meshStandardMaterial color="#1C110C" roughness={0.9} />
                        </mesh>
                        <mesh position={[0, 1.73, -0.21]} castShadow>
                            <sphereGeometry args={[0.11, 8, 8]} />
                            <meshStandardMaterial color="#1C110C" roughness={0.9} />
                        </mesh>
                        {/* Simple arms */}
                        <mesh position={[0.28, 1.1, 0]} rotation={[0, 0, 0.25]} castShadow>
                            <capsuleGeometry args={[0.07, 0.55, 4, 8]} />
                            <meshStandardMaterial color="#D85A7D" roughness={0.7} />
                        </mesh>
                        <mesh position={[-0.28, 1.1, 0]} rotation={[0, 0, -0.25]} castShadow>
                            <capsuleGeometry args={[0.07, 0.55, 4, 8]} />
                            <meshStandardMaterial color="#D85A7D" roughness={0.7} />
                        </mesh>
                    </group>
                );
            case 'cat':
                return (
                    <group scale={scale * 0.45}>
                        <mesh position={[0, 0.4, 0]} castShadow>
                            <boxGeometry args={[1, 0.6, 0.5]} />
                            <meshStandardMaterial color="#FFB74D" />
                        </mesh>
                        <mesh position={[0.5, 0.8, 0]} castShadow>
                            <boxGeometry args={[0.4, 0.4, 0.4]} />
                            <meshStandardMaterial color="#FFB74D" />
                        </mesh>
                        {/* Tail */}
                        <mesh position={[-0.6, 0.6, 0]} rotation={[0, 0, 0.5]} castShadow>
                            <cylinderGeometry args={[0.05, 0.05, 0.8]} />
                            <meshStandardMaterial color="#FFB74D" />
                        </mesh>
                        {/* Ears */}
                        <mesh position={[0.6, 1.1, 0.1]} castShadow>
                            <coneGeometry args={[0.08, 0.2, 3]} />
                            <meshStandardMaterial color="#FFB74D" />
                        </mesh>
                        <mesh position={[0.6, 1.1, -0.1]} castShadow>
                            <coneGeometry args={[0.08, 0.2, 3]} />
                            <meshStandardMaterial color="#FFB74D" />
                        </mesh>
                    </group>
                );
            case 'dog':
                return (
                    <group scale={scale * 0.55}>
                        <mesh position={[0, 0.5, 0]} castShadow>
                            <boxGeometry args={[1.2, 0.7, 0.6]} />
                            <meshStandardMaterial color="#8D6E63" />
                        </mesh>
                        <mesh position={[0.7, 1.0, 0]} castShadow>
                            <boxGeometry args={[0.5, 0.5, 0.5]} />
                            <meshStandardMaterial color="#8D6E63" />
                        </mesh>
                        {/* Snout */}
                        <mesh position={[1.0, 0.9, 0]} castShadow>
                            <boxGeometry args={[0.3, 0.2, 0.2]} />
                            <meshStandardMaterial color="#795548" />
                        </mesh>
                        {/* Ears */}
                        <mesh position={[0.8, 1.3, 0.2]} castShadow>
                            <boxGeometry args={[0.1, 0.3, 0.2]} />
                            <meshStandardMaterial color="#5D4037" />
                        </mesh>
                        <mesh position={[0.8, 1.3, -0.2]} castShadow>
                            <boxGeometry args={[0.1, 0.3, 0.2]} />
                            <meshStandardMaterial color="#5D4037" />
                        </mesh>
                    </group>
                );
            case 'flower': 
                return (
                    <group scale={scale * 0.5}>
                        <mesh position={[0, 0.5, 0]} castShadow>
                            <cylinderGeometry args={[0.04, 0.04, 1]} />
                            <meshStandardMaterial color="#689F38" />
                        </mesh>
                        <mesh position={[0, 1.0, 0]} castShadow>
                            <sphereGeometry args={[0.15, 8, 8]} />
                            <meshStandardMaterial color="#FBC02D" />
                        </mesh>
                        {[0, 60, 120, 180, 240, 300].map(deg => (
                            <mesh key={deg} position={[Math.cos(deg*Math.PI/180)*0.3, 1.0, Math.sin(deg*Math.PI/180)*0.3]} rotation={[0, -deg*Math.PI/180, 0]}>
                                <boxGeometry args={[0.35, 0.08, 0.2]} />
                                <meshStandardMaterial color="#F06292" />
                            </mesh>
                        ))}
                    </group>
                );
            case 'stone': return <mesh castShadow position={[0, 0.2, 0]} scale={scale}><dodecahedronGeometry args={[0.5]} /><meshStandardMaterial color="#90A4AE" roughness={0.9} /></mesh>;
            default: return <mesh castShadow position={[0, 0.5, 0]} scale={scale}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#94A396" /></mesh>;
        }
    }

    const liveY = getTerrainHeight(object.x, object.z, heights);

    return (
        <group 
            ref={groupRef}
            position={[object.x, liveY, object.z]} 
            rotation={[0, object.rotation, 0]}
            onPointerDown={handlePointerDown}
        >
            {renderModel()}
            {isSelected && (
                <mesh position={[0, 0.05, 0]} rotation={[-Math.PI/2, 0, 0]}>
                    <ringGeometry args={[1.2 * (object.scale || 1), 1.5 * (object.scale || 1), 32]} />
                    <meshBasicMaterial color="#4299E1" transparent opacity={0.6} />
                </mesh>
            )}
        </group>
    );
}
