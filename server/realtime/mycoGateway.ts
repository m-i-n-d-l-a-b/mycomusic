import crypto from "node:crypto";
import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  parseClientMessage,
  serializeServerMessage,
  type MycoErrorMessage,
  type MycoReadyMessage,
  type MycoSnapshotMessage,
} from "../domain/mycoProtocol";
import { MycoSimulation } from "../simulation/mycoSimulation";

const MAX_FEATURE_FPS = 35;
const SNAPSHOT_FPS = 30;
const MAX_BUFFERED_BYTES = 1_000_000;

interface GatewaySession {
  id: string;
  latestClientSessionId: string;
  ws: WebSocket;
  simulation: MycoSimulation;
  frameTimes: number[];
  lastTickAt: number;
  interval: NodeJS.Timeout;
}

function sendJson(ws: WebSocket, message: MycoReadyMessage | MycoSnapshotMessage | MycoErrorMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(serializeServerMessage(message));
}

function errorMessage(code: MycoErrorMessage["code"], message: string): MycoErrorMessage {
  return { type: "myco.error", code, message };
}

function isRateLimited(session: GatewaySession, now: number): boolean {
  session.frameTimes = session.frameTimes.filter((time) => now - time < 1_000);
  session.frameTimes.push(now);
  return session.frameTimes.length > MAX_FEATURE_FPS;
}

function startSnapshotLoop(session: GatewaySession, wss: WebSocketServer): void {
  session.interval = setInterval(() => {
    const now = Date.now();
    const deltaSec = Math.min(0.1, Math.max(1 / 120, (now - session.lastTickAt) / 1_000));
    session.lastTickAt = now;

    if (session.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      session.simulation.noteDroppedFrame();
      return;
    }

    const snapshot = session.simulation.step(deltaSec, wss.clients.size);
    sendJson(session.ws, {
      type: "myco.snapshot",
      sessionId: session.latestClientSessionId,
      timestamp: now,
      ...snapshot,
    });
  }, 1_000 / SNAPSHOT_FPS);
}

export function attachMycoGateway(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const id = crypto.randomUUID();
    const session: GatewaySession = {
      id,
      latestClientSessionId: id,
      ws,
      simulation: new MycoSimulation({ seed: id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) }),
      frameTimes: [],
      lastTickAt: Date.now(),
      interval: setInterval(() => undefined, 1_000),
    };
    clearInterval(session.interval);

    sendJson(ws, {
      type: "myco.ready",
      sessionId: id,
      capabilities: {
        maxFeatureFps: MAX_FEATURE_FPS,
        snapshotFps: SNAPSHOT_FPS,
        backendOwnsSimulation: true,
      },
    });

    startSnapshotLoop(session, wss);

    ws.on("message", (raw) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(String(raw));
      } catch {
        sendJson(ws, errorMessage("VALIDATION_ERROR", "Message must be valid JSON"));
        return;
      }

      const parsed = parseClientMessage(parsedJson);
      if (!parsed.success) {
        sendJson(ws, errorMessage("VALIDATION_ERROR", parsed.error));
        return;
      }

      const now = Date.now();
      if (isRateLimited(session, now)) {
        sendJson(ws, errorMessage("RATE_LIMITED", `Feature stream exceeds ${MAX_FEATURE_FPS} fps`));
        return;
      }

      session.latestClientSessionId = parsed.message.sessionId;
      session.simulation.acceptFeature(parsed.message);
    });

    ws.on("close", () => {
      clearInterval(session.interval);
    });

    ws.on("error", () => {
      clearInterval(session.interval);
    });
  });

  return wss;
}
