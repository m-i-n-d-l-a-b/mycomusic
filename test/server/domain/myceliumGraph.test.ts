import { MyceliumGraph } from "../../../server/domain/myceliumGraph";
import type { MycoForces } from "../../../server/domain/mycoMapping";
import type { MycoSnapshotPayload, MycoTip } from "../../../server/domain/mycoProtocol";

const forces: MycoForces = {
  amplitude: 0.7,
  growthPressure: 0.7,
  morphology: "AM",
  branchProbability: 0.6,
  edgeThickness: 0.35,
  extensionRate: 0.08,
  harmony: 0.8,
  anastomosisRate: 0.8,
  pulse: 0.9,
  bioVoltageMv: 1.9,
  symbioticState: "Nutrient Transfer",
  spectralFlux: 0.1,
};

function expectUnique(values: string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

function expectValidSnapshotReferences(snapshot: MycoSnapshotPayload): void {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));

  for (const edge of snapshot.edges) {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  }
  for (const tip of snapshot.tips) {
    expect(nodeIds.has(tip.nodeId)).toBe(true);
  }
}

function expectAllNodesReachRoot(snapshot: MycoSnapshotPayload): void {
  const rootId = snapshot.nodes[0]?.id;
  expect(rootId).toBeDefined();

  const parentByTarget = new Map(
    snapshot.edges
      .filter((edge) => !edge.fused)
      .map((edge) => [edge.target, edge.source])
  );

  for (const node of snapshot.nodes) {
    const seen = new Set<string>();
    let currentId: string | undefined = node.id;
    while (currentId && currentId !== rootId && !seen.has(currentId)) {
      seen.add(currentId);
      currentId = parentByTarget.get(currentId);
    }
    expect(currentId).toBe(rootId);
  }
}

describe("MyceliumGraph", () => {
  it("starts from four active 3D root tips", () => {
    const graph = new MyceliumGraph({ seed: 42 });
    const snapshot = graph.snapshot();

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.tips).toHaveLength(4);
    for (const tip of snapshot.tips) {
      expect(tip.nodeId).toBe(snapshot.nodes[0].id);
      expect(Math.hypot(tip.dx, tip.dy, tip.dz)).toBeGreaterThan(0.95);
    }
  });

  it("produces deterministic snapshots for the same seed and inputs", () => {
    const a = new MyceliumGraph({ seed: 42 });
    const b = new MyceliumGraph({ seed: 42 });

    for (let i = 0; i < 8; i++) {
      a.step(forces, 1 / 30);
      b.step(forces, 1 / 30);
    }

    expect(a.snapshot().nodes).toEqual(b.snapshot().nodes);
    expect(a.snapshot().edges).toEqual(b.snapshot().edges);
  });

  it("keeps graph coordinates finite and edge endpoints valid", () => {
    const graph = new MyceliumGraph({ seed: 7 });

    for (let i = 0; i < 60; i++) {
      graph.step(forces, 1 / 30);
    }

    const snapshot = graph.snapshot();
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));

    expect(snapshot.nodes.length).toBeGreaterThan(1);
    for (const node of snapshot.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.z)).toBe(true);
      expect(Number.isFinite(node.radius)).toBe(true);
    }
    for (const edge of snapshot.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("grows through a true 3D volume under sustained stress", () => {
    const graph = new MyceliumGraph({ seed: 17 });

    for (let i = 0; i < 900; i++) {
      graph.step({ ...forces, growthPressure: 1, branchProbability: 0.9, anastomosisRate: 1 }, 1 / 12);
    }

    const snapshot = graph.snapshot();
    const maxAbsY = Math.max(...snapshot.nodes.map((node) => Math.abs(node.y)));
    const xRange = Math.max(...snapshot.nodes.map((node) => node.x)) - Math.min(...snapshot.nodes.map((node) => node.x));
    const yRange = Math.max(...snapshot.nodes.map((node) => node.y)) - Math.min(...snapshot.nodes.map((node) => node.y));
    const zRange = Math.max(...snapshot.nodes.map((node) => node.z)) - Math.min(...snapshot.nodes.map((node) => node.z));

    expect(maxAbsY).toBeGreaterThan(0.5);
    expect(yRange).toBeGreaterThan(0.75);
    expect(yRange).toBeGreaterThan(xRange * 0.25);
    expect(yRange).toBeGreaterThan(zRange * 0.25);
  });

  it("scales growth events with elapsed time instead of snapshot tick count", () => {
    const graph = new MyceliumGraph({ seed: 7 });

    graph.step(forces, 2);

    expect(graph.snapshot().nodes.length).toBeGreaterThan(2);
  });

  it("assigns monotonic birth order to nodes and their tree edges", () => {
    const graph = new MyceliumGraph({ seed: 7 });

    graph.step(forces, 2);

    const snapshot = graph.snapshot();
    const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const nonRootOrders = snapshot.nodes.slice(1).map((node) => node.birthOrder);

    expect(snapshot.nodes[0].birthOrder).toBe(0);
    expect(new Set(nonRootOrders).size).toBe(nonRootOrders.length);
    expect(nonRootOrders).toEqual([...nonRootOrders].sort((a, b) => a - b));

    for (const edge of snapshot.edges.filter((candidate) => !candidate.fused)) {
      const target = nodesById.get(edge.target);
      expect(target).toBeDefined();
      expect(edge.birthOrder).toBe(target?.birthOrder);
    }
  });

  it("keeps branch tips separated when branch pressure is high", () => {
    const graph = new MyceliumGraph({ seed: 42 });

    for (let i = 0; i < 180; i++) {
      graph.step({ ...forces, growthPressure: 1, branchProbability: 1, anastomosisRate: 0 }, 1 / 12);
    }

    const tipsByNode = new Map<string, MycoTip[]>();
    const snapshot = graph.snapshot();
    for (const tip of snapshot.tips) {
      tipsByNode.set(tip.nodeId, [...(tipsByNode.get(tip.nodeId) ?? []), tip]);
    }

    let comparedTipPairs = 0;
    for (const tips of tipsByNode.values()) {
      for (let i = 0; i < tips.length; i += 1) {
        for (let j = i + 1; j < tips.length; j += 1) {
          comparedTipPairs += 1;
          const a = tips[i];
          const b = tips[j];
          expect(a.dx * b.dx + a.dy * b.dy + a.dz * b.dz).toBeLessThanOrEqual(0.94);
        }
      }
    }

    expect(comparedTipPairs).toBeGreaterThan(0);
  });

  it("does not create nodes from pulse spikes without sustained growth pressure", () => {
    const graph = new MyceliumGraph({ seed: 7 });

    for (let i = 0; i < 180; i++) {
      graph.step({ ...forces, growthPressure: 0.08, pulse: 1 }, 1 / 30);
    }

    expect(graph.snapshot().nodes.length).toBe(1);
  });

  it("keeps growing indefinitely by pruning the oldest live branches at the node budget", () => {
    const graph = new MyceliumGraph({ seed: 91, maxNodes: 24 });
    const stress = { ...forces, growthPressure: 1, branchProbability: 0.9, harmony: 1, anastomosisRate: 1 };

    for (let i = 0; i < 700; i++) {
      graph.step(stress, 1 / 12);
    }

    const firstSnapshot = graph.snapshot();
    const firstMaxBirthOrder = Math.max(...firstSnapshot.nodes.map((node) => node.birthOrder));

    expect(firstSnapshot.nodes).toHaveLength(24);
    expect(firstSnapshot.nodes[0].id).toBe("node-0");
    expect(firstMaxBirthOrder).toBeGreaterThan(24);
    expectUnique(firstSnapshot.nodes.map((node) => node.id));
    expectUnique(firstSnapshot.edges.map((edge) => edge.id));
    expectUnique(firstSnapshot.tips.map((tip) => tip.id));
    expectValidSnapshotReferences(firstSnapshot);
    expectAllNodesReachRoot(firstSnapshot);

    for (let i = 0; i < 180; i++) {
      graph.step(stress, 1 / 12);
    }

    const secondSnapshot = graph.snapshot();
    const secondMaxBirthOrder = Math.max(...secondSnapshot.nodes.map((node) => node.birthOrder));

    expect(secondSnapshot.nodes).toHaveLength(24);
    expect(secondMaxBirthOrder).toBeGreaterThan(firstMaxBirthOrder);
    expectUnique(secondSnapshot.nodes.map((node) => node.id));
    expectUnique(secondSnapshot.edges.map((edge) => edge.id));
    expectUnique(secondSnapshot.tips.map((tip) => tip.id));
    expectValidSnapshotReferences(secondSnapshot);
    expectAllNodesReachRoot(secondSnapshot);
  });

  it("raises topology index when anastomosis creates fused graph edges", () => {
    const tree = new MyceliumGraph({ seed: 9 });
    const graph = new MyceliumGraph({ seed: 9 });

    for (let i = 0; i < 300; i++) {
      tree.step({ ...forces, harmony: 0, anastomosisRate: 0 }, 1 / 30);
      graph.step({ ...forces, harmony: 1, anastomosisRate: 1 }, 1 / 30);
    }

    expect(graph.snapshot().telemetry.topologyIndex).toBeGreaterThan(
      tree.snapshot().telemetry.topologyIndex
    );
    expect(graph.snapshot().telemetry.topologyLabel).toBe("Complex Graph");
  });

  it("only creates fused edges between genuinely nearby non-adjacent nodes", () => {
    const graph = new MyceliumGraph({ seed: 9 });

    for (let i = 0; i < 180; i++) {
      graph.step({ ...forces, harmony: 1, anastomosisRate: 1 }, 1 / 30);
    }

    const snapshot = graph.snapshot();
    const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));

    for (const edge of snapshot.edges.filter((candidate) => candidate.fused)) {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      if (!source || !target) continue;

      expect(Math.hypot(source.x - target.x, source.y - target.y, source.z - target.z)).toBeLessThanOrEqual(
        Math.max(0.045, forces.extensionRate * 2.2)
      );
    }
  });
});
