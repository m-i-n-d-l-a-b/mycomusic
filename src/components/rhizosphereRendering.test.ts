import type { BandPulses, Bands8 } from "../audio/types";
import {
  advanceCameraKickNudge,
  advanceKickImpact,
  computeKickFftMaxNorm,
  computeEdgeReveal,
  computeTravelPulse,
  deriveReactiveVisualState,
  KICK_FREQUENCY_HIGH_HZ,
  KICK_FREQUENCY_LOW_HZ,
  mergeKickPulseFromBassFft,
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
        upperBass: 0.55,
        presence: 0.35,
        air: 0.85,
      },
      isActive: true,
    });

    expect(state.bassEnergy).toBeCloseTo(0.6);
    expect(state.midEnergy).toBeCloseTo(0.4);
    expect(state.trebleEnergy).toBeCloseTo(0.9);
    expect(state.pulse).toBeCloseTo(0.85);
    expect(state.kickPulse).toBe(1);
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
    expect(state.kickPulse).toBe(0);
    expect(state.sparkIntensity).toBe(0);
    expect(state.isSilent).toBe(true);
  });

  it("does not turn sustained bass energy into kick glow without a transient", () => {
    const state = deriveReactiveVisualState({
      bands: { ...emptyBands, subBass: 0.9, midBass: 0.8, upperBass: 0.7 },
      pulses: emptyPulses,
      isActive: true,
    });

    expect(state.bassEnergy).toBeGreaterThan(0.7);
    expect(state.kickPulse).toBe(0);
  });

  it("does not treat lower bass pulses as kick hits", () => {
    const state = deriveReactiveVisualState({
      bands: { ...emptyBands, subBass: 0.9, midBass: 0.8, upperBass: 0.2 },
      pulses: { ...emptyPulses, subBass: 1, midBass: 1 },
      isActive: true,
    });

    expect(state.kickPulse).toBe(0);
  });

  it("reveals newly created edges gradually without exceeding full opacity", () => {
    expect(computeEdgeReveal(0, 0)).toBe(0);
    expect(computeEdgeReveal(0.45, 0)).toBeCloseTo(0.321428);
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

  it("ignores sustained bass FFT energy and treats sharp bass rises as kick hits", () => {
    const sustained = mergeKickPulseFromBassFft({
      rawKickPulse: 0,
      bassMaxNorm: 0.5,
      previousBassMaxNorm: 0.5,
    });
    const transient = mergeKickPulseFromBassFft({
      rawKickPulse: 0,
      bassMaxNorm: 0.5,
      previousBassMaxNorm: 0.35,
    });
    const rawTransient = mergeKickPulseFromBassFft({
      rawKickPulse: 0.7,
      bassMaxNorm: 0.05,
      previousBassMaxNorm: 0.05,
    });

    expect(sustained).toBe(0);
    expect(transient).toBeGreaterThan(0.85);
    expect(rawTransient).toBeCloseTo(0.7);
  });

  it(`reads kick FFT energy only from the ${KICK_FREQUENCY_LOW_HZ}-${KICK_FREQUENCY_HIGH_HZ} Hz window`, () => {
    const sampleRate = 44_100;
    const fft = new Uint8Array(new ArrayBuffer(1024));
    const binWidthHz = (sampleRate / 2) / fft.length;
    const inKickRangeBin = Math.ceil(KICK_FREQUENCY_LOW_HZ / binWidthHz);
    const belowKickRangeBin = inKickRangeBin - 1;
    const aboveKickRangeBin = Math.floor(KICK_FREQUENCY_HIGH_HZ / binWidthHz) + 1;
    fft[belowKickRangeBin] = 255;
    fft[inKickRangeBin] = 200;
    fft[aboveKickRangeBin] = 255;

    expect(computeKickFftMaxNorm(fft, sampleRate)).toBeCloseTo(200 / 255);
  });

  it("advances a visible kick impact with thresholding and decay", () => {
    const quiet = advanceKickImpact({
      previousImpact: 0,
      kickPulse: 0.18,
      deltaSeconds: 1 / 60,
      reducedMotion: false,
    });
    const hit = advanceKickImpact({
      previousImpact: 0,
      kickPulse: 0.75,
      deltaSeconds: 1 / 60,
      reducedMotion: false,
    });
    const decayed = advanceKickImpact({
      previousImpact: hit,
      kickPulse: 0,
      deltaSeconds: 0.2,
      reducedMotion: false,
    });

    expect(quiet).toBe(0);
    expect(hit).toBeGreaterThan(0.7);
    expect(decayed).toBeLessThan(hit);
    expect(decayed).toBeGreaterThan(0);
  });

  it("keeps camera kick nudge sensitive to moderate kick hits", () => {
    const sharedImpact = advanceKickImpact({
      previousImpact: 0,
      kickPulse: 0.18,
      deltaSeconds: 1 / 60,
      reducedMotion: false,
    });
    const cameraNudge = advanceCameraKickNudge({
      previousNudge: 0,
      kickPulse: 0.18,
      deltaSeconds: 1 / 60,
      reducedMotion: false,
    });
    const decayed = advanceCameraKickNudge({
      previousNudge: cameraNudge,
      kickPulse: 0,
      deltaSeconds: 0.2,
      reducedMotion: false,
    });
    const reducedMotion = advanceCameraKickNudge({
      previousNudge: cameraNudge,
      kickPulse: 1,
      deltaSeconds: 1 / 60,
      reducedMotion: true,
    });

    expect(sharedImpact).toBe(0);
    expect(cameraNudge).toBeGreaterThan(0.25);
    expect(decayed).toBeLessThan(cameraNudge);
    expect(decayed).toBeGreaterThan(0);
    expect(reducedMotion).toBe(0);
  });
});
