import type { MycoSnapshotMessage } from "../../server/domain/mycoProtocol";

interface FungalTelemetryHudProps {
  snapshot: MycoSnapshotMessage | null;
  connectionState: string;
  error: string | null;
  sessionId: string;
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function connectionLabel(connectionState: string): string {
  if (connectionState === "open") return "Open";
  if (connectionState === "connecting") return "Forming";
  if (connectionState === "error") return "Fault";
  return "Closed";
}

export function FungalTelemetryHud({
  snapshot,
  connectionState,
  error,
  sessionId,
}: FungalTelemetryHudProps) {
  const telemetry = snapshot?.telemetry;
  const bioVoltageMv = telemetry?.bioVoltageMv ?? 0;
  const topologyIndex = telemetry?.topologyIndex ?? 0;
  const topologyLabel = telemetry?.topologyLabel ?? "Dendritic Tree";
  const symbioticState = telemetry?.symbioticState ?? "Resource Hoarding";
  const morphology = telemetry?.morphology ?? "Balanced";
  const growthRate = telemetry?.growthRate ?? 0;
  const anastomosisRate = telemetry?.anastomosisRate ?? 0;
  const voltagePercent = percent(bioVoltageMv / 2.1);

  return (
    <aside className="panel telemetry-hud" aria-label="Fungal telemetry">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Fungal Telemetry</p>
          <h2>Living Network State</h2>
        </div>
        <span className="morphology-badge" data-morphology={morphology}>
          {morphology}
        </span>
      </div>

      <section className="bio-voltage-card" aria-label="Current bio-voltage">
        <div>
          <p className="eyebrow">Current Bio-Voltage</p>
          <div className="bio-voltage-value">
            {bioVoltageMv.toFixed(1)}
            <span>mV peak</span>
          </div>
        </div>
        <div className="meter-track" aria-hidden="true">
          <div className="meter-fill" style={{ width: voltagePercent }} />
        </div>
        <p className="microcopy">Action potential range: 0.3 to 2.1 mV under rhythmic load.</p>
      </section>

      <dl className="telemetry-list">
        <div className="telemetry-row">
          <dt>Network Topology Index</dt>
          <dd>
            <div className="telemetry-value">
              <span>{topologyLabel}</span>
              <span>{topologyIndex.toFixed(2)}</span>
            </div>
            <div className="topology-bar" aria-hidden="true">
              <span style={{ width: percent(topologyIndex) }} />
            </div>
          </dd>
        </div>
        <div className="telemetry-row">
          <dt>Symbiotic State</dt>
          <dd>{symbioticState}</dd>
        </div>
        <div className="telemetry-row">
          <dt>Growth / Fusion</dt>
          <dd>
            <div className="telemetry-value">
              <span>{growthRate.toFixed(1)} tips/s</span>
              <span>{anastomosisRate.toFixed(2)} fusion</span>
            </div>
          </dd>
        </div>
        <div className="telemetry-row">
          <dt>Backend Link</dt>
          <dd>
            {connectionLabel(connectionState)} · Session {sessionId.slice(0, 8)}
          </dd>
        </div>
      </dl>

      {error ? <p className="error-text">{error}</p> : null}
    </aside>
  );
}
