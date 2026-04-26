import type { BandPulses, Bands8 } from "../audio/types";

interface ReactiveVisualInput {
  bands: Bands8;
  pulses: BandPulses;
  isActive: boolean;
}

export interface ReactiveVisualState {
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  pulse: number;
  /** Transient level in sub–upper bass; use for kick hits. */
  kickPulse: number;
  substrateBreath: number;
  sparkIntensity: number;
  isSilent: boolean;
}

interface TravelPulseInput {
  conductivity: number;
  edgeSeed: number;
  reducedMotion: boolean;
  timeMs: number;
  voltageIntensity: number;
}

interface FftKickPulseInput {
  rawKickPulse: number;
  bassMaxNorm: number;
  previousBassMaxNorm: number;
}

interface KickImpactInput {
  previousImpact: number;
  kickPulse: number;
  deltaSeconds: number;
  reducedMotion: boolean;
}

interface CameraKickNudgeInput {
  previousNudge: number;
  kickPulse: number;
  deltaSeconds: number;
  reducedMotion: boolean;
}

const EDGE_REVEAL_SECONDS = 1.4;
const KICK_TRANSIENT_FLOOR = 0.09;
export const KICK_FREQUENCY_LOW_HZ = 50;
export const KICK_FREQUENCY_HIGH_HZ = 100;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shapeKickTransient(value: number): number {
  return clamp01((value - KICK_TRANSIENT_FLOOR) * 3.6);
}

function kickBandPulse(pulses: BandPulses): number {
  return pulses.upperBass;
}

export function computeKickFftMaxNorm(frequencyData: Uint8Array, sampleRate: number): number {
  if (frequencyData.length === 0 || sampleRate <= 0) return 0;

  const binWidthHz = (sampleRate / 2) / frequencyData.length;
  const startBin = Math.max(0, Math.ceil(KICK_FREQUENCY_LOW_HZ / binWidthHz));
  const endBin = Math.min(frequencyData.length - 1, Math.floor(KICK_FREQUENCY_HIGH_HZ / binWidthHz));
  if (endBin < startBin) return 0;

  let max = 0;
  for (let i = startBin; i <= endBin; i += 1) {
    max = Math.max(max, frequencyData[i] ?? 0);
  }

  return clamp01(max / 255);
}

export function deriveReactiveVisualState({
  bands,
  pulses,
  isActive,
}: ReactiveVisualInput): ReactiveVisualState {
  if (!isActive) {
    return {
      overallEnergy: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
      pulse: 0,
      kickPulse: 0,
      substrateBreath: 0,
      sparkIntensity: 0,
      isSilent: true,
    };
  }

  const bassEnergy = average([bands.subBass, bands.midBass, bands.upperBass]);
  const midEnergy = average([bands.lowMids, bands.mids, bands.upperMids]);
  const trebleEnergy = average([bands.presence, bands.air]);
  const overallEnergy = average([
    bands.subBass,
    bands.midBass,
    bands.upperBass,
    bands.lowMids,
    bands.mids,
    bands.upperMids,
    bands.presence,
    bands.air,
  ]);
  const pulse = Math.max(
    pulses.subBass,
    pulses.midBass,
    pulses.upperBass,
    pulses.lowMids,
    pulses.mids,
    pulses.upperMids,
    pulses.presence,
    pulses.air
  );
  const sparkPulse = Math.max(pulses.presence, pulses.air);
  // Kick glow is tuned to the upper-bass punch range; raw FFT narrows it further to 50-80 Hz.
  const fromTransient = kickBandPulse(pulses);
  const kickPulse = shapeKickTransient(fromTransient);

  return {
    overallEnergy,
    bassEnergy,
    midEnergy,
    trebleEnergy,
    pulse,
    kickPulse,
    substrateBreath: clamp01(overallEnergy * 0.72 + bassEnergy * 0.42 + pulse * 0.25),
    sparkIntensity: clamp01(trebleEnergy * 0.45 + sparkPulse * 0.7),
    isSilent: overallEnergy < 0.015 && pulse < 0.03,
  };
}

export function computeEdgeReveal(ageSeconds: number, transitionProgress: number): number {
  return Math.max(clamp01(ageSeconds / EDGE_REVEAL_SECONDS), clamp01(transitionProgress));
}

export function computeTravelPulse({
  conductivity,
  edgeSeed,
  reducedMotion,
  timeMs,
  voltageIntensity,
}: TravelPulseInput): number {
  const voltage = clamp01(voltageIntensity);
  if (voltage <= 0) return 0;

  const boundedConductivity = clamp01(conductivity);
  if (reducedMotion) {
    return voltage * boundedConductivity * 0.16;
  }

  const phase = (timeMs * 0.0012 + edgeSeed * 0.73) % 1;
  const wave = Math.max(0, 1 - Math.abs(phase - 0.5) / 0.22);
  return clamp01(wave * voltage * (0.35 + boundedConductivity * 0.65));
}

export function mergeKickPulseFromBassFft({
  rawKickPulse,
  bassMaxNorm,
  previousBassMaxNorm,
}: FftKickPulseInput): number {
  const current = clamp01(bassMaxNorm);
  const previous = clamp01(previousBassMaxNorm);
  const rise = Math.max(0, current - previous);
  const fromFft = current > 0.16 && rise > 0.025 ? shapeKickTransient(rise * 7) : 0;

  return clamp01(Math.max(rawKickPulse, fromFft));
}

export function advanceKickImpact({
  previousImpact,
  kickPulse,
  deltaSeconds,
  reducedMotion,
}: KickImpactInput): number {
  const decayRate = reducedMotion ? 10 : 7;
  const decayed = clamp01(previousImpact) * Math.exp(-Math.max(0, deltaSeconds) * decayRate);
  const thresholded = clamp01((kickPulse - 0.22) / 0.78);
  const shaped = Math.pow(thresholded, 0.72) * (reducedMotion ? 0.55 : 1);

  return Math.max(decayed, shaped);
}

export function advanceCameraKickNudge({
  previousNudge,
  kickPulse,
  deltaSeconds,
  reducedMotion,
}: CameraKickNudgeInput): number {
  if (reducedMotion) return 0;

  const decayed = clamp01(previousNudge) * Math.exp(-Math.max(0, deltaSeconds) * 9);
  const thresholded = clamp01((kickPulse - 0.08) / 0.52);
  const shaped = Math.pow(thresholded, 0.65);

  return Math.max(decayed, shaped);
}
