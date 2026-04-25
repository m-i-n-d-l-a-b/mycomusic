import { useEffect, useRef } from "react";
import type { Morphology, MycoEdge, MycoNode, MycoSnapshotMessage } from "../../server/domain/mycoProtocol";

interface RhizosphereCanvasProps {
  snapshot: MycoSnapshotMessage | null;
}

interface Viewport {
  width: number;
  height: number;
}

interface SnapshotRenderCache {
  snapshot: MycoSnapshotMessage;
  nodesById: Map<string, MycoNode>;
  nodeSeeds: Map<string, number>;
  edgeSeeds: Map<string, number>;
}

interface SnapshotTransition {
  from: SnapshotRenderCache | null;
  to: SnapshotRenderCache;
  startTime: number;
  durationMs: number;
}

const VIEWPORT_PROJECTION_SCALE = 1.15;
const MAX_CANVAS_DPR = 2;
const MAX_SNAPSHOT_INTERPOLATION_MS = 120;

function projectPoint(node: Pick<MycoNode, "x" | "y">, viewport: Viewport): { x: number; y: number } {
  const scale = Math.min(viewport.width, viewport.height, 900) * VIEWPORT_PROJECTION_SCALE;
  return {
    x: viewport.width / 2 + node.x * scale,
    y: viewport.height / 2 + node.y * scale,
  };
}

function projectInterpolatedPoint(
  node: MycoNode,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport
): { x: number; y: number } {
  if (!(previousCache && progress < 1)) return projectPoint(node, viewport);

  const previousNode = previousCache.nodesById.get(node.id);
  if (!previousNode) return projectPoint(node, viewport);

  return projectPoint(
    {
      x: previousNode.x + (node.x - previousNode.x) * progress,
      y: previousNode.y + (node.y - previousNode.y) * progress,
    },
    viewport
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) / 2_147_483_647;
}

function morphologyStroke(morphology: Morphology, alpha: number): string {
  if (morphology === "ECM") return `rgba(215, 155, 98, ${alpha})`;
  if (morphology === "AM") return `rgba(92, 231, 255, ${alpha})`;
  return `rgba(126, 255, 194, ${alpha})`;
}

function morphologyFill(morphology: Morphology, alpha: number): string {
  if (morphology === "ECM") return `rgba(235, 172, 108, ${alpha})`;
  if (morphology === "AM") return `rgba(105, 236, 255, ${alpha})`;
  return `rgba(178, 255, 218, ${alpha})`;
}

function drawStaticSubstrate(context: CanvasRenderingContext2D, viewport: Viewport) {
  const { width, height } = viewport;
  context.fillStyle = "#020605";
  context.fillRect(0, 0, width, height);

  const gradient = context.createRadialGradient(
    width / 2,
    height / 2,
    24,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72
  );
  gradient.addColorStop(0, "rgba(96, 255, 176, 0.14)");
  gradient.addColorStop(0.42, "rgba(7, 34, 24, 0.52)");
  gradient.addColorStop(1, "rgba(2, 6, 5, 0.98)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.22;
  context.strokeStyle = "rgba(157, 255, 205, 0.07)";
  context.lineWidth = 1;
  for (let x = -40; x < width + 40; x += 54) {
    context.beginPath();
    context.moveTo(x + Math.sin(x) * 4, 0);
    context.lineTo(x - 90, height);
    context.stroke();
  }
  context.restore();
}

function drawSubstrate(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  backgroundCanvas: HTMLCanvasElement,
  pulseGradient: CanvasGradient | null,
  time: number
) {
  const { width, height } = viewport;
  context.clearRect(0, 0, width, height);
  context.drawImage(backgroundCanvas, 0, 0, width, height);

  if (pulseGradient) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.035 + Math.sin(time * 0.0005) * 0.014;
    context.fillStyle = pulseGradient;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
}

function drawIdleSpores(context: CanvasRenderingContext2D, viewport: Viewport, time: number) {
  const { width, height } = viewport;
  context.save();
  context.fillStyle = "rgba(206, 255, 226, 0.64)";
  context.font = "16px system-ui";
  context.fillText("Awaiting mycelial telemetry...", 32, 52);

  for (let index = 0; index < 42; index += 1) {
    const seed = index * 13.37;
    const radius = 80 + (index % 9) * 34;
    const angle = seed + time * 0.00008 * (index % 2 === 0 ? 1 : -1);
    const x = width / 2 + Math.cos(angle) * radius + Math.sin(seed) * 42;
    const y = height / 2 + Math.sin(angle * 0.76) * radius * 0.46 + Math.cos(seed) * 36;
    const alpha = 0.12 + (index % 5) * 0.035;
    context.beginPath();
    context.arc(x, y, 1 + (index % 4) * 0.45, 0, Math.PI * 2);
    context.fillStyle = `rgba(126, 255, 194, ${alpha})`;
    context.fill();
  }
  context.restore();
}

function drawHyphalEdge(
  context: CanvasRenderingContext2D,
  edge: MycoEdge,
  source: MycoNode,
  target: MycoNode,
  sourcePoint: { x: number; y: number },
  targetPoint: { x: number; y: number },
  seed: number,
  time: number,
  anastomosisRate: number,
  reducedMotion: boolean
) {
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const sway = reducedMotion ? 0 : Math.sin(time * 0.0012 + seed * 12) * 0.5 + 0.5;
  const curvature = (0.08 + seed * 0.18 + sway * 0.12) * Math.min(distance, 180);
  const controlX = sourcePoint.x + dx * 0.52 + normalX * curvature * (seed > 0.5 ? 1 : -1);
  const controlY = sourcePoint.y + dy * 0.52 + normalY * curvature * (seed > 0.5 ? 1 : -1);
  const morphology = target.morphology === "Balanced" ? source.morphology : target.morphology;
  const fusedBoost = edge.fused ? 0.28 + anastomosisRate * 0.36 : 0;
  const baseAlpha = Math.min(0.82, 0.26 + edge.conductivity * 0.26 + fusedBoost);
  const lineWidth = Math.max(
    morphology === "AM" ? 0.55 : 0.9,
    edge.thickness * (morphology === "ECM" ? 12 : morphology === "AM" ? 5.5 : 8)
  );

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (edge.fused || anastomosisRate > 0.5) {
    context.beginPath();
    context.moveTo(sourcePoint.x, sourcePoint.y);
    context.quadraticCurveTo(controlX, controlY, targetPoint.x, targetPoint.y);
    context.strokeStyle = `rgba(126, 255, 218, ${0.12 + fusedBoost * 0.5})`;
    context.lineWidth = lineWidth + 7 * Math.max(anastomosisRate, edge.fused ? 0.75 : 0);
    context.shadowColor = "rgba(92, 231, 255, 0.5)";
    context.shadowBlur = 18;
    context.stroke();
  }

  context.beginPath();
  context.moveTo(sourcePoint.x, sourcePoint.y);
  context.quadraticCurveTo(controlX, controlY, targetPoint.x, targetPoint.y);
  context.strokeStyle = morphologyStroke(morphology, baseAlpha);
  context.lineWidth = lineWidth;
  context.shadowColor = edge.fused ? "rgba(126, 255, 218, 0.72)" : "rgba(126, 255, 194, 0.16)";
  context.shadowBlur = edge.fused ? 16 : 5;
  context.stroke();

  if (morphology === "AM") {
    context.setLineDash([1.2, 6]);
    context.beginPath();
    context.moveTo(sourcePoint.x, sourcePoint.y);
    context.quadraticCurveTo(controlX, controlY, targetPoint.x, targetPoint.y);
    context.strokeStyle = `rgba(210, 255, 248, ${0.2 + baseAlpha * 0.28})`;
    context.lineWidth = Math.max(0.4, lineWidth * 0.42);
    context.stroke();
  }

  context.restore();
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: MycoNode,
  point: { x: number; y: number },
  seed: number,
  time: number,
  voltageIntensity: number,
  reducedMotion: boolean
) {
  const pulse = reducedMotion ? 0.5 : Math.sin(time * 0.004 + seed * 10) * 0.5 + 0.5;
  const radius = Math.max(1.35, node.radius * 120);
  const chargeRadius = radius + node.charge * (8 + voltageIntensity * 14) + pulse * voltageIntensity * 4;

  context.save();
  context.beginPath();
  context.arc(point.x, point.y, chargeRadius, 0, Math.PI * 2);
  context.fillStyle = `rgba(92, 231, 255, ${node.charge * 0.12 + voltageIntensity * 0.09})`;
  context.shadowColor = "rgba(92, 231, 255, 0.58)";
  context.shadowBlur = 22 * Math.max(node.charge, voltageIntensity);
  context.fill();

  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = morphologyFill(node.morphology, 0.34 + node.charge * 0.44);
  context.shadowColor = morphologyStroke(node.morphology, 0.52);
  context.shadowBlur = node.morphology === "ECM" ? 8 : 14;
  context.fill();

  if (node.morphology === "ECM") {
    context.beginPath();
    context.arc(point.x, point.y, radius * 1.8, 0, Math.PI * 2);
    context.strokeStyle = "rgba(215, 155, 98, 0.16)";
    context.lineWidth = Math.max(0.6, radius * 0.35);
    context.stroke();
  }

  context.restore();
}

function drawSnapshot(
  context: CanvasRenderingContext2D,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport,
  time: number,
  reducedMotion: boolean
) {
  const { snapshot, nodesById, nodeSeeds, edgeSeeds } = cache;
  const voltageIntensity = Math.min(1, snapshot.telemetry.bioVoltageMv / 2.1);
  const anastomosisRate = snapshot.telemetry.anastomosisRate;

  for (const edge of snapshot.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!(source && target)) continue;
    drawHyphalEdge(
      context,
      edge,
      source,
      target,
      projectInterpolatedPoint(source, previousCache, progress, viewport),
      projectInterpolatedPoint(target, previousCache, progress, viewport),
      edgeSeeds.get(edge.id) ?? 0,
      time,
      anastomosisRate,
      reducedMotion
    );
  }

  for (const tip of snapshot.tips) {
    const node = nodesById.get(tip.nodeId);
    if (!node) continue;
    const point = projectInterpolatedPoint(node, previousCache, progress, viewport);
    const length = 8 + tip.energy * 18;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(tip.angle);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(length, 0);
    context.strokeStyle = `rgba(168, 255, 224, ${0.24 + tip.energy * 0.45})`;
    context.lineWidth = 0.8 + tip.energy * 1.3;
    context.shadowColor = "rgba(126, 255, 194, 0.5)";
    context.shadowBlur = 10;
    context.stroke();
    context.restore();
  }

  for (const node of snapshot.nodes) {
    drawNode(
      context,
      node,
      projectInterpolatedPoint(node, previousCache, progress, viewport),
      nodeSeeds.get(node.id) ?? 0,
      time,
      voltageIntensity,
      reducedMotion
    );
  }
}

export function RhizosphereCanvas({ snapshot }: RhizosphereCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotCacheRef = useRef<SnapshotRenderCache | null>(null);
  const snapshotTransitionRef = useRef<SnapshotTransition | null>(null);

  useEffect(() => {
    if (!snapshot) {
      snapshotCacheRef.current = null;
      snapshotTransitionRef.current = null;
      return;
    }

    const previousCache = snapshotCacheRef.current;
    const nextCache: SnapshotRenderCache = {
      snapshot,
      nodesById: new Map(snapshot.nodes.map((node) => [node.id, node])),
      nodeSeeds: new Map(snapshot.nodes.map((node) => [node.id, hashString(node.id)])),
      edgeSeeds: new Map(snapshot.edges.map((edge) => [edge.id, hashString(edge.id)])),
    };
    const durationMs = previousCache
      ? Math.min(
          MAX_SNAPSHOT_INTERPOLATION_MS,
          Math.max(1_000 / 30, snapshot.timestamp - previousCache.snapshot.timestamp)
        )
      : 0;

    snapshotCacheRef.current = nextCache;
    snapshotTransitionRef.current = {
      from: previousCache,
      to: nextCache,
      startTime: performance.now(),
      durationMs,
    };
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    const viewport: Viewport = { width: 0, height: 0 };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const backgroundCanvas = document.createElement("canvas");
    const backgroundContext = backgroundCanvas.getContext("2d");
    let pulseGradient: CanvasGradient | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
      viewport.width = rect.width;
      viewport.height = rect.height;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;

      backgroundCanvas.width = Math.floor(rect.width * dpr);
      backgroundCanvas.height = Math.floor(rect.height * dpr);
      if (backgroundContext) {
        backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        backgroundContext.clearRect(0, 0, viewport.width, viewport.height);
        drawStaticSubstrate(backgroundContext, viewport);
      }

      pulseGradient = context.createRadialGradient(
        viewport.width / 2,
        viewport.height / 2,
        12,
        viewport.width / 2,
        viewport.height / 2,
        Math.max(viewport.width, viewport.height) * 0.55
      );
      pulseGradient.addColorStop(0, "rgba(96, 255, 176, 1)");
      pulseGradient.addColorStop(0.45, "rgba(7, 34, 24, 0.32)");
      pulseGradient.addColorStop(1, "rgba(2, 6, 5, 0)");
    };

    const render = (time: number) => {
      const reducedMotion = motionQuery.matches;
      const renderTime = reducedMotion ? 0 : time;
      drawSubstrate(context, viewport, backgroundCanvas, pulseGradient, renderTime);

      const currentTransition = snapshotTransitionRef.current;
      if (currentTransition) {
        const progress =
          currentTransition.durationMs <= 0
            ? 1
            : Math.min(1, (performance.now() - currentTransition.startTime) / currentTransition.durationMs);
        drawSnapshot(
          context,
          currentTransition.to,
          currentTransition.from,
          progress,
          viewport,
          renderTime,
          reducedMotion
        );
      } else {
        drawIdleSpores(context, viewport, renderTime);
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <section className="rhizosphere" aria-label="Rhizosphere viewport">
      <canvas ref={canvasRef} />
    </section>
  );
}
