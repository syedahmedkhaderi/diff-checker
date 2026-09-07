import { unzipSync } from "fflate";
export type FileEntry = { path: string; bytes: Uint8Array; text?: string };
export type DocumentProject = {
  files: FileEntry[];
  active: string;
  root: string;
};
export function validPath(p: string) {
  return (
    p.length > 0 &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    !p.split("/").some((x) => x === ".." || x === "." || !x) &&
    !p.includes("\0") &&
    !/^[a-z]:/i.test(p)
  );
}
export function decode(bytes: Uint8Array, encoding = "utf-8") {
  let selected = encoding;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = "utf-16be";
  if (selected === "utf-8" && bytes.slice(0, 8192).includes(0))
    throw Error(
      "This appears to be a binary file. Choose another encoding if it is text.",
    );
  try {
    return new TextDecoder(selected, { fatal: true }).decode(bytes);
  } catch {
    throw Error(
      `Could not decode this file as ${selected}. Change the encoding in Settings and try again.`,
    );
  }
}
const binary = /\.(png|jpg|jpeg|gif|webp|pdf|woff2?|ttf|otf|eps|ico|zip)$/i;
export async function importFiles(
  files: File[],
  encoding: string,
): Promise<DocumentProject> {
  let entries: FileEntry[] = [];
  let total = 0;
  for (const file of files) {
    if (file.size > 40 * 1024 * 1024) throw Error("The import limit is 40 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".zip")) {
      const unzipped = unzipSync(bytes, {
        filter: (entry) => {
          if (entry.originalSize > 40 * 1024 * 1024)
            throw Error("An archive entry exceeds 40 MB.");
          total += entry.originalSize;
          if (total > 40 * 1024 * 1024)
            throw Error("The expanded project exceeds 40 MB.");
          return !entry.name.endsWith("/");
        },
      });
      entries.push(
        ...Object.entries(unzipped).map(([path, bytes]) => ({ path, bytes })),
      );
    } else {
      total += bytes.length;
      entries.push({ path: file.webkitRelativePath || file.name, bytes });
    }
  }
  if (total > 40 * 1024 * 1024 || entries.length > 1000)
    throw Error("Projects must be under 40 MB and 1,000 files.");
  entries = entries.filter(
    (e) => !e.path.startsWith("__MACOSX/") && !e.path.endsWith(".DS_Store"),
  );
  if (entries.some((e) => !validPath(e.path)))
    throw Error("The project contains an unsafe file path.");
  const prefix = entries[0]?.path.split("/")[0] + "/";
  if (entries.length && entries.every((e) => e.path.startsWith(prefix)))
    entries = entries.map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.path)) throw Error("Duplicate file paths in project.");
    seen.add(entry.path);
    if (!binary.test(entry.path)) {
      try {
        entry.text = decode(entry.bytes, encoding);
      } catch (e) {
        if (
          entries.length === 1 ||
          /\.(tex|bib|sty|cls|txt)$/i.test(entry.path)
        )
          throw e;
      }
    }
  }
  if (entries.some((e) => e.text !== undefined && e.text.length > 2_000_000))
    throw Error(
      "A text file exceeds the 2 million character editor limit. Split it into smaller files; project assets may total 40 MB.",
    );
  if (entries.length === 1 && entries[0].text === undefined)
    throw Error(
      "Upload a text file, or a LaTeX project containing text files.",
    );
  const roots = entries.filter(
    (e) => e.text?.includes("\\documentclass") && e.path.endsWith(".tex"),
  );
  const active =
    roots[0]?.path ||
    entries.find((e) => e.path.endsWith(".tex"))?.path ||
    entries.find((e) => e.text !== undefined)?.path;
  if (!active) throw Error("No readable text files were found.");
  return {
    files: entries,
    active,
    root: roots.length === 1 ? roots[0].path : "",
  };
}
export function textOf(p: DocumentProject) {
  return p.files.find((f) => f.path === p.active)?.text || "";
}
export function updateText(p: DocumentProject, text: string) {
  return {
    ...p,
    files: p.files.map((f) => (f.path === p.active ? { ...f, text } : f)),
  };
}
export function emptyProject(name: string): DocumentProject {
  return {
    files: [{ path: name, bytes: new Uint8Array(), text: "" }],
    active: name,
    root: name,
  };
}
export function serialize(p: DocumentProject) {
  return {
    root: p.root,
    files: p.files.map((f) => {
      const bytes =
        f.text === undefined ? f.bytes : new TextEncoder().encode(f.text);
      let str = "";
      for (let i = 0; i < bytes.length; i += 8192)
        str += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { path: f.path, data: btoa(str) };
    }),
  };
}
export function download(
  data: string | Blob,
  name: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(
    typeof data === "string" ? new Blob([data], { type }) : data,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const exampleA = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{xcolor}
\usepackage{hyperref}

\title{A Study of Interesting Things}
\author{Jane Doe}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}

Einstein's famous equation relates energy and mass as
\begin{equation}
  E = mc^2
\end{equation}
which has profound implications in physics.

We evaluate three methods.

\end{document}
`;
export const exampleB = exampleA
  .replace("three methods", "five methods")
  .replace(
    "\\end{document}",
    "\\section{Results}\nOur experiments demonstrate consistent improvements.\n\n\\end{document}",
  );
