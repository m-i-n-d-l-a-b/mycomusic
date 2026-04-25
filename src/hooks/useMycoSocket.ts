import { useEffect, useRef, useState } from "react";
import { useAudioStore } from "../store/audioStore";
import type {
  AudioFeatureFrame,
  AudioSourceKind,
  MycoErrorMessage,
  MycoSnapshotMessage,
  MycoServerMessage,
} from "../../server/domain/mycoProtocol";

type ConnectionState = "connecting" | "open" | "closed" | "error";

interface UseMycoSocketResult {
  connectionState: ConnectionState;
  snapshot: MycoSnapshotMessage | null;
  error: string | null;
  sessionId: string;
}

const FEATURE_FRAME_INTERVAL_MS = 1_000 / 30;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5_000;

function getWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_MYCO_WS_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV && window.location.port === "5173") {
    return `${protocol}//${window.location.hostname}:8787/ws`;
  }

  return `${protocol}//${window.location.host}/ws`;
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

export function useMycoSocket(): UseMycoSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [snapshot, setSnapshot] = useState<MycoSnapshotMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef(sessionId);
  const lastSentAtRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current !== null) return;
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
      if (disposed) return;

      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;
      setConnectionState("connecting");

      ws.addEventListener("open", () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("open");
        setError(null);
      });

      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        setConnectionState("closed");
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        setConnectionState("error");
        setError("WebSocket connection failed");
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
          setSnapshot(message);
          return;
        }
        if (message.type === "myco.error") {
          const mycoError = message as MycoErrorMessage;
          setError(mycoError.message);
        }
      });
    };

    connect();

    const unsubscribe = useAudioStore.subscribe((state) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
        frequencyData: state.frequencyData,
      };

      ws.send(JSON.stringify(frame));
    });

    return () => {
      disposed = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      unsubscribe();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return {
    connectionState,
    snapshot,
    error,
    sessionId,
  };
}
