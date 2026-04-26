import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { advanceCameraKickNudge, type ReactiveVisualState } from "../rhizosphereRendering";

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

const ORBIT_SPEED = 0.38;
const REDUCED_ORBIT_SPEED = 0.22;
const CENTER_LERP = 0.16;
const FRAMING_LERP = 0.02;
const ORBIT_AXIS_TILT_RADIANS = 0.43;
const REDUCED_ORBIT_AXIS_TILT_RADIANS = 0.19;
const CAMERA_TIMER_MIN_SECONDS = 30;
const CAMERA_TIMER_MAX_SECONDS = 60;
const CAMERA_POSITION_RESPONSE = 1.35;
const REDUCED_CAMERA_POSITION_RESPONSE = 0.58;
const CAMERA_LOOK_RESPONSE = 1.6;
const REDUCED_CAMERA_LOOK_RESPONSE = 0.72;

type CameraAngleProfile = {
  radiusScale: number;
  heightScale: number;
  heightOffset: number;
  angleOffset: number;
  speedScale: number;
  axisTilt: number;
  reducedAxisTilt: number;
  lookLift: number;
  fov: number;
};

const CAMERA_ANGLE_PROFILES: CameraAngleProfile[] = [
  {
    radiusScale: 1,
    heightScale: 1,
    heightOffset: 0,
    angleOffset: 0,
    speedScale: 1,
    axisTilt: ORBIT_AXIS_TILT_RADIANS,
    reducedAxisTilt: REDUCED_ORBIT_AXIS_TILT_RADIANS,
    lookLift: 0.08,
    fov: 55,
  },
  {
    radiusScale: 0.82,
    heightScale: 2.05,
    heightOffset: 0.85,
    angleOffset: Math.PI * 0.42,
    speedScale: 0.72,
    axisTilt: 0.18,
    reducedAxisTilt: 0.1,
    lookLift: 0.5,
    fov: 49,
  },
  {
    radiusScale: 0.62,
    heightScale: 0.42,
    heightOffset: -0.18,
    angleOffset: -Math.PI * 0.34,
    speedScale: 1.24,
    axisTilt: 0.7,
    reducedAxisTilt: 0.28,
    lookLift: -0.04,
    fov: 63,
  },
];

function randomCameraSwitchSeconds() {
  return CAMERA_TIMER_MIN_SECONDS + Math.random() * (CAMERA_TIMER_MAX_SECONDS - CAMERA_TIMER_MIN_SECONDS);
}

function pickNextCameraAngle(currentIndex: number) {
  const nextOffset = 1 + Math.floor(Math.random() * (CAMERA_ANGLE_PROFILES.length - 1));
  return (currentIndex + nextOffset) % CAMERA_ANGLE_PROFILES.length;
}

function frameResponse(deltaSeconds: number, response: number) {
  return 1 - Math.exp(-deltaSeconds * response);
}

/**
 * Cinematic orbit: camera circles a damped colony center.
 * Growth changes framing slowly, so the view feels anchored instead of glued to every new node.
 */
export function CameraRigMyco({ boundsRef, reactiveRef, reducedMotionRef, timeMsRef }: Props) {
  const { camera } = useThree();
  const workRef = useRef(new THREE.Vector3(5.3, 2.2, 3.5));
  const smoothCameraPosition = useRef(new THREE.Vector3(5.3, 2.2, 3.5));
  const smoothLook = useRef(new THREE.Vector3(0, 0.08, 0));
  const smoothCenter = useRef(new THREE.Vector3(0, 0, 0));
  const orbitAngleRef = useRef(0.65);
  const smoothRadiusRef = useRef(3.7);
  const smoothHeightRef = useRef(1.9);
  const kickNudgeRef = useRef(0);
  const joltOffset = useRef(new THREE.Vector3(0, 0, 0));
  const activeCameraAngleRef = useRef(0);
  const cameraAngleElapsedRef = useRef(0);
  const nextCameraAngleSwitchRef = useRef(randomCameraSwitchSeconds());

  useFrame((_, delta) => {
    const t = timeMsRef.current * 0.001;
    const b = boundsRef.current;
    const r = reactiveRef.current;
    const rm = reducedMotionRef.current;
    cameraAngleElapsedRef.current += delta;
    if (cameraAngleElapsedRef.current >= nextCameraAngleSwitchRef.current) {
      activeCameraAngleRef.current = pickNextCameraAngle(activeCameraAngleRef.current);
      cameraAngleElapsedRef.current = 0;
      nextCameraAngleSwitchRef.current = randomCameraSwitchSeconds();
    }
    const angleProfile = CAMERA_ANGLE_PROFILES[activeCameraAngleRef.current];

    smoothCenter.current.lerp(b.center, rm ? CENTER_LERP * 0.25 : CENTER_LERP);

    const targetRadius = Math.max(2.85, Math.min(12.4, b.radius * 1.55 + 1.55));
    smoothRadiusRef.current += (targetRadius - smoothRadiusRef.current) * (rm ? FRAMING_LERP * 0.25 : FRAMING_LERP);

    const targetHeight = Math.max(1.4, Math.min(6.5, b.radius * 0.34 + 1.65));
    smoothHeightRef.current += (targetHeight - smoothHeightRef.current) * (rm ? FRAMING_LERP * 0.25 : FRAMING_LERP);

    const speed = (rm ? REDUCED_ORBIT_SPEED : ORBIT_SPEED) * angleProfile.speedScale;
    orbitAngleRef.current += delta * speed;
    const angle = orbitAngleRef.current + angleProfile.angleOffset;
    const radiusBreath = rm ? 0 : Math.sin(t * 0.09) * 0.18 + r.overallEnergy * 0.12;
    const heightDrift = rm ? 0 : Math.sin(t * 0.07 + 1.4) * 0.1 + r.trebleEnergy * 0.08;
    const radius = (smoothRadiusRef.current + radiusBreath) * angleProfile.radiusScale;
    const height = Math.max(0.38, smoothHeightRef.current * angleProfile.heightScale + angleProfile.heightOffset + heightDrift);
    const axisTilt = rm ? angleProfile.reducedAxisTilt : angleProfile.axisTilt;
    const orbitX = Math.cos(angle) * radius;
    const orbitZ = Math.sin(angle) * radius;

    workRef.current.set(
      smoothCenter.current.x + orbitX,
      smoothCenter.current.y + height + Math.sin(axisTilt) * orbitZ,
      smoothCenter.current.z + Math.cos(axisTilt) * orbitZ
    );

    // Nudge from kickPulse, not only !isSilent (gating can stay "silent" on sparse mixes).
    const canReact =
      r && (!r.isSilent || r.bassEnergy > 0.02 || r.kickPulse > 0.04 || r.overallEnergy > 0.04);
    if (rm) {
      kickNudgeRef.current = 0;
    } else if (canReact) {
      kickNudgeRef.current = advanceCameraKickNudge({
        previousNudge: kickNudgeRef.current,
        kickPulse: r.kickPulse,
        deltaSeconds: delta,
        reducedMotion: rm,
      });
    } else {
      kickNudgeRef.current *= Math.exp(-delta * 8);
    }
    const j = kickNudgeRef.current;
    if (j > 0.001) {
      const phase = angle * 4.1 + t * 0.22;
      const punchDistance = Math.min(0.72, Math.max(0.22, radius * 0.06)) * j;
      joltOffset.current.copy(smoothCenter.current).sub(workRef.current);
      if (joltOffset.current.lengthSq() > 0) {
        joltOffset.current.normalize().multiplyScalar(punchDistance);
      }
      joltOffset.current.x += Math.sin(phase) * j * 0.11;
      joltOffset.current.y += Math.sin(phase * 1.3 - 0.4) * j * 0.09;
      joltOffset.current.z += Math.cos(phase * 0.95 + 0.2) * j * 0.1;
      workRef.current.add(joltOffset.current);
    }

    const positionResponse = rm ? REDUCED_CAMERA_POSITION_RESPONSE : CAMERA_POSITION_RESPONSE;
    smoothCameraPosition.current.lerp(workRef.current, frameResponse(delta, positionResponse));
    camera.position.copy(smoothCameraPosition.current);
    tmpLook.copy(smoothCenter.current);
    tmpLook.y += rm ? Math.min(0.16, angleProfile.lookLift) : angleProfile.lookLift;
    const lookResponse = rm ? REDUCED_CAMERA_LOOK_RESPONSE : CAMERA_LOOK_RESPONSE;
    smoothLook.current.lerp(tmpLook, frameResponse(delta, lookResponse));
    camera.lookAt(smoothLook.current);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = rm ? Math.max(52, angleProfile.fov) : angleProfile.fov;
      const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, frameResponse(delta, positionResponse));
      if (Math.abs(camera.fov - nextFov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
