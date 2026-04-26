import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export function hidePooledLine(line: Line2 | null | undefined): void {
  if (!line) return;

  const material = line.material;
  if (!line.visible && line.userData.hidden === true) {
    if (material instanceof LineMaterial && material.opacity !== 0) {
      material.opacity = 0;
    }
    return;
  }

  line.visible = false;
  line.userData.hidden = true;

  if (material instanceof LineMaterial) {
    material.opacity = 0;
  }
}
