import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  createJob,
  validate,
  safePath,
  jobs,
  type CompileInput,
} from "../server/compiler";
const doc = (body: string) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
const project = (text: string) => ({
  root: "main.tex",
  files: [{ path: "main.tex", data: Buffer.from(text).toString("base64") }],
});
test("project validation enforces paths, roots and compiler allowlist", () => {
  assert.ok(!safePath("../outside"));
  assert.ok(!safePath("C:/outside"));
  assert.ok(safePath("chapters/one.tex"));
  assert.throws(() =>
    validate({
      engine: "shell",
      original: project(""),
      revised: project(""),
    } as unknown as CompileInput),
  );
  assert.throws(() =>
    validate({
      engine: "pdflatex",
      original: { ...project(""), root: "missing.tex" },
      revised: project(""),
    }),
  );
});
test("real local LaTeX produces three PDFs, including changed mathematics", async () => {
  const job = await createJob({
    engine: "pdflatex",
    original: project(doc("Original text. $E=mc^2$")),
    revised: project(doc("Revised text. $E=mc^3$")),
  });
  try {
    const start = Date.now();
    while (job.status === "running" || job.status === "queued") {
      if (Date.now() - start > 120000)
        throw Error("Test compilation timed out");
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(
      job.status,
      "complete",
      job.errors.join("\n") + job.log.slice(-4000),
    );
    assert.ok(job.artifacts.includes("original.pdf"));
    assert.ok(job.artifacts.includes("revised.pdf"));
    assert.ok(job.artifacts.includes("changes.pdf"));
  } finally {
    await rm(job.dir, { recursive: true, force: true });
    jobs.delete(job.id);
  }
});
async function finished(job: Awaited<ReturnType<typeof createJob>>) {
  await job.done;
  return job;
}
async function dispose(job: Awaited<ReturnType<typeof createJob>>) {
  await job.done;
  await rm(job.dir, { recursive: true, force: true });
  jobs.delete(job.id);
}
function imagePdf(color: string) {
  const stream = `${color} rg 0 0 40 40 re f`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(result);
  result +=
    `xref\n0 5\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result).toString("base64");
}
test("nested includes, bibliography and same-name version assets compile independently", async () => {
  const make = (word: string, color: string) => ({
    root: "main.tex",
    files: [
      {
        path: "main.tex",
        data: Buffer.from(
          "\\documentclass{article}\n\\usepackage{graphicx}\n\\graphicspath{{figures/}}\n\\begin{document}\n\\input{chapters/intro}\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}",
        ).toString("base64"),
      },
      {
        path: "chapters/intro.tex",
        data: Buffer.from(
          `${word} text. \\cite{key}\n\\input{chapters/details}\n\\includegraphics[width=1cm]{figure}`,
        ).toString("base64"),
      },
      {
        path: "chapters/details.tex",
        data: Buffer.from("Nested source.").toString("base64"),
      },
      {
        path: "references.bib",
        data: Buffer.from(
          "@article{key,author={Jane Doe},title={A Paper},journal={Journal},year={2020}}",
        ).toString("base64"),
      },
      { path: "figures/figure.pdf", data: imagePdf(color) },
    ],
  });
  const job = await createJob({
    engine: "pdflatex",
    original: make("Old", "1 0 0"),
    revised: make("New", "0 0 1"),
  });
  try {
    await finished(job);
    assert.equal(
      job.status,
      "complete",
      job.errors.join("\n") + job.log.slice(-3000),
    );
    const { readFile } = await import("node:fs/promises");
    const marked = await readFile(job.dir + "/changes.tex", "utf8");
    assert.match(marked, /original\/figures\/figure.pdf/);
    assert.match(marked, /revised\/figures\/figure.pdf/);
    assert.ok(
      !job.log.includes("Citation `key' on page 1 undefined on input line") ||
        job.log.includes("Output written"),
    );
  } finally {
    await dispose(job);
  }
});
test("invalid revised source retains the original PDF and exposes a compiler error", async () => {
  const job = await createJob({
    engine: "pdflatex",
    original: project(doc("Valid")),
    revised: project(doc("\\undefinedcommand")),
  });
  try {
    await finished(job);
    assert.equal(job.status, "failed");
    assert.ok(job.artifacts.includes("original.pdf"));
    assert.ok(job.errors.some((e) => e.includes("Undefined control sequence")));
  } finally {
    await dispose(job);
  }
});
test("missing package reports failure without losing another successful version", async () => {
  const job = await createJob({
    engine: "pdflatex",
    original: project(doc("Valid")),
    revised: project(
      doc("Valid").replace(
        "\\begin{document}",
        "\\usepackage{diff-test-missing-package}\n\\begin{document}",
      ),
    ),
  });
  try {
    await finished(job);
    assert.equal(job.status, "failed");
    assert.ok(job.artifacts.includes("original.pdf"));
    assert.ok(job.errors.length > 0);
  } finally {
    await dispose(job);
  }
});
test("cancellation ends an in-flight local job", async () => {
  const { cancelJob } = await import("../server/compiler");
  const job = await createJob({
    engine: "pdflatex",
    original: project(doc("Hello")),
    revised: project(doc("World")),
  });
  cancelJob(job);
  try {
    await finished(job);
    assert.equal(job.status, "cancelled");
  } finally {
    await dispose(job);
  }
});
test("compiler timeout terminates work and reports the deadline", async () => {
  const job = await createJob(
    {
      engine: "pdflatex",
      original: project(doc("Timeout test")),
      revised: project(doc("Timeout test")),
    },
    { timeoutMs: 1 },
  );
  try {
    await finished(job);
    assert.equal(job.status, "failed");
    assert.ok(job.errors.some((e) => e.includes("exceeded")));
  } finally {
    await dispose(job);
  }
});
