import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { hidePooledLine } from "./linePoolUtils";

describe("linePoolUtils", () => {
  it("hides pooled lines and clears visible opacity", () => {
    const line = new Line2(
      new LineGeometry().setPositions([0, 0, 0, 1, 1, 1]),
      new LineMaterial({ transparent: true, opacity: 0.8 })
    );
    line.visible = true;

    hidePooledLine(line);

    expect(line.visible).toBe(false);
    expect(line.material).toBeInstanceOf(LineMaterial);
    expect((line.material as LineMaterial).opacity).toBe(0);
  });
});
