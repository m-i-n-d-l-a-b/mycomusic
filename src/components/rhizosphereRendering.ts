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

const EDGE_REVEAL_SECONDS = 1.8;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

  return {
    overallEnergy,
    bassEnergy,
    midEnergy,
    trebleEnergy,
    pulse,
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
