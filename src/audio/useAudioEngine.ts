import { useCallback, useEffect, useRef } from "react";
import { type AudioSourceNode, useAudioStore } from "../store/audioStore";
import { createSourceLifecycle } from "./audioLifecycle";
import { ANALYZER_CONFIG } from "./types";
import { useFrequencyAnalyzer } from "./useFrequencyAnalyzer";

const SILENCE_THRESHOLD = 8; // Max freq value (0–255) below which we consider silence
const SILENCE_STOP_SECONDS = 15; // Seconds of consecutive silence before auto-stopping

function createSilenceDetector(params: {
  analyser: AnalyserNode;
  audioTrack: MediaStreamTrack;
  analyserNodeRef: { current: AnalyserNode | null };
  intervalRef: { current: number | null };
  onSilence: () => void;
}) {
  const { analyser, audioTrack, analyserNodeRef, intervalRef, onSilence } = params;
  const timeDomain = new Uint8Array(analyser.fftSize);
  const freqDomain = new Uint8Array(analyser.frequencyBinCount);
  let silenceStart: number | null = null;

  intervalRef.current = window.setInterval(() => {
    if (!analyserNodeRef.current || audioTrack.readyState === "ended") {
      clearInterval(intervalRef.current!);
      intervalRef.current = null;
      return;
    }
    analyser.getByteFrequencyData(freqDomain);
    analyser.getByteTimeDomainData(timeDomain);

    const maxFreq = Math.max(...freqDomain);
    if (maxFreq > SILENCE_THRESHOLD) {
      silenceStart = null;
    } else {
      silenceStart = silenceStart ?? Date.now();
      if ((Date.now() - silenceStart) / 1000 >= SILENCE_STOP_SECONDS) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        onSilence();
      }
    }
  }, 100);
}

/**
 * Custom hook managing Web Audio API setup, MP3 decoding, and playback
 */
export function useAudioEngine() {
  const {
    audioBuffer,
    audioContext,
    analyserNode,
    mediaStream,
    isPlaying,
    captureSource,
    gainMultiplier,
    setAudioBuffer,
    setAudioContext,
    setSourceNode,
    setAnalyserNode,
    setMediaStream,
    setRecordingStream,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    updateFrequencyData,
    setError,
    setIsLoading,
    setCaptureSource,
  } = useAudioStore();

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const keepAliveNodeRef = useRef<AudioNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveIntervalRef = useRef<number | null>(null);
  const sourceLifecycleRef = useRef(createSourceLifecycle());

  // Time tracking: when playback starts, record the context time and buffer offset
  const playbackStartTimeRef = useRef<number>(0); // AudioContext.currentTime when playback started
  const playbackOffsetRef = useRef<number>(0); // Buffer position when playback started

  const ensureValidContext = async (): Promise<AudioContext> => {
    // Check if context exists and is valid
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      const AudioContextClass =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext is not supported in this browser");
      }
      const newContext = new AudioContextClass();
      audioContextRef.current = newContext;
      setAudioContext(newContext);
      ensureRecordingDestination(newContext);
      return newContext;
    }

    const context = audioContextRef.current;

    // Resume if suspended
    if (context.state === "suspended") {
      await context.resume();
    }

    // If closed somehow, recreate
    if (context.state === "closed") {
      const AudioContextClass =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext is not supported in this browser");
      }
      const newContext = new AudioContextClass();
      audioContextRef.current = newContext;
      setAudioContext(newContext);
      ensureRecordingDestination(newContext);
      return newContext;
    }

    ensureRecordingDestination(context);
    return context;
  };

  const createKeepAliveNode = async (context: AudioContext): Promise<AudioNode> => {
    try {
      const processorName = `keep-alive-${Math.random().toString(36).slice(2)}`;
      const workletCode = `
        class KeepAliveProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._counter = 0;
          }
          process(inputs, outputs) {
            // Compute peak of the first channel to detect real PCM.
            const input = inputs[0];
            const ch = input && input[0] ? input[0] : null;
            let peak = 0;
            if (ch) {
              for (let i = 0; i < ch.length; i++) {
                const v = Math.abs(ch[i]);
                if (v > peak) peak = v;
              }
            }
            this._counter++;
            // Post frequently for debugging (~every ~0.1–0.2s depending on device)
            if (this._counter % 50 === 0) {
              this.port.postMessage({ peak });
            }

            // Output silence (avoid feedback)
            const output = outputs[0];
            if (output) {
              for (let c = 0; c < output.length; c++) {
                const out = output[c];
                for (let i = 0; i < out.length; i++) out[i] = 0;
              }
            }
            return true;
          }
        }
        registerProcessor('${processorName}', KeepAliveProcessor);
      `;

      const blob = new Blob([workletCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const node = new AudioWorkletNode(context, processorName);
      if (import.meta.env.DEV) console.log("Using AudioWorklet keep-alive.");
      return node;
    } catch (e) {
      console.warn("AudioWorklet keep-alive unavailable; falling back to ScriptProcessor:", e);
      const sp = context.createScriptProcessor(256, 1, 1);
      sp.onaudioprocess = (event) => {
        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
      };
      if (import.meta.env.DEV) console.log("Using ScriptProcessor keep-alive.");
      return sp;
    }
  };

  const ensureRecordingDestination = useCallback(
    (context: AudioContext): MediaStreamAudioDestinationNode => {
      if (!recordingDestinationRef.current || recordingDestinationRef.current.context !== context) {
        recordingDestinationRef.current = context.createMediaStreamDestination();
        setRecordingStream(recordingDestinationRef.current.stream);
      }

      return recordingDestinationRef.current;
    },
    [setRecordingStream]
  );

  // Sync refs with store on mount
  // IMPORTANT: We do NOT close the context on unmount because other components
  // may still be using it (e.g., PlaybackControls uses the context after FileDropzone unmounts).
  // The context is a shared resource managed via the Zustand store.
  useEffect(() => {
    const state = useAudioStore.getState();

    // If the store already has a valid context, use it instead of creating a new one
    if (state.audioContext && state.audioContext.state !== "closed") {
      audioContextRef.current = state.audioContext;
    } else if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      // Only create a new context if one doesn't exist
      const AudioContextClass =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext is not supported in this browser");
      }
      const context = new AudioContextClass();
      audioContextRef.current = context;
      setAudioContext(context);
      ensureRecordingDestination(context);
    }

    // Sync other refs with store state (critical for components mounting after capture starts)
    if (state.analyserNode) {
      analyserNodeRef.current = state.analyserNode;
    }
    if (state.sourceNode) {
      sourceNodeRef.current = state.sourceNode;
    }
    if (state.mediaStream) {
      mediaStreamRef.current = state.mediaStream;
    }

    if (audioContextRef.current) {
      ensureRecordingDestination(audioContextRef.current);
    }

    // NO cleanup - context is a shared resource, not owned by any single component
  }, [setAudioContext, ensureRecordingDestination]);

  // Set up frequency analyzer
  // Enable analyzer when we have an analyser node AND either playing OR capturing system audio
  // This ensures system audio capture works even if isPlaying hasn't updated yet
  useFrequencyAnalyzer({
    analyserNode,
    sampleRate: audioContext?.sampleRate ?? 44100,
    enabled: !!analyserNode && (isPlaying || captureSource !== null),
    onUpdate: updateFrequencyData,
    gainMultiplier,
  });

  // Update current time during playback
  useEffect(() => {
    if (!isPlaying) return;
    if (!audioBuffer) return;
    if (!audioContextRef.current) return;

    const updateTime = () => {
      if (!audioContextRef.current) return;
      if (!audioBuffer) return;

      // Calculate elapsed time since playback started
      const elapsed = audioContextRef.current.currentTime - playbackStartTimeRef.current;
      // Current position = offset when playback started + elapsed time
      const currentTime = playbackOffsetRef.current + elapsed;

      // Clamp to valid range
      const clampedTime = Math.max(0, Math.min(currentTime, audioBuffer.duration));
      setCurrentTime(clampedTime);
    };

    // Update immediately
    updateTime();

    // Then update every 100ms
    const interval = setInterval(updateTime, 100);

    return () => clearInterval(interval);
  }, [isPlaying, audioBuffer, setCurrentTime]);

  const loadAudio = async (file: File) => {
    try {
      setIsLoading(true);
      setError(null);

      if (!audioContextRef.current) {
        throw new Error("AudioContext not initialized");
      }

      const context = audioContextRef.current;

      // Check if context is closed, recreate if needed
      if (context.state === "closed") {
        const AudioContextClass =
          window.AudioContext ||
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("AudioContext is not supported in this browser");
        }
        const newContext = new AudioContextClass();
        audioContextRef.current = newContext;
        setAudioContext(newContext);
        ensureRecordingDestination(newContext);
        // Retry with new context
        return loadAudio(file);
      }

      stopCurrentSource();
      setIsPlaying(false);
      setAudioBuffer(null);
      setDuration(0);
      setCurrentTime(0);
      playbackOffsetRef.current = 0;
      playbackStartTimeRef.current = 0;

      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await context.decodeAudioData(arrayBuffer);

      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      setCurrentTime(0);
      playbackOffsetRef.current = 0;
      playbackStartTimeRef.current = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load audio file";
      setError(message);
      console.error("Error loading audio:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const stopCurrentSource = () => {
    sourceLifecycleRef.current.invalidateActiveSource();

    // Clear keep-alive interval
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }

    // Stop keep-alive audio element
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      // Remove from DOM to avoid leaking hidden elements
      audioElRef.current.remove();
      audioElRef.current = null;
    }

    // Disconnect keep-alive node if it exists
    if (keepAliveNodeRef.current) {
      try {
        keepAliveNodeRef.current.disconnect();
      } catch (e) {
        // Node may already be disconnected
      }
      keepAliveNodeRef.current = null;
    }

    // Stop MediaStream tracks if capturing system audio
    // Check both the local ref and the store (for cross-component cleanup)
    const streamToStop = mediaStreamRef.current ?? mediaStream;
    if (streamToStop) {
      streamToStop.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setMediaStream(null);
    }

    if (sourceNodeRef.current) {
      try {
        // Disconnect source node
        sourceNodeRef.current.disconnect();
        // AudioBufferSourceNode has stop(), MediaStreamAudioSourceNode does not
        if ("stop" in sourceNodeRef.current && typeof sourceNodeRef.current.stop === "function") {
          sourceNodeRef.current.stop();
        }
      } catch (e) {
        // Source may already be stopped/disconnected
      }
      sourceNodeRef.current = null;
      setSourceNode(null);
    }
    if (analyserNodeRef.current) {
      try {
        analyserNodeRef.current.disconnect();
      } catch (e) {
        // Node may already be disconnected
      }
      analyserNodeRef.current = null;
      setAnalyserNode(null);
    }
    setCaptureSource(null);
  };

  const play = (retry = false) => {
    if (!(audioBuffer && audioContextRef.current)) return;

    const context = audioContextRef.current;

    // Check if context is closed, recreate if needed (only once to avoid recursion)
    if (context.state === "closed" && !retry) {
      const AudioContextClass =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        setError("AudioContext is not supported in this browser");
        return;
      }
      const newContext = new AudioContextClass();
      audioContextRef.current = newContext;
      setAudioContext(newContext);
      ensureRecordingDestination(newContext);
      return play(true); // Retry with new context
    }

    if (context.state === "closed") {
      setError("AudioContext is closed and cannot be recreated");
      return;
    }

    // Resume context if suspended (browser autoplay policy)
    if (context.state === "suspended") {
      context.resume();
    }

    // Stop existing source if any
    stopCurrentSource();

    // Create new source node
    const source = context.createBufferSource();
    const sourceToken = sourceLifecycleRef.current.startSource();
    source.buffer = audioBuffer;
    source.loop = false;

    // Create analyser node
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYZER_CONFIG.fftSize;
    analyser.smoothingTimeConstant = ANALYZER_CONFIG.smoothingTimeConstant;
    const recordingDestination = ensureRecordingDestination(context);

    // Connect playback to speakers and a dedicated recording stream.
    try {
      source.connect(analyser);
      analyser.connect(context.destination);
      analyser.connect(recordingDestination);
    } catch (error) {
      console.error("Error connecting audio nodes:", error);
      setError("Failed to connect audio nodes");
      return;
    }

    // Handle playback end
    source.onended = () => {
      if (!sourceLifecycleRef.current.isActiveSource(sourceToken)) return;
      setIsPlaying(false);
      setCurrentTime(audioBuffer.duration);
      playbackOffsetRef.current = 0;
      playbackStartTimeRef.current = 0;
      stopCurrentSource();
    };

    // Start playback from current offset position
    const offset = playbackOffsetRef.current;
    source.start(0, offset);

    // Record when playback started and from what position
    playbackStartTimeRef.current = context.currentTime;
    playbackOffsetRef.current = offset;

    sourceNodeRef.current = source;
    analyserNodeRef.current = analyser;
    setSourceNode(source);
    setAnalyserNode(analyser);
    setIsPlaying(true);

    // Immediately update currentTime to show correct position
    setCurrentTime(offset);
  };

  const pause = () => {
    if (!(sourceNodeRef.current && audioContextRef.current && audioBuffer)) return;

    try {
      // Calculate current position before stopping
      const elapsed = audioContextRef.current.currentTime - playbackStartTimeRef.current;
      const currentPosition = playbackOffsetRef.current + elapsed;

      // Update offset to current position
      playbackOffsetRef.current = Math.max(0, Math.min(currentPosition, audioBuffer.duration));

      // Stop playback
      stopCurrentSource();

      // Update UI
      setCurrentTime(playbackOffsetRef.current);
      setIsPlaying(false);

      // Reset start time
      playbackStartTimeRef.current = 0;
    } catch (error) {
      console.error("Error pausing audio:", error);
    }
  };

  const stop = () => {
    stopCurrentSource();
    setIsPlaying(false);
    setCurrentTime(0);
    playbackOffsetRef.current = 0;
    playbackStartTimeRef.current = 0;
  };

  const seek = (time: number) => {
    if (!audioBuffer) return;

    const wasPlaying = isPlaying;
    const seekTime = Math.max(0, Math.min(time, audioBuffer.duration));

    // Stop current playback if playing
    if (wasPlaying) {
      stopCurrentSource();
      setIsPlaying(false);
    }

    // Update position
    playbackOffsetRef.current = seekTime;
    playbackStartTimeRef.current = 0;
    setCurrentTime(seekTime);

    // Resume playback if it was playing
    if (wasPlaying) {
      play();
    }
  };

  const captureSystemAudio = async () => {
    let pendingStream: MediaStream | null = null;
    let replacedExistingSource = false;

    try {
      setIsLoading(true);
      setError(null);

      // Check if getDisplayMedia is supported
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing is not supported in this browser");
      }

      // Request display capture with audio.
      // Note: video: true is required to trigger the chooser UI in Chromium.
      // CRITICAL: Disable voice-processing (echo cancellation/noise suppression/AGC).
      // For tab/system audio, these can cancel the signal down to silence.
      const audioConstraints: MediaTrackConstraints & { suppressLocalAudioPlayback?: boolean } = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Experimental in Chromium; harmless if ignored.
        suppressLocalAudioPlayback: false,
      };

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: audioConstraints,
      });
      pendingStream = stream;

      // Extract the audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        // User didn't check "Share tab audio" - clean up and show error
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "No audio shared! Please ensure 'Share tab audio' is checked when selecting a tab."
        );
      }

      // Check track state immediately
      const initialTrackState = audioTrack.readyState as MediaStreamTrackState;

      // If track is already ended, something went wrong
      if (initialTrackState === "ended") {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "Audio track ended immediately. Make sure audio is playing in the tab you're sharing."
        );
      }

      // Get a valid, running context
      const context = await ensureValidContext();
      const recordingDestination = ensureRecordingDestination(context);

      // Enable the audio track if it's not already enabled
      if (!audioTrack.enabled) {
        audioTrack.enabled = true;
      }

      // Note: We don't check track state again here because:
      // 1. We already verified it's "live" initially
      // 2. The track might temporarily appear ended during async operations but recover
      // 3. If it's truly ended, the event handlers will catch it

      // CRITICAL: Isolate the audio track into an audio-only stream and feed it directly into Web Audio.
      // This avoids any <audio> element / MediaElementAudioSourceNode quirks.
      const audioOnlyStream = new MediaStream([audioTrack]);

      // Create source from the audio-only stream.
      const source = context.createMediaStreamSource(audioOnlyStream);

      // Create analyser node with larger buffer for better detection
      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYZER_CONFIG.fftSize;
      analyser.smoothingTimeConstant = ANALYZER_CONFIG.smoothingTimeConstant;
      // Use default decibel range (-100 to -30) which works well for most audio sources
      // Previous settings (-90 to -10) expected very loud signals, causing weak visualization

      const keepAliveNode = await createKeepAliveNode(context);

      source.connect(analyser);
      analyser.connect(keepAliveNode);
      keepAliveNode.connect(context.destination);
      analyser.connect(recordingDestination);

      // Ensure context is running BEFORE setting up nodes
      // This is critical - the context must be running for audio to flow
      const initialContextState = context.state;
      if (initialContextState !== "running") {
        console.warn("AudioContext not running, attempting to resume:", initialContextState);
        await context.resume();
        // Verify it's running after resume (check state again after async operation)
        const stateAfterResume: AudioContextState = context.state;
        if (stateAfterResume !== "running") {
          throw new Error(`Failed to resume AudioContext. State: ${stateAfterResume}`);
        }
      }

      // Update state - ensure context is set first for sampleRate
      // Set analyser node FIRST so the frequency analyzer can start immediately
      stopCurrentSource();
      replacedExistingSource = true;
      mediaStreamRef.current = stream;
      setMediaStream(stream);
      pendingStream = null;

      keepAliveNodeRef.current = keepAliveNode;
      setAudioContext(context);
      analyserNodeRef.current = analyser;
      setAnalyserNode(analyser);
      sourceNodeRef.current = source;
      setSourceNode(source);
      setCaptureSource("system");
      setIsPlaying(true);
      setCurrentTime(0);
      setDuration(0); // No duration for live streams

      // Verify track is still live after setup (re-check state after async operations)
      // Re-read state with type assertion to avoid TypeScript narrowing issues
      const trackStateAfterSetup = audioTrack.readyState as MediaStreamTrackState;
      if (trackStateAfterSetup === "ended") {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "Audio track ended unexpectedly. Make sure audio is playing in the shared tab and 'Share tab audio' is checked."
        );
      }

      // CRITICAL: Start reading from analyser immediately to keep audio graph active
      // Some browsers may optimize away inactive audio graphs, causing the stream to end
      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
      createSilenceDetector({
        analyser,
        audioTrack,
        analyserNodeRef,
        intervalRef: keepAliveIntervalRef,
        onSilence: () => {
          stopCurrentSource();
          setIsPlaying(false);
          setCurrentTime(0);
          setError(null);
        },
      });

      // Monitor audio track for changes (user Stop, tab close, or browser ending the share)
      const handleTrackEnded = () => {
        if (keepAliveIntervalRef.current) {
          clearInterval(keepAliveIntervalRef.current);
          keepAliveIntervalRef.current = null;
        }
        stopCurrentSource();
        setIsPlaying(false);
        setCurrentTime(0);
        setError(null);
      };

      audioTrack.addEventListener("ended", handleTrackEnded);

      // Also handle when video track ends (user stops sharing)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          if (keepAliveIntervalRef.current) {
            clearInterval(keepAliveIntervalRef.current);
            keepAliveIntervalRef.current = null;
          }
          stopCurrentSource();
          setIsPlaying(false);
          setCurrentTime(0);
        });
      }
    } catch (error) {
      if (pendingStream) {
        pendingStream.getTracks().forEach((track) => track.stop());
      }
      if (replacedExistingSource) {
        stopCurrentSource();
      }
      const message = error instanceof Error ? error.message : "Failed to capture system audio";
      setError(message);
      console.error("Error capturing system audio:", error);
      setCaptureSource(null);
    } finally {
      setIsLoading(false);
    }
  };

  const captureInputDeviceAudio = async () => {
    let pendingStream: MediaStream | null = null;
    let replacedExistingSource = false;

    try {
      setIsLoading(true);
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone/input capture is not supported in this browser");
      }

      // Capture from an input device (microphone / Stereo Mix / VB-Cable).
      // IMPORTANT: We first request permission, then enumerate devices and (if available)
      // re-request with an exact deviceId for "Stereo Mix"/loopback devices.
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      // After permission is granted, labels become available in enumerateDevices().
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");

      const LOOPBACK_LABEL = /(stereo\s*mix|what\s*u\s*hear|loopback|vb-audio|cable output)/i;
      const preferred = audioInputs.find((d) => LOOPBACK_LABEL.test(d.label));

      // Stop the permission stream once we have device info.
      permissionStream.getTracks().forEach((t) => t.stop());

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (preferred?.deviceId) {
        audioConstraints.deviceId = { exact: preferred.deviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      pendingStream = stream;

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No audio input device available");
      }

      const context = await ensureValidContext();
      const recordingDestination = ensureRecordingDestination(context);
      const source = context.createMediaStreamSource(stream);

      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYZER_CONFIG.fftSize;
      analyser.smoothingTimeConstant = ANALYZER_CONFIG.smoothingTimeConstant;
      // Use default decibel range (-100 to -30) which works well for most audio sources

      const keepAliveNode = await createKeepAliveNode(context);

      source.connect(analyser);
      analyser.connect(keepAliveNode);
      keepAliveNode.connect(context.destination);
      analyser.connect(recordingDestination);

      stopCurrentSource();
      replacedExistingSource = true;
      mediaStreamRef.current = stream;
      setMediaStream(stream);
      pendingStream = null;

      keepAliveNodeRef.current = keepAliveNode;
      setAudioContext(context);
      analyserNodeRef.current = analyser;
      setAnalyserNode(analyser);
      sourceNodeRef.current = source;
      setSourceNode(source);

      setCaptureSource("input");
      setIsPlaying(true);
      setCurrentTime(0);
      setDuration(0);

      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
      createSilenceDetector({
        analyser,
        audioTrack,
        analyserNodeRef,
        intervalRef: keepAliveIntervalRef,
        onSilence: () => {
          stopCurrentSource();
          setIsPlaying(false);
          setCurrentTime(0);
        },
      });

      audioTrack.addEventListener("ended", () => {
        stopCurrentSource();
        setIsPlaying(false);
        setCurrentTime(0);
      });
    } catch (error) {
      if (pendingStream) {
        pendingStream.getTracks().forEach((track) => track.stop());
      }
      if (replacedExistingSource) {
        stopCurrentSource();
      }
      const message =
        error instanceof Error ? error.message : "Failed to capture audio input device";
      setError(message);
      console.error("Error capturing input device audio:", error);
      setCaptureSource(null);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    loadAudio,
    play,
    pause,
    stop,
    seek,
    captureSystemAudio,
    captureInputDeviceAudio,
  };
}
