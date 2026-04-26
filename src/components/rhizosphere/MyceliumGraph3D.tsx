import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Morphology, MycoSnapshotMessage } from "../../../server/domain/mycoProtocol";
import { useAudioStore } from "../../store/audioStore";
import { createBackgroundFieldState, stepBackgroundFieldSmooth } from "../../rhizosphere/backgroundFieldSmooth";
import {
  buildSnapshotCache,
  easeSnapshotProgress,
  interpolateTipDirection,
  interpolateNodeGraphPositionInto,
  revealProgressForBirthOrder,
  type SnapshotRenderCache,
  type SnapshotTransition,
  SNAPSHOT_FPS,
  stableSnapshotKey,
  transitionDurationMs,
} from "../../rhizosphere/snapshotUtils";
import {
  buildEdgeLinePositions,
  colorForMorphology,
  hyphalMainLineWidth,
  nodeSphereRadius,
  toScenePoint3,
  travelPulsePointOnEdge,
  TRAVEL_PULSE_MIN,
  hyphalQuadraticControlGraph,
  particleCloudCount,
  writeParticleCloudPositions,
} from "../../rhizosphere/mycelium3dMath";
import { hidePooledLine } from "../../rhizosphere/linePoolUtils";
import {
  advanceKickImpact,
  type ReactiveVisualState,
  computeKickFftMaxNorm,
  computeEdgeReveal,
  computeTravelPulse,
  deriveReactiveVisualState,
  mergeKickPulseFromBassFft,
} from "../rhizosphereRendering";
import { Html } from "@react-three/drei";

const MAX_NODES = 2000;
const MAX_SPARKS = 800;
const MAX_LINE_POOL = 1200;
const MAX_TIP_POOL = 128;
const FRAME_BUDGET_MS = 20;
const BAD_FRAMES_FOR_LOW_QUALITY = 3;
const GOOD_FRAMES_FOR_HIGH_QUALITY = 60;
const DPR_LOW = 1.25;
const DPR_HIGH = 2;
const EDGE_SEGMENTS = 12;
const EDGE_POINT_COUNT = EDGE_SEGMENTS + 1;
const TIP_GRAPH_LENGTH = 0.024;
const CHARGE_HALO_THRESHOLD = 0.065;
const PROFILE_SAMPLE_LIMIT = 120;
const PROFILE_LOG_INTERVAL_MS = 3_000;

type Props = {
  snapshotRef: RefObject<MycoSnapshotMessage | null>;
  boundsOutRef: RefObject<{ center: THREE.Vector3; radius: number }>;
  timeMsOutRef: RefObject<number>;
  qualityOutRef: RefObject<"high" | "low">;
  dprSetCallback: (dpr: number) => void;
  reducedMotionRef: RefObject<boolean>;
  reactiveOutRef: RefObject<ReactiveVisualState>;
};

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const MYCELIUM_HIGHLIGHT_HEX = 0xbcd100;
const MYCELIUM_LINE_HEX = 0x35e8ff;
const MYCELIUM_EMISSIVE_HEX = 0x8d5cff;
const MYCELIUM_CHARGE_HALO_HEX = 0xff4fd8;
const MYCELIUM_KICK_GLOW_HEX = 0xf5ff6b;
const MYCELIUM_ANASTOMOSIS_HEX = 0xb36cff;
const MYCELIUM_SPARK_CORE_HEX = 0xfff3a3;
const MYCELIUM_SPORE_CLOUD_HEX = 0xc7ff5f;
const MYCELIUM_TIP_HIGH_ENERGY_HEX = 0xff6bd6;
const MYCELIUM_NODE_OPACITY = 0.98;
const BRANCH_ECM_ORANGE_HEX = 0xffb15f;
const BRANCH_AM_GREEN_HEX = 0xa4ff5f;
const BRANCH_BALANCED_WHITE_HEX = 0x9aa8a1;
const _white = new THREE.Color(MYCELIUM_HIGHLIGHT_HEX);
const _kickGlow = new THREE.Color(MYCELIUM_KICK_GLOW_HEX);
const _anastomosisGlow = new THREE.Color(MYCELIUM_ANASTOMOSIS_HEX);
const _w0 = new THREE.Vector3();
const _w1 = new THREE.Vector3();
const _boundsCenter = new THREE.Vector3();
const _boundsSize = new THREE.Vector3();
const TIP_LINE_POINTS = new Float32Array(6);
const _graphNode = { x: 0, y: 0, z: 0 };
const _graphSource = { x: 0, y: 0, z: 0 };
const _graphTarget = { x: 0, y: 0, z: 0 };
const _tipGraphPosition = { x: 0, y: 0, z: 0 };
const _tipEndGraphPosition = { x: 0, y: 0, z: 0 };

type FrameProfileSection = "reactive" | "snapshot" | "nodes" | "edges" | "tips" | "bounds" | "particles" | "dpr" | "total";

type FrameProfileStats = Record<FrameProfileSection, number[]>;

function createFrameProfileStats(): FrameProfileStats {
  return {
    reactive: [],
    snapshot: [],
    nodes: [],
    edges: [],
    tips: [],
    bounds: [],
    particles: [],
    dpr: [],
    total: [],
  };
}

function recordProfileSample(stats: FrameProfileStats, section: FrameProfileSection, durationMs: number): void {
  const samples = stats[section];
  samples.push(durationMs);
  if (samples.length > PROFILE_SAMPLE_LIMIT) {
    samples.shift();
  }
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function logProfileSamples(stats: FrameProfileStats): void {
  const rows = Object.entries(stats).map(([section, samples]) => ({
    section,
    p50: percentile(samples, 0.5).toFixed(2),
    p95: percentile(samples, 0.95).toFixed(2),
    max: (samples.length ? Math.max(...samples) : 0).toFixed(2),
  }));
  console.table(rows);
}

function branchColorForMorphology(morphology: Morphology, out: THREE.Color): THREE.Color {
  if (morphology === "ECM") return out.set(BRANCH_ECM_ORANGE_HEX);
  if (morphology === "AM") return out.set(BRANCH_AM_GREEN_HEX);
  return out.set(BRANCH_BALANCED_WHITE_HEX);
}

function branchOpacityScaleForMorphology(morphology: Morphology): number {
  return morphology === "Balanced" ? 0.58 : 0.82;
}

function branchOpacityCapForMorphology(morphology: Morphology): number {
  return morphology === "Balanced" ? 0.38 : 0.52;
}

function setWideLinePositions(line: Line2, positions: Float32Array, pointCount: number): void {
  const start = line.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute | undefined;
  const segmentBuffer = start?.data;
  const array = segmentBuffer?.array as Float32Array | undefined;
  if (!segmentBuffer || !array) {
    line.geometry.setPositions(positions);
    return;
  }

  let writeIndex = 0;
  for (let i = 0; i < pointCount - 1; i += 1) {
    const current = i * 3;
    const next = current + 3;
    array[writeIndex] = positions[current];
    array[writeIndex + 1] = positions[current + 1];
    array[writeIndex + 2] = positions[current + 2];
    array[writeIndex + 3] = positions[next];
    array[writeIndex + 4] = positions[next + 1];
    array[writeIndex + 5] = positions[next + 2];
    writeIndex += 6;
  }
  segmentBuffer.needsUpdate = true;
  line.geometry.instanceCount = pointCount - 1;
}

function writeScaleTranslationMatrix(mesh: THREE.InstancedMesh, index: number, position: THREE.Vector3, scale: number): void {
  const array = mesh.instanceMatrix.array;
  const offset = index * 16;
  array[offset] = scale;
  array[offset + 1] = 0;
  array[offset + 2] = 0;
  array[offset + 3] = 0;
  array[offset + 4] = 0;
  array[offset + 5] = scale;
  array[offset + 6] = 0;
  array[offset + 7] = 0;
  array[offset + 8] = 0;
  array[offset + 9] = 0;
  array[offset + 10] = scale;
  array[offset + 11] = 0;
  array[offset + 12] = position.x;
  array[offset + 13] = position.y;
  array[offset + 14] = position.z;
  array[offset + 15] = 1;
}

function createPooledLine(index: number, pointCount: number): Line2 {
  const line = new Line2(
    new LineGeometry(),
    new LineMaterial({
      color: MYCELIUM_LINE_HEX,
      linewidth: 0.025,
      worldUnits: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  line.frustumCulled = false;
  line.visible = false;
  line.userData = { i: index, hidden: true };
  line.geometry.setPositions(new Float32Array(pointCount * 3));
  return line;
}

function disposeLinePool(pool: Line2[]): void {
  for (const line of pool) {
    line.parent?.remove(line);
    line.geometry.dispose();
    if (line.material instanceof LineMaterial) {
      line.material.dispose();
    }
  }
  pool.length = 0;
}

function updateLinePoolResolution(pool: Line2[], width: number, height: number): void {
  for (const line of pool) {
    if (line.material instanceof LineMaterial) {
      line.material.resolution.set(width, height);
    }
  }
}

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

function pruneMapToKeys<T>(map: Map<string, T>, keepIds: Set<string>): void {
  for (const key of map.keys()) {
    if (!keepIds.has(key)) {
      map.delete(key);
    }
  }
}

function pruneRenderCaches(
  cache: SnapshotRenderCache,
  persistentNodeSeeds: Map<string, number>,
  persistentEdgeSeeds: Map<string, number>,
  edgeLinePositionPool: Map<string, Float32Array>
): void {
  pruneMapToKeys(
    persistentNodeSeeds,
    new Set(cache.snapshot.nodes.map((node) => node.id))
  );
  pruneMapToKeys(
    persistentEdgeSeeds,
    new Set(cache.snapshot.edges.map((edge) => edge.id))
  );
  pruneMapToKeys(
    edgeLinePositionPool,
    new Set(cache.renderEdges.map(({ edge }) => edge.id))
  );
}

/**
 * 3D mycelium: instanced node spheres, pooled line hyphae, travel spark instancing, and ambient.
 */
export function MyceliumGraph3D({
  snapshotRef,
  boundsOutRef,
  timeMsOutRef,
  qualityOutRef,
  dprSetCallback,
  reducedMotionRef,
  reactiveOutRef,
}: Props) {
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const instancedRef = useRef<THREE.InstancedMesh | null>(null);
  const chargeHaloRef = useRef<THREE.InstancedMesh | null>(null);
  const sparkRef = useRef<THREE.InstancedMesh | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const pointsGeomRef = useRef<THREE.BufferGeometry<THREE.NormalBufferAttributes> | null>(null);
  const lineGroupRef = useRef<THREE.Group | null>(null);
  const tipGroupRef = useRef<THREE.Group | null>(null);
  const linePoolRef = useRef<Line2[]>([]);
  const tipPoolRef = useRef<Line2[]>([]);
  const poolReady = useRef(false);
  const edgeLinePositionPoolRef = useRef(new Map<string, Float32Array>());

  const transitionRef = useRef<SnapshotTransition | null>(null);
  const snapshotCacheRef = useRef<SnapshotRenderCache | null>(null);
  const lastProcessedSnapshotKeyRef = useRef<string | null>(null);
  const persistentNodeSeedsRef = useRef(new Map<string, number>());
  const persistentEdgeSeedsRef = useRef(new Map<string, number>());

  const lastFrameTimeRef = useRef(0);
  const frameTimeSamplesRef = useRef<number[]>([]);
  const badFrameStreakRef = useRef(0);
  const goodFrameStreakRef = useRef(0);
  const dprStabilityRef = useRef(0);
  const effectiveDprCapRef = useRef(DPR_HIGH);
  const backgroundField = useRef(createBackgroundFieldState());
  /** Raw FFT in R3F frame: onset detection (store updates can lag a rAF). */
  const kickFftRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const prevBassMaxNormRef = useRef(0);
  const materialKickImpactRef = useRef(0);
  const profileStatsRef = useRef<FrameProfileStats>(createFrameProfileStats());
  const lastProfileLogAtRef = useRef(0);
  const lineResolutionRef = useRef({ width: 0, height: 0 });

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 14, 12), []);
  const chargeHaloGeometry = useMemo(() => new THREE.SphereGeometry(1, 18, 14), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: MYCELIUM_EMISSIVE_HEX,
        emissiveIntensity: 0.32,
        roughness: 0.64,
        metalness: 0,
        vertexColors: true,
        opacity: MYCELIUM_NODE_OPACITY,
        depthWrite: false,
      }),
    []
  );
  const chargeHaloMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: MYCELIUM_CHARGE_HALO_HEX,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
      }),
    []
  );
  const sparkGeometry = useMemo(() => new THREE.SphereGeometry(0.04, 8, 6), []);
  const sparkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: MYCELIUM_SPARK_CORE_HEX,
        emissive: MYCELIUM_CHARGE_HALO_HEX,
        emissiveIntensity: 0.3,
        roughness: 0.5,
        metalness: 0,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
    []
  );

  const getEdgePositionBuffer = (id: string) => {
    let positions = edgeLinePositionPoolRef.current.get(id);
    if (!positions) {
      positions = new Float32Array(EDGE_POINT_COUNT * 3);
      edgeLinePositionPoolRef.current.set(id, positions);
    }
    return positions;
  };

  useLayoutEffect(() => {
    const lineGroup = lineGroupRef.current;
    const tipGroup = tipGroupRef.current;
    if (!lineGroup || !tipGroup || poolReady.current) return;

    for (let i = 0; i < MAX_LINE_POOL; i += 1) {
      const line = createPooledLine(i, EDGE_POINT_COUNT);
      lineGroup.add(line);
      linePoolRef.current[i] = line;
    }
    for (let i = 0; i < MAX_TIP_POOL; i += 1) {
      const line = createPooledLine(i, 2);
      tipGroup.add(line);
      tipPoolRef.current[i] = line;
    }
    poolReady.current = true;

    return () => {
      disposeLinePool(linePoolRef.current);
      disposeLinePool(tipPoolRef.current);
      edgeLinePositionPoolRef.current.clear();
      poolReady.current = false;
      lineResolutionRef.current = { width: 0, height: 0 };
    };
  }, []);

  useFrame((state, delta) => {
    const frameStart = performance.now();
    let profileSectionStart = frameStart;
    const markProfile = (section: FrameProfileSection) => {
      if (!import.meta.env.DEV) return;
      const now = performance.now();
      recordProfileSample(profileStatsRef.current, section, now - profileSectionStart);
      profileSectionStart = now;
    };

    timeMsOutRef.current = state.clock.elapsedTime * 1000;
    const timeMs = timeMsOutRef.current;
    const tSec = timeMs;
    const reduced = reducedMotionRef.current;

    const s = useAudioStore.getState();
    const rawReactive = deriveReactiveVisualState({
      bands: s.bands,
      pulses: s.pulses,
      isActive: s.isPlaying || s.captureSource !== null,
    });

    let kickMerged = rawReactive.kickPulse;
    const an = s.analyserNode;
    const audioActive = s.isPlaying || s.captureSource !== null;
    if (an && audioActive) {
      const nBins = an.frequencyBinCount;
      if (!kickFftRef.current || kickFftRef.current.length !== nBins) {
        kickFftRef.current = new Uint8Array(new ArrayBuffer(nBins));
      }
      const d = kickFftRef.current;
      an.getByteFrequencyData(d);
      const norm = computeKickFftMaxNorm(d, s.audioContext?.sampleRate ?? 44_100);
      kickMerged = mergeKickPulseFromBassFft({
        rawKickPulse: rawReactive.kickPulse,
        bassMaxNorm: norm,
        previousBassMaxNorm: prevBassMaxNormRef.current,
      });
      prevBassMaxNormRef.current = norm;
    } else {
      prevBassMaxNormRef.current = 0;
    }

    const withKick: ReactiveVisualState = { ...rawReactive, kickPulse: kickMerged };
    const { forField, show: showField } = stepBackgroundFieldSmooth(backgroundField.current, withKick);
    const reactive = showField ? forField : withKick;
    reactiveOutRef.current = reactive;
    const materialImpact = advanceKickImpact({
      previousImpact: materialKickImpactRef.current,
      kickPulse: reactive.kickPulse,
      deltaSeconds: delta,
      reducedMotion: reduced,
    });
    materialKickImpactRef.current = materialImpact;
    material.emissiveIntensity = 0.42 + materialImpact * 1.35;
    sparkMaterial.emissiveIntensity = 0.7 + reactive.sparkIntensity * 0.9 + materialImpact * 2.4;
    sparkMaterial.opacity = Math.min(1, 0.82 + reactive.sparkIntensity * 0.1 + materialImpact * 0.18);

    const inst = instancedRef.current;
    const chargeHalo = chargeHaloRef.current;
    const spark = sparkRef.current;
    const pPoints = pointsRef.current;
    const pGeom = pointsGeomRef.current;
    if (state.scene.fog instanceof THREE.Fog) {
      const f = state.scene.fog;
      f.near = 6 + (1 - reactive.substrateBreath) * 2;
      f.far = 40 + reactive.bassEnergy * 6;
    } else if (state.scene.fog instanceof THREE.FogExp2) {
      const f = state.scene.fog;
      f.density = 0.018 + (1 - reactive.substrateBreath) * 0.004 - reactive.bassEnergy * 0.002;
    }
    markProfile("reactive");

    if (
      poolReady.current &&
      (lineResolutionRef.current.width !== state.size.width || lineResolutionRef.current.height !== state.size.height)
    ) {
      updateLinePoolResolution(linePoolRef.current, state.size.width, state.size.height);
      updateLinePoolResolution(tipPoolRef.current, state.size.width, state.size.height);
      lineResolutionRef.current = { width: state.size.width, height: state.size.height };
    }

    // Snapshot transition (read ref before draw)
    const snap = snapshotRef.current;
    if (snap) {
      const k = stableSnapshotKey(snap);
      if (k !== lastProcessedSnapshotKeyRef.current) {
        const previousCache = snapshotCacheRef.current;
        const nextCache = buildSnapshotCache(
          snap,
          persistentNodeSeedsRef.current,
          persistentEdgeSeedsRef.current,
          {
            maxNodes: MAX_NODES,
            maxEdges: MAX_LINE_POOL,
            maxTips: MAX_TIP_POOL,
            previousCache,
          }
        );
        pruneRenderCaches(
          nextCache,
          persistentNodeSeedsRef.current,
          persistentEdgeSeedsRef.current,
          edgeLinePositionPoolRef.current
        );
        const durationMs = transitionDurationMs(nextCache, previousCache, SNAPSHOT_FPS);
        snapshotCacheRef.current = nextCache;
        lastProcessedSnapshotKeyRef.current = k;
        transitionRef.current = {
          from: previousCache,
          to: nextCache,
          birthOrderStagger: nextCache.birthOrderStagger,
          startTime: performance.now(),
          durationMs,
        };
        if (!hasSnapshot) {
          setHasSnapshot(true);
        }
      }
    } else {
      lastProcessedSnapshotKeyRef.current = null;
      snapshotCacheRef.current = null;
      transitionRef.current = null;
      if (hasSnapshot) {
        setHasSnapshot(false);
      }
    }
    markProfile("snapshot");

    const tr = transitionRef.current;
    const settledCache = snapshotCacheRef.current;

    if (inst) {
      _box.makeEmpty();
      let sparkN = 0;

      if (tr || settledCache) {
        const fromCache = tr?.from ?? null;
        const toCache = tr?.to ?? settledCache;
        if (!toCache) {
          boundsOutRef.current.center.set(0, 0, 0);
          boundsOutRef.current.radius = 1;
        } else {
          const progress = tr
            ? tr.durationMs <= 0
              ? 1
              : Math.min(1, (performance.now() - tr.startTime) / tr.durationMs)
            : 1;
          if (tr && progress >= 1) {
            transitionRef.current = null;
          }
          const p = tr && progress < 1 ? progress : 1;
          const cache = toCache;
          const { snapshot, nodeSeeds, renderedNodes, renderEdges, renderTips } = cache;
          const voltage = Math.min(1, snapshot.telemetry.bioVoltageMv / 2.1);
          const anastomosisRate = snapshot.telemetry.anastomosisRate;
          const nNodes = renderedNodes.length;
          let chargeHaloN = 0;

          for (let i = 0; i < nNodes; i += 1) {
            const node = renderedNodes[i];
            const graphPosition = interpolateNodeGraphPositionInto(
              node,
              cache,
              p < 1 && fromCache ? fromCache : null,
              p,
              _graphNode
            );
            toScenePoint3(graphPosition, node, nodeSeeds.get(node.id) ?? 0, tSec, reduced, _p);
            const reveal =
              tr && fromCache && p < 1 && !fromCache.nodesById.has(node.id)
                ? revealProgressForBirthOrder(node.birthOrder, p, tr.birthOrderStagger)
                : 1;
            const r = nodeSphereRadius(node, reveal, tSec, nodeSeeds.get(node.id) ?? 0, reduced);
            writeScaleTranslationMatrix(inst, i, _p, r);
            _c.copy(colorForMorphology(node.morphology));
            _c.lerp(_white, 0.16 + node.charge * 0.1);
            _c.lerp(_kickGlow, materialImpact * 0.12);
            _c.multiplyScalar(0.88 + reveal * 0.22 + node.charge * 0.14 + materialImpact * 0.34);
            inst.setColorAt(i, _c);
            if (chargeHalo && reveal > 0 && node.charge > CHARGE_HALO_THRESHOLD && chargeHaloN < MAX_NODES) {
              const haloScale = r * (2.35 + node.charge * 4.2 + voltage * 1.2);
              writeScaleTranslationMatrix(chargeHalo, chargeHaloN, _p, haloScale);
              _c.set(MYCELIUM_CHARGE_HALO_HEX);
              _c.lerp(_white, Math.min(0.45, node.charge * 0.35));
              _c.multiplyScalar(0.7 + node.charge * 1.4 + voltage * 0.5);
              chargeHalo.setColorAt(chargeHaloN, _c);
              chargeHaloN += 1;
            }
            _box.expandByPoint(_p);
          }
          inst.count = nNodes;
          if (inst.instanceColor) {
            inst.instanceColor.needsUpdate = true;
          }
          inst.instanceMatrix.needsUpdate = true;
          if (chargeHalo) {
            chargeHalo.count = chargeHaloN;
            if (chargeHalo.instanceColor) {
              chargeHalo.instanceColor.needsUpdate = true;
            }
            chargeHalo.instanceMatrix.needsUpdate = true;
          }
          markProfile("nodes");

          for (let eix = 0; eix < renderEdges.length; eix += 1) {
            const { edge, source: srcN, target: tgtN, edgeSeed: seedE, sourceSeed, targetSeed } = renderEdges[eix];
            const L = linePoolRef.current[eix];
            if (!L) {
              hidePooledLine(L);
              continue;
            }
            L.visible = true;
            L.userData.hidden = false;
            const graphSource = interpolateNodeGraphPositionInto(
              srcN,
              cache,
              p < 1 && fromCache ? fromCache : null,
              p,
              _graphSource
            );
            const graphTarget = interpolateNodeGraphPositionInto(
              tgtN,
              cache,
              p < 1 && fromCache ? fromCache : null,
              p,
              _graphTarget
            );
            const { controlX, controlY, controlZ } = hyphalQuadraticControlGraph(graphSource, graphTarget, seedE, tSec, reduced);
            const isNewEdge = fromCache ? !fromCache.edgeSeeds.has(edge.id) : false;
            const revealE = tr && isNewEdge ? revealProgressForBirthOrder(edge.birthOrder, p, tr.birthOrderStagger) : 1;
            const travel = computeTravelPulse({
              conductivity: edge.conductivity,
              edgeSeed: seedE,
              reducedMotion: reduced,
              timeMs: tSec,
              voltageIntensity: voltage,
            });
            if (spark && travel > TRAVEL_PULSE_MIN && computeEdgeReveal(edge.age, revealE) > 0.35 && sparkN < MAX_SPARKS) {
              const head = reduced ? 0.62 : (tSec * 0.0014 + seedE) % 1;
              travelPulsePointOnEdge(
                head,
                graphSource,
                graphTarget,
                controlX,
                controlY,
                controlZ,
                tgtN,
                srcN,
                seedE,
                tSec,
                reduced,
                _v,
                nodeSeeds.get(srcN.id) ?? seedE,
                nodeSeeds.get(tgtN.id) ?? seedE
              );
              const sc = 0.5 + travel * 0.85;
              writeScaleTranslationMatrix(spark, sparkN, _v, sc * 0.12);
              sparkN += 1;
            }
            const positions = getEdgePositionBuffer(edge.id);
            buildEdgeLinePositions(
              srcN,
              tgtN,
              graphSource,
              graphTarget,
              tSec,
              reduced,
              positions,
              sourceSeed,
              targetSeed,
              { controlX, controlY, controlZ },
              EDGE_SEGMENTS
            );
            setWideLinePositions(L, positions, EDGE_POINT_COUNT);
            const m = L.material;
            if (m instanceof LineMaterial) {
              const re = computeEdgeReveal(edge.age, revealE);
              const fusedBoost = edge.fused ? 0.35 + anastomosisRate * 0.55 : anastomosisRate > 0.55 ? 0.08 : 0;
              const branchMorphology = tgtN.morphology === "Balanced" ? srcN.morphology : tgtN.morphology;
              m.opacity = Math.min(
                branchOpacityCapForMorphology(branchMorphology),
                (0.045 + edge.conductivity * 0.14 + fusedBoost * 0.24 + materialImpact * 0.34) *
                  re *
                  branchOpacityScaleForMorphology(branchMorphology)
              );
              m.linewidth =
                hyphalMainLineWidth(edge, srcN, tgtN, revealE) * (1 + fusedBoost * 1.45 + materialImpact * 0.55);
              branchColorForMorphology(branchMorphology, _c);
              if (edge.fused) {
                _c.lerp(_anastomosisGlow, 0.58);
              }
              _c.lerp(_kickGlow, materialImpact * 0.16);
              _c.multiplyScalar(0.48 + fusedBoost * 0.32 + materialImpact * 0.58);
              m.color.copy(_c);
            }
          }
          for (let h = renderEdges.length; h < MAX_LINE_POOL; h += 1) {
            const line = linePoolRef.current[h];
            hidePooledLine(line);
          }
          markProfile("edges");

          for (let tix = 0; tix < renderTips.length; tix += 1) {
            const { tip, node: tnode, nodeSeed: seedN } = renderTips[tix];
            const TL = tipPoolRef.current[tix];
            if (!TL) {
              hidePooledLine(TL);
              continue;
            }
            const previousTip = fromCache && p < 1 ? fromCache.tipsById.get(tip.id) : null;
            const eProg = easeSnapshotProgress(p);
            const show = previousTip ? 1 : p < 1 ? eProg : 1;
            const direction = previousTip ? interpolateTipDirection(previousTip, tip, p) : tip;
            const energy = previousTip
              ? previousTip.energy + (tip.energy - previousTip.energy) * eProg
              : tip.energy;
            const graphPosition = interpolateNodeGraphPositionInto(
              tnode,
              cache,
              p < 1 && fromCache ? fromCache : null,
              p,
              _tipGraphPosition
            );
            toScenePoint3(graphPosition, tnode, seedN, tSec, reduced, _w0);
            const Lg = TIP_GRAPH_LENGTH * (0.35 + show * 0.65) * (0.7 + energy * 0.5);
            _tipEndGraphPosition.x = graphPosition.x + direction.dx * Lg;
            _tipEndGraphPosition.y = graphPosition.y + direction.dy * Lg;
            _tipEndGraphPosition.z = graphPosition.z + direction.dz * Lg;
            toScenePoint3(_tipEndGraphPosition, tnode, seedN, tSec, reduced, _w1);
            TL.visible = true;
            TL.userData.hidden = false;
            TIP_LINE_POINTS[0] = _w0.x;
            TIP_LINE_POINTS[1] = _w0.y;
            TIP_LINE_POINTS[2] = _w0.z;
            TIP_LINE_POINTS[3] = _w1.x;
            TIP_LINE_POINTS[4] = _w1.y;
            TIP_LINE_POINTS[5] = _w1.z;
            setWideLinePositions(TL, TIP_LINE_POINTS, 2);
            const tm = TL.material;
            if (tm instanceof LineMaterial) {
              tm.opacity = Math.min(0.78, (0.16 + energy * 0.22 + materialImpact * 0.58) * show);
              tm.linewidth = (0.032 + energy * 0.045) * (1 + materialImpact * 0.9);
              tm.color.set(
                materialImpact > 0.35
                  ? MYCELIUM_KICK_GLOW_HEX
                  : energy > 0.72
                    ? MYCELIUM_TIP_HIGH_ENERGY_HEX
                    : MYCELIUM_LINE_HEX
              );
            }
          }
          for (let h = renderTips.length; h < MAX_TIP_POOL; h += 1) {
            const tline = tipPoolRef.current[h];
            hidePooledLine(tline);
          }
          markProfile("tips");

          if (!_box.isEmpty()) {
            _box.getCenter(_boundsCenter);
            _box.getSize(_boundsSize);
            boundsOutRef.current.center.copy(_boundsCenter);
            boundsOutRef.current.radius = Math.max(0.45, Math.max(_boundsSize.x, _boundsSize.y, _boundsSize.z) * 0.55);
          } else {
            boundsOutRef.current.center.set(0, 0, 0);
            boundsOutRef.current.radius = 1.0;
          }
          markProfile("bounds");

          if (pPoints && pGeom) {
            const n = particleCloudCount();
            const attr = pGeom.getAttribute("position");
            if (!attr || attr.count < n) {
              pGeom.setAttribute(
                "position",
                new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage)
              );
            }
            const pos = pGeom.getAttribute("position") as THREE.BufferAttribute;
            writeParticleCloudPositions(pos.array as Float32Array, n, tSec, reduced);
            pos.needsUpdate = true;
            pGeom.setDrawRange(0, n);
            (pPoints.material as THREE.PointsMaterial).opacity = 0.34;
          } else if (pGeom) {
            pGeom.setDrawRange(0, 0);
          }

          if (spark) {
            spark.count = sparkN;
            spark.instanceMatrix.needsUpdate = true;
          }
          markProfile("particles");
        }
      } else {
        if (pGeom) {
          pGeom.setDrawRange(0, 0);
        }
        if (inst) {
          inst.count = 0;
          if (inst.instanceColor) {
            inst.instanceColor.needsUpdate = true;
          }
          inst.instanceMatrix.needsUpdate = true;
        }
        if (spark) {
          spark.count = 0;
          spark.instanceMatrix.needsUpdate = true;
        }
        if (chargeHalo) {
          chargeHalo.count = 0;
          chargeHalo.instanceMatrix.needsUpdate = true;
        }
        for (let h = 0; h < MAX_LINE_POOL; h += 1) {
          const L = linePoolRef.current[h];
          hidePooledLine(L);
        }
        for (let h = 0; h < MAX_TIP_POOL; h += 1) {
          const T = tipPoolRef.current[h];
          hidePooledLine(T);
        }
        boundsOutRef.current.center.set(0, 0, 0);
        boundsOutRef.current.radius = 1.0;
      }
    } else {
      boundsOutRef.current.center.set(0, 0, 0);
      boundsOutRef.current.radius = 1.0;
      if (chargeHalo) {
        chargeHalo.count = 0;
        chargeHalo.instanceMatrix.needsUpdate = true;
      }
    }

    const cost = performance.now() - frameStart;
    if (lastFrameTimeRef.current > 0) {
      const ring = frameTimeSamplesRef.current;
      ring.push(cost);
      if (ring.length > 5) {
        ring.shift();
      }
      const avg = ring.reduce((a, b) => a + b, 0) / ring.length;
      if (avg > FRAME_BUDGET_MS) {
        badFrameStreakRef.current += 1;
        goodFrameStreakRef.current = 0;
      } else {
        badFrameStreakRef.current = 0;
        goodFrameStreakRef.current = avg < 12 ? goodFrameStreakRef.current + 1 : 0;
      }
      if (badFrameStreakRef.current >= BAD_FRAMES_FOR_LOW_QUALITY && qualityOutRef.current === "high") {
        qualityOutRef.current = "low";
        effectiveDprCapRef.current = DPR_LOW;
        dprSetCallback(DPR_LOW);
        dprStabilityRef.current = 0;
      } else if (goodFrameStreakRef.current >= GOOD_FRAMES_FOR_HIGH_QUALITY && qualityOutRef.current === "low") {
        qualityOutRef.current = "high";
        effectiveDprCapRef.current = DPR_HIGH;
        dprSetCallback(DPR_HIGH);
        dprStabilityRef.current = 0;
      }
    }
    markProfile("dpr");
    if (import.meta.env.DEV) {
      const now = performance.now();
      recordProfileSample(profileStatsRef.current, "total", now - frameStart);
      if (now - lastProfileLogAtRef.current >= PROFILE_LOG_INTERVAL_MS) {
        lastProfileLogAtRef.current = now;
        logProfileSamples(profileStatsRef.current);
      }
    }
    lastFrameTimeRef.current = timeMs;
  }, -1);

  return (
    <group>
      <instancedMesh ref={instancedRef} args={[geometry, material, MAX_NODES]} frustumCulled={false} />
      <instancedMesh ref={chargeHaloRef} args={[chargeHaloGeometry, chargeHaloMaterial, MAX_NODES]} frustumCulled={false} />
      <instancedMesh ref={sparkRef} args={[sparkGeometry, sparkMaterial, MAX_SPARKS]} frustumCulled={false} />
      <group ref={lineGroupRef} />
      <group ref={tipGroupRef} />
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry
          ref={(g) => {
            if (g) {
              pointsGeomRef.current = g as THREE.BufferGeometry<THREE.NormalBufferAttributes>;
              if (!g.getAttribute("position")) {
                g.setAttribute(
                  "position",
                  new THREE.BufferAttribute(new Float32Array(200 * 3), 3).setUsage(THREE.DynamicDrawUsage)
                );
              }
            }
          }}
        />
        <pointsMaterial
          attach="material"
          size={0.09}
          color={MYCELIUM_SPORE_CLOUD_HEX}
          transparent
          opacity={0.2}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      {!hasSnapshot && (
        <group position={[0, 0.08, 0]} scale={1.2}>
          <mesh position={[0, 0.02, 0]}>
            <sphereGeometry args={[0.1, 18, 14]} />
            <meshBasicMaterial color="#c7ff5f" />
          </mesh>
          <mesh position={[0.42, 0.03, -0.08]}>
            <sphereGeometry args={[0.065, 16, 12]} />
            <meshBasicMaterial color="#35e8ff" />
          </mesh>
          <mesh position={[-0.36, -0.01, 0.16]}>
            <sphereGeometry args={[0.075, 16, 12]} />
            <meshBasicMaterial color="#ff6bd6" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.42, 0.012, 8, 80]} />
            <meshBasicMaterial color="#b36cff" transparent opacity={0.85} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0.55]}>
            <torusGeometry args={[0.72, 0.006, 8, 96]} />
            <meshBasicMaterial color="#ff4fd8" transparent opacity={0.65} />
          </mesh>
        </group>
      )}
      {!hasSnapshot && (
        <Html position={[0, 0.2, 0]} center>
          <div
            style={{
              color: "rgba(248,250,252,0.9)",
              fontSize: 14,
              fontFamily: "system-ui, sans-serif",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            Awaiting mycelial telemetry…
          </div>
        </Html>
      )}
    </group>
  );
}

