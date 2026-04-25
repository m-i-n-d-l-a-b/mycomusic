# Myco-Acoustic Engine

Backend-first audio-reactive visualizer that maps browser-derived audio features into a simulated mycelium network.

## Architecture

- The browser owns audio permissions, playback, capture, and FFT analysis through `src/audio/useAudioEngine.ts` and `src/audio/useFrequencyAnalyzer.ts`.
- The frontend streams normalized feature frames to the backend over `/ws`.
- The Express/WebSocket backend owns the Myco-Acoustic Engine: protocol validation, audio-to-fungal mapping, deterministic graph growth, anastomosis, electrophysiological spikes, and telemetry.
- The current frontend is intentionally minimal: audio controls, a 2D rhizosphere canvas stub, and a fungal telemetry HUD.

## Local Development

```bash
npm install
npm run dev
```

This starts:

- Vite client on `http://127.0.0.1:5173`
- Express/WebSocket backend on `http://127.0.0.1:8787`
- WebSocket endpoint at `/ws`
- Health endpoint at `/health`

## Verification

```bash
npm run type-check
npm test
npm run build
```

The test suite covers:

- Protocol validation and numeric clamping.
- Audio-to-mycelium biological mapping.
- Deterministic mycelium graph growth and topology behavior.
- WebSocket acceptance, validation errors, and snapshot emission.

## Deployment

Vercel's Vite preset deploys the static client only, so the Express/WebSocket server in `server/`
does not run there. On `.vercel.app` deployments, the client runs the same simulation engine in
the browser unless an explicit WebSocket URL is configured. Other production hosts try `/ws` once
and then fall back locally if no WebSocket endpoint is available.

To run the backend-owned simulation in production, deploy `npm start` on a host that supports
WebSocket upgrades, set `MYCO_ALLOWED_ORIGINS` on that backend to your client origin, and set
`VITE_MYCO_WS_URL=wss://your-backend.example.com/ws` before building the Vercel client.

## v1 Mapping

- Amplitude drives apical tip growth pressure.
- Bass-heavy frames bias toward ECM morphology: thicker, slower, denser growth.
- Treble-heavy frames bias toward AM morphology: thinner, faster, more branched growth.
- Transient pulses generate simulated bio-voltage from `0.3` to `2.1` mV.
- Sustained low-flux mid-band energy acts as the v1 harmony proxy for anastomosis and nutrient-transfer state.
