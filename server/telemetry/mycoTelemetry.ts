import type { MycoForces } from "../domain/mycoMapping";
import type { MycoTelemetry, TopologyLabel } from "../domain/mycoProtocol";

export function topologyLabelFor(index: number): TopologyLabel {
  return index >= 0.22 ? "Complex Graph" : "Dendritic Tree";
}

export function deriveTelemetry(
  forces: MycoForces,
  topologyIndex: number,
  growthRate: number
): MycoTelemetry {
  return {
    bioVoltageMv: forces.bioVoltageMv,
    topologyIndex,
    topologyLabel: topologyLabelFor(topologyIndex),
    symbioticState: forces.symbioticState,
    morphology: forces.morphology,
    growthRate,
    anastomosisRate: forces.anastomosisRate,
  };
}
