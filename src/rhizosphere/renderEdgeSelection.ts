import type { MycoEdge, MycoNode } from "../../server/domain/mycoProtocol";

/**
 * Keeps mandatory tree connectivity visible before spending line-pool budget on optional fused edges.
 */
export function selectConnectivityPreservingEdges(
  edges: readonly MycoEdge[],
  renderedNodes: readonly MycoNode[],
  maxEdges: number
): MycoEdge[] {
  if (maxEdges <= 0) return [];

  const renderedNodeIds = new Set(renderedNodes.map((node) => node.id));
  const treeEdges: MycoEdge[] = [];
  const fusedEdges: MycoEdge[] = [];

  for (const edge of edges) {
    if (!(renderedNodeIds.has(edge.source) && renderedNodeIds.has(edge.target))) {
      continue;
    }

    if (edge.fused) {
      fusedEdges.push(edge);
    } else {
      treeEdges.push(edge);
    }
  }

  if (treeEdges.length >= maxEdges) {
    return treeEdges.slice(0, maxEdges);
  }

  return treeEdges.concat(fusedEdges.slice(0, maxEdges - treeEdges.length));
}
