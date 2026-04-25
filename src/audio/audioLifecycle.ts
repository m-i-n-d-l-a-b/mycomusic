export interface SourceLifecycle {
  startSource: () => number;
  invalidateActiveSource: () => void;
  isActiveSource: (token: number) => boolean;
}

export function createSourceLifecycle(): SourceLifecycle {
  let activeSourceToken = 0;

  return {
    startSource: () => {
      activeSourceToken += 1;
      return activeSourceToken;
    },
    invalidateActiveSource: () => {
      activeSourceToken += 1;
    },
    isActiveSource: (token: number) => token === activeSourceToken,
  };
}
