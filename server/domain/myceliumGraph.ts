import type { MycoForces } from "./mycoMapping";
import type { Morphology, MycoEdge, MycoNode, MycoSnapshotPayload, MycoTip } from "./mycoProtocol";
import { deriveTelemetry } from "../telemetry/mycoTelemetry";

interface GraphOptions {
  seed?: number;
  maxNodes?: number;
}

interface InternalTip extends MycoTip {
  age: number;
}

const DEFAULT_MAX_NODES = 640;
/** Baseline growth throughput; lower = fewer extension events per second at the same forces. */
const BASELINE_GROWTH_FPS = 10;
const MIN_GROWTH_PRESSURE = 0.08;
const MIN_ANASTOMOSIS_NODES = 12;
/** At few nodes, growth budget accumulates at `SEEDLING_GROWTH_MULT` of full rate; scales linearly to 1 by this count. */
const GROWTH_RAMP_FULL_NODE_COUNT = 400;
const SEEDLING_GROWTH_MULT = 0.85;
const MIN_BRANCH_SEPARATION_DOT = 0.94;
const BRANCH_DIRECTION_ATTEMPTS = 6;

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: MycoNode, b: MycoNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalizeDirection(direction: { dx: number; dy: number; dz: number }): { dx: number; dy: number; dz: number } {
  const length = Math.hypot(direction.dx, direction.dy, direction.dz) || 1;
  return {
    dx: direction.dx / length,
    dy: direction.dy / length,
    dz: direction.dz / length,
  };
}

function dotDirection(
  a: { dx: number; dy: number; dz: number },
  b: { dx: number; dy: number; dz: number }
): number {
  return a.dx * b.dx + a.dy * b.dy + a.dz * b.dz;
}

export class MyceliumGraph {
  private readonly rand: () => number;
  private readonly maxNodes: number;
  private nodes: MycoNode[] = [];
  private nodesById = new Map<string, MycoNode>();
  private edges: MycoEdge[] = [];
  private adjacency = new Map<string, MycoEdge[]>();
  private tips: InternalTip[] = [];
  private tick = 0;
  private nextBirthOrder = 1;
  private nextNodeId = 1;
  private nextEdgeId = 0;
  private nextTipId = 4;
  private growthBudget = 0;
  private fusedEdgeCount = 0;
  private lastForces: MycoForces = {
    amplitude: 0,
    growthPressure: 0,
    morphology: "Balanced",
    branchProbability: 0,
    edgeThickness: 0.2,
    extensionRate: 0.02,
    harmony: 0,
    anastomosisRate: 0,
    pulse: 0,
    bioVoltageMv: 0,
    symbioticState: "Resource Hoarding",
    spectralFlux: 0,
  };
  private lastGrowthRate = 0;

  constructor(options: GraphOptions = {}) {
    this.rand = createPrng(options.seed ?? 1337);
    this.maxNodes = Math.max(1, Math.floor(options.maxNodes ?? DEFAULT_MAX_NODES));
    this.seedGraph();
  }

  step(forces: MycoForces, deltaSec: number): void {
    this.tick += 1;
    this.lastForces = forces;
    this.decayElectricalCharge(deltaSec);
    this.ageEdges(deltaSec);
    this.ensureActiveTip();

    const growthEvents = this.computeGrowthEvents(forces, deltaSec);
    let createdNodes = 0;

    for (let i = 0; i < growthEvents; i++) {
      const tip = this.selectTip();
      if (!tip) break;
      const beforeNodeCount = this.nodes.length;
      this.extendTip(tip, forces, deltaSec);
      createdNodes += Math.max(0, this.nodes.length - beforeNodeCount);
    }

    this.pruneOldestBranches(this.nodes.length - this.maxNodes);

    this.lastGrowthRate = createdNodes / Math.max(deltaSec, 1 / 60);
  }

  snapshot(debug: Partial<MycoSnapshotPayload["debug"]> = {}): MycoSnapshotPayload {
    const topologyIndex = this.computeTopologyIndex();

    return {
      nodes: this.nodes.map((node) => ({ ...node })),
      edges: this.edges.map((edge) => ({ ...edge })),
      tips: this.tips.map(({ age: _age, ...tip }) => ({ ...tip })),
      telemetry: deriveTelemetry(this.lastForces, topologyIndex, this.lastGrowthRate),
      debug: {
        tick: this.tick,
        droppedFrames: 0,
        inputAgeMs: 0,
        connectedClients: 0,
        ...debug,
      },
    };
  }

  private seedGraph(): void {
    const root: MycoNode = {
      id: "node-0",
      x: 0,
      y: 0,
      z: 0,
      radius: 0.028,
      charge: 0,
      morphology: "Balanced",
      birthOrder: 0,
    };

    this.nodes = [root];
    this.nodesById = new Map([[root.id, root]]);
    this.edges = [];
    this.adjacency = new Map([[root.id, []]]);
    this.fusedEdgeCount = 0;
    this.nextBirthOrder = 1;
    this.nextNodeId = 1;
    this.nextEdgeId = 0;
    this.nextTipId = 4;
    this.tips = [
      { id: "tip-0", nodeId: root.id, dx: 0.9, dy: -0.26, dz: 0.36, energy: 1, age: 0 },
      { id: "tip-1", nodeId: root.id, dx: -0.86, dy: 0.32, dz: -0.4, energy: 1, age: 0 },
      { id: "tip-2", nodeId: root.id, dx: 0.34, dy: 0.74, dz: -0.58, energy: 1, age: 0 },
      { id: "tip-3", nodeId: root.id, dx: -0.38, dy: -0.7, dz: 0.6, energy: 1, age: 0 },
    ];
  }

  private addEdge(edge: MycoEdge): void {
    this.edges.push(edge);
    if (edge.fused) this.fusedEdgeCount += 1;

    const sourceEdges = this.adjacency.get(edge.source) ?? [];
    sourceEdges.push(edge);
    this.adjacency.set(edge.source, sourceEdges);

    const targetEdges = this.adjacency.get(edge.target) ?? [];
    targetEdges.push(edge);
    this.adjacency.set(edge.target, targetEdges);
  }

  /** Slower accumulation while the colony is small; approaches 1 as the network grows. */
  private growthStartRamp(): number {
    const n = this.nodes.length;
    if (n >= GROWTH_RAMP_FULL_NODE_COUNT) return 1;
    const t = (n - 1) / Math.max(1, GROWTH_RAMP_FULL_NODE_COUNT - 1);
    return SEEDLING_GROWTH_MULT + (1 - SEEDLING_GROWTH_MULT) * t;
  }

  private computeGrowthEvents(forces: MycoForces, deltaSec: number): number {
    if (forces.growthPressure <= MIN_GROWTH_PRESSURE) {
      this.growthBudget = 0;
      return 0;
    }

    const activeTips = Math.max(1, this.tips.length);
    const growthSignal = clamp((forces.growthPressure - MIN_GROWTH_PRESSURE) / (1 - MIN_GROWTH_PRESSURE));
    const easedGrowth = Math.pow(growthSignal, 1.28);
    const sustainedPulseBoost =
      forces.pulse > 0.72 && forces.growthPressure > 0.35 ? (forces.pulse - 0.72) * 0.22 : 0;
    const eventsAtBaselineFps = Math.max(
      0,
      Math.min(1.35, easedGrowth * (0.28 + Math.sqrt(activeTips) * 0.14) + sustainedPulseBoost)
    );
    const ramp = this.growthStartRamp();
    this.growthBudget += eventsAtBaselineFps * deltaSec * BASELINE_GROWTH_FPS * ramp;
    const events = Math.floor(this.growthBudget);
    this.growthBudget -= events;

    return events;
  }

  private selectTip(): InternalTip | undefined {
    if (this.tips.length === 0) return undefined;
    const index = Math.floor(this.rand() * this.tips.length);
    return this.tips[index];
  }

  private extendTip(tip: InternalTip, forces: MycoForces, deltaSec: number): void {
    const source = this.nodesById.get(tip.nodeId);
    if (!source) return;

    const birthOrder = this.nextBirthOrder;
    this.nextBirthOrder += 1;
    tip.age += deltaSec;
    const morphologyJitter = forces.morphology === "AM" ? 0.9 : forces.morphology === "ECM" ? 0.35 : 0.6;
    const verticalBias = forces.morphology === "AM" ? 0.08 : forces.morphology === "ECM" ? -0.03 : 0.02;
    const direction = normalizeDirection({
      dx: tip.dx + (this.rand() - 0.5) * morphologyJitter,
      dy: tip.dy + (this.rand() - 0.5) * morphologyJitter + verticalBias,
      dz: tip.dz + (this.rand() - 0.5) * morphologyJitter,
    });
    const length = forces.extensionRate * (0.65 + this.rand() * 0.7);
    const morphology = forces.morphology;
    const node: MycoNode = {
      id: `node-${this.nextNodeId}`,
      x: source.x + direction.dx * length,
      y: source.y + direction.dy * length,
      z: source.z + direction.dz * length,
      radius: this.radiusFor(morphology, forces),
      charge: forces.pulse,
      morphology,
      birthOrder,
    };
    this.nextNodeId += 1;
    const actualDirection = normalizeDirection({
      dx: node.x - source.x,
      dy: node.y - source.y,
      dz: node.z - source.z,
    });

    this.nodes.push(node);
    this.nodesById.set(node.id, node);
    this.adjacency.set(node.id, []);
    this.addEdge({
      id: `edge-${this.nextEdgeId}`,
      source: source.id,
      target: node.id,
      thickness: forces.edgeThickness,
      conductivity: clamp(0.35 + forces.harmony * 0.45 + forces.pulse * 0.2),
      age: 0,
      fused: false,
      birthOrder,
    });
    this.nextEdgeId += 1;

    tip.nodeId = node.id;
    tip.dx = actualDirection.dx;
    tip.dy = actualDirection.dy;
    tip.dz = actualDirection.dz;
    tip.energy = clamp(tip.energy * 0.92 + forces.growthPressure * 0.3);

    if (this.rand() < forces.branchProbability && this.tips.length < 96) {
      const branchDirection = this.createSeparatedBranchDirection(node, actualDirection);
      this.tips.push({
        id: `tip-${this.nextTipId}`,
        nodeId: node.id,
        dx: branchDirection.dx,
        dy: branchDirection.dy,
        dz: branchDirection.dz,
        energy: tip.energy * 0.85,
        age: 0,
      });
      this.nextTipId += 1;
    }

    this.tryAnastomosis(node, source.id, forces, birthOrder);
    this.applySpikeCascade(node.id, forces);
  }

  private isSeparatedFromReferences(
    candidate: { dx: number; dy: number; dz: number },
    references: { dx: number; dy: number; dz: number }[]
  ): boolean {
    return references.every((reference) => dotDirection(candidate, reference) <= MIN_BRANCH_SEPARATION_DOT);
  }

  private branchReferencesFor(nodeId: string, parentDirection: { dx: number; dy: number; dz: number }) {
    const references = [parentDirection];
    for (const existingTip of this.tips) {
      if (existingTip.nodeId === nodeId) {
        references.push(existingTip);
      }
    }
    return references;
  }

  private fallbackBranchDirection(
    node: MycoNode,
    parentDirection: { dx: number; dy: number; dz: number },
    references: { dx: number; dy: number; dz: number }[]
  ): { dx: number; dy: number; dz: number } {
    const referenceAxis = Math.abs(parentDirection.dy) < 0.8 ? { dx: 0, dy: 1, dz: 0 } : { dx: 1, dy: 0, dz: 0 };
    const normalA = normalizeDirection({
      dx: parentDirection.dy * referenceAxis.dz - parentDirection.dz * referenceAxis.dy,
      dy: parentDirection.dz * referenceAxis.dx - parentDirection.dx * referenceAxis.dz,
      dz: parentDirection.dx * referenceAxis.dy - parentDirection.dy * referenceAxis.dx,
    });
    const normalB = normalizeDirection({
      dx: parentDirection.dy * normalA.dz - parentDirection.dz * normalA.dy,
      dy: parentDirection.dz * normalA.dx - parentDirection.dx * normalA.dz,
      dz: parentDirection.dx * normalA.dy - parentDirection.dy * normalA.dx,
    });
    const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, 0.72, -0.72, 1.38, -1.38];

    for (const angle of angles) {
      const sideWeight = 0.94;
      const forwardWeight = 0.34;
      const candidate = normalizeDirection({
        dx: parentDirection.dx * forwardWeight + (normalA.dx * Math.cos(angle) + normalB.dx * Math.sin(angle)) * sideWeight,
        dy: parentDirection.dy * forwardWeight + (normalA.dy * Math.cos(angle) + normalB.dy * Math.sin(angle)) * sideWeight,
        dz: parentDirection.dz * forwardWeight + (normalA.dz * Math.cos(angle) + normalB.dz * Math.sin(angle)) * sideWeight,
      });
      if (this.isSeparatedFromReferences(candidate, references)) {
        return candidate;
      }
    }

    return normalA;
  }

  private createSeparatedBranchDirection(
    node: MycoNode,
    parentDirection: { dx: number; dy: number; dz: number }
  ): { dx: number; dy: number; dz: number } {
    const references = this.branchReferencesFor(node.id, parentDirection);
    for (let attempt = 0; attempt < BRANCH_DIRECTION_ATTEMPTS; attempt += 1) {
      const candidate = normalizeDirection({
        dx: parentDirection.dx + (this.rand() - 0.5) * 1.15,
        dy: parentDirection.dy + (this.rand() - 0.5) * 1.15,
        dz: parentDirection.dz + (this.rand() - 0.5) * 1.15,
      });
      if (this.isSeparatedFromReferences(candidate, references)) {
        return candidate;
      }
    }

    return this.fallbackBranchDirection(node, parentDirection, references);
  }

  private radiusFor(morphology: Morphology, forces: MycoForces): number {
    if (morphology === "ECM") return 0.018 + forces.edgeThickness * 0.04;
    if (morphology === "AM") return 0.009 + forces.edgeThickness * 0.02;
    return 0.012 + forces.edgeThickness * 0.025;
  }

  private tryAnastomosis(node: MycoNode, sourceId: string, forces: MycoForces, birthOrder: number): void {
    if (this.nodes.length < MIN_ANASTOMOSIS_NODES) return;

    const probability = clamp(forces.anastomosisRate * (0.18 + forces.harmony * 0.32));
    if (this.rand() > probability) return;

    const nearest = this.findAnastomosisCandidate(node, sourceId, forces.extensionRate);

    if (!nearest) return;

    this.addEdge({
      id: `edge-${this.nextEdgeId}`,
      source: node.id,
      target: nearest.id,
      thickness: Math.max(0.12, forces.edgeThickness * 0.8),
      conductivity: clamp(0.45 + forces.harmony * 0.5),
      age: 0,
      fused: true,
      birthOrder,
    });
    this.nextEdgeId += 1;
  }

  private pruneOldestBranches(overBudget: number): void {
    if (overBudget <= 0 || this.nodes.length <= 1) return;

    let remaining = Math.min(overBudget, this.nodes.length - 1);
    while (remaining > 0) {
      const pruneId = this.findOldestPrunableLeafId();
      if (!pruneId) break;
      this.retreatTipsFromPrunedLeaf(pruneId);

      this.nodes = this.nodes.filter((node) => node.id !== pruneId);
      const liveNodeIds = new Set(this.nodes.map((node) => node.id));
      this.edges = this.edges.filter((edge) => liveNodeIds.has(edge.source) && liveNodeIds.has(edge.target));
      this.tips = this.tips.filter((tip) => liveNodeIds.has(tip.nodeId));
      this.rebuildIndexes();
      remaining -= 1;
    }

    this.ensureActiveTip();
  }

  private findOldestPrunableLeafId(): string | null {
    const rootId = this.nodes[0]?.id;
    if (!rootId) return null;

    const treeChildCount = new Map<string, number>();
    for (const node of this.nodes) {
      treeChildCount.set(node.id, 0);
    }
    for (const edge of this.edges) {
      if (edge.fused) continue;
      treeChildCount.set(edge.source, (treeChildCount.get(edge.source) ?? 0) + 1);
    }

    const activeTipNodeIds = new Set(this.tips.map((tip) => tip.nodeId));
    const byAgeThenId = (a: MycoNode, b: MycoNode) => a.birthOrder - b.birthOrder || a.id.localeCompare(b.id);
    const leafCandidates = this.nodes
      .filter((node) => node.id !== rootId && (treeChildCount.get(node.id) ?? 0) === 0)
      .sort(byAgeThenId);

    return (
      leafCandidates.find((node) => !activeTipNodeIds.has(node.id))?.id ??
      leafCandidates[0]?.id ??
      this.nodes.filter((node) => node.id !== rootId).sort(byAgeThenId)[0]?.id ??
      null
    );
  }

  private retreatTipsFromPrunedLeaf(pruneId: string): void {
    const prunedNode = this.nodesById.get(pruneId);
    const parentEdge = this.edges.find((edge) => !edge.fused && edge.target === pruneId);
    const parent = parentEdge ? this.nodesById.get(parentEdge.source) : undefined;
    if (!(prunedNode && parent)) return;

    const retreatDirection = normalizeDirection({
      dx: prunedNode.x - parent.x,
      dy: prunedNode.y - parent.y,
      dz: prunedNode.z - parent.z,
    });
    for (const tip of this.tips) {
      if (tip.nodeId !== pruneId) continue;
      tip.nodeId = parent.id;
      tip.dx = retreatDirection.dx;
      tip.dy = retreatDirection.dy;
      tip.dz = retreatDirection.dz;
      tip.energy = Math.max(0.35, tip.energy * 0.92);
      tip.age = 0;
    }
  }

  private rebuildIndexes(): void {
    this.nodesById = new Map();
    this.adjacency = new Map();
    for (const node of this.nodes) {
      this.nodesById.set(node.id, node);
      this.adjacency.set(node.id, []);
    }

    const validEdges: MycoEdge[] = [];
    this.fusedEdgeCount = 0;
    for (const edge of this.edges) {
      if (!(this.nodesById.has(edge.source) && this.nodesById.has(edge.target))) continue;
      validEdges.push(edge);
      if (edge.fused) this.fusedEdgeCount += 1;

      const sourceEdges = this.adjacency.get(edge.source) ?? [];
      sourceEdges.push(edge);
      this.adjacency.set(edge.source, sourceEdges);

      const targetEdges = this.adjacency.get(edge.target) ?? [];
      targetEdges.push(edge);
      this.adjacency.set(edge.target, targetEdges);
    }
    this.edges = validEdges;
  }

  private ensureActiveTip(): void {
    if (this.tips.length > 0) return;
    const node = [...this.nodes].sort((a, b) => b.birthOrder - a.birthOrder)[0];
    if (!node) return;

    const parentEdge = this.edges.find((edge) => !edge.fused && edge.target === node.id);
    const parent = parentEdge ? this.nodesById.get(parentEdge.source) : undefined;
    const direction = parent
      ? normalizeDirection({
          dx: node.x - parent.x,
          dy: node.y - parent.y,
          dz: node.z - parent.z,
        })
      : normalizeDirection({
          dx: this.rand() - 0.5,
          dy: this.rand() - 0.5,
          dz: this.rand() - 0.5,
        });

    this.tips.push({
      id: `tip-${this.nextTipId}`,
      nodeId: node.id,
      dx: direction.dx,
      dy: direction.dy,
      dz: direction.dz,
      energy: 0.85,
      age: 0,
    });
    this.nextTipId += 1;
  }

  private hasEdgeBetween(aId: string, bId: string): boolean {
    return (this.adjacency.get(aId) ?? []).some((edge) => {
      return (edge.source === aId && edge.target === bId) || (edge.source === bId && edge.target === aId);
    });
  }

  private findAnastomosisCandidate(node: MycoNode, sourceId: string, extensionRate: number): MycoNode | undefined {
    const nearest: { node: MycoNode; distance: number }[] = [];
    const maxFusionDistance = Math.max(0.045, extensionRate * 2.2);

    for (const candidate of this.nodes) {
      if (candidate.id === node.id || candidate.id === sourceId) continue;
      if (this.hasEdgeBetween(node.id, candidate.id)) continue;
      if (this.hasEdgeBetween(sourceId, candidate.id)) continue;

      const candidateDistance = distance(node, candidate);
      if (candidateDistance > maxFusionDistance) continue;
      if (nearest.length < 5) {
        nearest.push({ node: candidate, distance: candidateDistance });
        continue;
      }

      let farthestIndex = 0;
      for (let index = 1; index < nearest.length; index += 1) {
        if (nearest[index].distance > nearest[farthestIndex].distance) {
          farthestIndex = index;
        }
      }

      if (candidateDistance < nearest[farthestIndex].distance) {
        nearest[farthestIndex] = { node: candidate, distance: candidateDistance };
      }
    }

    return nearest[Math.floor(this.rand() * nearest.length)]?.node;
  }

  private applySpikeCascade(nodeId: string, forces: MycoForces): void {
    if (forces.pulse <= 0.02) return;

    const touched = new Set<string>([nodeId]);
    const frontier = [{ nodeId, charge: forces.pulse }];
    let frontierIndex = 0;

    while (frontierIndex < frontier.length) {
      const current = frontier[frontierIndex];
      frontierIndex += 1;
      if (!current || current.charge < 0.08) continue;

      const node = this.nodesById.get(current.nodeId);
      if (node) {
        node.charge = Math.max(node.charge, current.charge);
      }

      for (const edge of this.adjacency.get(current.nodeId) ?? []) {
        const nextId =
          edge.source === current.nodeId ? edge.target : edge.target === current.nodeId ? edge.source : null;
        if (!nextId || touched.has(nextId)) continue;
        touched.add(nextId);
        frontier.push({ nodeId: nextId, charge: current.charge * edge.conductivity * 0.55 });
      }
    }
  }

  private decayElectricalCharge(deltaSec: number): void {
    const decay = Math.max(0, 1 - deltaSec * 2.8);
    for (const node of this.nodes) {
      node.charge *= decay;
    }
  }

  private ageEdges(deltaSec: number): void {
    for (const edge of this.edges) {
      edge.age += deltaSec;
    }
  }

  private computeTopologyIndex(): number {
    return clamp((this.fusedEdgeCount / Math.max(1, this.nodes.length - 1)) * 1.6);
  }
}
