import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { jobs, createJob, cancelJob, cleanup, publicJob } from "./compiler";
const port = 5273,
  token = randomBytes(32).toString("hex");
const allowed = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
const send = (res: http.ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (!/^(127\.0\.0\.1|localhost):(5273|5173)$/.test(host)) {
      send(res, 403, { error: "Invalid host" });
      return;
    }
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) {
      if (req.headers.origin && !allowed.has(req.headers.origin)) {
        send(res, 403, { error: "Invalid origin" });
        return;
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        send(res, 403, { error: "Cross-site request denied" });
        return;
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        send(res, 200, { token });
        return;
      }
      const provided = String(req.headers["x-diff-token"] || "");
      if (
        provided.length !== token.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
      ) {
        send(res, 401, { error: "Local session required" });
        return;
      }
      if (url.pathname === "/api/capabilities") {
        const available = (bin: string) =>
          !spawnSync(bin, ["--version"], {
            env: {
              ...process.env,
              PATH: `/Library/TeX/texbin:${process.env.PATH}`,
            },
            timeout: 3000,
          }).error;
        send(res, 200, {
          latexmk: available("latexmk"),
          latexdiff: available("latexdiff"),
          latexpand: available("latexpand"),
          engines: ["pdflatex", "xelatex", "lualatex"].filter(available),
        });
        return;
      }
      if (url.pathname === "/api/jobs" && req.method === "POST") {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 57 * 1024 * 1024) {
            send(res, 413, { error: "Projects exceed upload limit" });
            return;
          }
          chunks.push(chunk);
        }
        send(
          res,
          202,
          publicJob(
            await createJob(JSON.parse(Buffer.concat(chunks).toString())),
          ),
        );
        return;
      }
      const match = url.pathname.match(
        /^\/api\/jobs\/([^/]+)(?:\/artifacts\/([^/]+))?$/,
      );
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) {
          send(res, 404, { error: "Job expired or unavailable" });
          return;
        }
        if (req.method === "DELETE") {
          cancelJob(job);
          send(res, 200, publicJob(job));
          return;
        }
        if (match[2]) {
          if (!job.artifacts.includes(match[2])) {
            send(res, 404, { error: "Artifact unavailable" });
            return;
          }
          res.writeHead(200, {
            "Content-Type": match[2].endsWith(".pdf")
              ? "application/pdf"
              : "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(await readFile(path.join(job.dir, match[2])));
          return;
        }
        send(res, 200, publicJob(job));
        return;
      }
      send(res, 404, { error: "Not found" });
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      send(res, 200, { message: "Open http://127.0.0.1:5173" });
      return;
    }
    const base = path.resolve("dist");
    let file = path.resolve(base, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + path.sep) && file !== base) {
      send(res, 403, { error: "Invalid path" });
      return;
    }
    const hashedAsset = url.pathname.startsWith("/assets/");
    try {
      if (!(await stat(file)).isFile()) throw 0;
    } catch {
      // Hashed asset names are exact; a miss is a 404, not the SPA shell
      // (serving HTML as .js would just fail nosniff and wedge the page).
      if (hashedAsset) {
        send(res, 404, { error: "Not found" });
        return;
      }
      file = path.join(base, "index.html");
    }
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      // Vite fingerprints asset filenames, so they can cache forever; the
      // HTML shell must always revalidate so new builds are picked up.
      "Cache-Control": hashedAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(await readFile(file));
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Diff companion: http://127.0.0.1:${port}`),
);
setInterval(() => void cleanup(), 60000).unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    for (const job of jobs.values()) {
      cancelJob(job);
      await rm(job.dir, { recursive: true, force: true });
    }
    server.close(() => process.exit());
  });
