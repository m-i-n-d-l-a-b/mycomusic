import { Canvas } from "@react-three/fiber";
import { useCallback, useState, type MutableRefObject } from "react";
import type { MycoSnapshotMessage } from "../../server/domain/mycoProtocol";
import { RhizosphereScene3D } from "./RhizosphereScene3D";

type Props = {
  /** High-frequency mycelium graph; read in the render loop without React re-renders. */
  snapshotRef: MutableRefObject<MycoSnapshotMessage | null>;
};

const DEFAULT_DPR = 1.75;

/**
 * Full-viewport 3D rhizosphere: WebGL via React Three Fiber, automated orbit camera, adaptive DPR.
 */
export function RhizosphereCanvas({ snapshotRef }: Props) {
  const [dpr, setDpr] = useState(DEFAULT_DPR);
  const dprSetCallback = useCallback((next: number) => {
    setDpr((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
  }, []);

  return (
    <section className="rhizosphere" aria-label="Rhizosphere viewport">
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 2.8, 6], fov: 55, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor("#020605", 1);
        }}
      >
        <RhizosphereScene3D snapshotRef={snapshotRef} dprSetCallback={dprSetCallback} />
      </Canvas>
    </section>
  );
}
