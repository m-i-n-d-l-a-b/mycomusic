import { useId, useState } from "react";
import { AudioControls } from "./components/AudioControls";
import { FungalTelemetryHud } from "./components/FungalTelemetryHud";
import { RhizosphereCanvas } from "./components/RhizosphereCanvas";
import { useMycoSocket } from "./hooks/useMycoSocket";
import "./styles.css";

export function App() {
  const [isOverlayOpen, setIsOverlayOpen] = useState(true);
  const overlayContentId = useId();
  const { connectionState, error, sessionId, snapshot } = useMycoSocket();
  const telemetry = snapshot?.telemetry;
  const morphology = telemetry?.morphology ?? "Balanced";
  const symbioticState = telemetry?.symbioticState ?? "Resource Hoarding";
  const topology = telemetry?.topologyLabel ?? "Dendritic Tree";
  const statusText =
    connectionState === "open"
      ? "Backend link open"
      : connectionState === "connecting"
        ? "Backend link forming"
        : connectionState === "error"
          ? "Backend link fault"
          : "Backend link closed";

  return (
    <main className="app-shell" data-connection={connectionState}>
      <div className="background-noise" />
      <div className="background-vignette" />
      <RhizosphereCanvas snapshot={snapshot} />

      <aside
        className="ui-overlay"
        data-collapsed={!isOverlayOpen}
        aria-label="Myco-Acoustic Engine menu"
      >
        <div className="overlay-topbar">
          <div className="overlay-title">
            <p className="eyebrow">Rhizosphere Interface</p>
            <h1>Myco-Acoustic Engine</h1>
            <span className="connection-pill" data-state={connectionState}>
              {statusText}
            </span>
          </div>
          <button
            className="overlay-toggle"
            type="button"
            aria-label={isOverlayOpen ? "Collapse menu" : "Open menu"}
            aria-expanded={isOverlayOpen}
            aria-controls={overlayContentId}
            title={isOverlayOpen ? "Collapse menu" : "Open menu"}
            onClick={() => setIsOverlayOpen((isOpen) => !isOpen)}
          >
            <span className="overlay-toggle-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>

        <div className="overlay-summary" aria-hidden={!isOverlayOpen}>
          <span>{morphology} morphology</span>
          <span>{topology}</span>
          <span>{symbioticState}</span>
        </div>

        {isOverlayOpen ? (
          <div id={overlayContentId} className="overlay-content">
            <p className="overlay-description">
              Audio features become hyphal growth, electrophysiological spikes, and fungal topology
              in real time.
            </p>
            <AudioControls />
            <FungalTelemetryHud
              connectionState={connectionState}
              error={error}
              sessionId={sessionId}
              snapshot={snapshot}
            />
          </div>
        ) : (
          <div id={overlayContentId} className="overlay-content" hidden aria-hidden="true" />
        )}
      </aside>

      <p className="sr-only" aria-live="polite">
        {statusText}.
      </p>
    </main>
  );
}
