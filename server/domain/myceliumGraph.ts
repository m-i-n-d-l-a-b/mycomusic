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
const BASELINE_GROWTH_FPS = 8;

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
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  private growthBudget = 0;
  private fusedEdgeCount = 0;
  private lastForces: MycoForces = {
    amplitude: 0,
    growthPressure: 0,
    morphology: "Balanced",
    branchProbability: 0,
    edgeThickness: 0.25,
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
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.seedGraph();
  }

  step(forces: MycoForces, deltaSec: number): void {
    this.tick += 1;
    this.lastForces = forces;
    this.decayElectricalCharge(deltaSec);
    this.ageEdges(deltaSec);

    const startingNodeCount = this.nodes.length;
    const growthEvents = this.computeGrowthEvents(forces, deltaSec);

    for (let i = 0; i < growthEvents && this.nodes.length < this.maxNodes; i++) {
      const tip = this.selectTip();
      if (!tip) break;
      this.extendTip(tip, forces, deltaSec);
    }

    this.lastGrowthRate = (this.nodes.length - startingNodeCount) / Math.max(deltaSec, 1 / 60);
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
      radius: 0.028,
      charge: 0,
      morphology: "Balanced",
    };

    this.nodes = [root];
    this.nodesById = new Map([[root.id, root]]);
    this.edges = [];
    this.adjacency = new Map([[root.id, []]]);
    this.fusedEdgeCount = 0;
    this.tips = [
      { id: "tip-0", nodeId: root.id, angle: -0.15, energy: 1, age: 0 },
      { id: "tip-1", nodeId: root.id, angle: Math.PI + 0.15, energy: 1, age: 0 },
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

  private computeGrowthEvents(forces: MycoForces, deltaSec: number): number {
    if (forces.growthPressure <= 0.03 && forces.pulse <= 0.03) {
      this.growthBudget = 0;
      return 0;
    }

    const activeTips = Math.max(1, this.tips.length);
    const eventsAtBaselineFps = Math.max(
      0.25,
      Math.min(2.5, 0.35 + forces.growthPressure * Math.sqrt(activeTips))
    );
    this.growthBudget += eventsAtBaselineFps * deltaSec * BASELINE_GROWTH_FPS;
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

    tip.age += deltaSec;
    const morphologyJitter = forces.morphology === "AM" ? 0.9 : forces.morphology === "ECM" ? 0.35 : 0.6;
    const jitter = (this.rand() - 0.5) * morphologyJitter;
    const angle = tip.angle + jitter;
    const length = forces.extensionRate * (0.65 + this.rand() * 0.7);
    const morphology = forces.morphology;
    const node: MycoNode = {
      id: `node-${this.nodes.length}`,
      x: source.x + Math.cos(angle) * length,
      y: source.y + Math.sin(angle) * length,
      radius: this.radiusFor(morphology, forces),
      charge: forces.pulse,
      morphology,
    };

    this.nodes.push(node);
    this.nodesById.set(node.id, node);
    this.adjacency.set(node.id, []);
    this.addEdge({
      id: `edge-${this.edges.length}`,
      source: source.id,
      target: node.id,
      thickness: forces.edgeThickness,
      conductivity: clamp(0.35 + forces.harmony * 0.45 + forces.pulse * 0.2),
      age: 0,
      fused: false,
    });

    tip.nodeId = node.id;
    tip.angle = angle;
    tip.energy = clamp(tip.energy * 0.92 + forces.growthPressure * 0.3);

    if (this.rand() < forces.branchProbability && this.tips.length < 96) {
      this.tips.push({
        id: `tip-${this.tips.length}`,
        nodeId: node.id,
        angle: angle + (this.rand() > 0.5 ? 1 : -1) * (0.45 + this.rand() * 0.95),
        energy: tip.energy * 0.85,
        age: 0,
      });
    }

    this.tryAnastomosis(node, source.id, forces);
    this.applySpikeCascade(node.id, forces);
  }

  private radiusFor(morphology: Morphology, forces: MycoForces): number {
    if (morphology === "ECM") return 0.018 + forces.edgeThickness * 0.04;
    if (morphology === "AM") return 0.009 + forces.edgeThickness * 0.02;
    return 0.012 + forces.edgeThickness * 0.025;
  }

  private tryAnastomosis(node: MycoNode, sourceId: string, forces: MycoForces): void {
    if (this.nodes.length < 4) return;

    const probability = clamp(forces.anastomosisRate * (0.18 + forces.harmony * 0.32));
    if (this.rand() > probability) return;

    const nearest = this.findAnastomosisCandidate(node, sourceId);

    if (!nearest) return;

    this.addEdge({
      id: `edge-${this.edges.length}`,
      source: node.id,
      target: nearest.id,
      thickness: Math.max(0.12, forces.edgeThickness * 0.8),
      conductivity: clamp(0.45 + forces.harmony * 0.5),
      age: 0,
      fused: true,
    });
  }

  private findAnastomosisCandidate(node: MycoNode, sourceId: string): MycoNode | undefined {
    const nearest: { node: MycoNode; distance: number }[] = [];

    for (const candidate of this.nodes) {
      if (candidate.id === node.id || candidate.id === sourceId) continue;

      const candidateDistance = distance(node, candidate);
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
