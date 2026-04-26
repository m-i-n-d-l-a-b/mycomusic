import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { MycoSnapshotMessage } from "../../server/domain/mycoProtocol";
import { advanceKickImpact, type ReactiveVisualState } from "./rhizosphereRendering";
import { MyceliumGraph3D } from "./rhizosphere/MyceliumGraph3D";
import { CameraRigMyco, type BoundsFrame } from "./rhizosphere/CameraRigMyco";
import { KickPulsingLights } from "./rhizosphere/KickPulsingLights.tsx";

const RADIAL_VOLUME_RADIUS = 62;

const RADIAL_VOLUME_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  varying vec3 vLocalDirection;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vLocalDirection = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const RADIAL_VOLUME_FRAGMENT_SHADER = `
  uniform float uSubstrate;
  uniform float uBass;
  uniform float uKick;
  uniform vec3 uCorePosition;

  varying vec3 vWorldPosition;
  varying vec3 vLocalDirection;

  void main() {
    vec3 ray = normalize(vWorldPosition - cameraPosition);
    vec3 coreVector = uCorePosition - cameraPosition;
    vec3 toCore = length(coreVector) > 0.001 ? normalize(coreVector) : vec3(0.0, 0.0, -1.0);
    float focus = pow(max(dot(ray, toCore), 0.0), 1.9);
    float coreGlow = smoothstep(0.0, 0.95, focus);
    float shellDistance = distance(cameraPosition, vWorldPosition);
    float distanceDark = smoothstep(52.0, 112.0, shellDistance);
    float upperAir = smoothstep(-0.45, 0.92, vLocalDirection.y);

    vec3 dark = vec3(0.002, 0.006, 0.005);
    vec3 fungalViolet = vec3(0.080, 0.008, 0.180);
    vec3 mycoGreen = vec3(0.000, 0.060, 0.040);
    vec3 kickBloom = vec3(0.180, 0.080, 0.210);

    vec3 color = dark;
    color = mix(color, mycoGreen, coreGlow * (0.18 + uSubstrate * 0.28));
    color = mix(color, fungalViolet, coreGlow * (0.34 + uSubstrate * 0.32));
    color += mycoGreen * upperAir * (0.05 + uBass * 0.08);
    color += kickBloom * coreGlow * uKick * 0.38;
    color = mix(color, dark, distanceDark);

    gl_FragColor = vec4(color, 1.0);
  }
`;

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
  const volumeMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const boundsRef = useRef<BoundsFrame>({
    center: new THREE.Vector3(0, 0, 0),
    radius: 1,
  });
  const timeMsRef = useRef(0);
  const reactiveRef = useRef<ReactiveVisualState>(makeSilentReactive());
  const reducedMotionRef = useRef(false);
  const qualityOutRef = useRef<"high" | "low">("high");
  const volumeKickImpactRef = useRef(0);
  const volumeUniforms = useMemo(
    () => ({
      uSubstrate: { value: 0 },
      uBass: { value: 0 },
      uKick: { value: 0 },
      uCorePosition: { value: new THREE.Vector3(0, 0, 0) },
    }),
    []
  );

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
    const material = volumeMaterialRef.current;
    if (!material) return;
    const r = reactiveRef.current;
    const impact = advanceKickImpact({
      previousImpact: volumeKickImpactRef.current,
      kickPulse: r.kickPulse,
      deltaSeconds: delta,
      reducedMotion: reducedMotionRef.current,
    });
    volumeKickImpactRef.current = impact;
    material.uniforms.uSubstrate.value = r.substrateBreath;
    material.uniforms.uBass.value = r.bassEnergy;
    material.uniforms.uKick.value = impact;
    material.uniforms.uCorePosition.value.copy(boundsRef.current.center);
  });

  return (
    <>
      <color attach="background" args={["#020605"]} />
      <fogExp2 attach="fog" args={["#020605", 0.018]} />
      <mesh frustumCulled={false} renderOrder={-1000}>
        <sphereGeometry args={[RADIAL_VOLUME_RADIUS, 96, 64]} />
        <shaderMaterial
          ref={volumeMaterialRef}
          uniforms={volumeUniforms}
          vertexShader={RADIAL_VOLUME_VERTEX_SHADER}
          fragmentShader={RADIAL_VOLUME_FRAGMENT_SHADER}
          side={THREE.BackSide}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
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
