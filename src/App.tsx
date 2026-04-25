import { AudioControls } from "./components/AudioControls";
import { FungalTelemetryHud } from "./components/FungalTelemetryHud";
import { RhizosphereCanvas } from "./components/RhizosphereCanvas";
import { useMycoSocket } from "./hooks/useMycoSocket";
import "./styles.css";

export function App() {
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

      <section className="engine-title" aria-label="Myco-Acoustic Engine status">
        <p className="eyebrow">Rhizosphere Interface</p>
        <h1>Myco-Acoustic Engine</h1>
        <p>
          Audio features become hyphal growth, electrophysiological spikes, and fungal
          topology in real time.
        </p>
        <span className="connection-pill" data-state={connectionState}>
          {statusText}
        </span>
      </section>

      <div className="hud-grid">
        <div className="hud-column hud-column-left">
          <AudioControls />
        </div>
        <div className="hud-column hud-column-right">
          <FungalTelemetryHud
            connectionState={connectionState}
            error={error}
            sessionId={sessionId}
            snapshot={snapshot}
          />
        </div>
      </div>

      <aside className="ambient-readout" aria-hidden="true">
        <span>{morphology} morphology</span>
        <span>{topology}</span>
        <span>{symbioticState}</span>
      </aside>

      <p className="sr-only" aria-live="polite">
        {statusText}.
      </p>
    </main>
  );
}
