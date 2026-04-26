import type { ReactiveVisualState } from "../components/rhizosphereRendering";

export interface BackgroundFieldSmooth {
  bass: number;
  treble: number;
  substrate: number;
}

const BACKGROUND_FIELD_ATTACK = 0.052;
const BACKGROUND_FIELD_RELEASE = 0.91;
const BACKGROUND_FIELD_TAIL_EPS = 0.014;

/**
 * EMA toward live audio for field/fog — transient spores use raw `deriveReactiveVisualState`.
 */
export function stepBackgroundFieldSmooth(
  s: BackgroundFieldSmooth,
  raw: ReactiveVisualState
): { show: boolean; forField: ReactiveVisualState } {
  if (!raw.isSilent) {
    const k = BACKGROUND_FIELD_ATTACK;
    s.bass += (raw.bassEnergy - s.bass) * k;
    s.treble += (raw.trebleEnergy - s.treble) * k;
    s.substrate += (raw.substrateBreath - s.substrate) * k;
  } else {
    s.bass *= BACKGROUND_FIELD_RELEASE;
    s.treble *= BACKGROUND_FIELD_RELEASE;
    s.substrate *= BACKGROUND_FIELD_RELEASE;
  }

  const tail = s.bass + s.treble + s.substrate;
  const show = !raw.isSilent || tail > BACKGROUND_FIELD_TAIL_EPS;
  return {
    show,
    forField: {
      ...raw,
      bassEnergy: s.bass,
      trebleEnergy: s.treble,
      substrateBreath: s.substrate,
      isSilent: false,
    },
  };
}

export function createBackgroundFieldState(): BackgroundFieldSmooth {
  return { bass: 0, treble: 0, substrate: 0 };
}
