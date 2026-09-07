import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Project = { root: string; files: { path: string; data: string }[] };
export type CompileInput = {
  original: Project;
  revised: Project;
  engine: "pdflatex" | "xelatex" | "lualatex";
};
export type Job = {
  id: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  stage: string;
  artifacts: string[];
  errors: string[];
  log: string;
  created: number;
  dir: string;
  process?: ChildProcess;
  cancelled?: boolean;
  done?: Promise<void>;
  timeoutMs?: number;
};
export const jobs = new Map<string, Job>();
const engines = ["pdflatex", "xelatex", "lualatex"];
export function safePath(p: string) {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    p.length < 512 &&
    !p.startsWith("/") &&
    !p.startsWith("-") &&
    !p.includes("\\") &&
    !p.includes("\0") &&
    !p.split("/").some((x) => x === ".." || x === "." || !x) &&
    !/^[a-z]:/i.test(p)
  );
}
export function validate(input: CompileInput) {
  if (!input || !engines.includes(input.engine))
    throw Error("Choose a supported compiler.");
  let total = 0;
  for (const project of [input.original, input.revised]) {
    if (
      !project ||
      !Array.isArray(project.files) ||
      project.files.length > 1000 ||
      !safePath(project.root) ||
      !project.root.endsWith(".tex")
    )
      throw Error("Invalid project or root document.");
    const seen = new Set<string>();
    for (const file of project.files) {
      if (
        !safePath(file.path) ||
        seen.has(file.path) ||
        typeof file.data !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
      )
        throw Error("Invalid or duplicate project file.");
      seen.add(file.path);
      total += Buffer.byteLength(file.data, "base64");
    }
    if (!seen.has(project.root)) throw Error("Root document is missing.");
  }
  if (total > 40 * 1024 * 1024)
    throw Error("Projects exceed the 40 MB combined limit.");
}
function run(
  job: Job,
  command: string,
  args: string[],
  cwd: string,
  timeout = job.timeoutMs ?? 90000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (job.cancelled) return reject(Error("Cancelled"));
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:${process.env.PATH}`,
        shell_escape: "f",
        openout_any: "p",
        openin_any: "p",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    job.process = child;
    let output = "";
    let reason = "";
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      reason = `Compilation exceeded ${timeout / 1000} seconds.`;
      kill();
    }, timeout);
    const append = (data: Buffer) => {
      output += data.toString();
      if (output.length > 2_000_000) {
        reason = "Compiler output exceeded its limit.";
        kill();
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      job.process = undefined;
      job.log += `\n$ ${command} ${args.join(" ")}\n${output.slice(-200000)}\n`;
      if (job.log.length > 800000) job.log = job.log.slice(-800000);
      if (code === 0 && !job.cancelled && !reason) resolve(output);
      else
        reject(
          Error(
            reason ||
              (job.cancelled
                ? "Cancelled"
                : `${command} failed. ${
                    output
                      .split("\n")
                      .filter((l) => /^!|:\d+:|Error|not found/.test(l))
                      .slice(-6)
                      .join("\n") || "See compilation log."
                  }`),
          ),
        );
    });
  });
}
async function materialize(project: Project, dir: string) {
  await mkdir(dir, { recursive: true });
  for (const file of project.files) {
    const dest = path.join(dir, file.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(file.data, "base64"));
  }
}
async function compile(
  job: Job,
  dir: string,
  root: string,
  engine: string,
  artifact: string,
) {
  const flags =
    engine === "pdflatex"
      ? "-pdf"
      : engine === "xelatex"
        ? "-xelatex"
        : "-lualatex";
  await run(
    job,
    "latexmk",
    [
      "-norc",
      flags,
      "-no-shell-escape",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-outdir=build",
      root,
    ],
    dir,
  );
  const pdf = path.join(dir, "build", path.basename(root, ".tex") + ".pdf");
  if ((await stat(pdf)).size > 30 * 1024 * 1024)
    throw Error("Generated PDF exceeds 30 MB.");
  await writeFile(path.join(job.dir, artifact), await readFile(pdf));
  job.artifacts.push(artifact);
}
export async function createJob(
  input: CompileInput,
  limits: { timeoutMs?: number } = {},
) {
  validate(input);
  if (
    [...jobs.values()].some(
      (j) => j.status === "running" || j.status === "queued",
    )
  )
    throw Error("A compilation is already running.");
  const dir = await mkdtemp(path.join(tmpdir(), "diff-"));
  const job: Job = {
    id: randomUUID(),
    status: "queued",
    stage: "Preparing projects",
    timeoutMs: limits.timeoutMs,
    artifacts: [],
    errors: [],
    log: "",
    created: Date.now(),
    dir,
  };
  jobs.set(job.id, job);
  job.done = execute(job, input);
  return job;
}
async function execute(job: Job, input: CompileInput) {
  try {
    job.status = "running";
    const original = path.join(job.dir, "original");
    const revised = path.join(job.dir, "revised");
    await materialize(input.original, original);
    await materialize(input.revised, revised);
    for (const [label, dir, root] of [
      ["original", original, input.original.root],
      ["revised", revised, input.revised.root],
    ]) {
      if (job.cancelled) throw Error("Cancelled");
      job.stage = `Compiling ${label}`;
      try {
        await compile(job, dir, root, input.engine, `${label}.pdf`);
      } catch (e) {
        job.errors.push(`${label}: ${(e as Error).message}`);
      }
    }
    if (job.cancelled) throw Error("Cancelled");
    job.stage = "Marking changes";
    try {
      // Flatten each project from its own root, keeping relative input resolution independent.
      const flatten = async (project: Project, dir: string) => {
        const bbl = path.join(
          dir,
          "build",
          path.basename(project.root, ".tex") + ".bbl",
        );
        let bibliographyArgs: string[] = [];
        try {
          await stat(bbl);
          bibliographyArgs = ["--expand-bbl", bbl];
        } catch {}
        const source = await run(
          job,
          "latexpand",
          ["--fatal", ...bibliographyArgs, project.root],
          dir,
        );
        if (/\\(?:input|include|subfile|import|subimport)\s*[{[]/.test(source))
          throw Error(
            "An inclusion could not be flattened. Use standard input/include paths or flatten this project before comparing PDFs.",
          );
        return source;
      };
      const oldFlat = await flatten(input.original, original);
      const newFlat = await flatten(input.revised, revised);
      const qualify = (source: string, version: string, project: Project) => {
        const declaredPaths = [
          ...source.matchAll(/\\graphicspath\s*\{((?:\{[^}]*\}\s*)+)\}/g),
        ].flatMap((m) => [...m[1].matchAll(/\{([^}]*)\}/g)].map((p) => p[1]));
        return source.replace(
          /(\\includegraphics\*?(?:\[[^\]]*\])?\{)([^}]+)(\})/g,
          (_m, a, p, c) => {
            if (/[\\#]/.test(p))
              throw Error(
                "Dynamic image paths cannot be resolved in the marked-up document. Use literal image paths.",
              );
            const names = ["", ...declaredPaths].flatMap((prefix) =>
              ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps"].map(
                (ext) => prefix + p + ext,
              ),
            );
            const asset = names.find((name) =>
              project.files.some((file) => file.path === name),
            );
            if (!asset)
              throw Error(`Image dependency could not be resolved: ${p}`);
            return `${a}${version}/${asset}${c}`;
          },
        );
      };
      const changes = path.join(job.dir, "changes");
      await mkdir(changes);
      // Reserve internal paths so a project cannot overwrite the other version's assets.
      if (
        input.revised.files.some(
          (f) =>
            /^(original|revised)\//.test(f.path) ||
            ["old-flat.tex", "new-flat.tex", "changes.tex"].includes(f.path),
        )
      )
        throw Error(
          "Rename reserved project paths: original/, revised/, old-flat.tex, new-flat.tex, or changes.tex.",
        );
      await materialize(input.revised, changes);
      await materialize(input.original, path.join(changes, "original"));
      await materialize(input.revised, path.join(changes, "revised"));
      await writeFile(
        path.join(changes, "old-flat.tex"),
        qualify(oldFlat, "original", input.original),
      );
      await writeFile(
        path.join(changes, "new-flat.tex"),
        qualify(newFlat, "revised", input.revised),
      );
      const marked = await run(
        job,
        "latexdiff",
        [
          "--math-markup=whole",
          "--graphics-markup=both",
          "old-flat.tex",
          "new-flat.tex",
        ],
        changes,
      );
      await writeFile(path.join(changes, "changes.tex"), marked);
      await writeFile(path.join(job.dir, "changes.tex"), marked);
      job.artifacts.push("changes.tex");
      job.stage = "Compiling marked-up document";
      await compile(job, changes, "changes.tex", input.engine, "changes.pdf");
    } catch (e) {
      job.errors.push(`changes: ${(e as Error).message}`);
    }
    job.status = job.cancelled
      ? "cancelled"
      : job.artifacts.includes("changes.pdf")
        ? "complete"
        : "failed";
    job.stage =
      job.status === "complete"
        ? "Comparison ready"
        : job.cancelled
          ? "Cancelled"
          : "Compilation finished with errors";
  } catch (e) {
    job.status = job.cancelled ? "cancelled" : "failed";
    job.stage = (e as Error).message;
  } finally {
    await writeFile(path.join(job.dir, "compile.log"), job.log);
    if (!job.artifacts.includes("compile.log"))
      job.artifacts.push("compile.log");
  }
}
export function cancelJob(job: Job) {
  job.cancelled = true;
  job.status = "cancelled";
  job.stage = "Cancelled";
  try {
    if (job.process?.pid && process.platform !== "win32")
      process.kill(-job.process.pid, "SIGKILL");
    else job.process?.kill("SIGKILL");
  } catch {}
}
export async function cleanup() {
  for (const [id, job] of jobs) {
    if (Date.now() - job.created > 60 * 60 * 1000 && job.status !== "running") {
      await rm(job.dir, { recursive: true, force: true });
      jobs.delete(id);
    }
  }
}
export function publicJob(job: Job) {
  const { id, status, stage, artifacts, errors } = job;
  return { id, status, stage, artifacts, errors };
}
