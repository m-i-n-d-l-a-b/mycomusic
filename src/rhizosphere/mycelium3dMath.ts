import * as THREE from "three";
import type { MycoEdge, MycoNode, Morphology } from "../../server/domain/mycoProtocol";
import { computeEdgeReveal } from "../components/rhizosphereRendering";

/** Expands the tiny simulation coordinates into readable world-space separation. */
export const WORLD_GRAPH_SCALE = 15;

export const TRAVEL_PULSE_MIN = 0.025;
export const CHARGE_DYNAMIC_THRESHOLD = 0.04;
export const PARTICLE_CLOUD_COUNT = 96;
export const PARTICLE_CLOUD_RADIUS = 13.5;
export const PARTICLE_CLOUD_VERTICAL_RADIUS = 5.2;

const tmpV = new THREE.Vector3();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Expands simulation coordinates into world space while preserving true 3D topology.
 * The simulation owns x/y/z; rendering only adds small organic lift/wobble.
 */
export function toScenePoint3(
  point: { x: number; y: number; z: number },
  node: Pick<MycoNode, "radius" | "charge" | "morphology">,
  seed: number,
  timeMs: number,
  reducedMotion: boolean,
  out: THREE.Vector3 = tmpV
): THREE.Vector3 {
  const wobble = reducedMotion
    ? 0
    : Math.sin(timeMs * 0.0011 + seed * 11.2) * 0.06 + Math.cos(timeMs * 0.0009 + seed * 6.1) * 0.04;
  const morphLift =
    node.morphology === "ECM" ? -0.12 : node.morphology === "AM" ? 0.16 : 0;
  const y =
    point.y * WORLD_GRAPH_SCALE * 0.82 +
    morphLift +
    node.charge * 0.22 +
    (seed - 0.5) * 0.18 +
    wobble;
  return out.set(point.x * WORLD_GRAPH_SCALE, y, point.z * WORLD_GRAPH_SCALE);
}

export function hyphalQuadraticControlGraph(
  sourcePoint: { x: number; y: number; z: number },
  targetPoint: { x: number; y: number; z: number },
  seed: number,
  time: number,
  reducedMotion: boolean
): { controlX: number; controlY: number; controlZ: number } {
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const dz = targetPoint.z - sourcePoint.z;
  const distance = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const uz = dz / distance;
  const refX = Math.abs(uy) < 0.8 ? 0 : 1;
  const refY = Math.abs(uy) < 0.8 ? 1 : 0;
  const refZ = 0;
  let n1x = uy * refZ - uz * refY;
  let n1y = uz * refX - ux * refZ;
  let n1z = ux * refY - uy * refX;
  const n1Length = Math.hypot(n1x, n1y, n1z) || 1;
  n1x /= n1Length;
  n1y /= n1Length;
  n1z /= n1Length;
  const n2x = uy * n1z - uz * n1y;
  const n2y = uz * n1x - ux * n1z;
  const n2z = ux * n1y - uy * n1x;
  const sway = reducedMotion ? 0 : Math.sin(time * 0.0012 + seed * 12) * 0.5 + 0.5;
  const cap = 0.85;
  const curvature = (0.08 + seed * 0.18 + sway * 0.12) * Math.min(distance, cap);
  const spin = seed * Math.PI * 2;
  const ox = (n1x * Math.cos(spin) + n2x * Math.sin(spin)) * curvature;
  const oy = (n1y * Math.cos(spin) + n2y * Math.sin(spin)) * curvature;
  const oz = (n1z * Math.cos(spin) + n2z * Math.sin(spin)) * curvature;
  return {
    controlX: sourcePoint.x + dx * 0.52 + ox,
    controlY: sourcePoint.y + dy * 0.52 + oy,
    controlZ: sourcePoint.z + dz * 0.52 + oz,
  };
}

function quadraticPoint(
  t: number,
  a: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const one = 1 - t;
  return {
    x: one * one * a.x + 2 * one * t * c.x + t * t * b.x,
    y: one * one * a.y + 2 * one * t * c.y + t * t * b.y,
    z: one * one * a.z + 2 * one * t * c.z + t * t * b.z,
  };
}

const SEGMENTS = 12;

const tmpForEdge = new THREE.Vector3();
const tmpLineNode: Pick<MycoNode, "radius" | "charge" | "morphology"> = {
  radius: 0,
  charge: 0,
  morphology: "Balanced",
};
const tmpLinePoint = { x: 0, y: 0, z: 0 };

export interface HyphalControlGraph {
  controlX: number;
  controlY: number;
  controlZ: number;
}

/**
 * Fills `out` (length at least 13) with world positions along a hyphal Bezier, using morphology from target.
 */
export function buildEdgeLinePoints(
  sourceNode: MycoNode,
  targetNode: MycoNode,
  graphSource: { x: number; y: number; z: number },
  graphTarget: { x: number; y: number; z: number },
  seed: number,
  timeMs: number,
  reducedMotion: boolean,
  out: THREE.Vector3[],
  sourceSeed = seed,
  targetSeed = seed,
  control: HyphalControlGraph = hyphalQuadraticControlGraph(graphSource, graphTarget, seed, timeMs, reducedMotion)
): void {
  const { controlX, controlY, controlZ } = control;
  const ctrl = { x: controlX, y: controlY, z: controlZ };
  const n = Math.min(out.length, SEGMENTS + 1) - 1;
  for (let i = 0; i <= n; i += 1) {
    const t = n <= 0 ? 1 : i / n;
    const p2 = quadraticPoint(t, graphSource, ctrl, graphTarget);
    const morph: Morphology = t < 0.5 ? sourceNode.morphology : targetNode.morphology;
    const blended: MycoNode = {
      ...targetNode,
      x: p2.x,
      y: p2.y,
      z: p2.z,
      radius: sourceNode.radius + (targetNode.radius - sourceNode.radius) * t,
      charge: sourceNode.charge + (targetNode.charge - sourceNode.charge) * t,
      morphology: morph,
    };
    const nodeSeed = sourceSeed + (targetSeed - sourceSeed) * t;
    out[i].copy(toScenePoint3(p2, blended, nodeSeed, timeMs, reducedMotion, tmpForEdge));
  }
}

export function buildEdgeLinePositions(
  sourceNode: MycoNode,
  targetNode: MycoNode,
  graphSource: { x: number; y: number; z: number },
  graphTarget: { x: number; y: number; z: number },
  timeMs: number,
  reducedMotion: boolean,
  out: Float32Array,
  sourceSeed: number,
  targetSeed: number,
  control: HyphalControlGraph,
  segments = SEGMENTS
): void {
  for (let i = 0; i <= segments; i += 1) {
    const t = segments <= 0 ? 1 : i / segments;
    const one = 1 - t;
    tmpLinePoint.x =
      one * one * graphSource.x + 2 * one * t * control.controlX + t * t * graphTarget.x;
    tmpLinePoint.y =
      one * one * graphSource.y + 2 * one * t * control.controlY + t * t * graphTarget.y;
    tmpLinePoint.z =
      one * one * graphSource.z + 2 * one * t * control.controlZ + t * t * graphTarget.z;
    tmpLineNode.radius = sourceNode.radius + (targetNode.radius - sourceNode.radius) * t;
    tmpLineNode.charge = sourceNode.charge + (targetNode.charge - sourceNode.charge) * t;
    tmpLineNode.morphology = t < 0.5 ? sourceNode.morphology : targetNode.morphology;
    const nodeSeed = sourceSeed + (targetSeed - sourceSeed) * t;
    toScenePoint3(tmpLinePoint, tmpLineNode, nodeSeed, timeMs, reducedMotion, tmpForEdge);

    const offset = i * 3;
    out[offset] = tmpForEdge.x;
    out[offset + 1] = tmpForEdge.y;
    out[offset + 2] = tmpForEdge.z;
  }
}

export function hyphalMainLineWidth(
  edge: MycoEdge,
  source: MycoNode,
  target: MycoNode,
  revealProgress: number
): number {
  const morphology: Morphology = target.morphology === "Balanced" ? source.morphology : target.morphology;
  const reveal = computeEdgeReveal(edge.age, revealProgress);
  const morphologyScale = morphology === "ECM" ? 1.45 : morphology === "AM" ? 0.72 : 1;
  const thickness = 0.018 + edge.thickness * 0.085 * morphologyScale;
  return thickness * (0.28 + reveal * 0.72);
}

export function nodeSphereRadius(node: MycoNode, reveal: number, time: number, seed: number, reducedMotion: boolean): number {
  const pulse = reducedMotion ? 0.5 : Math.sin(time * 0.004 + seed * 10) * 0.5 + 0.5;
  const morphologyScale = node.morphology === "ECM" ? 1.25 : node.morphology === "AM" ? 0.72 : 1;
  const base = 0.035 + node.radius * 1.85 * morphologyScale;
  return base * (0.45 + reveal * 0.55) * (0.82 + node.charge * 0.42 + pulse * 0.08);
}

const ECM_COLOR = new THREE.Color(0xebac6c);
const AM_COLOR = new THREE.Color(0x69ecff);
const BALANCED_COLOR = new THREE.Color(0xb2ffda);

export function colorForMorphology(morphology: Morphology): THREE.Color {
  if (morphology === "ECM") return ECM_COLOR;
  if (morphology === "AM") return AM_COLOR;
  return BALANCED_COLOR;
}

export function particleCloudCount(): number {
  return PARTICLE_CLOUD_COUNT;
}

export function writeParticleCloudPositions(
  out: Float32Array,
  count: number,
  timeMs: number,
  reducedMotion: boolean
): void {
  const drift = reducedMotion ? 0 : timeMs * 0.00009;

  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    const yNorm = count <= 1 ? 0 : 1 - (2 * (i + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
    const phase = i * GOLDEN_ANGLE + drift * ((i % 3) - 1);
    const shell = 0.72 + (((i * 37) % 100) / 100) * 0.28;
    const breath = reducedMotion ? 1 : 1 + Math.sin(timeMs * 0.00042 + i * 0.61) * 0.035;
    const spread = PARTICLE_CLOUD_RADIUS * shell * breath;

    out[offset] = Math.cos(phase) * radial * spread;
    out[offset + 1] = 2.2 + yNorm * PARTICLE_CLOUD_VERTICAL_RADIUS + Math.sin(phase * 1.7) * 0.42;
    out[offset + 2] = Math.sin(phase) * radial * spread;
  }
}

export function travelPulsePointOnEdge(
  tAlong: number,
  graphSource: { x: number; y: number; z: number },
  graphTarget: { x: number; y: number; z: number },
  controlX: number,
  controlY: number,
  controlZ: number,
  targetNode: MycoNode,
  sourceNode: MycoNode,
  seed: number,
  timeMs: number,
  reducedMotion: boolean,
  out: THREE.Vector3,
  sourceSeed = seed,
  targetSeed = seed
): THREE.Vector3 {
  const p2 = quadraticPoint(
    tAlong,
    graphSource,
    { x: controlX, y: controlY, z: controlZ },
    graphTarget
  );
  const morph: Morphology = tAlong < 0.5 ? sourceNode.morphology : targetNode.morphology;
  const blended: MycoNode = {
    ...targetNode,
    x: p2.x,
    y: p2.y,
    z: p2.z,
    radius: sourceNode.radius + (targetNode.radius - sourceNode.radius) * tAlong,
    charge: sourceNode.charge + (targetNode.charge - sourceNode.charge) * tAlong,
    morphology: morph,
  };
  const nodeSeed = sourceSeed + (targetSeed - sourceSeed) * tAlong;
  return out.copy(toScenePoint3(p2, blended, nodeSeed, timeMs, reducedMotion));
}
