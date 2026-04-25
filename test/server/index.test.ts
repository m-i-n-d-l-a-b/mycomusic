import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMycoHttpServer, isMainModule } from "../../server/index";

function request(server: http.Server, pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Expected TCP server address"));
      return;
    }

    http
      .get(`http://127.0.0.1:${address.port}${pathname}`, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      })
      .on("error", reject);
  });
}

describe("createMycoHttpServer", () => {
  const originalClientDistPath = process.env.MYCO_CLIENT_DIST_PATH;

  afterEach(() => {
    if (originalClientDistPath === undefined) {
      delete process.env.MYCO_CLIENT_DIST_PATH;
    } else {
      process.env.MYCO_CLIENT_DIST_PATH = originalClientDistPath;
    }
  });

  it("serves the built client when a client dist path is configured", async () => {
    const clientDistPath = await fs.mkdtemp(path.join(os.tmpdir(), "myco-client-"));
    await fs.writeFile(
      path.join(clientDistPath, "index.html"),
      "<!doctype html><div id=\"root\">myco client</div>"
    );
    process.env.MYCO_CLIENT_DIST_PATH = clientDistPath;

    const { server } = createMycoHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const response = await request(server, "/");

      expect(response.status).toBe(200);
      expect(response.body).toContain("myco client");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(clientDistPath, { recursive: true, force: true });
    }
  });
});

describe("isMainModule", () => {
  it("detects the entrypoint using filesystem paths instead of raw file URL strings", () => {
    const entryPath = path.resolve("server/index.ts");
    const metaUrl = pathToFileURL(entryPath).href;

    expect(isMainModule(metaUrl, entryPath)).toBe(true);
  });
});
