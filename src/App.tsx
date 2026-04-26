import { useId, useState } from "react";
import { AudioControls } from "./components/AudioControls";
import { RhizosphereCanvas } from "./components/RhizosphereCanvas";
import { useMycoSocket } from "./hooks/useMycoSocket";
import "./styles.css";

export function App() {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const overlayContentId = useId();
  const { connectionState, snapshotRef } = useMycoSocket();
  const statusText =
    connectionState === "open"
      ? "Backend link open"
      : connectionState === "local"
        ? "Local engine active"
        : connectionState === "connecting"
          ? "Backend link forming"
          : connectionState === "error"
            ? "Backend link fault"
            : "Backend link closed";

  return (
    <main className="app-shell" data-connection={connectionState}>
      <div className="background-noise" />
      <div className="background-vignette" />
      <RhizosphereCanvas snapshotRef={snapshotRef} />

      <aside
        className="ui-overlay"
        data-collapsed={!isOverlayOpen}
        aria-label="MycoMusic menu"
      >
        <div className="overlay-topbar">
          <div className="overlay-title">
            <h1>MycoMusic</h1>
            <span className="connection-pill" data-state={connectionState}>
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

        <div
          id={overlayContentId}
          className="overlay-content"
          hidden={!isOverlayOpen}
          aria-hidden={!isOverlayOpen}
        >
          <p className="overlay-description">
            Audio features become hyphal growth, electrophysiological spikes, and fungal topology in
            real time.
          </p>
          <AudioControls />
        </div>
      </aside>

      <p className="sr-only" aria-live="polite">
        {statusText}.
      </p>
    </main>
  );
}
