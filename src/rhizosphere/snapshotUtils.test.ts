import {
  buildSnapshotCache,
  buildBirthOrderStagger,
  easeSnapshotProgress,
  findNodeInterpolationOrigin,
  hashString,
  interpolateTipDirection,
  interpolateNodeGraphPosition,
  revealProgressForBirthOrder,
} from "./snapshotUtils";
import type { MycoEdge, MycoNode, MycoSnapshotMessage, MycoTip } from "../../server/domain/mycoProtocol";

function makeMsg(
  nodes: MycoNode[],
  edges: MycoEdge[],
  tips: { id: string; nodeId: string; dx: number; dy: number; dz: number; energy: number }[] = []
): MycoSnapshotMessage {
  return {
    type: "myco.snapshot",
    sessionId: "s",
    timestamp: 1,
    nodes,
    edges,
    tips,
    telemetry: {
      bioVoltageMv: 0,
      topologyIndex: 0,
      topologyLabel: "Dendritic Tree",
      symbioticState: "Resource Hoarding",
      morphology: "Balanced",
      growthRate: 0,
      anastomosisRate: 0,
    },
    debug: { tick: 0, droppedFrames: 0, inputAgeMs: 0, connectedClients: 0 },
  };
}

const root: MycoNode = {
  id: "n0",
  x: 0,
  y: 0,
  z: 0,
  radius: 0.03,
  charge: 0,
  morphology: "Balanced",
  birthOrder: 0,
};

function makeNode(id: string, birthOrder: number): MycoNode {
  return {
    id,
    x: birthOrder * 0.1,
    y: 0,
    z: 0,
    radius: 0.03,
    charge: 0,
    morphology: "Balanced",
    birthOrder,
  };
}

describe("snapshotUtils", () => {
  it("has stable hash in [0, 1] for a given string", () => {
    const h1 = hashString("a");
    const h2 = hashString("a");
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(1);
  });

  it("eases 0/1 to themselves", () => {
    expect(easeSnapshotProgress(0)).toBe(0);
    expect(easeSnapshotProgress(1)).toBe(1);
  });

  it("interpolates node graph position toward new 3D position using graph origin chain", () => {
    const n0 = { ...root, id: "n0" };
    const n1: MycoNode = { id: "n1", x: 1, y: 0, z: 0.5, radius: 0.03, charge: 0, morphology: "Balanced", birthOrder: 1 };
    const prev = makeMsg(
      [n0],
      [],
      []
    ) as MycoSnapshotMessage;
    const next = makeMsg(
      [n0, n1],
      [
        { id: "e0", source: "n0", target: "n1", thickness: 0.2, conductivity: 0.5, age: 0, fused: false, birthOrder: 1 },
      ],
      []
    ) as MycoSnapshotMessage;

    const pNode = new Map();
    const pEdge = new Map();
    const cPrev = buildSnapshotCache(prev, pNode, pEdge);
    const cNext = buildSnapshotCache(next, pNode, pEdge);

    const p = interpolateNodeGraphPosition(n1, cNext, cPrev, 0.5);
    expect(p.x).toBeLessThan(1);
    expect(p.x).toBeGreaterThan(0);
    expect(p.z).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(0.5);
  });

  it("interpolates tip direction and keeps it normalized", () => {
    const d = interpolateTipDirection(
      { dx: 1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 },
      0.5
    );
    expect(Math.hypot(d.dx, d.dy, d.dz)).toBeCloseTo(1);
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBeGreaterThan(0);
  });

  it("findNodeInterpolationOrigin returns node if already in previous", () => {
    const n0 = { ...root, id: "n0" };
    const cPrev = buildSnapshotCache(makeMsg([n0], [], []), new Map(), new Map());
    const cNext = buildSnapshotCache(
      makeMsg([n0], [], []),
      new Map(cPrev.nodeSeeds),
      new Map()
    );
    const o = findNodeInterpolationOrigin(n0, cNext, cPrev, new Set());
    expect(o.x).toBe(0);
  });

  it("staggers new birth orders during a snapshot transition", () => {
    const n0 = { ...root, id: "n0" };
    const n1: MycoNode = { id: "n1", x: 0.1, y: 0, z: 0, radius: 0.03, charge: 0, morphology: "Balanced", birthOrder: 1 };
    const n2: MycoNode = { id: "n2", x: 0.2, y: 0, z: 0, radius: 0.03, charge: 0, morphology: "Balanced", birthOrder: 2 };
    const prev = buildSnapshotCache(makeMsg([n0], []), new Map(), new Map());
    const next = buildSnapshotCache(
      makeMsg(
        [n0, n1, n2],
        [
          { id: "e1", source: "n0", target: "n1", thickness: 0.2, conductivity: 0.5, age: 0, fused: false, birthOrder: 1 },
          { id: "e2", source: "n1", target: "n2", thickness: 0.2, conductivity: 0.5, age: 0, fused: false, birthOrder: 2 },
        ]
      ),
      new Map(prev.nodeSeeds),
      new Map(prev.edgeSeeds)
    );

    const stagger = buildBirthOrderStagger(next, prev);

    expect(revealProgressForBirthOrder(1, 0.25, stagger)).toBeGreaterThan(
      revealProgressForBirthOrder(2, 0.25, stagger)
    );
    expect(revealProgressForBirthOrder(1, 1, stagger)).toBe(1);
    expect(revealProgressForBirthOrder(2, 1, stagger)).toBe(1);
  });

  it("does not stagger when there is no previous snapshot", () => {
    const stagger = buildBirthOrderStagger(buildSnapshotCache(makeMsg([root], []), new Map(), new Map()), null);

    expect(revealProgressForBirthOrder(0, 0.4, stagger)).toBe(1);
  });

  it("renders newest growth with its ancestor path when a snapshot exceeds the node budget", () => {
    const nodes = [
      { ...root, id: "n0" },
      makeNode("n1", 1),
      makeNode("n2", 2),
      makeNode("n3", 3),
      makeNode("n4", 4),
      makeNode("n5", 5),
    ];
    const edges: MycoEdge[] = [
      { id: "e1", source: "n0", target: "n1", thickness: 0.2, conductivity: 0.5, age: 1, fused: false, birthOrder: 1 },
      { id: "e2", source: "n1", target: "n2", thickness: 0.2, conductivity: 0.5, age: 1, fused: false, birthOrder: 2 },
      { id: "e3", source: "n0", target: "n3", thickness: 0.2, conductivity: 0.5, age: 1, fused: false, birthOrder: 3 },
      { id: "e4", source: "n3", target: "n4", thickness: 0.2, conductivity: 0.5, age: 1, fused: false, birthOrder: 4 },
      { id: "e5", source: "n4", target: "n5", thickness: 0.2, conductivity: 0.5, age: 1, fused: false, birthOrder: 5 },
      { id: "fused", source: "n0", target: "n5", thickness: 0.2, conductivity: 0.5, age: 1, fused: true, birthOrder: 5 },
    ];
    const tips: MycoTip[] = [
      { id: "old-tip", nodeId: "n2", dx: 1, dy: 0, dz: 0, energy: 0.5 },
      { id: "new-tip", nodeId: "n5", dx: 1, dy: 0, dz: 0, energy: 0.5 },
    ];

    const cache = buildSnapshotCache(makeMsg(nodes, edges, tips), new Map(), new Map(), {
      maxNodes: 4,
      maxEdges: 5,
      maxTips: 5,
    });

    expect(cache.renderedNodes.map((node) => node.id)).toEqual(["n0", "n3", "n4", "n5"]);
    expect(cache.renderEdges.map(({ edge }) => edge.id)).toEqual(["e3", "e4", "e5", "fused"]);
    expect(cache.renderTips.map(({ tip }) => tip.id)).toEqual(["new-tip"]);
  });
});
