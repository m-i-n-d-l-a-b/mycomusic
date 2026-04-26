# 3D Mycelium Visualizer Audit

Date: 2026-04-26

Scope: server-side graph generation, snapshot transport, render-side interpolation, Three.js line/node math, and test coverage for the new 3D mycelium visualizer.

## Summary

The server-side graph data remains structurally connected in deterministic stress runs, but the render path can make a connected graph look detached.

Main causes:

- The renderer draws all 640 server nodes but only the first 900 edges. Under high anastomosis, fused edges are interleaved with parent tree edges, so later nodes can render without their parent edge.
- Server `y` growth is a free random walk and the renderer scales it into scene height. This creates real vertical divergence, plus extra morphology, charge, seed, and wobble offsets.
- Electrical travel pulses do not use the same seed, charge, and morphology interpolation as the visible hypha line, so sparks can appear off the line.
- Multiple growth events can land in a single snapshot, so several neighboring lines reveal at the same time. There is no birth-order staggering.
- The pooled `Line2` render loop does not hide a line if an edge is skipped because an endpoint is missing, which can leave stale orphan geometry on malformed or partially parsed snapshots.

## Evidence

`npm run type-check` passes.

`npm test` currently fails before running the new `src/rhizosphere` suites:

- `src/rhizosphere/mycelium3dMath.test.ts`
- `src/rhizosphere/snapshotUtils.test.ts`

Both fail with `TypeError: Cannot read properties of undefined (reading 'config')` at the first `describe(...)`. The other 8 test files pass, 28 tests total.

Stress run results:

```json
{
  "balanced": {
    "nodes": 640,
    "edges": 751,
    "fused": 112,
    "hiddenParentEdgesUnderRenderCap": 0,
    "connectedNodesFromRoot": 640,
    "worldYRange": 4.79
  },
  "highAM": {
    "nodes": 640,
    "edges": 918,
    "fused": 279,
    "hiddenParentEdgesUnderRenderCap": 14,
    "connectedNodesFromRoot": 640,
    "worldYRange": 7.96
  }
}
```

The high-AM case is the important one: the graph is connected in data, but 14 rendered nodes have their parent edge hidden by the `MAX_LINE_POOL` cap.

## Findings

### P1: Renderer edge cap can hide parent links

Files:

- `src/components/rhizosphere/MyceliumGraph3D.tsx`
- `server/domain/myceliumGraph.ts`

`MyceliumGraph3D` renders all server nodes because `MAX_NODES = 800` and the server caps nodes at 640. It renders only the first 900 edges. The server can emit more than 900 edges because each new node adds one tree edge and anastomosis can add fused edges.

Because fused edges are inserted into the same `edges` array immediately after growth edges, the first 900 edges are not guaranteed to include every node's parent edge. Result: connected nodes render as detached islands.

Fix direction:

- Prefer rendering a connectivity-preserving subset: include every non-fused tree edge first, then add fused edges until the budget is exhausted.
- Or make the edge pool size derive from the protocol max: `maxNodes - 1 + maxFusedEdges`.
- Add a render invariant test: every rendered node except root has at least one rendered incident edge.

### P1: Server vertical drift is unconstrained and scaled heavily

Files:

- `server/domain/myceliumGraph.ts`
- `src/rhizosphere/mycelium3dMath.ts`

`extendTip()` inherits `tip.dy`, adds large zero-mean jitter, normalizes the 3D vector, then stores `node.y`. `toScenePoint3()` maps `point.y * WORLD_PLANE_SCALE * 0.82` into scene height, then adds morphology lift, charge lift, seed lift, and wobble.

This means the visualizer is not a mostly planar substrate with small organic lift. It is a real 3D random walk, then amplified. Stress runs produced about 8 world units of y spread.

Also, `verticalBias` is not a directional bias. It is multiplied by `(rand - 0.5)`, so AM and ECM do not consistently pull up/down.

Fix direction:

- Decide the coordinate contract:
  - Planar network: keep server `y` damped/clamped near 0 and use render-only lift for aesthetics.
  - True 3D network: rename the "plane" APIs and make the camera/ground/UX communicate that topology is volumetric.
- Add vertical damping or bounds in `extendTip()`.
- Add a long-run test that asserts max `abs(node.y)` stays inside the chosen design envelope.

### P1: Travel pulse points do not follow the rendered edge curve

Files:

- `src/rhizosphere/mycelium3dMath.ts`
- `src/components/rhizosphere/MyceliumGraph3D.tsx`

`buildEdgeLinePoints()` blends source and target node seed, charge, radius, and morphology along the edge. `travelPulsePointOnEdge()` uses only the edge seed and target-dominant morphology. Since `toScenePoint3()` uses seed, charge, morphology, and wobble to compute y, pulse spheres can be offset from the actual rendered line.

Fix direction:

- Make `travelPulsePointOnEdge()` share the same interpolation contract as `buildEdgeLinePoints()`.
- Pass source and target node seeds into pulse placement.
- Add a test that samples `buildEdgeLinePoints()` and `travelPulsePointOnEdge()` at the same `t` and asserts close distance.

### P2: Multiple growth events reveal simultaneously

Files:

- `server/domain/myceliumGraph.ts`
- `server/realtime/mycoGateway.ts`
- `src/rhizosphere/snapshotUtils.ts`

`computeGrowthEvents()` can emit more than one growth event per simulation step. The gateway caps `deltaSec` at 0.25, but that can still produce several new nodes after a stalled tick or accumulated budget. The renderer only knows "new in this snapshot", not event birth order, so all new edges reveal together.

This matches the "multiple lines generated at the same time next to each other" symptom.

Fix direction:

- Add `birthTick` or `birthOrder` to nodes/edges.
- Stagger reveal by birth order within the same snapshot.
- Or cap growth to one extension per rendered snapshot and carry the rest in a queue.

### P2: Branch directions can be nearly duplicated

File:

- `server/domain/myceliumGraph.ts`

When branching, the original tip and new branch tip share the same node. The branch direction is jittered, but there is no minimum angular separation from the main direction or from other tips on that node. High `branchProbability` can produce visually parallel, adjacent hyphae that read as duplicate lines.

Fix direction:

- Enforce a minimum angle between a branch and its parent direction.
- Track outgoing tip directions per node, or resample/rotate when the dot product is too high.
- Add a test that high branch pressure does not create duplicate near-parallel child directions from the same node.

### P2: Skipped edges can leave stale pooled line geometry

File:

- `src/components/rhizosphere/MyceliumGraph3D.tsx`

If `srcN`, `tgtN`, or the line pool entry is missing, the edge loop continues without hiding that line. Lines after `nEdges` are hidden, but skipped indices inside `nEdges` keep whatever geometry was in that pool slot from a previous frame.

Server snapshots currently validate edge endpoints in tests, but the client parser accepts `myco.snapshot` messages without schema validation. A malformed or partial snapshot can leave orphan lines visible.

Fix direction:

- Hide and zero-opacity the pool line before `continue`.
- Validate incoming snapshot shape client-side before writing to `snapshotRef`.
- Add a renderer/unit test for skipped edges.

### P3: Naming and tests still describe a plane while code is true 3D

Files:

- `src/rhizosphere/snapshotUtils.ts`
- `src/rhizosphere/mycelium3dMath.ts`
- `src/rhizosphere/mycelium3dMath.test.ts`

Names like `interpolateNodePlane()`, `WORLD_PLANE_SCALE`, and test text like "maps graph plane to world XZ" conflict with the implementation, which preserves and scales `x/y/z`. This makes the math harder to reason about and hides the intended coordinate contract.

Fix direction:

- Rename "plane" helpers to "graph" or "world" terms once the coordinate contract is decided.
- Update tests to assert the actual contract.

## Resolution To-Do List

1. Fix the render edge budget so parent tree edges are never dropped before optional fused edges.
2. Choose and enforce the coordinate contract: planar-with-lift or true volumetric 3D.
3. Make travel pulses use the exact same world-position interpolation as rendered hypha lines.
4. Add per-node or per-edge birth metadata and stagger reveals for multiple growth events in one snapshot.
5. Enforce branch angular separation to prevent duplicate parallel hyphae.
6. Hide pooled lines on skipped/invalid edges and validate client snapshots before accepting them.
7. Repair the failing `src/rhizosphere` test initialization issue.
8. Add regression tests for rendered connectivity, vertical bounds, pulse-on-line alignment, stale line hiding, and branch separation.

