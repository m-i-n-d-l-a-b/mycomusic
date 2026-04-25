import type { BandPulses, Bands8 } from "../audio/types";
import {
  computeEdgeReveal,
  computeTravelPulse,
  deriveReactiveVisualState,
} from "./rhizosphereRendering";

const emptyBands: Bands8 = {
  subBass: 0,
  midBass: 0,
  upperBass: 0,
  lowMids: 0,
  mids: 0,
  upperMids: 0,
  presence: 0,
  air: 0,
};

const emptyPulses: BandPulses = { ...emptyBands };

describe("rhizosphere rendering helpers", () => {
  it("derives stable reactive visual intensities from live audio bands", () => {
    const state = deriveReactiveVisualState({
      bands: {
        ...emptyBands,
        subBass: 0.9,
        midBass: 0.6,
        upperBass: 0.3,
        lowMids: 0.2,
        mids: 0.4,
        upperMids: 0.6,
        presence: 0.8,
        air: 1,
      },
      pulses: {
        ...emptyPulses,
        presence: 0.35,
        air: 0.85,
      },
      isActive: true,
    });

    expect(state.bassEnergy).toBeCloseTo(0.6);
    expect(state.midEnergy).toBeCloseTo(0.4);
    expect(state.trebleEnergy).toBeCloseTo(0.9);
    expect(state.pulse).toBeCloseTo(0.85);
    expect(state.substrateBreath).toBeGreaterThan(state.overallEnergy);
    expect(state.sparkIntensity).toBeGreaterThan(0.8);
    expect(state.isSilent).toBe(false);
  });

  it("keeps inactive audio visually silent even if stale bands remain in the store", () => {
    const state = deriveReactiveVisualState({
      bands: { ...emptyBands, subBass: 1, air: 1 },
      pulses: { ...emptyPulses, air: 1 },
      isActive: false,
    });

    expect(state.overallEnergy).toBe(0);
    expect(state.pulse).toBe(0);
    expect(state.sparkIntensity).toBe(0);
    expect(state.isSilent).toBe(true);
  });

  it("reveals newly created edges gradually without exceeding full opacity", () => {
    expect(computeEdgeReveal(0, 0)).toBe(0);
    expect(computeEdgeReveal(0.45, 0)).toBeCloseTo(0.25);
    expect(computeEdgeReveal(0.1, 0.75)).toBeCloseTo(0.75);
    expect(computeEdgeReveal(5, 0.25)).toBe(1);
  });

  it("computes bounded deterministic electrical travel pulses", () => {
    const quiet = computeTravelPulse({
      conductivity: 0.8,
      edgeSeed: 0.25,
      reducedMotion: false,
      timeMs: 1_200,
      voltageIntensity: 0,
    });
    const active = computeTravelPulse({
      conductivity: 0.8,
      edgeSeed: 0.25,
      reducedMotion: false,
      timeMs: 1_200,
      voltageIntensity: 0.9,
    });
    const reduced = computeTravelPulse({
      conductivity: 0.8,
      edgeSeed: 0.25,
      reducedMotion: true,
      timeMs: 1_200,
      voltageIntensity: 0.9,
    });

    expect(quiet).toBe(0);
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThanOrEqual(1);
    expect(reduced).toBeLessThan(active);
  });
});
