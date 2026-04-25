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
  radius: number;
  charge: number;
  morphology: Morphology;
}

export interface MycoEdge {
  id: string;
  source: string;
  target: string;
  thickness: number;
  conductivity: number;
  age: number;
  fused: boolean;
}

export interface MycoTip {
  id: string;
  nodeId: string;
  angle: number;
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

export function serializeServerMessage(message: MycoServerMessage): string {
  return JSON.stringify(message);
}
