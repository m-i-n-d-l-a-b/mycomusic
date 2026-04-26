import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useCallback, type MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import type { MycoSnapshotMessage } from "../../server/domain/mycoProtocol";
import { advanceKickImpact, type ReactiveVisualState } from "./rhizosphereRendering";
import { MyceliumGraph3D } from "./rhizosphere/MyceliumGraph3D";
import { CameraRigMyco, type BoundsFrame } from "./rhizosphere/CameraRigMyco";
import { KickPulsingLights } from "./rhizosphere/KickPulsingLights.tsx";

function makeSilentReactive(): ReactiveVisualState {
  return {
    overallEnergy: 0,
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    pulse: 0,
    kickPulse: 0,
    substrateBreath: 0,
    sparkIntensity: 0,
    isSilent: true,
  };
}

type Props = {
  snapshotRef: RefObject<MycoSnapshotMessage | null>;
  dprSetCallback: (dpr: number) => void;
};

/**
 * 3D scene: lighting, fog, Myco graph, and automated orbit camera. Render as child of R3F `<Canvas>`.
 */
export function RhizosphereScene3D({ snapshotRef, dprSetCallback }: Props) {
  const groundMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const boundsRef = useRef<BoundsFrame>({
    center: new THREE.Vector3(0, 0, 0),
    radius: 1,
  });
  const timeMsRef = useRef(0);
  const reactiveRef = useRef<ReactiveVisualState>(makeSilentReactive());
  const reducedMotionRef = useRef(false);
  const qualityOutRef = useRef<"high" | "low">("high");
  const groundKickImpactRef = useRef(0);

  const dprSet = useCallback(
    (d: number) => {
      dprSetCallback(d);
    },
    [dprSetCallback]
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const h = () => {
      reducedMotionRef.current = mq.matches;
    };
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  useFrame((_, delta) => {
    const material = groundMaterialRef.current;
    if (!material) return;
    const r = reactiveRef.current;
    const impact = advanceKickImpact({
      previousImpact: groundKickImpactRef.current,
      kickPulse: r.kickPulse,
      deltaSeconds: delta,
      reducedMotion: reducedMotionRef.current,
    });
    groundKickImpactRef.current = impact;
    material.emissiveIntensity = 0.18 + impact * 1.55;
    material.opacity = Math.min(0.82, 0.56 + impact * 0.18);
  });

  return (
    <>
      <color attach="background" args={["#020605"]} />
      <fog attach="fog" args={["#020605", 9, 60]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]}>
        <circleGeometry args={[18, 96]} />
        <meshStandardMaterial
          ref={groundMaterialRef}
          color="#1C0042"
          emissive="#240022"
          emissiveIntensity={0.18}
          roughness={0.7}
          metalness={0}
          transparent
          opacity={0.58}
          depthWrite={false}
        />
      </mesh>
      <MyceliumGraph3D
        snapshotRef={snapshotRef}
        boundsOutRef={boundsRef}
        timeMsOutRef={timeMsRef}
        qualityOutRef={qualityOutRef}
        dprSetCallback={dprSet}
        reducedMotionRef={reducedMotionRef}
        reactiveOutRef={reactiveRef}
      />
      <KickPulsingLights
        reactiveRef={reactiveRef}
        reducedMotionRef={reducedMotionRef}
        timeMsRef={timeMsRef}
        boundsRef={boundsRef}
      />
      <CameraRigMyco
        boundsRef={boundsRef}
        reactiveRef={reactiveRef}
        reducedMotionRef={reducedMotionRef}
        timeMsRef={timeMsRef}
      />
    </>
  );
}
