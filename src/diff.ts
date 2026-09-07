import { diffArrays, createTwoFilesPatch } from "diff";
import { Change } from "@codemirror/merge";
export type Options = {
  ignoreCase: boolean;
  whitespace: boolean;
  comments: boolean;
  reflow: boolean;
  latex: boolean;
};
export const defaultOptions: Options = {
  ignoreCase: false,
  whitespace: false,
  comments: false,
  reflow: false,
  latex: true,
};
type Token = { value: string; from: number; to: number };
export function tokenize(source: string, options: Options): Token[] {
  const tokens: Token[] = [];
  let at = 0,
    math = "",
    verbatim = "";
  const push = (value: string, from: number, to: number) =>
    tokens.push({
      value: options.ignoreCase ? value.toLocaleLowerCase() : value,
      from,
      to,
    });
  while (at < source.length) {
    const start = at,
      rest = source.slice(at);
    let value = "";
    if (options.latex) {
      const env = rest.match(
        /^\\(begin|end)\{(verbatim\*?|lstlisting|minted|equation\*?|align\*?|gather\*?|displaymath|math)\}/,
      );
      if (env) {
        value = env[0];
        const isVerb = /^(verbatim|lstlisting|minted)/.test(env[2]);
        if (isVerb) verbatim = env[1] === "begin" ? env[2] : "";
        else math = env[1] === "begin" ? env[2] : "";
      } else if (verbatim) {
        value = rest.match(/^[^\n\\]+|^[\s\S]/)![0];
      } else if (rest.startsWith("\\verb")) {
        value = rest.match(/^\\verb\*?([^\w\s])[^\n]*?\1/)?.[0] || "\\verb";
      } else if (rest[0] === "%") {
        value = rest.match(/^[^\n]*/)![0];
        at += value.length;
        if (!options.comments) push(value, start, at);
        continue;
      } else if (rest.startsWith("\\(") || rest.startsWith("\\[")) {
        value = rest.slice(0, 2);
        math = value;
      } else if (rest.startsWith("\\)") || rest.startsWith("\\]")) {
        value = rest.slice(0, 2);
        math = "";
      } else if (rest[0] === "$") {
        value = rest.startsWith("$$") ? "$$" : "$";
        math = math === value ? "" : value;
      } else if (rest[0] === "\\") {
        value = rest.match(/^\\(?:[a-zA-Z@]+\*?|[^\r\n])/)?.[0] || "\\";
      }
    }
    if (!value)
      value = rest.match(
        /^(?:\r\n|\r|\n)|^[\t ]+|^[\p{L}\p{N}_]+|^[\s\S]/u,
      )![0];
    at += value.length;
    if (!math && !verbatim && /^\s+$/.test(value)) {
      if (options.whitespace) continue;
      if (options.reflow) {
        // A blank line is a paragraph boundary; a single prose newline is a space.
        const previous = tokens[tokens.length - 1];
        const normalized = /\r|\n/.test(value)
          ? " "
          : value.replace(/[\t ]+/g, " ");
        if (previous?.value === " ") {
          if (
            /\n/.test(value) &&
            /\n/.test(source.slice(previous.from, previous.to))
          )
            push("\n\n", start, at);
          else previous.to = at;
          continue;
        }
        push(normalized, start, at);
        continue;
      }
    }
    push(value === "\r\n" || value === "\r" ? "\n" : value, start, at);
  }
  return tokens;
}
export function compare(
  a: string,
  b: string,
  options: Options,
): readonly Change[] {
  if (a === b) return [];
  const ta = tokenize(a, options),
    tb = tokenize(b, options);
  const parts = diffArrays(ta, tb, {
    comparator: (x, y) => x.value === y.value,
    timeout: 45,
    maxEditLength: 2000,
  });
  if (!parts) {
    let head = 0,
      tailA = ta.length,
      tailB = tb.length;
    while (head < tailA && head < tailB && ta[head].value === tb[head].value)
      head++;
    while (
      tailA > head &&
      tailB > head &&
      ta[tailA - 1].value === tb[tailB - 1].value
    ) {
      tailA--;
      tailB--;
    }
    if (head === tailA && head === tailB) return [];
    return [
      new Change(
        ta[head]?.from ?? a.length,
        tailA > head ? ta[tailA - 1].to : (ta[head]?.from ?? a.length),
        tb[head]?.from ?? b.length,
        tailB > head ? tb[tailB - 1].to : (tb[head]?.from ?? b.length),
      ),
    ];
  }
  const changes: Change[] = [];
  let ai = 0,
    bi = 0,
    pending: { fa: number; fb: number; ta: number; tb: number } | undefined;
  const boundary = (ts: Token[], i: number, length: number) =>
    ts[i]?.from ?? length;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) {
        changes.push(
          new Change(pending.fa, pending.ta, pending.fb, pending.tb),
        );
        pending = undefined;
      }
      ai += part.count;
      bi += part.count;
      continue;
    }
    if (!pending)
      pending = {
        fa: boundary(ta, ai, a.length),
        fb: boundary(tb, bi, b.length),
        ta: boundary(ta, ai, a.length),
        tb: boundary(tb, bi, b.length),
      };
    if (part.removed) {
      ai += part.count;
      pending.ta = ta[ai - 1]?.to ?? pending.ta;
    }
    if (part.added) {
      bi += part.count;
      pending.tb = tb[bi - 1]?.to ?? pending.tb;
    }
  }
  if (pending)
    changes.push(new Change(pending.fa, pending.ta, pending.fb, pending.tb));
  return changes;
}
export function patch(a: string, b: string, nameA: string, nameB: string) {
  return createTwoFilesPatch(nameA, nameB, a, b);
}
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function report(
  a: string,
  b: string,
  nameA: string,
  nameB: string,
  options: Options,
) {
  const changes = compare(a, b, options);
  function markup(source: string, side: "A" | "B") {
    let end = 0,
      out = "";
    for (const change of changes) {
      const from = side === "A" ? change.fromA : change.fromB,
        to = side === "A" ? change.toA : change.toB;
      out += escapeHtml(source.slice(end, from));
      if (to > from)
        out += `<${side === "A" ? "del" : "ins"}>${escapeHtml(source.slice(from, to))}</${side === "A" ? "del" : "ins"}>`;
      end = to;
    }
    return out + escapeHtml(source.slice(end));
  }
  return `<!doctype html><meta charset="utf-8"><title>Diff report</title><style>body{font:15px system-ui;margin:32px;color:#20232b}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 monospace;padding:20px;border:1px solid #ddd}del{background:#fee2e2}ins{background:#dcfce7;text-decoration:none}small{color:#555}</style><h1>Text comparison</h1><small>Comparison options: ${escapeHtml(JSON.stringify(options))}. Patch exports always use unfiltered source.</small><main><section><h2>${escapeHtml(nameA)}</h2><pre>${markup(a, "A")}</pre></section><section><h2>${escapeHtml(nameB)}</h2><pre>${markup(b, "B")}</pre></section></main>`;
}
