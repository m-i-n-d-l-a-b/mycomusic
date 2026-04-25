import type { AudioFeatureFrame } from "../../../server/domain/mycoProtocol";
import { mapAudioToMyco } from "../../../server/domain/mycoMapping";

type FrameOverrides = Partial<Omit<AudioFeatureFrame, "bands" | "pulses" | "frequencyData">> & {
  bands?: Partial<AudioFeatureFrame["bands"]>;
  pulses?: Partial<AudioFeatureFrame["pulses"]>;
  frequencyData?: Partial<AudioFeatureFrame["frequencyData"]>;
};

function frame(overrides: FrameOverrides = {}): AudioFeatureFrame {
  return {
    type: "audio.feature",
    sessionId: "test-session",
    timestamp: 1_000,
    source: "file",
    bands: {
      subBass: 0,
      midBass: 0,
      upperBass: 0,
      lowMids: 0,
      mids: 0,
      upperMids: 0,
      presence: 0,
      air: 0,
      ...overrides.bands,
    },
    pulses: {
      subBass: 0,
      midBass: 0,
      upperBass: 0,
      lowMids: 0,
      mids: 0,
      upperMids: 0,
      presence: 0,
      air: 0,
      ...overrides.pulses,
    },
    frequencyData: {
      low: 0,
      mid: 0,
      high: 0,
      air: 0,
      ...overrides.frequencyData,
    },
  };
}

describe("mapAudioToMyco", () => {
  it("maps stronger amplitude to higher apical growth pressure", () => {
    const quiet = mapAudioToMyco(frame({ bands: { mids: 0.1 } }));
    const loud = mapAudioToMyco(
      frame({
        bands: {
          subBass: 0.8,
          midBass: 0.8,
          upperBass: 0.8,
          lowMids: 0.8,
          mids: 0.8,
          upperMids: 0.8,
          presence: 0.8,
          air: 0.8,
        },
      })
    );

    expect(loud.growthPressure).toBeGreaterThan(quiet.growthPressure);
  });

  it("classifies bass-heavy frames as ECM morphology", () => {
    const mapped = mapAudioToMyco(
      frame({
        bands: {
          subBass: 0.9,
          midBass: 0.8,
          upperBass: 0.7,
          presence: 0.1,
          air: 0.05,
        },
      })
    );

    expect(mapped.morphology).toBe("ECM");
    expect(mapped.edgeThickness).toBeGreaterThan(0.5);
  });

  it("classifies treble-heavy frames as AM morphology", () => {
    const mapped = mapAudioToMyco(
      frame({
        bands: {
          subBass: 0.05,
          midBass: 0.1,
          upperBass: 0.1,
          presence: 0.9,
          air: 0.8,
        },
      })
    );

    expect(mapped.morphology).toBe("AM");
    expect(mapped.branchProbability).toBeGreaterThan(0.3);
  });

  it("clamps transient spike voltage into biological telemetry range", () => {
    const mapped = mapAudioToMyco(
      frame({
        pulses: {
          subBass: 1,
          midBass: 1,
          upperBass: 1,
          lowMids: 1,
          mids: 1,
          upperMids: 1,
          presence: 1,
          air: 1,
        },
      })
    );

    expect(mapped.bioVoltageMv).toBeGreaterThanOrEqual(0.3);
    expect(mapped.bioVoltageMv).toBeLessThanOrEqual(2.1);
  });

  it("uses sustained low-flux mid-band energy as a harmony proxy", () => {
    const previous = frame({
      bands: { lowMids: 0.6, mids: 0.7, upperMids: 0.6, presence: 0.2 },
    });
    const current = frame({
      bands: { lowMids: 0.62, mids: 0.69, upperMids: 0.61, presence: 0.2 },
    });

    const mapped = mapAudioToMyco(current, previous);

    expect(mapped.harmony).toBeGreaterThan(0.6);
    expect(mapped.symbioticState).toBe("Nutrient Transfer");
  });
});
