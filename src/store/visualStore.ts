import { create } from "zustand";

interface VisualState {
  timeCursor: number; // Global time for shader evolution
  scenePhase: number; // Current scene transition phase (0-1)
  isMetallic: boolean; // Metallic skin toggle
  shapeMorph: number | null; // Manual shape morph override (null = auto, 0-4 = shape)
  splitAmount: number | null; // Manual split amount override (null = auto, 0-1 = split)
  visualMode: "default" | "forest" | "thomas"; // Visual mode toggle
  showThomasLogo: boolean; // Toggle the centered Thomas logo on and off
  thomasEvolutionIntensity: number; // User-controlled multiplier for Thomas mood drift
  thomasEventDensity: number; // User-controlled multiplier for Thomas event frequency
  thomasParticleWarp: number; // User-controlled particle cloud warp amount

  // Actions
  updateTimeCursor: (delta: number) => void;
  setTimeCursor: (time: number) => void;
  setScenePhase: (phase: number) => void;
  toggleMetallic: () => void;
  setShapeMorph: (morph: number | null) => void;
  setSplitAmount: (amount: number | null) => void;
  setVisualMode: (mode: "default" | "forest" | "thomas") => void;
  toggleThomasLogo: () => void;
  setThomasEvolutionIntensity: (intensity: number) => void;
  setThomasEventDensity: (density: number) => void;
  setThomasParticleWarp: (warp: number) => void;
  reset: () => void;
}

const initialState = {
  timeCursor: 0,
  scenePhase: 0,
  isMetallic: false,
  shapeMorph: null,
  splitAmount: null,
  visualMode: "default" as const,
  showThomasLogo: true,
  thomasEvolutionIntensity: 1,
  thomasEventDensity: 1,
  thomasParticleWarp: 0,
};

export const useVisualStore = create<VisualState>((set) => ({
  ...initialState,

  updateTimeCursor: (delta) => set((state) => ({ timeCursor: state.timeCursor + delta })),
  setTimeCursor: (time) => set({ timeCursor: time }),
  setScenePhase: (phase) => set({ scenePhase: phase }),
  toggleMetallic: () => set((state) => ({ isMetallic: !state.isMetallic })),
  setShapeMorph: (morph) => set({ shapeMorph: morph }),
  setSplitAmount: (amount) => set({ splitAmount: amount }),
  setVisualMode: (mode) => set({ visualMode: mode }),
  toggleThomasLogo: () => set((state) => ({ showThomasLogo: !state.showThomasLogo })),
  setThomasEvolutionIntensity: (intensity) =>
    set({ thomasEvolutionIntensity: Math.max(0, Math.min(2, intensity)) }),
  setThomasEventDensity: (density) =>
    set({ thomasEventDensity: Math.max(0, Math.min(2, density)) }),
  setThomasParticleWarp: (warp) =>
    set({ thomasParticleWarp: Math.max(0, Math.min(1, warp)) }),
  reset: () => set(initialState),
}));
