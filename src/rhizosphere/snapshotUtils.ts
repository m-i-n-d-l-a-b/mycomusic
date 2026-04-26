import type { MycoEdge, MycoNode, MycoSnapshotMessage, MycoTip } from "../../server/domain/mycoProtocol";
import { selectConnectivityPreservingEdges } from "./renderEdgeSelection";

export const SNAPSHOT_FPS = 12;
export const MAX_SNAPSHOT_INTERPOLATION_MS = 150;

export interface SnapshotRenderCache {
  snapshot: MycoSnapshotMessage;
  nodesById: Map<string, MycoNode>;
  tipsById: Map<string, MycoTip>;
  nodeSeeds: Map<string, number>;
  edgeSeeds: Map<string, number>;
  incomingSourceByTarget: Map<string, MycoNode>;
  renderedNodes: MycoNode[];
  renderEdges: CachedRenderEdge[];
  renderTips: CachedRenderTip[];
  birthOrderStagger: BirthOrderStagger;
}

export interface CachedRenderEdge {
  edge: MycoEdge;
  source: MycoNode;
  target: MycoNode;
  edgeSeed: number;
  sourceSeed: number;
  targetSeed: number;
}

export interface CachedRenderTip {
  tip: MycoTip;
  node: MycoNode;
  nodeSeed: number;
}

interface SnapshotCacheOptions {
  maxNodes?: number;
  maxEdges?: number;
  maxTips?: number;
  previousCache?: SnapshotRenderCache | null;
}

export interface GraphPosition {
  x: number;
  y: number;
  z: number;
}

export interface SnapshotTransition {
  from: SnapshotRenderCache | null;
  to: SnapshotRenderCache;
  birthOrderStagger: BirthOrderStagger;
  startTime: number;
  durationMs: number;
}

export interface BirthOrderStagger {
  rankByBirthOrder: Map<number, number>;
  count: number;
  disabled: boolean;
}

export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) / 2_147_483_647;
}

export function stableSnapshotKey(msg: MycoSnapshotMessage): string {
  return `${msg.sessionId}\0${msg.timestamp}`;
}

export function easeSnapshotProgress(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

export function findNodeInterpolationOrigin(
  node: MycoNode,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache,
  seen: Set<string>
): Pick<MycoNode, "x" | "y" | "z"> {
  const previousNode = previousCache.nodesById.get(node.id);
  if (previousNode) return previousNode;

  if (seen.has(node.id)) return node;
  seen.add(node.id);

  const source = cache.incomingSourceByTarget.get(node.id);
  if (!source) return node;

  return findNodeInterpolationOrigin(source, cache, previousCache, seen);
}

export function interpolateAngle(from: number, to: number, progress: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * easeSnapshotProgress(progress);
}

export function interpolateTipDirection(
  from: Pick<MycoTip, "dx" | "dy" | "dz">,
  to: Pick<MycoTip, "dx" | "dy" | "dz">,
  progress: number
): Pick<MycoTip, "dx" | "dy" | "dz"> {
  const t = easeSnapshotProgress(progress);
  const dx = from.dx + (to.dx - from.dx) * t;
  const dy = from.dy + (to.dy - from.dy) * t;
  const dz = from.dz + (to.dz - from.dz) * t;
  const length = Math.hypot(dx, dy, dz) || 1;
  return { dx: dx / length, dy: dy / length, dz: dz / length };
}

/** Interpolated 3D graph position during snapshot cross-fade, matching growth origin chains. */
export function interpolateNodeGraphPositionInto(
  node: MycoNode,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  out: GraphPosition
): GraphPosition {
  if (!(previousCache && progress < 1)) {
    out.x = node.x;
    out.y = node.y;
    out.z = node.z;
    return out;
  }

  const from = findNodeInterpolationOrigin(node, cache, previousCache, new Set<string>());
  const easedProgress = easeSnapshotProgress(progress);
  out.x = from.x + (node.x - from.x) * easedProgress;
  out.y = from.y + (node.y - from.y) * easedProgress;
  out.z = from.z + (node.z - from.z) * easedProgress;
  return out;
}

export function interpolateNodeGraphPosition(
  node: MycoNode,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number
): GraphPosition {
  return interpolateNodeGraphPositionInto(node, cache, previousCache, progress, { x: 0, y: 0, z: 0 });
}

function selectRenderedNodes(nodes: readonly MycoNode[], edges: readonly MycoEdge[], maxNodes: number): MycoNode[] {
  if (maxNodes <= 0) return [];
  if (nodes.length <= maxNodes) return [...nodes];

  const [root, ...rest] = nodes;
  if (!root) return [];
  if (maxNodes === 1) return [root];

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentByTarget = new Map<string, string>();
  for (const edge of edges) {
    if (!edge.fused && !parentByTarget.has(edge.target)) {
      parentByTarget.set(edge.target, edge.source);
    }
  }

  const renderedById = new Map<string, MycoNode>([[root.id, root]]);
  const newestFirst = rest.slice().sort((a, b) => b.birthOrder - a.birthOrder || b.id.localeCompare(a.id));

  for (const candidate of newestFirst) {
    const path: MycoNode[] = [];
    const seen = new Set<string>();
    let current: MycoNode | undefined = candidate;
    while (current && current.id !== root.id && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = nodesById.get(parentByTarget.get(current.id) ?? "");
    }
    if (current?.id !== root.id) continue;

    const missingCount = path.reduce((count, node) => count + (renderedById.has(node.id) ? 0 : 1), 0);
    if (renderedById.size + missingCount > maxNodes) continue;

    for (let i = path.length - 1; i >= 0; i -= 1) {
      const pathNode = path[i];
      renderedById.set(pathNode.id, pathNode);
    }
  }

  return [...renderedById.values()];
}

export function buildSnapshotCache(
  snapshot: MycoSnapshotMessage,
  persistentNodeSeeds: Map<string, number>,
  persistentEdgeSeeds: Map<string, number>,
  options: SnapshotCacheOptions = {}
): SnapshotRenderCache {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const tipsById = new Map(snapshot.tips.map((tip) => [tip.id, tip]));
  const incomingSourceByTarget = new Map<string, MycoNode>();
  const nodeSeeds = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (!persistentNodeSeeds.has(node.id)) {
      persistentNodeSeeds.set(node.id, hashString(node.id));
    }
    nodeSeeds.set(node.id, persistentNodeSeeds.get(node.id)!);
  }
  const edgeSeeds = new Map<string, number>();
  for (const edge of snapshot.edges) {
    if (!persistentEdgeSeeds.has(edge.id)) {
      persistentEdgeSeeds.set(edge.id, hashString(edge.id));
    }
    edgeSeeds.set(edge.id, persistentEdgeSeeds.get(edge.id)!);

    if (!incomingSourceByTarget.has(edge.target)) {
      const source = nodesById.get(edge.source);
      if (source) {
        incomingSourceByTarget.set(edge.target, source);
      }
    }
  }

  const renderedNodes = selectRenderedNodes(snapshot.nodes, snapshot.edges, options.maxNodes ?? snapshot.nodes.length);
  const renderedNodeIds = new Set(renderedNodes.map((node) => node.id));
  const selectedEdges = selectConnectivityPreservingEdges(
    snapshot.edges,
    renderedNodes,
    options.maxEdges ?? snapshot.edges.length
  );
  const renderEdges: CachedRenderEdge[] = [];
  for (const edge of selectedEdges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!(source && target)) continue;

    const edgeSeed = edgeSeeds.get(edge.id) ?? 0;
    renderEdges.push({
      edge,
      source,
      target,
      edgeSeed,
      sourceSeed: nodeSeeds.get(source.id) ?? edgeSeed,
      targetSeed: nodeSeeds.get(target.id) ?? edgeSeed,
    });
  }

  const renderTips: CachedRenderTip[] = [];
  for (const tip of snapshot.tips.slice(0, options.maxTips ?? snapshot.tips.length)) {
    if (!renderedNodeIds.has(tip.nodeId)) continue;
    const node = nodesById.get(tip.nodeId);
    if (!node) continue;
    renderTips.push({
      tip,
      node,
      nodeSeed: nodeSeeds.get(node.id) ?? 0,
    });
  }

  const birthOrderStagger = buildBirthOrderStaggerFromCollections(
    snapshot.nodes,
    snapshot.edges,
    options.previousCache ?? null
  );

  return {
    snapshot,
    nodesById,
    tipsById,
    nodeSeeds,
    edgeSeeds,
    incomingSourceByTarget,
    renderedNodes,
    renderEdges,
    renderTips,
    birthOrderStagger,
  };
}

function buildBirthOrderStaggerFromCollections(
  nodes: readonly MycoNode[],
  edges: readonly MycoEdge[],
  previousCache: SnapshotRenderCache | null
): BirthOrderStagger {
  if (!previousCache) {
    return { rankByBirthOrder: new Map(), count: 0, disabled: true };
  }

  const birthOrders = new Set<number>();
  for (const node of nodes) {
    if (!previousCache.nodesById.has(node.id)) {
      birthOrders.add(node.birthOrder);
    }
  }
  for (const edge of edges) {
    if (!previousCache.edgeSeeds.has(edge.id)) {
      birthOrders.add(edge.birthOrder);
    }
  }

  const sortedOrders = [...birthOrders].sort((a, b) => a - b);
  return {
    rankByBirthOrder: new Map(sortedOrders.map((birthOrder, rank) => [birthOrder, rank])),
    count: sortedOrders.length,
    disabled: false,
  };
}

export function buildBirthOrderStagger(
  nowCache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null
): BirthOrderStagger {
  return buildBirthOrderStaggerFromCollections(nowCache.snapshot.nodes, nowCache.snapshot.edges, previousCache);
}

export function revealProgressForBirthOrder(
  birthOrder: number,
  progress: number,
  stagger: BirthOrderStagger
): number {
  if (stagger.disabled) return 1;

  const rank = stagger.rankByBirthOrder.get(birthOrder);
  if (rank === undefined) return 1;
  if (stagger.count <= 1) return easeSnapshotProgress(progress);
  if (progress >= 1) return 1;

  const maxDelay = 0.55;
  const start = (rank / Math.max(1, stagger.count - 1)) * maxDelay;
  const localProgress = (progress - start) / Math.max(0.001, 1 - start);
  return easeSnapshotProgress(localProgress);
}

export function transitionDurationMs(
  nowCache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  snapshotFps: number
): number {
  if (!previousCache) return 0;
  return Math.min(
    MAX_SNAPSHOT_INTERPOLATION_MS,
    Math.max(1_000 / snapshotFps, nowCache.snapshot.timestamp - previousCache.snapshot.timestamp)
  );
}
