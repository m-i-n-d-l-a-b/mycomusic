import { useEffect, useRef, type MutableRefObject } from "react";
import type { BandPulses, Bands8 } from "../audio/types";
import { useAudioStore } from "../store/audioStore";
import type { Morphology, MycoEdge, MycoNode, MycoSnapshotMessage, MycoTip } from "../../server/domain/mycoProtocol";
import {
  type ReactiveVisualState,
  computeEdgeReveal,
  computeTravelPulse,
  deriveReactiveVisualState,
} from "./rhizosphereRendering";

interface RhizosphereCanvasProps {
  /** High-frequency mycelium graph; read in rAF without React re-renders. */
  snapshotRef: MutableRefObject<MycoSnapshotMessage | null>;
}

interface Viewport {
  width: number;
  height: number;
}

interface SnapshotRenderCache {
  snapshot: MycoSnapshotMessage;
  nodesById: Map<string, MycoNode>;
  tipsById: Map<string, MycoTip>;
  nodeSeeds: Map<string, number>;
  edgeSeeds: Map<string, number>;
}

interface SnapshotTransition {
  from: SnapshotRenderCache | null;
  to: SnapshotRenderCache;
  startTime: number;
  durationMs: number;
}

interface AudioRenderSnapshot {
  bands: Bands8;
  pulses: BandPulses;
  isActive: boolean;
}

const VIEWPORT_PROJECTION_SCALE = 2.3;
const MAX_CANVAS_DPR = 2;
const SNAPSHOT_FPS = 12;
const MAX_SNAPSHOT_INTERPOLATION_MS = 150;
const FRAME_BUDGET_MS = 20;
const BAD_FRAMES_FOR_LOW_QUALITY = 3;
const GOOD_FRAMES_FOR_HIGH_QUALITY = 60;
const CHARGE_DYNAMIC_THRESHOLD = 0.04;
const TRAVEL_PULSE_MIN = 0.025;

interface RenderPoint {
  x: number;
  y: number;
}

function readAudioRenderSnapshot(): AudioRenderSnapshot {
  const state = useAudioStore.getState();
  return {
    bands: state.bands,
    pulses: state.pulses,
    isActive: state.isPlaying || state.captureSource !== null,
  };
}

function projectPoint(node: Pick<MycoNode, "x" | "y">, viewport: Viewport): RenderPoint {
  const scale = Math.min(viewport.width, viewport.height, 900) * VIEWPORT_PROJECTION_SCALE;
  return {
    x: viewport.width / 2 + node.x * scale,
    y: viewport.height / 2 + node.y * scale,
  };
}

function projectInterpolatedPoint(
  node: MycoNode,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport
): RenderPoint {
  if (!(previousCache && progress < 1)) return projectPoint(node, viewport);

  const from = findNodeInterpolationOrigin(node, cache, previousCache, new Set<string>());
  const easedProgress = easeSnapshotProgress(progress);

  return projectPoint(
    {
      x: from.x + (node.x - from.x) * easedProgress,
      y: from.y + (node.y - from.y) * easedProgress,
    },
    viewport
  );
}

function easeSnapshotProgress(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

function findNodeInterpolationOrigin(
  node: MycoNode,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache,
  seen: Set<string>
): Pick<MycoNode, "x" | "y"> {
  const previousNode = previousCache.nodesById.get(node.id);
  if (previousNode) return previousNode;

  if (seen.has(node.id)) return node;
  seen.add(node.id);

  const incomingEdge = cache.snapshot.edges.find((edge) => edge.target === node.id);
  const source = incomingEdge ? cache.nodesById.get(incomingEdge.source) : null;
  if (!source) return node;

  return findNodeInterpolationOrigin(source, cache, previousCache, seen);
}

function interpolateAngle(from: number, to: number, progress: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * easeSnapshotProgress(progress);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) / 2_147_483_647;
}

/** Quadratic control point for a hyphal Bezier, shared by full edge draw and travel-only overlay. */
function hyphalQuadraticControl(
  sourcePoint: { x: number; y: number },
  targetPoint: { x: number; y: number },
  seed: number,
  time: number,
  reducedMotion: boolean
): { controlX: number; controlY: number } {
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const sway = reducedMotion ? 0 : Math.sin(time * 0.0012 + seed * 12) * 0.5 + 0.5;
  const curvature = (0.08 + seed * 0.18 + sway * 0.12) * Math.min(distance, 180);
  return {
    controlX: sourcePoint.x + dx * 0.52 + normalX * curvature * (seed > 0.5 ? 1 : -1),
    controlY: sourcePoint.y + dy * 0.52 + normalY * curvature * (seed > 0.5 ? 1 : -1),
  };
}

function drawNodeChargeHalo(
  context: CanvasRenderingContext2D,
  node: MycoNode,
  point: { x: number; y: number },
  seed: number,
  time: number,
  voltageIntensity: number,
  reveal: number,
  reducedMotion: boolean,
  shadowScale: number
) {
  const pulse = reducedMotion ? 0.5 : Math.sin(time * 0.004 + seed * 10) * 0.5 + 0.5;
  const radius = Math.max(1.35, node.radius * 120) * (0.45 + reveal * 0.55);
  const chargeRadius = radius + node.charge * (8 + voltageIntensity * 14) + pulse * voltageIntensity * 4;
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, chargeRadius, 0, Math.PI * 2);
  context.fillStyle = `rgba(92, 231, 255, ${(node.charge * 0.12 + voltageIntensity * 0.09) * reveal})`;
  context.shadowColor = "rgba(92, 231, 255, 0.58)";
  context.shadowBlur = 22 * Math.max(node.charge, voltageIntensity) * shadowScale;
  context.fill();
  context.restore();
}

function drawTravelPulseStroke(
  context: CanvasRenderingContext2D,
  sourcePoint: { x: number; y: number },
  targetPoint: { x: number; y: number },
  controlX: number,
  controlY: number,
  seed: number,
  time: number,
  reducedMotion: boolean,
  travelPulse: number,
  lineWidth: number,
  reveal: number,
  shadowScale: number
) {
  if (travelPulse <= TRAVEL_PULSE_MIN || reveal <= 0.35) return;
  const head = reducedMotion ? 0.62 : (time * 0.0014 + seed) % 1;
  const tail = Math.max(0, head - 0.09);
  context.save();
  context.beginPath();
  for (let index = 0; index <= 5; index += 1) {
    const t = tail + (head - tail) * (index / 5);
    const oneMinusT = 1 - t;
    const x =
      oneMinusT * oneMinusT * sourcePoint.x + 2 * oneMinusT * t * controlX + t * t * targetPoint.x;
    const y =
      oneMinusT * oneMinusT * sourcePoint.y + 2 * oneMinusT * t * controlY + t * t * targetPoint.y;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.lineCap = "round";
  context.strokeStyle = `rgba(212, 255, 248, ${0.16 + travelPulse * 0.58})`;
  context.lineWidth = lineWidth + 0.8 + travelPulse * 2.2;
  context.shadowColor = "rgba(92, 231, 255, 0.84)";
  context.shadowBlur = (10 + travelPulse * 22) * shadowScale;
  context.stroke();
  context.restore();
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

/** EMA toward live audio for background rings/glow — transient spores keep using raw `deriveReactiveVisualState`. */
interface BackgroundFieldSmooth {
  bass: number;
  treble: number;
  substrate: number;
}

const BACKGROUND_FIELD_ATTACK = 0.052;
const BACKGROUND_FIELD_RELEASE = 0.91;
const BACKGROUND_FIELD_TAIL_EPS = 0.014;

function stepBackgroundFieldSmooth(
  s: BackgroundFieldSmooth,
  raw: ReactiveVisualState
): { show: boolean; forField: ReactiveVisualState } {
  if (!raw.isSilent) {
    const k = BACKGROUND_FIELD_ATTACK;
    s.bass += (raw.bassEnergy - s.bass) * k;
    s.treble += (raw.trebleEnergy - s.treble) * k;
    s.substrate += (raw.substrateBreath - s.substrate) * k;
  } else {
    s.bass *= BACKGROUND_FIELD_RELEASE;
    s.treble *= BACKGROUND_FIELD_RELEASE;
    s.substrate *= BACKGROUND_FIELD_RELEASE;
  }

  const tail = s.bass + s.treble + s.substrate;
  const show = !raw.isSilent || tail > BACKGROUND_FIELD_TAIL_EPS;
  return {
    show,
    forField: {
      ...raw,
      bassEnergy: s.bass,
      trebleEnergy: s.treble,
      substrateBreath: s.substrate,
      isSilent: false,
    },
  };
}

function drawReactiveAudioField(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  reactive: ReactiveVisualState,
  time: number,
  reducedMotion: boolean
) {
  if (reactive.isSilent) return;

  const { width, height } = viewport;
  const centerDrift = reducedMotion ? 0 : Math.sin(time * 0.00016) * width * 0.032;
  const centerX = width / 2 + centerDrift;
  const centerY = height / 2 + (reducedMotion ? 0 : Math.cos(time * 0.00013) * height * 0.025);
  const radius = Math.max(width, height) * (0.28 + reactive.substrateBreath * 0.13);
  const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

  glow.addColorStop(0, `rgba(126, 255, 194, ${0.05 + reactive.substrateBreath * 0.11})`);
  glow.addColorStop(0.42, `rgba(92, 231, 255, ${reactive.trebleEnergy * 0.045})`);
  glow.addColorStop(1, "rgba(2, 6, 5, 0)");

  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const ringCount = 3;
  for (let index = 0; index < ringCount; index += 1) {
    const ringPhase = reducedMotion ? 0 : (time * 0.000095 + index * 0.23) % 1;
    const ringRadius = radius * (0.36 + index * 0.18 + ringPhase * 0.09);
    context.beginPath();
    context.ellipse(centerX, centerY, ringRadius * 1.35, ringRadius * 0.48, -0.18, 0, Math.PI * 2);
    context.strokeStyle = `rgba(168, 255, 224, ${0.026 + reactive.bassEnergy * 0.028})`;
    context.lineWidth = 0.72 + reactive.substrateBreath * 0.95;
    context.stroke();
  }

  context.restore();
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

interface HyphalDrawOptions {
  omitTravelPulse?: boolean;
  shadowScale?: number;
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
  voltageIntensity: number,
  revealProgress: number,
  reducedMotion: boolean,
  options?: HyphalDrawOptions
) {
  const shadowScale = options?.shadowScale ?? 1;
  const { controlX, controlY } = hyphalQuadraticControl(
    sourcePoint,
    targetPoint,
    seed,
    time,
    reducedMotion
  );
  const morphology = target.morphology === "Balanced" ? source.morphology : target.morphology;
  const fusedBoost = edge.fused ? 0.28 + anastomosisRate * 0.36 : 0;
  const reveal = computeEdgeReveal(edge.age, revealProgress);
  const baseAlpha = Math.min(0.82, 0.26 + edge.conductivity * 0.26 + fusedBoost) * reveal;
  const lineWidth = Math.max(
    morphology === "AM" ? 0.55 : 0.9,
    edge.thickness * (morphology === "ECM" ? 12 : morphology === "AM" ? 5.5 : 8)
  ) * (0.32 + reveal * 0.68);
  const travelPulse = computeTravelPulse({
    conductivity: edge.conductivity,
    edgeSeed: seed,
    reducedMotion,
    timeMs: time,
    voltageIntensity,
  });

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (edge.fused || anastomosisRate > 0.5) {
    context.beginPath();
    context.moveTo(sourcePoint.x, sourcePoint.y);
    context.quadraticCurveTo(controlX, controlY, targetPoint.x, targetPoint.y);
    context.strokeStyle = `rgba(126, 255, 218, ${(0.12 + fusedBoost * 0.5) * reveal})`;
    context.lineWidth = lineWidth + 7 * Math.max(anastomosisRate, edge.fused ? 0.75 : 0);
    context.shadowColor = "rgba(92, 231, 255, 0.5)";
    context.shadowBlur = 18 * shadowScale;
    context.stroke();
  }

  context.beginPath();
  context.moveTo(sourcePoint.x, sourcePoint.y);
  context.quadraticCurveTo(controlX, controlY, targetPoint.x, targetPoint.y);
  context.strokeStyle = morphologyStroke(morphology, baseAlpha);
  context.lineWidth = lineWidth;
  context.shadowColor = edge.fused ? "rgba(126, 255, 218, 0.72)" : "rgba(126, 255, 194, 0.16)";
  context.shadowBlur = (edge.fused ? 16 : 5) * shadowScale;
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

  if (!options?.omitTravelPulse && travelPulse > TRAVEL_PULSE_MIN && reveal > 0.35) {
    drawTravelPulseStroke(
      context,
      sourcePoint,
      targetPoint,
      controlX,
      controlY,
      seed,
      time,
      reducedMotion,
      travelPulse,
      lineWidth,
      reveal,
      shadowScale
    );
  }

  context.restore();
}

interface NodeDrawOptions {
  omitChargeGlow?: boolean;
  shadowScale?: number;
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: MycoNode,
  point: { x: number; y: number },
  seed: number,
  time: number,
  voltageIntensity: number,
  reveal: number,
  reducedMotion: boolean,
  options?: NodeDrawOptions
) {
  const shadowScale = options?.shadowScale ?? 1;
  const pulse = reducedMotion ? 0.5 : Math.sin(time * 0.004 + seed * 10) * 0.5 + 0.5;
  const radius = Math.max(1.35, node.radius * 120) * (0.45 + reveal * 0.55);
  const chargeRadius = radius + node.charge * (8 + voltageIntensity * 14) + pulse * voltageIntensity * 4;

  context.save();
  if (!options?.omitChargeGlow) {
    context.beginPath();
    context.arc(point.x, point.y, chargeRadius, 0, Math.PI * 2);
    context.fillStyle = `rgba(92, 231, 255, ${(node.charge * 0.12 + voltageIntensity * 0.09) * reveal})`;
    context.shadowColor = "rgba(92, 231, 255, 0.58)";
    context.shadowBlur = 22 * Math.max(node.charge, voltageIntensity) * shadowScale;
    context.fill();
  }

  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = morphologyFill(node.morphology, (0.34 + node.charge * 0.44) * reveal);
  context.shadowColor = morphologyStroke(node.morphology, 0.52);
  context.shadowBlur = (node.morphology === "ECM" ? 8 : 14) * shadowScale;
  context.fill();

  if (node.morphology === "ECM") {
    context.beginPath();
    context.arc(point.x, point.y, radius * 1.8, 0, Math.PI * 2);
    context.strokeStyle = `rgba(215, 155, 98, ${0.16 * reveal})`;
    context.lineWidth = Math.max(0.6, radius * 0.35);
    context.stroke();
  }

  context.restore();
}

function hyphalMainLineWidth(edge: MycoEdge, source: MycoNode, target: MycoNode, revealProgress: number): number {
  const morphology = target.morphology === "Balanced" ? source.morphology : target.morphology;
  const reveal = computeEdgeReveal(edge.age, revealProgress);
  return (
    Math.max(
      morphology === "AM" ? 0.55 : 0.9,
      edge.thickness * (morphology === "ECM" ? 12 : morphology === "AM" ? 5.5 : 8)
    ) * (0.32 + reveal * 0.68)
  );
}

function drawGraphStaticLayer(
  context: CanvasRenderingContext2D,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport,
  time: number,
  reducedMotion: boolean,
  shadowScale: number
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
      projectInterpolatedPoint(source, cache, previousCache, progress, viewport),
      projectInterpolatedPoint(target, cache, previousCache, progress, viewport),
      edgeSeeds.get(edge.id) ?? 0,
      time,
      anastomosisRate,
      voltageIntensity,
      previousCache?.edgeSeeds.has(edge.id) ? progress : 0,
      reducedMotion,
      { omitTravelPulse: true, shadowScale }
    );
  }
  for (const node of snapshot.nodes) {
    drawNode(
      context,
      node,
      projectInterpolatedPoint(node, cache, previousCache, progress, viewport),
      nodeSeeds.get(node.id) ?? 0,
      time,
      voltageIntensity,
      previousCache && !previousCache.nodesById.has(node.id) ? progress : 1,
      reducedMotion,
      { omitChargeGlow: true, shadowScale }
    );
  }
}

function drawSnapshotDynamicOverlay(
  context: CanvasRenderingContext2D,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport,
  time: number,
  reducedMotion: boolean,
  shadowScale: number
) {
  const { snapshot, nodesById, nodeSeeds, edgeSeeds } = cache;
  const voltageIntensity = Math.min(1, snapshot.telemetry.bioVoltageMv / 2.1);

  for (const edge of snapshot.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!(source && target)) continue;
    const sourcePoint = projectInterpolatedPoint(source, cache, previousCache, progress, viewport);
    const targetPoint = projectInterpolatedPoint(target, cache, previousCache, progress, viewport);
    const seed = edgeSeeds.get(edge.id) ?? 0;
    const revealProgress = previousCache?.edgeSeeds.has(edge.id) ? progress : 0;
    const lineWidth = hyphalMainLineWidth(edge, source, target, revealProgress);
    const travelPulse = computeTravelPulse({
      conductivity: edge.conductivity,
      edgeSeed: seed,
      reducedMotion,
      timeMs: time,
      voltageIntensity,
    });
    const reveal = computeEdgeReveal(edge.age, revealProgress);
    const { controlX, controlY } = hyphalQuadraticControl(
      sourcePoint,
      targetPoint,
      seed,
      time,
      reducedMotion
    );
    if (travelPulse > TRAVEL_PULSE_MIN && reveal > 0.35) {
      drawTravelPulseStroke(
        context,
        sourcePoint,
        targetPoint,
        controlX,
        controlY,
        seed,
        time,
        reducedMotion,
        travelPulse,
        lineWidth,
        reveal,
        shadowScale
      );
    }
  }

  for (const node of snapshot.nodes) {
    if (node.charge > CHARGE_DYNAMIC_THRESHOLD) {
      const point = projectInterpolatedPoint(node, cache, previousCache, progress, viewport);
      const r = previousCache && !previousCache.nodesById.has(node.id) ? progress : 1;
      drawNodeChargeHalo(
        context,
        node,
        point,
        nodeSeeds.get(node.id) ?? 0,
        time,
        voltageIntensity,
        r,
        reducedMotion,
        shadowScale
      );
    }
  }

  for (const tip of snapshot.tips) {
    drawTip(context, tip, cache, previousCache, progress, viewport, shadowScale);
  }
}

function drawTip(
  context: CanvasRenderingContext2D,
  tip: MycoTip,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport,
  shadowScale: number
) {
  const node = cache.nodesById.get(tip.nodeId);
  if (!node) return;

  const previousTip = previousCache?.tipsById.get(tip.id);
  const easedProgress = easeSnapshotProgress(progress);
  const reveal = previousTip ? 1 : easedProgress;
  const angle = previousTip ? interpolateAngle(previousTip.angle, tip.angle, progress) : tip.angle;
  const energy = previousTip ? previousTip.energy + (tip.energy - previousTip.energy) * easedProgress : tip.energy;
  const point = projectInterpolatedPoint(node, cache, previousCache, progress, viewport);
  const length = (8 + energy * 18) * (0.35 + reveal * 0.65);

  context.save();
  context.translate(point.x, point.y);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(length, 0);
  context.strokeStyle = `rgba(168, 255, 224, ${(0.24 + energy * 0.45) * reveal})`;
  context.lineWidth = (0.8 + energy * 1.3) * (0.45 + reveal * 0.55);
  context.shadowColor = "rgba(126, 255, 194, 0.5)";
  context.shadowBlur = 10 * shadowScale * reveal;
  context.stroke();
  context.restore();
}

function drawSnapshot(
  context: CanvasRenderingContext2D,
  cache: SnapshotRenderCache,
  previousCache: SnapshotRenderCache | null,
  progress: number,
  viewport: Viewport,
  time: number,
  reducedMotion: boolean,
  shadowScale = 1
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
      projectInterpolatedPoint(source, cache, previousCache, progress, viewport),
      projectInterpolatedPoint(target, cache, previousCache, progress, viewport),
      edgeSeeds.get(edge.id) ?? 0,
      time,
      anastomosisRate,
      voltageIntensity,
      previousCache?.edgeSeeds.has(edge.id) ? progress : 0,
      reducedMotion,
      { shadowScale }
    );
  }

  for (const tip of snapshot.tips) {
    drawTip(context, tip, cache, previousCache, progress, viewport, shadowScale);
  }

  for (const node of snapshot.nodes) {
    drawNode(
      context,
      node,
      projectInterpolatedPoint(node, cache, previousCache, progress, viewport),
      nodeSeeds.get(node.id) ?? 0,
      time,
      voltageIntensity,
      previousCache && !previousCache.nodesById.has(node.id) ? progress : 1,
      reducedMotion,
      { shadowScale }
    );
  }
}

function drawTransientSpores(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  reactive: ReactiveVisualState,
  time: number,
  reducedMotion: boolean
) {
  if (reactive.sparkIntensity <= 0.03) return;

  const { width, height } = viewport;
  const count = Math.round(6 + reactive.sparkIntensity * 18);
  const centerX = width / 2;
  const centerY = height / 2;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = "rgba(168, 255, 224, 0.62)";
  context.shadowBlur = 8 + reactive.sparkIntensity * 12;

  for (let index = 0; index < count; index += 1) {
    const seed = index * 19.91;
    const drift = reducedMotion ? 0 : time * 0.00045 * (index % 2 === 0 ? 1 : -1);
    const angle = seed + drift;
    const orbit = 90 + (index % 7) * 42 + reactive.trebleEnergy * 90;
    const x = centerX + Math.cos(angle) * orbit + Math.sin(seed * 0.7) * width * 0.08;
    const y = centerY + Math.sin(angle * 0.72) * orbit * 0.55 + Math.cos(seed) * height * 0.06;
    const radius = 0.8 + (index % 3) * 0.45 + reactive.sparkIntensity * 1.4;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(210, 255, 248, ${0.08 + reactive.sparkIntensity * 0.22})`;
    context.fill();
  }

  context.restore();
}

function buildSnapshotCache(
  snapshot: MycoSnapshotMessage,
  persistentNodeSeeds: Map<string, number>,
  persistentEdgeSeeds: Map<string, number>
): SnapshotRenderCache {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const tipsById = new Map(snapshot.tips.map((tip) => [tip.id, tip]));
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
  }
  return { snapshot, nodesById, tipsById, nodeSeeds, edgeSeeds };
}

function stableSnapshotKey(msg: MycoSnapshotMessage): string {
  return `${msg.sessionId}\0${msg.timestamp}`;
}

export function RhizosphereCanvas({ snapshotRef }: RhizosphereCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRenderSnapshotRef = useRef<AudioRenderSnapshot>(readAudioRenderSnapshot());
  const snapshotCacheRef = useRef<SnapshotRenderCache | null>(null);
  const snapshotTransitionRef = useRef<SnapshotTransition | null>(null);
  const lastProcessedSnapshotKeyRef = useRef<string | null>(null);
  const persistentNodeSeedsRef = useRef<Map<string, number>>(new Map());
  const persistentEdgeSeedsRef = useRef<Map<string, number>>(new Map());
  const staticBuiltForKeyRef = useRef<string | null>(null);
  const qualityRef = useRef<"high" | "low">("high");
  const frameTimeSamplesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(0);
  const badFrameStreakRef = useRef(0);
  const goodFrameStreakRef = useRef(0);
  const effectiveDprCapRef = useRef(MAX_CANVAS_DPR);

  useEffect(() => {
    return useAudioStore.subscribe((state) => {
      audioRenderSnapshotRef.current = {
        bands: state.bands,
        pulses: state.pulses,
        isActive: state.isPlaying || state.captureSource !== null,
      };
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const graphStaticCanvas = document.createElement("canvas");
    const graphStaticContext = graphStaticCanvas.getContext("2d");

    let animationFrame = 0;
    const viewport: Viewport = { width: 0, height: 0 };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const backgroundCanvas = document.createElement("canvas");
    const backgroundContext = backgroundCanvas.getContext("2d");
    const backgroundFieldSmooth: BackgroundFieldSmooth = { bass: 0, treble: 0, substrate: 0 };
    let pulseGradient: CanvasGradient | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, effectiveDprCapRef.current);
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

      graphStaticCanvas.width = Math.floor(rect.width * dpr);
      graphStaticCanvas.height = Math.floor(rect.height * dpr);
      if (graphStaticContext) {
        graphStaticContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        graphStaticContext.clearRect(0, 0, viewport.width, viewport.height);
      }
      staticBuiltForKeyRef.current = null;

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
      const frameStart = performance.now();

      if (viewport.width > 0 && viewport.height > 0) {
        const snap = snapshotRef.current;
        if (!snap) {
          lastProcessedSnapshotKeyRef.current = null;
          snapshotCacheRef.current = null;
          snapshotTransitionRef.current = null;
          staticBuiltForKeyRef.current = null;
        } else {
          const key = stableSnapshotKey(snap);
          if (key !== lastProcessedSnapshotKeyRef.current) {
            lastProcessedSnapshotKeyRef.current = key;
            const previousCache = snapshotCacheRef.current;
            const nextCache = buildSnapshotCache(
              snap,
              persistentNodeSeedsRef.current,
              persistentEdgeSeedsRef.current
            );
            const durationMs = previousCache
              ? Math.min(
                  MAX_SNAPSHOT_INTERPOLATION_MS,
                  Math.max(1_000 / SNAPSHOT_FPS, snap.timestamp - previousCache.snapshot.timestamp)
                )
              : 0;
            snapshotCacheRef.current = nextCache;
            snapshotTransitionRef.current = {
              from: previousCache,
              to: nextCache,
              startTime: performance.now(),
              durationMs,
            };
            staticBuiltForKeyRef.current = null;
          }
        }
      }

      if (viewport.width <= 0 || viewport.height <= 0) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }

      const reducedMotion = motionQuery.matches;
      const renderTime = reducedMotion ? 0 : time;
      const shadowScale = qualityRef.current === "low" ? 0.5 : 1;
      const reactiveVisualState = deriveReactiveVisualState(audioRenderSnapshotRef.current);
      const { show: showBackgroundField, forField } = stepBackgroundFieldSmooth(
        backgroundFieldSmooth,
        reactiveVisualState
      );
      drawSubstrate(context, viewport, backgroundCanvas, pulseGradient, renderTime);
      if (showBackgroundField) {
        drawReactiveAudioField(context, viewport, forField, renderTime, reducedMotion);
      }

      const currentTransition = snapshotTransitionRef.current;
      if (currentTransition) {
        const progress =
          currentTransition.durationMs <= 0
            ? 1
            : Math.min(1, (performance.now() - currentTransition.startTime) / currentTransition.durationMs);
        if (progress < 1) {
          drawSnapshot(
            context,
            currentTransition.to,
            currentTransition.from,
            progress,
            viewport,
            renderTime,
            reducedMotion,
            shadowScale
          );
        } else {
          const settledKey = stableSnapshotKey(currentTransition.to.snapshot);
          if (graphStaticContext && staticBuiltForKeyRef.current !== settledKey) {
            graphStaticContext.clearRect(0, 0, viewport.width, viewport.height);
            drawGraphStaticLayer(
              graphStaticContext,
              currentTransition.to,
              currentTransition.from,
              1,
              viewport,
              renderTime,
              reducedMotion,
              shadowScale
            );
            staticBuiltForKeyRef.current = settledKey;
          }
          if (graphStaticContext) {
            context.drawImage(graphStaticCanvas, 0, 0, viewport.width, viewport.height);
          }
          drawSnapshotDynamicOverlay(
            context,
            currentTransition.to,
            currentTransition.from,
            1,
            viewport,
            renderTime,
            reducedMotion,
            shadowScale
          );
        }
      } else {
        drawIdleSpores(context, viewport, renderTime);
      }
      drawTransientSpores(context, viewport, reactiveVisualState, renderTime, reducedMotion);

      const cost = performance.now() - frameStart;
      if (lastFrameTimeRef.current > 0) {
        const ring = frameTimeSamplesRef.current;
        ring.push(cost);
        if (ring.length > 5) {
          ring.shift();
        }
        const avg = ring.reduce((a, b) => a + b, 0) / ring.length;
        if (avg > FRAME_BUDGET_MS) {
          badFrameStreakRef.current += 1;
          goodFrameStreakRef.current = 0;
        } else {
          badFrameStreakRef.current = 0;
        }
        if (avg < 12) {
          goodFrameStreakRef.current += 1;
        } else {
          goodFrameStreakRef.current = 0;
        }
        if (badFrameStreakRef.current >= BAD_FRAMES_FOR_LOW_QUALITY && qualityRef.current === "high") {
          qualityRef.current = "low";
          effectiveDprCapRef.current = 1.25;
          staticBuiltForKeyRef.current = null;
          resize();
        } else if (
          goodFrameStreakRef.current >= GOOD_FRAMES_FOR_HIGH_QUALITY &&
          qualityRef.current === "low"
        ) {
          qualityRef.current = "high";
          effectiveDprCapRef.current = MAX_CANVAS_DPR;
          staticBuiltForKeyRef.current = null;
          resize();
        }
      }
      lastFrameTimeRef.current = time;

      animationFrame = window.requestAnimationFrame(render);
    };

    const handleDisplayChange = () => {
      resize();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    window.addEventListener("resize", handleDisplayChange);
    window.matchMedia("screen").addEventListener("change", handleDisplayChange);

    effectiveDprCapRef.current = MAX_CANVAS_DPR;
    resize();
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleDisplayChange);
      window.matchMedia("screen").removeEventListener("change", handleDisplayChange);
    };
  }, [snapshotRef]);

  return (
    <section className="rhizosphere" aria-label="Rhizosphere viewport">
      <canvas ref={canvasRef} />
    </section>
  );
}
