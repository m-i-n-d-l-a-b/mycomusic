import { createSourceLifecycle } from "./audioLifecycle";

describe("createSourceLifecycle", () => {
  it("marks manually stopped sources as inactive so late ended events are ignored", () => {
    const lifecycle = createSourceLifecycle();
    const firstToken = lifecycle.startSource();

    lifecycle.invalidateActiveSource();

    expect(lifecycle.isActiveSource(firstToken)).toBe(false);
  });

  it("keeps only the latest source token active", () => {
    const lifecycle = createSourceLifecycle();
    const oldToken = lifecycle.startSource();
    const currentToken = lifecycle.startSource();

    expect(lifecycle.isActiveSource(oldToken)).toBe(false);
    expect(lifecycle.isActiveSource(currentToken)).toBe(true);
  });
});
