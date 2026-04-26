import { useCallback, useEffect, useRef } from "react";
import {
  BAND_DEFINITIONS,
  type BandPulses,
  type Bands8,
  type GateConfig,
  type ReactiveAudioData,
  deriveLegacyBands,
} from "./types";

interface UseFrequencyAnalyzerOptions {
  analyserNode: AnalyserNode | null;
  sampleRate: number;
  enabled: boolean;
  onUpdate: (data: ReactiveAudioData) => void;
  gateConfig?: Partial<GateConfig>;
  gainMultiplier?: number; // Manual gain adjustment (0.1 to 3.0)
  minUpdateIntervalMs?: number;
}

const DEFAULT_GATE_CONFIG: GateConfig = {
  threshold: 0.08,
  ratio: 0.3,
  attackTime: 0.003,
  releaseTime: 0.06,
  transientSensitivity: 2.5,
};

const TARGET_PEAK = 180;
const NORM_SMOOTHING = 0.65;
const NORM_CLAMP_MIN = 0.3;
const NORM_CLAMP_MAX = 3.0;
const PEAK_HISTORY_FRAMES = 60;

const BAND_IDS = BAND_DEFINITIONS.map((b) => b.id) as (keyof Bands8)[];

interface NormalizationBandState {
  peakHistory: number[];
  peakSum: number;
  historyIndex: number;
  historyCount: number;
  factor: number;
}

function createEmptyBands8(): Bands8 {
  return {
    subBass: 0,
    midBass: 0,
    upperBass: 0,
    lowMids: 0,
    mids: 0,
    upperMids: 0,
    presence: 0,
    air: 0,
  };
}

function createEmptyPulses(): BandPulses {
  return { ...createEmptyBands8() };
}

function resetBandState(target: Record<keyof Bands8, number>): void {
  for (const id of BAND_IDS) {
    target[id] = 0;
  }
}

function resetNormalizationState(
  target: Record<keyof Bands8, NormalizationBandState>
): void {
  for (const id of BAND_IDS) {
    target[id].peakHistory.fill(0);
    target[id].peakSum = 0;
    target[id].historyIndex = 0;
    target[id].historyCount = 0;
    target[id].factor = 1.0;
  }
}

/**
 * Analyzes audio frequency data into 8 music-oriented bands with per-band
 * normalization, delta-time-aware smoothing, and transient pulse signals.
 */
export function useFrequencyAnalyzer({
  analyserNode,
  sampleRate,
  enabled,
  onUpdate,
  gateConfig = {},
  gainMultiplier = 1.0,
  minUpdateIntervalMs = 0,
}: UseFrequencyAnalyzerOptions) {
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | undefined>(undefined);
  const lastFrameTimeRef = useRef<number>(0);
  const lastUpdateAtRef = useRef<number>(0);

  const onUpdateRef = useRef(onUpdate);
  const gateConfigRef = useRef(gateConfig);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    gateConfigRef.current = gateConfig;
  }, [gateConfig]);

  type BandId = keyof Bands8;

  const envelopeStateRef = useRef<Record<BandId, number>>(
    Object.fromEntries(BAND_IDS.map((id) => [id, 0])) as Record<BandId, number>
  );
  const prevRawRef = useRef<Record<BandId, number>>(
    Object.fromEntries(BAND_IDS.map((id) => [id, 0])) as Record<BandId, number>
  );
  const normStateRef = useRef<Record<BandId, NormalizationBandState>>(
    Object.fromEntries(
      BAND_IDS.map((id) => [
        id,
        {
          peakHistory: new Array<number>(PEAK_HISTORY_FRAMES).fill(0),
          peakSum: 0,
          historyIndex: 0,
          historyCount: 0,
          factor: 1.0,
        },
      ])
    ) as Record<BandId, NormalizationBandState>
  );
  const rawRef = useRef<Record<BandId, number>>(createEmptyBands8());
  const peaksRef = useRef<Record<BandId, number>>(createEmptyBands8());
  const normalizedRef = useRef<Record<BandId, number>>(createEmptyBands8());
  const pulsesRef = useRef<BandPulses>(createEmptyPulses());
  const enhancedRef = useRef<Record<BandId, number>>(createEmptyBands8());
  const gatedRef = useRef<Bands8>(createEmptyBands8());

  const resetAnalyzerState = useCallback((): void => {
    resetNormalizationState(normStateRef.current);
    resetBandState(envelopeStateRef.current);
    resetBandState(prevRawRef.current);
    resetBandState(rawRef.current);
    resetBandState(peaksRef.current);
    resetBandState(normalizedRef.current);
    resetBandState(pulsesRef.current);
    resetBandState(enhancedRef.current);
    resetBandState(gatedRef.current);
    lastFrameTimeRef.current = 0;
    lastUpdateAtRef.current = 0;
  }, []);

  useEffect(() => {
    if (!(analyserNode && enabled)) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      resetAnalyzerState();
      if (!enabled) {
        console.log("Frequency analyzer disabled:", { analyserNode: !!analyserNode, enabled });
      }
      return;
    }

    console.log("Frequency analyzer starting:", {
      analyserNode: !!analyserNode,
      enabled,
      sampleRate,
      frequencyBinCount: analyserNode.frequencyBinCount,
    });

    const gate: GateConfig = { ...DEFAULT_GATE_CONFIG, ...gateConfigRef.current };

    const bufferLength = analyserNode.frequencyBinCount;
    const buffer = new ArrayBuffer(bufferLength);
    const dataArray = new Uint8Array(buffer);
    dataArrayRef.current = dataArray;

    const nyquist = sampleRate / 2;
    const frequencyResolution = nyquist / bufferLength;

    const binRanges = BAND_DEFINITIONS.map((def) => ({
      id: def.id,
      start: Math.floor(def.lowHz / frequencyResolution),
      end: Math.min(bufferLength - 1, Math.floor(def.highHz / frequencyResolution)),
      peakWeight: def.peakWeight,
    }));

    const applyGate = (value: number): number => {
      if (value <= gate.threshold) {
        return value * gate.ratio;
      }
      const aboveThreshold = value - gate.threshold;
      const thresholdRange = 2.2 - gate.threshold;
      return (
        gate.threshold * gate.ratio +
        (aboveThreshold / thresholdRange) * (1.5 - gate.threshold * gate.ratio)
      );
    };

    const analyze = (now: number) => {
      if (!(analyserNode && dataArrayRef.current)) return;

      const deltaSec =
        lastFrameTimeRef.current > 0 ? (now - lastFrameTimeRef.current) / 1000 : 1 / 60;
      lastFrameTimeRef.current = now;

      const attackCoeff = Math.exp(-deltaSec / gate.attackTime);
      const releaseCoeff = Math.exp(-deltaSec / gate.releaseTime);

      analyserNode.getByteFrequencyData(dataArrayRef.current);
      const arr = dataArrayRef.current;

      const raw = rawRef.current;
      const peaks = peaksRef.current;
      resetBandState(raw);
      resetBandState(peaks);

      for (const { id, start, end, peakWeight } of binRanges) {
        let sum = 0;
        let peak = 0;
        let count = 0;
        for (let i = start; i <= end && i < bufferLength; i++) {
          const v = arr[i] ?? 0;
          sum += v;
          if (v > peak) peak = v;
          count++;
        }
        peaks[id] = peak;
        const avg = count > 0 ? sum / (count * 255) : 0;
        const peakNorm = peak / 255;
        raw[id] = avg * (1 - peakWeight) + peakNorm * peakWeight;
      }

      const normState = normStateRef.current;
      const envelopeState = envelopeStateRef.current;
      const prevRaw = prevRawRef.current;

      const normalized = normalizedRef.current;
      resetBandState(normalized);
      for (const id of BAND_IDS) {
        const peak = peaks[id];
        const state = normState[id];
        if (state.historyCount < PEAK_HISTORY_FRAMES) {
          state.historyCount += 1;
        } else {
          state.peakSum -= state.peakHistory[state.historyIndex] ?? 0;
        }
        state.peakHistory[state.historyIndex] = peak;
        state.peakSum += peak;
        state.historyIndex = (state.historyIndex + 1) % PEAK_HISTORY_FRAMES;
        const avgPeak = state.historyCount > 0 ? state.peakSum / state.historyCount : TARGET_PEAK;
        const targetRatio = TARGET_PEAK / Math.max(avgPeak, 1);
        state.factor = state.factor * NORM_SMOOTHING + targetRatio * (1 - NORM_SMOOTHING);
        state.factor = Math.max(
          NORM_CLAMP_MIN,
          Math.min(NORM_CLAMP_MAX, state.factor)
        );
        normalized[id] = raw[id] * state.factor * gainMultiplier;
      }

      const pulses = pulsesRef.current;
      resetBandState(pulses);
      for (const id of BAND_IDS) {
        const delta = Math.max(0, normalized[id] - prevRaw[id]) * gate.transientSensitivity;
        pulses[id] = Math.min(1, delta);
        prevRaw[id] = normalized[id];
      }

      const enhanced = enhancedRef.current;
      resetBandState(enhanced);
      for (const id of BAND_IDS) {
        enhanced[id] = Math.min(1, normalized[id] + pulses[id]);
      }

      const gated = gatedRef.current;
      resetBandState(gated);
      for (const id of BAND_IDS) {
        let env = envelopeState[id];
        if (enhanced[id] > env) {
          env = enhanced[id] + (env - enhanced[id]) * attackCoeff;
        } else {
          env = enhanced[id] + (env - enhanced[id]) * releaseCoeff;
        }
        envelopeState[id] = env;
        gated[id] = applyGate(env);
      }

      if (minUpdateIntervalMs <= 0 || now - lastUpdateAtRef.current >= minUpdateIntervalMs) {
        lastUpdateAtRef.current = now;
        const bands: Bands8 = { ...gated };
        const bandPulses: BandPulses = { ...pulses };
        onUpdateRef.current({
          bands,
          pulses: bandPulses,
          frequencyData: deriveLegacyBands(bands),
        });
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    const startAnalyze = (now: number) => {
      analyze(now);
    };

    animationFrameRef.current = requestAnimationFrame(startAnalyze);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      resetAnalyzerState();
    };
  }, [analyserNode, sampleRate, enabled, gainMultiplier, minUpdateIntervalMs, resetAnalyzerState]);
}
