import { parseClientMessage } from "../../../server/domain/mycoProtocol";

describe("mycoProtocol", () => {
  it("clamps valid feature frames into normalized numeric ranges", () => {
    const parsed = parseClientMessage({
      type: "audio.feature",
      sessionId: "session-1",
      timestamp: 123,
      bands: {
        subBass: 2,
        midBass: 0.5,
        upperBass: 0.5,
        lowMids: 0.5,
        mids: 0.5,
        upperMids: 0.5,
        presence: 0.5,
        air: -1,
      },
      pulses: {
        subBass: 0,
        midBass: 0,
        upperBass: 0,
        lowMids: 0,
        mids: 0,
        upperMids: 0,
        presence: 0,
        air: 3,
      },
      frequencyData: {
        low: 0.1,
        mid: 0.2,
        high: 0.3,
        air: 4,
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.message.type === "audio.feature") {
      expect(parsed.message.bands.subBass).toBe(1);
      expect(parsed.message.bands.air).toBe(0);
      expect(parsed.message.pulses.air).toBe(1);
      expect(parsed.message.frequencyData?.air).toBe(1);
    }
  });

  it("accepts compact feature frames without legacy frequency data", () => {
    const parsed = parseClientMessage({
      type: "audio.feature",
      sessionId: "session-compact",
      timestamp: 123,
      bands: {
        subBass: 0.2,
        midBass: 0.2,
        upperBass: 0.2,
        lowMids: 0.2,
        mids: 0.2,
        upperMids: 0.2,
        presence: 0.2,
        air: 0.2,
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
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects malformed client messages", () => {
    const parsed = parseClientMessage({
      type: "audio.feature",
      sessionId: "",
      timestamp: "soon",
    });

    expect(parsed.success).toBe(false);
  });
});
