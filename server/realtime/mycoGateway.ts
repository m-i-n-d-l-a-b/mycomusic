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
/** Full graph snapshots per second; keep audio features at ~30fps from the client. */
const SNAPSHOT_FPS = 12;
const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_MESSAGE_BYTES = 16_384;
const MAX_DELTA_SEC = 0.25;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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
  if (session.frameTimes.length >= MAX_FEATURE_FPS) return true;
  session.frameTimes.push(now);
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.MYCO_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function isAllowedOrigin(request: http.IncomingMessage): boolean {
  const originHeader = request.headers.origin;
  if (!originHeader) return true;

  try {
    const origin = new URL(originHeader);
    const hostHeader = request.headers.host;
    const requestHost = hostHeader ? new URL(`http://${hostHeader}`) : null;

    if (requestHost && origin.host === requestHost.host) return true;
    if (requestHost && isLoopbackHost(origin.hostname) && isLoopbackHost(requestHost.hostname)) {
      return true;
    }

    return allowedOrigins().has(origin.origin);
  } catch {
    return false;
  }
}

function rawMessageSize(raw: WebSocket.RawData): number {
  if (typeof raw === "string") return Buffer.byteLength(raw);
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return raw.reduce((sum, chunk) => sum + chunk.byteLength, 0);
}

function startSnapshotLoop(session: GatewaySession, wss: WebSocketServer): void {
  session.interval = setInterval(() => {
    const now = Date.now();
    const deltaSec = Math.min(MAX_DELTA_SEC, Math.max(1 / 120, (now - session.lastTickAt) / 1_000));
    session.lastTickAt = now;
    const snapshot = session.simulation.step(deltaSec, wss.clients.size);

    if (session.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      session.simulation.noteDroppedFrame();
      return;
    }

    sendJson(session.ws, {
      type: "myco.snapshot",
      sessionId: session.latestClientSessionId,
      timestamp: now,
      ...snapshot,
    });
  }, 1_000 / SNAPSHOT_FPS);
}

export function attachMycoGateway(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws" || !isAllowedOrigin(request)) {
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
      if (rawMessageSize(raw) > MAX_MESSAGE_BYTES) {
        sendJson(ws, errorMessage("VALIDATION_ERROR", "Message exceeds maximum payload size"));
        return;
      }

      const now = Date.now();
      if (isRateLimited(session, now)) {
        sendJson(ws, errorMessage("RATE_LIMITED", `Feature stream exceeds ${MAX_FEATURE_FPS} fps`));
        return;
      }

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
