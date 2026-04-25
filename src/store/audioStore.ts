import { create } from "zustand";
import type { BandPulses, Bands8, FrequencyBands, ReactiveAudioData } from "../audio/types";

export type AudioSourceNode =
  | AudioBufferSourceNode
  | MediaStreamAudioSourceNode
  | MediaElementAudioSourceNode;
export type CaptureSource = "system" | "input";

export type { ReactiveAudioData };

const EMPTY_BANDS8: Bands8 = {
  subBass: 0,
  midBass: 0,
  upperBass: 0,
  lowMids: 0,
  mids: 0,
  upperMids: 0,
  presence: 0,
  air: 0,
};

const EMPTY_PULSES: BandPulses = { ...EMPTY_BANDS8 };

interface AudioState {
  audioBuffer: globalThis.AudioBuffer | null;
  audioContext: AudioContext | null;
  sourceNode: AudioSourceNode | null;
  analyserNode: AnalyserNode | null;
  mediaStream: MediaStream | null;
  recordingStream: MediaStream | null;
  captureSource: CaptureSource | null;
  isPlaying: boolean;
  isLoading: boolean;
  isCapturingSystemAudio: boolean;
  currentTime: number;
  duration: number;
  /** 8-band energy values */
  bands: Bands8;
  /** Transient/onset pulse signals per band */
  pulses: BandPulses;
  /** Legacy 4-band aggregate (low/mid/high/air) for backward compatibility */
  frequencyData: FrequencyBands;
  error: string | null;
  gainMultiplier: number; // Manual gain adjustment (0.1 to 3.0)

  // Actions
  setAudioBuffer: (buffer: AudioBuffer | null) => void;
  setAudioContext: (context: AudioContext | null) => void;
  setSourceNode: (node: AudioSourceNode | null) => void;
  setAnalyserNode: (node: AnalyserNode | null) => void;
  setMediaStream: (stream: MediaStream | null) => void;
  setRecordingStream: (stream: MediaStream | null) => void;
  setCaptureSource: (source: CaptureSource | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsCapturingSystemAudio: (capturing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  updateFrequencyData: (data: ReactiveAudioData) => void;
  setError: (error: string | null) => void;
  setGainMultiplier: (gain: number) => void;
  reset: () => void;
}

const initialState = {
  audioBuffer: null,
  audioContext: null,
  sourceNode: null,
  analyserNode: null,
  mediaStream: null,
  recordingStream: null,
  captureSource: null,
  isPlaying: false,
  isLoading: false,
  isCapturingSystemAudio: false,
  currentTime: 0,
  duration: 0,
  bands: EMPTY_BANDS8,
  pulses: EMPTY_PULSES,
  frequencyData: { low: 0, mid: 0, high: 0, air: 0 },
  error: null,
  gainMultiplier: 1.0, // Default 1.0 = no adjustment
};

export const useAudioStore = create<AudioState>((set) => ({
  ...initialState,

  setAudioBuffer: (buffer) => set({ audioBuffer: buffer }),
  setAudioContext: (context) => set({ audioContext: context }),
  setSourceNode: (node) => set({ sourceNode: node }),
  setAnalyserNode: (node) => set({ analyserNode: node }),
  setMediaStream: (stream) => set({ mediaStream: stream }),
  setRecordingStream: (stream) => set({ recordingStream: stream }),
  setCaptureSource: (source) =>
    set({ captureSource: source, isCapturingSystemAudio: source === "system" }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsCapturingSystemAudio: (capturing) =>
    set({ isCapturingSystemAudio: capturing, captureSource: capturing ? "system" : null }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  updateFrequencyData: (data) =>
    set({
      bands: data.bands,
      pulses: data.pulses,
      frequencyData: data.frequencyData,
    }),
  setError: (error) => set({ error }),
  setGainMultiplier: (gain) => set({ gainMultiplier: Math.max(0.1, Math.min(3.0, gain)) }),
  reset: () => set(initialState),
}));
