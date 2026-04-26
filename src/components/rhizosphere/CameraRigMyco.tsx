import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { advanceKickImpact, type ReactiveVisualState } from "../rhizosphereRendering";

const tmpLook = new THREE.Vector3(0, 0, 0);

export interface BoundsFrame {
  center: THREE.Vector3;
  radius: number;
}

type Props = {
  /** Updated each frame (before this rig) with graph AABB. */
  boundsRef: RefObject<BoundsFrame>;
  /** Latest audio-reactive state for camera breathing. */
  reactiveRef: RefObject<ReactiveVisualState>;
  /** prefers-reduced-motion. */
  reducedMotionRef: RefObject<boolean>;
  /** Elapsed time ref for slow drift in reduced mode. */
  timeMsRef: RefObject<number>;
};

const ORBIT_SPEED = 0.36;
const REDUCED_ORBIT_SPEED = 0.12;
const CENTER_LERP = 0.06;
const FRAMING_LERP = 0.012;

/**
 * Cinematic orbit: camera circles a damped colony center.
 * Growth changes framing slowly, so the view feels anchored instead of glued to every new node.
 */
export function CameraRigMyco({ boundsRef, reactiveRef, reducedMotionRef, timeMsRef }: Props) {
  const { camera } = useThree();
  const workRef = useRef(new THREE.Vector3(6, 2.2, 4));
  const smoothCenter = useRef(new THREE.Vector3(0, 0, 0));
  const orbitAngleRef = useRef(0.65);
  const smoothRadiusRef = useRef(4.2);
  const smoothHeightRef = useRef(1.9);
  const kickImpactRef = useRef(0);
  const joltOffset = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const t = timeMsRef.current * 0.001;
    const b = boundsRef.current;
    const r = reactiveRef.current;
    const rm = reducedMotionRef.current;

    smoothCenter.current.lerp(b.center, rm ? CENTER_LERP * 0.25 : CENTER_LERP);

    const targetRadius = Math.max(3.2, Math.min(14, b.radius * 1.75 + 1.8));
    smoothRadiusRef.current += (targetRadius - smoothRadiusRef.current) * (rm ? FRAMING_LERP * 0.25 : FRAMING_LERP);

    const targetHeight = Math.max(1.4, Math.min(6.5, b.radius * 0.34 + 1.65));
    smoothHeightRef.current += (targetHeight - smoothHeightRef.current) * (rm ? FRAMING_LERP * 0.25 : FRAMING_LERP);

    const speed = rm ? REDUCED_ORBIT_SPEED : ORBIT_SPEED;
    orbitAngleRef.current += delta * speed;
    const angle = orbitAngleRef.current;
    const radiusBreath = rm ? 0 : Math.sin(t * 0.09) * 0.18 + r.overallEnergy * 0.12;
    const heightDrift = rm ? 0 : Math.sin(t * 0.07 + 1.4) * 0.1 + r.trebleEnergy * 0.08;
    const radius = smoothRadiusRef.current + radiusBreath;
    const height = smoothHeightRef.current + heightDrift;

    workRef.current.set(
      smoothCenter.current.x + Math.cos(angle) * radius,
      smoothCenter.current.y + height,
      smoothCenter.current.z + Math.sin(angle) * radius
    );

    // Nudge from kickPulse, not only !isSilent (gating can stay "silent" on sparse mixes).
    const canReact =
      r && (!r.isSilent || r.bassEnergy > 0.02 || r.kickPulse > 0.04 || r.overallEnergy > 0.04);
    if (rm) {
      kickImpactRef.current = 0;
    } else if (canReact) {
      kickImpactRef.current = advanceKickImpact({
        previousImpact: kickImpactRef.current,
        kickPulse: r.kickPulse,
        deltaSeconds: delta,
        reducedMotion: rm,
      });
    } else {
      kickImpactRef.current *= Math.exp(-delta * 8);
    }
    const j = kickImpactRef.current;
    if (j > 0.001) {
      const phase = angle * 4.1 + t * 0.22;
      joltOffset.current.set(
        Math.sin(phase) * j * 0.34,
        Math.sin(phase * 1.3 - 0.4) * j * 0.16,
        Math.cos(phase * 0.95 + 0.2) * j * 0.3
      );
      workRef.current.add(joltOffset.current);
    }

    camera.position.copy(workRef.current);
    tmpLook.copy(smoothCenter.current);
    tmpLook.y += rm ? 0.05 : 0.08;
    camera.lookAt(tmpLook);
  });

  return null;
}
