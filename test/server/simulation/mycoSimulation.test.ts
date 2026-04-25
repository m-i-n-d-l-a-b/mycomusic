import { MycoSimulation } from "../../../server/simulation/mycoSimulation";
import type { AudioFeatureFrame } from "../../../server/domain/mycoProtocol";

function featureFrame(): AudioFeatureFrame {
  return {
    type: "audio.feature",
    sessionId: "stale-input-test",
    timestamp: 1_000,
    source: "file",
    bands: {
      subBass: 0.8,
      midBass: 0.8,
      upperBass: 0.7,
      lowMids: 0.4,
      mids: 0.4,
      upperMids: 0.4,
      presence: 0.2,
      air: 0.2,
    },
    pulses: {
      subBass: 1,
      midBass: 0.5,
      upperBass: 0.5,
      lowMids: 0,
      mids: 0,
      upperMids: 0,
      presence: 0,
      air: 0,
    },
    frequencyData: { low: 0.7, mid: 0.4, high: 0.2, air: 0.2 },
  };
}

describe("MycoSimulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not keep growing from stale audio input", () => {
    const simulation = new MycoSimulation({ seed: 11 });
    simulation.acceptFeature(featureFrame());

    const activeSnapshot = simulation.step(1 / 30);
    expect(activeSnapshot.nodes.length).toBeGreaterThan(1);

    vi.setSystemTime(7_000);
    const beforeStaleStep = simulation.snapshot();
    const staleSnapshot = simulation.step(1 / 30);

    expect(staleSnapshot.nodes.length).toBe(beforeStaleStep.nodes.length);
    expect(staleSnapshot.telemetry.growthRate).toBe(0);
  });
});
