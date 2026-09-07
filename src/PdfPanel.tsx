import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Play,
  Square,
  RefreshCw,
  FileText,
  LoaderCircle,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentProject } from "./files";
import { serialize, download } from "./files";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
type Job = {
  id: string;
  status: string;
  stage: string;
  artifacts: string[];
  errors: string[];
};
let session = "";
async function api(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  if (!session) {
    const response = await fetch("/api/session");
    if (!response.ok)
      throw Error(
        "Local companion unavailable. Start it with npm run dev or npm start.",
      );
    session = (await response.json()).token;
  }
  const response = await fetch("/api/" + path, {
    ...init,
    headers: { ...init.headers, "x-diff-token": session },
  });
  if (!response.ok) {
    if (response.status === 401 && retry) {
      session = "";
      return api(path, init, false);
    }
    throw Error((await response.json()).error || "Request failed");
  }
  return response;
}
export function PdfPanel({
  projects,
  revision,
}: {
  projects: DocumentProject[];
  revision: number;
}) {
  const [engine, setEngine] = useState("pdflatex"),
    [capabilities, setCapabilities] = useState<string[]>([]),
    [available, setAvailable] = useState(false),
    [job, setJob] = useState<Job | null>(null),
    [message, setMessage] = useState("Checking local compiler…"),
    [selected, setSelected] = useState("changes.pdf"),
    [compiledAt, setCompiledAt] = useState(-1),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(0),
    [zoom, setZoom] = useState(1),
    [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null),
    [logs, setLogs] = useState(""),
    [showLogs, setShowLogs] = useState(false),
    [starting, setStarting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy =
    starting || job?.status === "queued" || job?.status === "running";
  async function check() {
    try {
      const c = await (await api("capabilities")).json();
      setCapabilities(c.engines);
      setAvailable(
        c.latexmk && c.latexdiff && c.latexpand && c.engines.length > 0,
      );
      setMessage(
        c.latexmk && c.latexdiff && c.latexpand
          ? "Local compiler ready"
          : "Install latexmk, latexdiff, and latexpand through your TeX distribution.",
      );
    } catch {
      setAvailable(false);
      setMessage(
        "Local companion unavailable. Start it with npm run dev or npm start.",
      );
    }
  }
  useEffect(() => {
    void check();
  }, []);
  useEffect(() => {
    if (!job || !busy) return;
    const id = setInterval(async () => {
      try {
        setJob(await (await api(`jobs/${job.id}`)).json());
      } catch (e) {
        setMessage((e as Error).message);
        setJob((j) => (j ? { ...j, status: "failed" } : j));
      }
    }, 600);
    return () => clearInterval(id);
  }, [job?.id, busy]);
  useEffect(() => {
    if (!job?.artifacts.includes(selected)) {
      setPdf(null);
      setPages(0);
      return;
    }
    setPdf(null);
    setPages(0);
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const data = await (
          await api(`jobs/${job.id}/artifacts/${selected}`)
        ).arrayBuffer();
        task = pdfjs.getDocument({ data });
        const document = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setMessage("");
        setPdf(document);
        setPages(document.numPages);
        setPage(1);
      } catch (e) {
        if (!cancelled) setMessage((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [job?.id, job?.artifacts.join(","), selected]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false,
      render: pdfjs.RenderTask | undefined;
    void (async () => {
      try {
        const sheet = await pdf.getPage(page);
        if (cancelled) return;
        const viewport = sheet.getViewport({ scale: zoom * 1.25 });
        const c = canvas.current!;
        const ratio = window.devicePixelRatio || 1;
        c.width = viewport.width * ratio;
        c.height = viewport.height * ratio;
        c.style.width = viewport.width + "px";
        c.style.height = viewport.height + "px";
        render = sheet.render({
          canvas: c,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        await render.promise;
      } catch (e) {
        if (!cancelled) setMessage((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, page, zoom]);
  async function compile() {
    setStarting(true);
    setMessage("");
    setLogs("");
    try {
      if (projects.some((p) => !p.root))
        throw Error("Choose a root .tex document for each project in Files.");
      const snapshot = revision;
      const result = await (
        await api("jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            original: serialize(projects[0]),
            revised: serialize(projects[1]),
            engine,
          }),
        })
      ).json();
      setJob(result);
      setCompiledAt(snapshot);
      setSelected("changes.pdf");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function artifact(name: string) {
    if (!job) return;
    download(
      await (await api(`jobs/${job.id}/artifacts/${name}`)).blob(),
      name,
    );
  }
  async function viewLogs() {
    setShowLogs(!showLogs);
    if (job?.artifacts.includes("compile.log"))
      try {
        setLogs(
          await (await api(`jobs/${job.id}/artifacts/compile.log`)).text(),
        );
      } catch (e) {
        setMessage((e as Error).message);
      }
  }
  return (
    <section className="pdf-panel">
      <div className="pdf-toolbar">
        <div className="segmented">
          {["changes", "original", "revised"].map((name) => (
            <button
              key={name}
              className={selected === name + ".pdf" ? "selected" : ""}
              onClick={() => setSelected(name + ".pdf")}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <select
            aria-label="LaTeX engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
          >
            {(capabilities.length ? capabilities : ["pdflatex"]).map((e) => (
              <option key={e} value={e}>
                {e === "pdflatex"
                  ? "pdfLaTeX"
                  : e === "xelatex"
                    ? "XeLaTeX"
                    : "LuaLaTeX"}
              </option>
            ))}
          </select>
          {busy ? (
            <button
              onClick={() =>
                job &&
                void api(`jobs/${job.id}`, { method: "DELETE" })
                  .then((r) => r.json())
                  .then(setJob)
                  .catch((e) => setMessage(e.message))
              }
            >
              <Square size={14} />
              Cancel
            </button>
          ) : (
            <button
              className="primary"
              disabled={!available}
              onClick={() => void compile()}
            >
              <Play size={14} />
              Compile comparison
            </button>
          )}
        </div>
      </div>
      <div className="compile-status" role="status">
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <span className={`status-dot ${available ? "ready" : ""}`} />
        )}
        <span>
          {busy ? job?.stage || "Starting compilation…" : job?.stage || message}
        </span>
        {!available && (
          <button className="text-button" onClick={() => void check()}>
            <RefreshCw size={13} />
            Retry
          </button>
        )}
        {compiledAt >= 0 && compiledAt !== revision && (
          <span className="stale">Source changed · recompile to update</span>
        )}
        {job?.artifacts.includes("compile.log") && (
          <button
            className="text-button push-right"
            onClick={() => void viewLogs()}
          >
            Compilation log
          </button>
        )}
      </div>
      {message && job && <div className="notice">{message}</div>}
      {job?.errors.map((error, i) => (
        <details className="compile-error" key={i}>
          <summary>{error.split("\n")[0]}</summary>
          <pre>{error}</pre>
        </details>
      ))}
      {showLogs && (
        <pre className="log-output">
          {logs || "Log will be available when compilation finishes."}
        </pre>
      )}
      {pdf ? (
        <>
          <div className="pdf-view-controls">
            <button
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <select
              aria-label="PDF zoom"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
                <option value={z} key={z}>
                  {z * 100}%
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                void artifact(selected).catch((e) => setMessage(e.message))
              }
            >
              <Download size={14} />
              PDF
            </button>
            {job?.artifacts.includes("changes.tex") && (
              <button
                onClick={() =>
                  void artifact("changes.tex").catch((e) =>
                    setMessage(e.message),
                  )
                }
              >
                <FileText size={14} />
                Diff source
              </button>
            )}
          </div>
          <div className="pdf-canvas-wrap">
            <canvas ref={canvas} aria-label={`${selected} page ${page}`} />
          </div>
        </>
      ) : (
        <div className="pdf-empty">
          <div className="empty-icon">
            <FileText size={28} strokeWidth={1.4} />
          </div>
          <h2>
            {busy
              ? "Preparing your documents"
              : job
                ? "No PDF for this view yet"
                : "See changes on the page"}
          </h2>
          <p>
            {busy
              ? "Your LaTeX project is compiling on this computer."
              : job
                ? "Check the compilation details or select an available original."
                : "Compile both versions and a marked-up document with additions and deletions."}
          </p>
          {!job && (
            <small>
              Uses your local TeX installation. Intended for trusted projects.
            </small>
          )}
        </div>
      )}
    </section>
  );
}
