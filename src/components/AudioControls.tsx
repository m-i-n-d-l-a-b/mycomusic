import { useRef } from "react";
import { useAudioEngine } from "../audio/useAudioEngine";
import { useAudioStore } from "../store/audioStore";

export function AudioControls() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { loadAudio, play, pause, stop, captureSystemAudio, captureInputDeviceAudio } = useAudioEngine();
  const {
    audioBuffer,
    captureSource,
    currentTime,
    duration,
    error,
    gainMultiplier,
    isLoading,
    isPlaying,
    setGainMultiplier,
  } = useAudioStore();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    await loadAudio(file);
  };

  const sourceLabel =
    captureSource === "system"
      ? "Tab/System Capture"
      : captureSource === "input"
        ? "Input Device Capture"
        : audioBuffer
          ? "Audio File"
          : "Idle Substrate";
  const statusLabel =
    duration > 0
      ? `${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`
      : captureSource
        ? captureSource === "system"
          ? "Live system capture"
          : "Live input capture"
        : "Awaiting audio";
  const canPlayFile = Boolean(audioBuffer) && !isLoading && !isPlaying;
  const canPauseFile = isPlaying && captureSource === null;

  return (
    <section className="overlay-section audio-controls" aria-label="Audio controls">
      <div className="section-header">
        <div>
          <p className="eyebrow">Audio Source</p>
          <h2>Signal Acquisition</h2>
        </div>
        <span className="source-chip">{sourceLabel}</span>
      </div>

      <div className="control-group">
        <label className="control-label" htmlFor="audio-file">
          Load an audio specimen
        </label>
        <input
          id="audio-file"
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          aria-describedby="audio-file-help"
          aria-label="Choose audio file for mycelium visualization"
        />
        <p className="microcopy" id="audio-file-help">
          Files stay in the browser; only normalized acoustic features are streamed to the engine.
        </p>
      </div>

      <div className="button-row">
        <button
          className="button-primary"
          type="button"
          onClick={() => play()}
          disabled={!canPlayFile}
          aria-label="Play loaded audio file"
        >
          Play
        </button>
        <button type="button" onClick={pause} disabled={!canPauseFile} aria-label="Pause loaded audio file">
          Pause
        </button>
        <button type="button" onClick={stop} disabled={isLoading} aria-label="Stop audio or live capture">
          Stop
        </button>
      </div>

      <div className="button-row">
        <button
          type="button"
          onClick={captureSystemAudio}
          disabled={isLoading}
          aria-label="Capture tab or system audio"
        >
          Capture Tab/System Audio
        </button>
        <button
          type="button"
          onClick={captureInputDeviceAudio}
          disabled={isLoading}
          aria-label="Capture microphone or input device audio"
        >
          Capture Input Device
        </button>
      </div>

      <div className="control-group">
        <label className="gain-control" htmlFor="gain-multiplier">
          <span className="control-label">Apical growth gain</span>
          <span>{gainMultiplier.toFixed(1)}x</span>
          <input
            id="gain-multiplier"
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={gainMultiplier}
            onChange={(event) => setGainMultiplier(Number(event.currentTarget.value))}
            aria-label="Apical growth gain"
            aria-valuetext={`${gainMultiplier.toFixed(1)} times`}
          />
        </label>
      </div>

      <p className="status-line" aria-live="polite">
        {isLoading ? "Preparing audio graph..." : statusLabel}
      </p>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
