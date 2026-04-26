import { z } from "zod";

export const BAND_KEYS = [
  "subBass",
  "midBass",
  "upperBass",
  "lowMids",
  "mids",
  "upperMids",
  "presence",
  "air",
] as const;

export const LEGACY_BAND_KEYS = ["low", "mid", "high", "air"] as const;

export type BandKey = (typeof BAND_KEYS)[number];
export type LegacyBandKey = (typeof LEGACY_BAND_KEYS)[number];
export type AudioSourceKind = "file" | "system" | "input";
export type Morphology = "ECM" | "AM" | "Balanced";
export type SymbioticState = "Resource Hoarding" | "Nutrient Transfer";
export type TopologyLabel = "Dendritic Tree" | "Complex Graph";

export type Bands8 = Record<BandKey, number>;
export type BandPulses = Record<BandKey, number>;
export type FrequencyBands = Record<LegacyBandKey, number>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const normalizedNumber = z.number().finite().transform(clamp01);

function createBandSchema<T extends readonly string[]>(keys: T) {
  return z.object(
    Object.fromEntries(keys.map((key) => [key, normalizedNumber])) as Record<
      T[number],
      typeof normalizedNumber
    >
  );
}

export const bands8Schema = createBandSchema(BAND_KEYS);
export const bandPulsesSchema = createBandSchema(BAND_KEYS);
export const frequencyBandsSchema = createBandSchema(LEGACY_BAND_KEYS);

export const audioFeatureFrameSchema = z.object({
  type: z.literal("audio.feature"),
  sessionId: z.string().trim().min(1).max(128),
  timestamp: z.number().finite().nonnegative(),
  source: z.enum(["file", "system", "input"]).optional(),
  bands: bands8Schema,
  pulses: bandPulsesSchema,
  frequencyData: frequencyBandsSchema.optional(),
});

export type AudioFeatureFrame = z.infer<typeof audioFeatureFrameSchema>;

export interface MycoNode {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  charge: number;
  morphology: Morphology;
  birthOrder: number;
}

export interface MycoEdge {
  id: string;
  source: string;
  target: string;
  thickness: number;
  conductivity: number;
  age: number;
  fused: boolean;
  birthOrder: number;
}

export interface MycoTip {
  id: string;
  nodeId: string;
  dx: number;
  dy: number;
  dz: number;
  energy: number;
}

export interface MycoTelemetry {
  bioVoltageMv: number;
  topologyIndex: number;
  topologyLabel: TopologyLabel;
  symbioticState: SymbioticState;
  morphology: Morphology;
  growthRate: number;
  anastomosisRate: number;
}

export interface MycoSnapshotPayload {
  nodes: MycoNode[];
  edges: MycoEdge[];
  tips: MycoTip[];
  telemetry: MycoTelemetry;
  debug: {
    tick: number;
    droppedFrames: number;
    inputAgeMs: number;
    connectedClients: number;
  };
}

export interface MycoReadyMessage {
  type: "myco.ready";
  sessionId: string;
  capabilities: {
    maxFeatureFps: number;
    snapshotFps: number;
    backendOwnsSimulation: true;
  };
}

export interface MycoSnapshotMessage extends MycoSnapshotPayload {
  type: "myco.snapshot";
  sessionId: string;
  timestamp: number;
}

export interface MycoTelemetryMessage {
  type: "myco.telemetry";
  sessionId: string;
  timestamp: number;
  telemetry: MycoTelemetry;
}

export interface MycoErrorMessage {
  type: "myco.error";
  code: "VALIDATION_ERROR" | "RATE_LIMITED" | "INTERNAL_ERROR";
  message: string;
}

export type MycoClientMessage = AudioFeatureFrame;
export type MycoServerMessage =
  | MycoReadyMessage
  | MycoSnapshotMessage
  | MycoTelemetryMessage
  | MycoErrorMessage;

export type ParseClientMessageResult =
  | { success: true; message: MycoClientMessage }
  | { success: false; error: string };

export type ParseServerMessageResult =
  | { success: true; message: MycoServerMessage }
  | { success: false; error: string };

const morphologySchema = z.enum(["ECM", "AM", "Balanced"]);
const symbioticStateSchema = z.enum(["Resource Hoarding", "Nutrient Transfer"]);
const topologyLabelSchema = z.enum(["Dendritic Tree", "Complex Graph"]);

const mycoNodeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  radius: z.number().finite().nonnegative(),
  charge: z.number().finite(),
  morphology: morphologySchema,
  birthOrder: z.number().int().nonnegative(),
});

const mycoEdgeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  source: z.string().trim().min(1).max(128),
  target: z.string().trim().min(1).max(128),
  thickness: z.number().finite(),
  conductivity: z.number().finite(),
  age: z.number().finite().nonnegative(),
  fused: z.boolean(),
  birthOrder: z.number().int().nonnegative(),
});

const mycoTipSchema = z.object({
  id: z.string().trim().min(1).max(128),
  nodeId: z.string().trim().min(1).max(128),
  dx: z.number().finite(),
  dy: z.number().finite(),
  dz: z.number().finite(),
  energy: z.number().finite(),
});

const mycoTelemetrySchema = z.object({
  bioVoltageMv: z.number().finite(),
  topologyIndex: z.number().finite(),
  topologyLabel: topologyLabelSchema,
  symbioticState: symbioticStateSchema,
  morphology: morphologySchema,
  growthRate: z.number().finite(),
  anastomosisRate: z.number().finite(),
});

const mycoSnapshotDebugSchema = z.object({
  tick: z.number().int().nonnegative(),
  droppedFrames: z.number().int().nonnegative(),
  inputAgeMs: z.number().finite().nonnegative(),
  connectedClients: z.number().int().nonnegative(),
});

const mycoReadyMessageSchema = z.object({
  type: z.literal("myco.ready"),
  sessionId: z.string().trim().min(1).max(128),
  capabilities: z.object({
    maxFeatureFps: z.number().finite().positive(),
    snapshotFps: z.number().finite().positive(),
    backendOwnsSimulation: z.literal(true),
  }),
});

const mycoSnapshotMessageSchema = z.object({
  type: z.literal("myco.snapshot"),
  sessionId: z.string().trim().min(1).max(128),
  timestamp: z.number().finite().nonnegative(),
  nodes: z.array(mycoNodeSchema),
  edges: z.array(mycoEdgeSchema),
  tips: z.array(mycoTipSchema),
  telemetry: mycoTelemetrySchema,
  debug: mycoSnapshotDebugSchema,
});

const mycoTelemetryMessageSchema = z.object({
  type: z.literal("myco.telemetry"),
  sessionId: z.string().trim().min(1).max(128),
  timestamp: z.number().finite().nonnegative(),
  telemetry: mycoTelemetrySchema,
});

const mycoErrorMessageSchema = z.object({
  type: z.literal("myco.error"),
  code: z.enum(["VALIDATION_ERROR", "RATE_LIMITED", "INTERNAL_ERROR"]),
  message: z.string(),
});

const mycoServerMessageSchema = z.discriminatedUnion("type", [
  mycoReadyMessageSchema,
  mycoSnapshotMessageSchema,
  mycoTelemetryMessageSchema,
  mycoErrorMessageSchema,
]);

function findSnapshotReferenceError(snapshot: MycoSnapshotMessage): string | null {
  const nodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (nodeIds.has(node.id)) {
      return `Duplicate node id: ${node.id}`;
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of snapshot.edges) {
    if (edgeIds.has(edge.id)) {
      return `Duplicate edge id: ${edge.id}`;
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      return `Edge ${edge.id} references missing source node ${edge.source}`;
    }
    if (!nodeIds.has(edge.target)) {
      return `Edge ${edge.id} references missing target node ${edge.target}`;
    }
  }

  const tipIds = new Set<string>();
  for (const tip of snapshot.tips) {
    if (tipIds.has(tip.id)) {
      return `Duplicate tip id: ${tip.id}`;
    }
    tipIds.add(tip.id);
    if (!nodeIds.has(tip.nodeId)) {
      return `Tip ${tip.id} references missing node ${tip.nodeId}`;
    }
  }

  return null;
}

export function parseClientMessage(input: unknown): ParseClientMessageResult {
  const parsed = audioFeatureFrameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  return { success: true, message: parsed.data };
}

export function parseServerMessage(input: unknown): ParseServerMessageResult {
  const parsed = mycoServerMessageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  const message = parsed.data as MycoServerMessage;
  if (message.type === "myco.snapshot") {
    const referenceError = findSnapshotReferenceError(message);
    if (referenceError) {
      return { success: false, error: referenceError };
    }
  }

  return { success: true, message };
}

export function serializeServerMessage(message: MycoServerMessage): string {
  return JSON.stringify(message);
}
