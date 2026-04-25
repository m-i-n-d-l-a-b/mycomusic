import { useRef } from "react";
import { useAudioEngine } from "../audio/useAudioEngine";
import { useAudioStore } from "../store/audioStore";

export function AudioControls() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { loadAudio, play, pause, stop, captureSystemAudio, captureInputDeviceAudio } = useAudioEngine();
  const audioBuffer = useAudioStore((state) => state.audioBuffer);
  const captureSource = useAudioStore((state) => state.captureSource);
  const currentTime = useAudioStore((state) => state.currentTime);
  const duration = useAudioStore((state) => state.duration);
  const error = useAudioStore((state) => state.error);
  const gainMultiplier = useAudioStore((state) => state.gainMultiplier);
  const isLoading = useAudioStore((state) => state.isLoading);
  const isPlaying = useAudioStore((state) => state.isPlaying);
  const setGainMultiplier = useAudioStore((state) => state.setGainMultiplier);

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
      <div className="section-header-compact">
        <p className="eyebrow">Audio</p>
        <span className="source-chip-compact">{sourceLabel}</span>
      </div>

      <div className="control-group-compact">
        <input
          id="audio-file"
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          aria-label="Choose audio file"
        />
      </div>

      <div className="button-grid-compact">
        <button
          className="button-compact button-primary"
          type="button"
          onClick={() => play()}
          disabled={!canPlayFile}
          aria-label="Play"
          title="Play loaded audio file"
        >
          ▶
        </button>
        <button
          className="button-compact"
          type="button"
          onClick={pause}
          disabled={!canPauseFile}
          aria-label="Pause"
          title="Pause loaded audio file"
        >
          ⏸
        </button>
        <button
          className="button-compact"
          type="button"
          onClick={stop}
          disabled={isLoading}
          aria-label="Stop"
          title="Stop audio or live capture"
        >
          ⏹
        </button>
      </div>

      <div className="button-stack-compact">
        <button
          className="button-compact-full"
          type="button"
          onClick={captureSystemAudio}
          disabled={isLoading}
          aria-label="Capture tab/system audio"
        >
          🖥️ Tab/System
        </button>
        <button
          className="button-compact-full"
          type="button"
          onClick={captureInputDeviceAudio}
          disabled={isLoading}
          aria-label="Capture input device"
        >
          🎤 Input
        </button>
      </div>

      <div className="control-group-compact">
        <label className="gain-control-compact" htmlFor="gain-multiplier">
          <span className="control-label-compact">Gain</span>
          <span className="gain-value-compact">{gainMultiplier.toFixed(1)}x</span>
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

      <p className="status-line-compact" aria-live="polite">
        {isLoading ? "Loading..." : statusLabel}
      </p>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
