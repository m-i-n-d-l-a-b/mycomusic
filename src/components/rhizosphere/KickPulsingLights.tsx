import { useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { advanceKickImpact, type ReactiveVisualState } from "../rhizosphereRendering";

const HEMI_BASE = 0.82;
const AMBIENT_BASE = 0.14;
const DIR_WARM_BASE = 1.45;
const DIR_COOL_BASE = 0.62;
const POINT_BASE = 1.1;
const PULSE_TRIGGER = 0.18;

interface BoundsFrameLike {
  center: THREE.Vector3;
  radius: number;
}

type Props = {
  reactiveRef: RefObject<ReactiveVisualState>;
  reducedMotionRef: RefObject<boolean>;
  timeMsRef: RefObject<number>;
  boundsRef: RefObject<BoundsFrameLike>;
};

/**
 * Drives key light intensities from bass energy and kick transients.
 */
export function KickPulsingLights({ reactiveRef, reducedMotionRef, timeMsRef, boundsRef }: Props) {
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const dirWarmRef = useRef<THREE.DirectionalLight>(null);
  const dirCoolRef = useRef<THREE.DirectionalLight>(null);
  const pointRef = useRef<THREE.PointLight>(null);
  const pulseGroupRef = useRef<THREE.Group>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const ringCRef = useRef<THREE.Mesh>(null);
  const kickSmoothed = useRef(0);
  const kickImpactRef = useRef(0);
  const pulseAgeRef = useRef(10);
  const pulseStrengthRef = useRef(0);
  const lastKickRef = useRef(0);

  useFrame((_, delta) => {
    const r = reactiveRef.current;
    if (!r) return;
    const rm = reducedMotionRef.current;
    const t = timeMsRef.current * 0.001;
    // Do not require !isSilent: field smoothing can mark silent while bands still have trace energy;
    // bass/kick already go to 0 when audio is actually idle.
    const hasLevel = r.overallEnergy > 0.0005 || r.bassEnergy > 0.0005 || r.kickPulse > 0.0005;
    if (!hasLevel) {
      kickSmoothed.current *= Math.exp(-delta * 8);
    } else {
      kickSmoothed.current = Math.max(
        kickSmoothed.current * Math.exp(-delta * 10),
        r.kickPulse * (rm ? 0.25 : 1)
      );
    }
    const kick = kickSmoothed.current;
    const impact = advanceKickImpact({
      previousImpact: kickImpactRef.current,
      kickPulse: r.kickPulse,
      deltaSeconds: delta,
      reducedMotion: rm,
    });
    kickImpactRef.current = impact;
    const bass = r.bassEnergy;
    const breath = rm ? 0 : Math.sin(t * 0.31) * 0.1 + Math.sin(t * 0.085) * 0.12;
    const wobble = rm ? 0 : Math.sin(t * 0.12 + 0.4) * bass * 0.18;

    const boost = (rm ? 0.35 : 1) * (kick * 1.55 + impact * 0.85 + bass * 0.08) + wobble;
    if (hemiRef.current) hemiRef.current.intensity = HEMI_BASE + breath * 0.12 + boost * 0.28;
    if (ambientRef.current) ambientRef.current.intensity = AMBIENT_BASE + boost * 0.2 + breath * 0.08;
    if (dirWarmRef.current) dirWarmRef.current.intensity = DIR_WARM_BASE + boost * 0.95 + impact * 0.65;
    if (dirCoolRef.current) dirCoolRef.current.intensity = DIR_COOL_BASE + boost * 0.35;
    if (pointRef.current) pointRef.current.intensity = POINT_BASE + boost * 1.45 + impact * 1.8;

    const kickRising = r.kickPulse > PULSE_TRIGGER && r.kickPulse > lastKickRef.current + 0.035;
    if (!rm && kickRising) {
      pulseAgeRef.current = 0;
      pulseStrengthRef.current = Math.max(pulseStrengthRef.current, r.kickPulse);
    } else {
      pulseAgeRef.current += delta * 1.85;
      pulseStrengthRef.current *= Math.exp(-delta * 2.4);
    }
    lastKickRef.current = r.kickPulse;

    const bounds = boundsRef.current;
    if (pulseGroupRef.current && bounds) {
      pulseGroupRef.current.position.set(bounds.center.x, -0.035, bounds.center.z);
    }

    const colonyScale = Math.max(1.3, Math.min(5.2, (bounds?.radius ?? 1) * 0.8 + 1.2));
    const rings = [ringARef.current, ringBRef.current, ringCRef.current];
    for (let i = 0; i < rings.length; i += 1) {
      const ring = rings[i];
      if (!ring) continue;
      const phase = pulseAgeRef.current - i * 0.14;
      const visible = phase >= 0 && phase <= 1;
      ring.visible = visible;
      const material = ring.material;
      if (!visible || !(material instanceof THREE.MeshBasicMaterial)) continue;
      const fade = Math.pow(1 - phase, 1.8);
      const opacity = Math.min(0.72, pulseStrengthRef.current * fade * (0.62 - i * 0.1));
      const scale = colonyScale * (0.45 + phase * (1.45 + i * 0.18));
      ring.scale.setScalar(scale);
      material.opacity = opacity;
    }
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} color="#9cffbc" groundColor="#02100b" intensity={HEMI_BASE} />
      <ambientLight ref={ambientRef} color="#143324" intensity={AMBIENT_BASE} />
      <directionalLight
        ref={dirWarmRef}
        position={[5, 8, 4]}
        intensity={DIR_WARM_BASE}
        color="#fff3cf"
        castShadow={false}
      />
      <directionalLight
        ref={dirCoolRef}
        position={[-6, 3, -5]}
        intensity={DIR_COOL_BASE}
        color="#54d8ff"
        castShadow={false}
      />
      <pointLight
        ref={pointRef}
        position={[0, 1.25, 0]}
        intensity={POINT_BASE}
        color="#83ffe1"
        distance={18}
        decay={1.35}
      />
      <group ref={pulseGroupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {[ringARef, ringBRef, ringCRef].map((ref, index) => (
          <mesh key={index} ref={ref} visible={false}>
            <torusGeometry args={[1, 0.014 + index * 0.004, 8, 128]} />
            <meshBasicMaterial
              color={index === 0 ? "#b8ffe4" : index === 1 ? "#72f6ff" : "#ffcf8a"}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}
