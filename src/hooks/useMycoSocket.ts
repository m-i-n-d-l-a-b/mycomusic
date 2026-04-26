import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { MycoSimulation } from "../../server/simulation/mycoSimulation";
import { useAudioStore } from "../store/audioStore";
import type {
  AudioFeatureFrame,
  AudioSourceKind,
  MycoErrorMessage,
  MycoSnapshotMessage,
  MycoServerMessage,
} from "../../server/domain/mycoProtocol";

type ConnectionState = "connecting" | "open" | "closed" | "error" | "local";

/** Full graph snapshots: latest copy in `snapshotRef` (server ~12/s) for canvas rendering. */
export interface UseMycoSocketResult {
  connectionState: ConnectionState;
  snapshotRef: MutableRefObject<MycoSnapshotMessage | null>;
  error: string | null;
  sessionId: string;
}

const FEATURE_FRAME_INTERVAL_MS = 1_000 / 30;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5_000;
/** Matches server `SNAPSHOT_FPS` in `server/realtime/mycoGateway.ts` for local fallback. */
const SNAPSHOT_INTERVAL_MS = 1_000 / 12;

function getConfiguredWebSocketUrl(): string | null {
  const configuredUrl = import.meta.env.VITE_MYCO_WS_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }

  return null;
}

function getWebSocketUrl(): string {
  const configuredUrl = getConfiguredWebSocketUrl();
  if (configuredUrl) return configuredUrl;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV && window.location.port === "5173") {
    return `${protocol}//${window.location.hostname}:8787/ws`;
  }

  return `${protocol}//${window.location.host}/ws`;
}

function shouldUseLocalFallback(): boolean {
  return !import.meta.env.DEV && getConfiguredWebSocketUrl() === null;
}

function isWebSocketDisabled(): boolean {
  const disabled = import.meta.env.VITE_MYCO_DISABLE_WS;
  return disabled === "true" || disabled === "1";
}

function shouldStartWithLocalFallback(): boolean {
  return shouldUseLocalFallback() && (isWebSocketDisabled() || window.location.hostname.endsWith(".vercel.app"));
}

function seedFromSession(sessionId: string): number {
  return sessionId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getAudioSourceKind(): AudioSourceKind {
  const state = useAudioStore.getState();
  if (state.captureSource) return state.captureSource;
  if (state.audioBuffer) return "file";
  return "input";
}

function parseServerMessage(data: unknown): MycoServerMessage | null {
  try {
    const message = JSON.parse(String(data)) as Partial<MycoServerMessage>;
    if (
      message.type === "myco.ready" ||
      message.type === "myco.snapshot" ||
      message.type === "myco.telemetry" ||
      message.type === "myco.error"
    ) {
      return message as MycoServerMessage;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Pushes the latest full snapshot to `snapshotRef` for the canvas to read on every rAF.
 */
function wireSnapshot(
  msg: MycoSnapshotMessage,
  snapshotRef: MutableRefObject<MycoSnapshotMessage | null>
): void {
  snapshotRef.current = msg;
}

export function useMycoSocket(): UseMycoSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const snapshotRef = useRef<MycoSnapshotMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef(sessionId);
  const lastSentAtRef = useRef(0);
  const lastFeatureRefsRef = useRef<{
    bands: unknown;
    pulses: unknown;
    isPlaying: boolean;
    captureSource: unknown;
  } | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const localSimulationRef = useRef<MycoSimulation | null>(null);
  const localSnapshotTimerRef = useRef<number | null>(null);
  const localLastTickAtRef = useRef(0);
  const isUsingLocalFallbackRef = useRef(false);
  const hasOpenedSocketRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const stopLocalFallback = () => {
      isUsingLocalFallbackRef.current = false;
      localSimulationRef.current = null;
      localLastTickAtRef.current = 0;
      if (localSnapshotTimerRef.current !== null) {
        window.clearInterval(localSnapshotTimerRef.current);
        localSnapshotTimerRef.current = null;
      }
    };

    const startLocalFallback = () => {
      if (disposed || isUsingLocalFallbackRef.current) return;

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      wsRef.current?.close();
      wsRef.current = null;
      isUsingLocalFallbackRef.current = true;
      const localSessionId = sessionIdRef.current;
      localSimulationRef.current = new MycoSimulation({ seed: seedFromSession(localSessionId) });
      localLastTickAtRef.current = Date.now();
      setConnectionState("local");
      setError(null);

      localSnapshotTimerRef.current = window.setInterval(() => {
        const simulation = localSimulationRef.current;
        if (!simulation) return;

        const now = Date.now();
        const deltaSec = Math.min(0.25, Math.max(1 / 120, (now - localLastTickAtRef.current) / 1_000));
        localLastTickAtRef.current = now;
        const next: MycoSnapshotMessage = {
          type: "myco.snapshot",
          sessionId: localSessionId,
          timestamp: now,
          ...simulation.step(deltaSec, 1),
        };
        wireSnapshot(next, snapshotRef);
      }, SNAPSHOT_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (disposed || isUsingLocalFallbackRef.current || reconnectTimerRef.current !== null) return;
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttemptRef.current
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || isUsingLocalFallbackRef.current) return;

      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;
      setConnectionState("connecting");

      ws.addEventListener("open", () => {
        stopLocalFallback();
        hasOpenedSocketRef.current = true;
        reconnectAttemptRef.current = 0;
        setConnectionState("open");
        setError(null);
      });

      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (isUsingLocalFallbackRef.current) return;
        setConnectionState("closed");
        if (shouldUseLocalFallback() && !hasOpenedSocketRef.current) {
          startLocalFallback();
          return;
        }
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        setConnectionState("error");
        setError("WebSocket connection failed");
        if (shouldUseLocalFallback() && !hasOpenedSocketRef.current) {
          startLocalFallback();
        }
      });

      ws.addEventListener("message", (event) => {
        const message = parseServerMessage(event.data);
        if (!message) {
          setError("Received malformed WebSocket message");
          return;
        }

        if (message.type === "myco.ready") {
          sessionIdRef.current = message.sessionId;
          setSessionId(message.sessionId);
          return;
        }
        if (message.type === "myco.snapshot") {
          wireSnapshot(message, snapshotRef);
          return;
        }
        if (message.type === "myco.error") {
          const mycoError = message as MycoErrorMessage;
          setError(mycoError.message);
        }
      });
    };

    if (shouldStartWithLocalFallback()) {
      startLocalFallback();
    } else {
      connect();
    }

    const unsubscribe = useAudioStore.subscribe((state) => {
      const lastFeatureRefs = lastFeatureRefsRef.current;
      if (
        lastFeatureRefs?.bands === state.bands &&
        lastFeatureRefs.pulses === state.pulses &&
        lastFeatureRefs.isPlaying === state.isPlaying &&
        lastFeatureRefs.captureSource === state.captureSource
      ) {
        return;
      }
      lastFeatureRefsRef.current = {
        bands: state.bands,
        pulses: state.pulses,
        isPlaying: state.isPlaying,
        captureSource: state.captureSource,
      };

      const ws = wsRef.current;
      if (!(state.isPlaying || state.captureSource)) return;

      const now = performance.now();
      if (now - lastSentAtRef.current < FEATURE_FRAME_INTERVAL_MS) return;
      lastSentAtRef.current = now;

      const frame: AudioFeatureFrame = {
        type: "audio.feature",
        sessionId: sessionIdRef.current,
        timestamp: Date.now(),
        source: getAudioSourceKind(),
        bands: state.bands,
        pulses: state.pulses,
      };

      if (isUsingLocalFallbackRef.current) {
        localSimulationRef.current?.acceptFeature(frame);
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(frame));
    });

    return () => {
      disposed = true;
      snapshotRef.current = null;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      unsubscribe();
      wsRef.current?.close();
      wsRef.current = null;
      stopLocalFallback();
    };
  }, []);

  return {
    connectionState,
    snapshotRef,
    error,
    sessionId,
  };
}
