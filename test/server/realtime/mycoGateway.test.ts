import http from "node:http";
import WebSocket from "ws";
import { attachMycoGateway } from "../../../server/realtime/mycoGateway";

let server: http.Server | null = null;

function startGateway(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server = http.createServer();
    attachMycoGateway(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
      }
      resolve({
        url: `ws://127.0.0.1:${address.port}/ws`,
        close: () =>
          new Promise((closeResolve) => {
            server?.close(() => closeResolve());
            server = null;
          }),
      });
    });
  });
}

function waitForMessage(ws: WebSocket, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2_000);
    ws.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      if (parsed.type === type) {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
});

describe("attachMycoGateway", () => {
  it("accepts feature frames and emits mycelium snapshots", async () => {
    const gateway = await startGateway();
    const ws = new WebSocket(gateway.url);

    await waitForMessage(ws, "myco.ready");
    const snapshotPromise = waitForMessage(ws, "myco.snapshot");

    ws.send(
      JSON.stringify({
        type: "audio.feature",
        sessionId: "test",
        timestamp: Date.now(),
        bands: {
          subBass: 0.6,
          midBass: 0.5,
          upperBass: 0.4,
          lowMids: 0.2,
          mids: 0.2,
          upperMids: 0.2,
          presence: 0.1,
          air: 0.1,
        },
        pulses: {
          subBass: 1,
          midBass: 0,
          upperBass: 0,
          lowMids: 0,
          mids: 0,
          upperMids: 0,
          presence: 0,
          air: 0,
        },
        frequencyData: { low: 0.5, mid: 0.2, high: 0.1, air: 0.1 },
      })
    );

    const snapshot = await snapshotPromise;
    expect(snapshot).toMatchObject({
      type: "myco.snapshot",
      sessionId: "test",
    });

    ws.close();
    await gateway.close();
  });

  it("emits protocol errors for malformed messages", async () => {
    const gateway = await startGateway();
    const ws = new WebSocket(gateway.url);

    await waitForMessage(ws, "myco.ready");
    const errorPromise = waitForMessage(ws, "myco.error");
    ws.send(JSON.stringify({ type: "audio.feature", sessionId: "" }));

    const error = await errorPromise;
    expect(error).toMatchObject({
      type: "myco.error",
      code: "VALIDATION_ERROR",
    });

    ws.close();
    await gateway.close();
  });
});
