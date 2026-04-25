import { MyceliumGraph } from "../../../server/domain/myceliumGraph";
import type { MycoForces } from "../../../server/domain/mycoMapping";

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

describe("MyceliumGraph", () => {
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

    for (let i = 0; i < 24; i++) {
      graph.step(forces, 1 / 30);
    }

    const snapshot = graph.snapshot();
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));

    expect(snapshot.nodes.length).toBeGreaterThan(1);
    for (const node of snapshot.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.radius)).toBe(true);
    }
    for (const edge of snapshot.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("raises topology index when anastomosis creates fused graph edges", () => {
    const tree = new MyceliumGraph({ seed: 9 });
    const graph = new MyceliumGraph({ seed: 9 });

    for (let i = 0; i < 40; i++) {
      tree.step({ ...forces, harmony: 0, anastomosisRate: 0 }, 1 / 30);
      graph.step({ ...forces, harmony: 1, anastomosisRate: 1 }, 1 / 30);
    }

    expect(graph.snapshot().telemetry.topologyIndex).toBeGreaterThan(
      tree.snapshot().telemetry.topologyIndex
    );
    expect(graph.snapshot().telemetry.topologyLabel).toBe("Complex Graph");
  });
});
