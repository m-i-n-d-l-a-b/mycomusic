import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachMycoGateway } from "./realtime/mycoGateway";

const DEFAULT_PORT = 8787;
const DEFAULT_CLIENT_DIST_PATH = path.resolve(process.cwd(), "dist");

export function isMainModule(metaUrl: string, argvEntry = process.argv[1]): boolean {
  if (!argvEntry) return false;
  return path.resolve(argvEntry) === fileURLToPath(metaUrl);
}

export function createMycoHttpServer() {
  const app = express();
  const clientDistPath = process.env.MYCO_CLIENT_DIST_PATH ?? DEFAULT_CLIENT_DIST_PATH;
  const clientIndexPath = path.join(clientDistPath, "index.html");

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "myco-acoustic-engine",
      websocketPath: "/ws",
    });
  });

  if (fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistPath));
    app.get(/.*/, (_request, response) => {
      response.sendFile(clientIndexPath);
    });
  }

  const server = http.createServer(app);
  const websocketServer = attachMycoGateway(server);

  return { app, server, websocketServer };
}

if (isMainModule(import.meta.url)) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const { server } = createMycoHttpServer();

  server.listen(port, () => {
    console.log(`Myco-Acoustic Engine listening on http://127.0.0.1:${port}`);
  });
}
