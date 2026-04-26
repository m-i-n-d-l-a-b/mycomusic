import type { MycoEdge, MycoNode } from "../../server/domain/mycoProtocol";
import { selectConnectivityPreservingEdges } from "./renderEdgeSelection";

function node(id: string): MycoNode {
  return {
    id,
    x: 0,
    y: 0,
    z: 0,
    radius: 0.03,
    charge: 0,
    morphology: "Balanced",
    birthOrder: 0,
  };
}

function edge(id: string, source: string, target: string, fused = false): MycoEdge {
  return {
    id,
    source,
    target,
    thickness: 0.2,
    conductivity: 0.5,
    age: 0,
    fused,
    birthOrder: Number(id.replace(/\D/g, "")) || 0,
  };
}

describe("selectConnectivityPreservingEdges", () => {
  it("prioritizes tree edges over fused edges so rendered nodes keep parent links", () => {
    const nodes = [node("n0"), node("n1"), node("n2"), node("n3")];
    const edges = [
      edge("tree-0", "n0", "n1"),
      edge("fused-0", "n1", "n2", true),
      edge("fused-1", "n2", "n3", true),
      edge("tree-1", "n1", "n2"),
      edge("tree-2", "n2", "n3"),
    ];

    const selected = selectConnectivityPreservingEdges(edges, nodes, 3);

    expect(selected.map((candidate) => candidate.id)).toEqual(["tree-0", "tree-1", "tree-2"]);
  });

  it("fills remaining budget with fused edges after tree connectivity is preserved", () => {
    const nodes = [node("n0"), node("n1"), node("n2")];
    const edges = [
      edge("tree-0", "n0", "n1"),
      edge("fused-0", "n0", "n2", true),
      edge("tree-1", "n1", "n2"),
      edge("fused-1", "n1", "n2", true),
    ];

    const selected = selectConnectivityPreservingEdges(edges, nodes, 3);

    expect(selected.map((candidate) => candidate.id)).toEqual(["tree-0", "tree-1", "fused-0"]);
  });
});
