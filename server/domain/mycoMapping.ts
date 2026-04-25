import {
  BAND_KEYS,
  type AudioFeatureFrame,
  type Bands8,
  type Morphology,
  type SymbioticState,
} from "./mycoProtocol";

export interface MycoForces {
  amplitude: number;
  growthPressure: number;
  morphology: Morphology;
  branchProbability: number;
  edgeThickness: number;
  extensionRate: number;
  harmony: number;
  anastomosisRate: number;
  pulse: number;
  bioVoltageMv: number;
  symbioticState: SymbioticState;
  spectralFlux: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function overallEnergy(bands: Bands8): number {
  return average(BAND_KEYS.map((key) => bands[key]));
}

export function bassEnergy(bands: Bands8): number {
  return average([bands.subBass, bands.midBass, bands.upperBass]);
}

export function midEnergy(bands: Bands8): number {
  return average([bands.lowMids, bands.mids, bands.upperMids]);
}

export function trebleEnergy(bands: Bands8): number {
  return average([bands.presence, bands.air]);
}

export function overallPulse(frame: AudioFeatureFrame): number {
  return Math.max(...BAND_KEYS.map((key) => frame.pulses[key]));
}

export function spectralFlux(current: Bands8, previous?: Bands8): number {
  if (!previous) return 0;

  const positiveDelta = BAND_KEYS.reduce((sum, key) => {
    return sum + Math.max(0, current[key] - previous[key]);
  }, 0);

  return clamp(positiveDelta / BAND_KEYS.length);
}

export function harmonyProxy(current: Bands8, previous?: Bands8): number {
  const mids = midEnergy(current);
  const treble = trebleEnergy(current);
  const bass = bassEnergy(current);
  const sustainedBody = clamp(mids * 0.65 + bass * 0.2 + treble * 0.15);
  const fluxPenalty = spectralFlux(current, previous) * 1.35;
  const bandBalancePenalty = Math.abs(current.lowMids - current.upperMids) * 0.35;

  return clamp(sustainedBody + 0.35 - fluxPenalty - bandBalancePenalty);
}

export function classifyMorphology(bands: Bands8): Morphology {
  const bass = bassEnergy(bands);
  const treble = trebleEnergy(bands);

  if (bass > treble + 0.16) return "ECM";
  if (treble > bass + 0.16) return "AM";
  return "Balanced";
}

export function voltageFromPulse(pulse: number): number {
  if (pulse <= 0.02) return 0;
  return clamp(0.3 + pulse * 1.8, 0.3, 2.1);
}

export function mapAudioToMyco(
  frame: AudioFeatureFrame,
  previousFrame?: AudioFeatureFrame
): MycoForces {
  const amplitude = overallEnergy(frame.bands);
  const bass = bassEnergy(frame.bands);
  const treble = trebleEnergy(frame.bands);
  const morphology = classifyMorphology(frame.bands);
  const pulse = overallPulse(frame);
  const harmony = harmonyProxy(frame.bands, previousFrame?.bands);
  const flux = spectralFlux(frame.bands, previousFrame?.bands);
  const growthPressure = clamp(amplitude * 0.82 + pulse * 0.18);

  const ecmBias = morphology === "ECM" ? 1 : 0;
  const amBias = morphology === "AM" ? 1 : 0;
  const edgeThickness = clamp(0.24 + bass * 0.62 + ecmBias * 0.16 - amBias * 0.08);
  const branchProbability = clamp(0.08 + treble * 0.42 + amBias * 0.2 + pulse * 0.18);
  const extensionRate = clamp(0.018 + growthPressure * 0.075 + amBias * 0.018 - ecmBias * 0.012);
  const anastomosisRate = clamp(harmony * 0.85 + amplitude * 0.15);
  const symbioticState: SymbioticState =
    harmony >= 0.58 && flux < 0.22 ? "Nutrient Transfer" : "Resource Hoarding";

  return {
    amplitude,
    growthPressure,
    morphology,
    branchProbability,
    edgeThickness,
    extensionRate,
    harmony,
    anastomosisRate,
    pulse,
    bioVoltageMv: voltageFromPulse(pulse),
    symbioticState,
    spectralFlux: flux,
  };
}
