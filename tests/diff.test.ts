import test from "node:test";
import assert from "node:assert/strict";
import { compare, defaultOptions, tokenize, patch, report } from "../src/diff";
import { decode, importFiles, validPath } from "../src/files";
const options = defaultOptions;
test("empty, identical, additions, deletions, Unicode and CRLF", () => {
  assert.equal(compare("", "", options).length, 0);
  assert.equal(compare("same", "same", options).length, 0);
  assert.ok(compare("", "你好 👋", options).length);
  assert.ok(compare("hi", "", options).length);
  assert.equal(compare("a\r\nb", "a\nb", options).length, 0);
  assert.ok(compare("a\n", "a", options).length);
});
test("LaTeX commands remain atomic and comments respect escaped percent", () => {
  const commands = tokenize("\\section{Hi} \\% percent % comment", {
    ...options,
    comments: true,
  });
  assert.ok(commands.some((t) => t.value === "\\section"));
  assert.ok(commands.some((t) => t.value === "\\%"));
  assert.ok(!commands.some((t) => t.value.includes("comment")));
  assert.equal(
    compare("Text % before", "Text % after", { ...options, comments: true })
      .length,
    0,
  );
  assert.ok(
    compare("Text \\% before", "Text \\% after", { ...options, comments: true })
      .length,
  );
});
test("filters preserve math, verbatim and paragraphs", () => {
  assert.equal(
    compare("Hello world", "hello  world", {
      ...options,
      ignoreCase: true,
      whitespace: true,
    }).length,
    0,
  );
  assert.ok(compare("$a b$", "$ab$", { ...options, whitespace: true }).length);
  assert.ok(
    compare(
      "\\begin{verbatim}a b\\end{verbatim}",
      "\\begin{verbatim}ab\\end{verbatim}",
      { ...options, whitespace: true },
    ).length,
  );
  assert.equal(
    compare("Hello\nworld", "Hello world", { ...options, reflow: true }).length,
    0,
  );
  assert.ok(
    compare("Hello\n\nworld", "Hello world", { ...options, reflow: true })
      .length,
  );
});
test("exports preserve unfiltered source and escape HTML", () => {
  assert.match(patch("A", "a", "a.tex", "b.tex"), /-A/);
  const html = report("<script>", "<img>", "a", "b", options);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;/);
});
test("decoding detects BOM and rejects binary and malformed UTF8", () => {
  assert.equal(decode(new Uint8Array([255, 254, 65, 0])), "A");
  assert.throws(() => decode(new Uint8Array([0, 1, 2])));
  assert.throws(() => decode(new Uint8Array([255])));
  assert.equal(decode(new Uint8Array([233]), "windows-1252"), "é");
});
test("imports select a unique root and retain assets", async () => {
  const p = await importFiles(
    [
      new File(["\\documentclass{article}"], "paper.tex"),
      new File([new Uint8Array([0, 1])], "figure.png"),
    ],
    "utf-8",
  );
  assert.equal(p.root, "paper.tex");
  assert.equal(p.files[1].text, undefined);
  assert.equal(validPath("../outside.tex"), false);
  assert.equal(validPath("/outside.tex"), false);
  assert.equal(validPath("chapters/intro.tex"), true);
});
test("large comparison has bounded expensive diff work", () => {
  const a = "A long line containing data and words.\n".repeat(6000);
  const start = performance.now();
  assert.ok(compare(a, a.replace("data", "changed"), options).length);
  assert.ok(performance.now() - start < 2000);
});
