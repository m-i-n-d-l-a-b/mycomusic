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
  if (connectionState === "local") return "Local";
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
    <section className="overlay-section telemetry-hud" aria-label="Fungal telemetry">
      <div className="section-header-compact">
        <p className="eyebrow">Telemetry</p>
        <span className="morphology-badge" data-morphology={morphology}>
          {morphology}
        </span>
      </div>

      <section className="bio-voltage-card-compact" aria-label="Current bio-voltage">
        <div className="bio-voltage-compact">
          <div className="bio-voltage-icon" aria-hidden="true">⚡</div>
          <div>
            <div className="bio-voltage-value-compact">
              {bioVoltageMv.toFixed(1)}<span>mV</span>
            </div>
            <div className="meter-track-compact" aria-hidden="true">
              <div className="meter-fill" style={{ width: voltagePercent }} />
            </div>
          </div>
        </div>
      </section>

      <dl className="telemetry-list-compact">
        <div className="telemetry-row-compact">
          <dt title="Network Topology Index">🕸️</dt>
          <dd>
            <div className="topology-bar-compact" aria-hidden="true">
              <span style={{ width: percent(topologyIndex) }} />
            </div>
            <div className="telemetry-label-compact">{topologyIndex.toFixed(2)}</div>
          </dd>
        </div>
        <div className="telemetry-row-compact">
          <dt title="Symbiotic State">🍄</dt>
          <dd className="telemetry-compact-text">{symbioticState}</dd>
        </div>
        <div className="telemetry-row-compact">
          <dt title="Growth Rate">📈</dt>
          <dd className="telemetry-compact-text">{growthRate.toFixed(1)} tips/s</dd>
        </div>
        <div className="telemetry-row-compact">
          <dt title="Fusion Rate">🔗</dt>
          <dd className="telemetry-compact-text">{anastomosisRate.toFixed(2)}</dd>
        </div>
        <div className="telemetry-row-compact">
          <dt title="Backend Link">🌐</dt>
          <dd className="telemetry-compact-text">
            {connectionLabel(connectionState)}
          </dd>
        </div>
      </dl>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
