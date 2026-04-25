import { mapAudioToMyco, type MycoForces } from "../domain/mycoMapping";
import { MyceliumGraph } from "../domain/myceliumGraph";
import type { AudioFeatureFrame, MycoSnapshotPayload } from "../domain/mycoProtocol";

interface SimulationOptions {
  seed?: number;
  staleInputMs?: number;
}

const DEFAULT_STALE_INPUT_MS = 1_500;
const IDLE_FORCES: MycoForces = {
  amplitude: 0,
  growthPressure: 0,
  morphology: "Balanced",
  branchProbability: 0,
  edgeThickness: 0.25,
  extensionRate: 0.02,
  harmony: 0,
  anastomosisRate: 0,
  pulse: 0,
  bioVoltageMv: 0,
  symbioticState: "Resource Hoarding",
  spectralFlux: 0,
};

export class MycoSimulation {
  private readonly graph: MyceliumGraph;
  private readonly staleInputMs: number;
  private latestFrame: AudioFeatureFrame | null = null;
  private previousFrame: AudioFeatureFrame | null = null;
  private lastInputAt = 0;
  private droppedFrames = 0;

  constructor(options: SimulationOptions = {}) {
    this.graph = new MyceliumGraph({ seed: options.seed });
    this.staleInputMs = options.staleInputMs ?? DEFAULT_STALE_INPUT_MS;
  }

  acceptFeature(frame: AudioFeatureFrame): void {
    this.previousFrame = this.latestFrame;
    this.latestFrame = frame;
    this.lastInputAt = Date.now();
  }

  step(deltaSec: number, connectedClients = 1): MycoSnapshotPayload {
    const frame = this.latestFrame;

    if (frame && Date.now() - this.lastInputAt <= this.staleInputMs) {
      this.graph.step(mapAudioToMyco(frame, this.previousFrame ?? undefined), deltaSec);
    } else if (frame) {
      this.graph.step(IDLE_FORCES, deltaSec);
    }

    return this.snapshot(connectedClients);
  }

  snapshot(connectedClients = 1): MycoSnapshotPayload {
    return this.graph.snapshot({
      droppedFrames: this.droppedFrames,
      inputAgeMs: this.lastInputAt > 0 ? Date.now() - this.lastInputAt : 0,
      connectedClients,
    });
  }

  noteDroppedFrame(): void {
    this.droppedFrames += 1;
  }
}
