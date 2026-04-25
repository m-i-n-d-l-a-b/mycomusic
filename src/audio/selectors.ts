import type { BandPulses, Bands8, FrequencyBands } from "./types";

/**
 * Overall energy across all 8 bands. Use instead of hand-rolling (low+mid+high+air)/4.
 */
export function overallEnergy(bands: Bands8): number {
  const sum =
    bands.subBass +
    bands.midBass +
    bands.upperBass +
    bands.lowMids +
    bands.mids +
    bands.upperMids +
    bands.presence +
    bands.air;
  return sum / 8;
}

/**
 * Bass energy (sub-bass through upper bass). Use for kick/bass reactivity.
 */
export function bassEnergy(bands: Bands8): number {
  return (bands.subBass + bands.midBass + bands.upperBass) / 3;
}

/**
 * Treble energy (presence + air). Use for snares, hats, cymbals.
 */
export function trebleEnergy(bands: Bands8): number {
  return (bands.presence + bands.air) / 2;
}

/**
 * Mid energy (low-mids through upper-mids). Use for vocals, synth body.
 */
export function midEnergy(bands: Bands8): number {
  return (bands.lowMids + bands.mids + bands.upperMids) / 3;
}

/**
 * Overall pulse (max transient across all bands). Use for impact-sensitive visuals.
 */
export function overallPulse(pulses: BandPulses): number {
  return Math.max(
    pulses.subBass,
    pulses.midBass,
    pulses.upperBass,
    pulses.lowMids,
    pulses.mids,
    pulses.upperMids,
    pulses.presence,
    pulses.air
  );
}

/**
 * Bass pulse (max transient in bass bands). Use for kick hits.
 */
export function bassPulse(pulses: BandPulses): number {
  return Math.max(pulses.subBass, pulses.midBass, pulses.upperBass);
}

/**
 * Treble pulse (max transient in treble bands). Use for snare/hat hits.
 */
export function treblePulse(pulses: BandPulses): number {
  return Math.max(pulses.presence, pulses.air);
}

/**
 * Legacy overall intensity from 4-band frequencyData. Backward-compatible with
 * components that expect (low+mid+high+air)/4.
 */
export function legacyOverallIntensity(frequencyData: FrequencyBands): number {
  return (frequencyData.low + frequencyData.mid + frequencyData.high + frequencyData.air) / 4;
}
