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

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function getAudioSourceKind(): AudioSourceKind {
  const state = useAudioStore.getState();
  if (state.captureSource) return state.captureSource;
  if (state.audioBuffer) return "file";
  return "input";
}

export function useMycoSocket(): UseMycoSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [snapshot, setSnapshot] = useState<MycoSnapshotMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;
    setConnectionState("connecting");

    ws.addEventListener("open", () => {
      setConnectionState("open");
      setError(null);
    });

    ws.addEventListener("close", () => {
      setConnectionState("closed");
    });

    ws.addEventListener("error", () => {
      setConnectionState("error");
      setError("WebSocket connection failed");
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as MycoServerMessage;
      if (message.type === "myco.snapshot") {
        setSnapshot(message);
        return;
      }
      if (message.type === "myco.error") {
        const mycoError = message as MycoErrorMessage;
        setError(mycoError.message);
      }
    });

    const unsubscribe = useAudioStore.subscribe((state) => {
      if (ws.readyState !== WebSocket.OPEN) return;
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
      unsubscribe();
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return {
    connectionState,
    snapshot,
    error,
    sessionId: sessionIdRef.current,
  };
}
