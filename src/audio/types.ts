/** 8-band schema targeting main frequency ranges in modern music */
export interface Bands8 {
  subBass: number; // 20-60 Hz (sub-bass rumble)
  midBass: number; // 60-120 Hz (kick body)
  upperBass: number; // 120-250 Hz (bass guitar)
  lowMids: number; // 250-500 Hz (warmth)
  mids: number; // 500-1000 Hz (vocals/synth body)
  upperMids: number; // 1000-2500 Hz (presence/clarity)
  presence: number; // 2500-6000 Hz (snares/claps)
  air: number; // 6000-16000 Hz (hi-hats/cymbals)
}

/** Transient/onset pulse signals for sharp visual triggering */
export interface BandPulses {
  subBass: number;
  midBass: number;
  upperBass: number;
  lowMids: number;
  mids: number;
  upperMids: number;
  presence: number;
  air: number;
}

/** Band definition for table-driven analysis */
export interface BandDefinition {
  id: keyof Bands8;
  lowHz: number;
  highHz: number;
  /** Weight for avg vs peak: 0 = pure avg, 1 = pure peak. Transient-heavy bands use higher peak weight. */
  peakWeight: number;
}

/** 8-band crossover table for modern music */
export const BAND_DEFINITIONS: readonly BandDefinition[] = [
  { id: "subBass", lowHz: 20, highHz: 60, peakWeight: 0.2 },
  { id: "midBass", lowHz: 60, highHz: 120, peakWeight: 0.4 },
  { id: "upperBass", lowHz: 120, highHz: 250, peakWeight: 0.3 },
  { id: "lowMids", lowHz: 250, highHz: 500, peakWeight: 0.2 },
  { id: "mids", lowHz: 500, highHz: 1000, peakWeight: 0.25 },
  { id: "upperMids", lowHz: 1000, highHz: 2500, peakWeight: 0.35 },
  { id: "presence", lowHz: 2500, highHz: 6000, peakWeight: 0.5 },
  { id: "air", lowHz: 6000, highHz: 16000, peakWeight: 0.4 },
] as const;

/** Legacy 4-band contract for backward compatibility. Derived from Bands8. */
export interface FrequencyBands {
  low: number; // subBass + midBass + upperBass
  mid: number; // lowMids + mids + upperMids
  high: number; // presence
  air: number; // air
}

/** Derives legacy low/mid/high/air from 8-band energy values. Maps to original 20-500/500-4k/4k-7.5k/7.5k-20k semantics. */
export function deriveLegacyBands(bands: Bands8): FrequencyBands {
  return {
    low: (bands.subBass + bands.midBass + bands.upperBass + bands.lowMids) / 4,
    mid: (bands.mids + bands.upperMids) / 2,
    high: bands.presence,
    air: bands.air,
  };
}

/** Full reactive audio output: 8 bands, pulses, and legacy 4-band aggregate */
export interface ReactiveAudioData {
  bands: Bands8;
  pulses: BandPulses;
  frequencyData: FrequencyBands;
}

/** Shared analyser config for consistent tuning across playback and capture paths */
export const ANALYZER_CONFIG = {
  fftSize: 2048,
  smoothingTimeConstant: 0.3,
} as const;

export interface AudioEngineConfig {
  fftSize?: number;
  smoothingTimeConstant?: number;
  sampleRate?: number;
}

export interface GateConfig {
  /** Threshold level (0-1) below which signals are reduced */
  threshold: number;
  /** Ratio for signals below threshold (1.0 = no reduction, 0.0 = complete gate) */
  ratio: number;
  /** Attack time in seconds for envelope follower (how fast to respond to transients) */
  attackTime: number;
  /** Release time in seconds for envelope follower (how fast to decay) */
  releaseTime: number;
  /** Sensitivity to transients (higher = more emphasis on sudden changes) */
  transientSensitivity: number;
}
