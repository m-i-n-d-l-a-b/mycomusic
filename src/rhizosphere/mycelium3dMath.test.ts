import * as THREE from "three";
import {
  PARTICLE_CLOUD_COUNT,
  PARTICLE_CLOUD_RADIUS,
  PARTICLE_CLOUD_VERTICAL_RADIUS,
  WORLD_GRAPH_SCALE,
  buildEdgeLinePoints,
  hyphalQuadraticControlGraph,
  toScenePoint3,
  nodeSphereRadius,
  particleCloudCount,
  travelPulsePointOnEdge,
  writeParticleCloudPositions,
} from "./mycelium3dMath";
import type { MycoNode } from "../../server/domain/mycoProtocol";

describe("mycelium3dMath", () => {
  it("maps 3D graph coordinates into world space with scale", () => {
    const n: MycoNode = {
      id: "a",
      x: 0,
      y: 0,
      z: 0,
      radius: 0.03,
      charge: 0,
      morphology: "Balanced",
      birthOrder: 0,
    };
    const v = toScenePoint3({ x: 1, y: -0.5, z: 0.25 }, n, 0.4, 0, true, new THREE.Vector3());
    expect(v.x).toBeCloseTo(1 * WORLD_GRAPH_SCALE);
    expect(v.y).toBeCloseTo(-0.5 * WORLD_GRAPH_SCALE * 0.82 + (0.4 - 0.5) * 0.18);
    expect(v.z).toBeCloseTo(0.25 * WORLD_GRAPH_SCALE);
  });

  it("buildEdgeLinePoints produces non-empty line", () => {
    const a: MycoNode = {
      id: "a",
      x: 0,
      y: 0,
      z: 0,
      radius: 0.03,
      charge: 0.1,
      morphology: "AM",
      birthOrder: 1,
    };
    const b: MycoNode = {
      id: "b",
      x: 0.2,
      y: 0.1,
      z: -0.15,
      radius: 0.04,
      charge: 0.2,
      morphology: "AM",
      birthOrder: 2,
    };
    const pts = Array.from({ length: 13 }, () => new THREE.Vector3());
    buildEdgeLinePoints(a, b, { x: 0, y: 0, z: 0 }, { x: 0.2, y: 0.1, z: -0.15 }, 0.3, 1000, false, pts);
    expect(pts[0].length()).toBeGreaterThan(0);
    expect(pts[12].distanceTo(pts[0])).toBeGreaterThan(0.01);
    expect(pts[12].z).toBeCloseTo(-0.15 * WORLD_GRAPH_SCALE);
  });

  it("keeps edge endpoints anchored to source and target node positions", () => {
    const a: MycoNode = {
      id: "a",
      x: -0.1,
      y: 0.05,
      z: 0.08,
      radius: 0.03,
      charge: 0,
      morphology: "ECM",
      birthOrder: 1,
    };
    const b: MycoNode = {
      id: "b",
      x: 0.18,
      y: -0.12,
      z: -0.04,
      radius: 0.04,
      charge: 1,
      morphology: "AM",
      birthOrder: 2,
    };
    const pts = Array.from({ length: 13 }, () => new THREE.Vector3());
    const sourceSeed = 0.2;
    const targetSeed = 0.8;

    buildEdgeLinePoints(
      a,
      b,
      { x: a.x, y: a.y, z: a.z },
      { x: b.x, y: b.y, z: b.z },
      0.3,
      1000,
      false,
      pts,
      sourceSeed,
      targetSeed
    );

    expect(pts[0].distanceTo(toScenePoint3(a, a, sourceSeed, 1000, false, new THREE.Vector3()))).toBeLessThan(0.001);
    expect(pts[12].distanceTo(toScenePoint3(b, b, targetSeed, 1000, false, new THREE.Vector3()))).toBeLessThan(0.001);
  });

  it("places travel pulses on the same curve as rendered hypha lines", () => {
    const a: MycoNode = {
      id: "a",
      x: -0.1,
      y: 0.03,
      z: 0.08,
      radius: 0.02,
      charge: 0.05,
      morphology: "ECM",
      birthOrder: 1,
    };
    const b: MycoNode = {
      id: "b",
      x: 0.16,
      y: -0.08,
      z: -0.06,
      radius: 0.05,
      charge: 0.9,
      morphology: "AM",
      birthOrder: 2,
    };
    const sourcePoint = { x: a.x, y: a.y, z: a.z };
    const targetPoint = { x: b.x, y: b.y, z: b.z };
    const edgeSeed = 0.31;
    const sourceSeed = 0.12;
    const targetSeed = 0.87;
    const timeMs = 1_250;
    const pts = Array.from({ length: 13 }, () => new THREE.Vector3());
    buildEdgeLinePoints(a, b, sourcePoint, targetPoint, edgeSeed, timeMs, false, pts, sourceSeed, targetSeed);
    const { controlX, controlY, controlZ } = hyphalQuadraticControlGraph(sourcePoint, targetPoint, edgeSeed, timeMs, false);

    const pulsePoint = travelPulsePointOnEdge(
      0.5,
      sourcePoint,
      targetPoint,
      controlX,
      controlY,
      controlZ,
      b,
      a,
      edgeSeed,
      timeMs,
      false,
      new THREE.Vector3(),
      sourceSeed,
      targetSeed
    );

    expect(pulsePoint.distanceTo(pts[6])).toBeLessThan(0.001);
  });

  it("nodeSphereRadius returns positive for typical node", () => {
    const n: MycoNode = {
      id: "a",
      x: 0,
      y: 0,
      z: 0,
      radius: 0.04,
      charge: 0.5,
      morphology: "ECM",
      birthOrder: 1,
    };
    const r = nodeSphereRadius(n, 1, 0, 0.5, true);
    expect(r).toBeGreaterThan(0.02);
  });

  it("spreads the particle cloud across a large static scene-space volume", () => {
    const count = particleCloudCount();
    const positions = new Float32Array(count * 3);

    writeParticleCloudPositions(positions, count, 1_000, false);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;
      minX = Math.min(minX, positions[offset]);
      maxX = Math.max(maxX, positions[offset]);
      minY = Math.min(minY, positions[offset + 1]);
      maxY = Math.max(maxY, positions[offset + 1]);
      minZ = Math.min(minZ, positions[offset + 2]);
      maxZ = Math.max(maxZ, positions[offset + 2]);
    }

    expect(maxX - minX).toBeGreaterThan(PARTICLE_CLOUD_RADIUS);
    expect(maxY - minY).toBeGreaterThan(PARTICLE_CLOUD_VERTICAL_RADIUS);
    expect(maxZ - minZ).toBeGreaterThan(PARTICLE_CLOUD_RADIUS);
  });

  it("uses a fixed particle count instead of audio intensity", () => {
    expect(particleCloudCount()).toBe(PARTICLE_CLOUD_COUNT);
  });

  it("keeps reduced-motion particle positions stable over time", () => {
    const count = particleCloudCount();
    const atStart = new Float32Array(count * 3);
    const later = new Float32Array(count * 3);

    writeParticleCloudPositions(atStart, count, 0, true);
    writeParticleCloudPositions(later, count, 8_000, true);

    expect(Array.from(later)).toEqual(Array.from(atStart));
  });

  it("slowly drifts particle positions over time when motion is enabled", () => {
    const count = particleCloudCount();
    const atStart = new Float32Array(count * 3);
    const later = new Float32Array(count * 3);

    writeParticleCloudPositions(atStart, count, 0, false);
    writeParticleCloudPositions(later, count, 8_000, false);

    expect(Array.from(later)).not.toEqual(Array.from(atStart));
    expect(Math.abs(later[0] - atStart[0])).toBeLessThan(0.7);
  });
});
