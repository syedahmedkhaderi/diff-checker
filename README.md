# Diff

A quiet, local-first text comparison workspace with LaTeX source highlighting and locally compiled, change-marked PDFs.

## Run

Requires Node.js 22.13 or later (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. This starts Vite and the local compilation companion together. To serve a production build from one local origin:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4318**. All dependencies, including the PDF worker, are served locally; there are no CDN fonts, analytics, remote document uploads, or accounts.

## Compare text

Paste into either editor or use its upload button. Drop individual text files or ZIP projects on the appropriate side. Folder upload is available in each editor's hover/focus toolbar. Any readable text extension is accepted; select Plain text to disable LaTeX syntax handling.

- Side-by-side or unified highlights, line alignment, word/LaTeX-token differences, line counts, and previous/next changed-block navigation.
- Search and replace (`Cmd/Ctrl+F`), undo/redo, copy, swap, clear, wrapping, synchronized scrolling, and collapse unchanged sections.
- Optional case, whitespace, LaTeX-comment, and prose-reflow filters. Filters never rewrite either input. Math and verbatim whitespace remain significant. This is lexical comparison, not a mathematical-equivalence checker.
- Export either active text file, an **unfiltered** standard unified patch, or an escaped highlighted HTML report recording the current filters. Report and patch generation run in a worker.
- Import encoding defaults to UTF-8, with UTF-16 BOM detection and manual UTF-16/Windows-1252 choices. Editor changes preserve the document's CRLF or LF convention. Text downloads use UTF-8.
- Draft saving is opt-in under Settings. Drafts stay in this browser's local storage; existing drafts are restored only when requested. Large drafts exceeding approximately 4 MB must be downloaded instead.

The summary counts changed blocks and affected source lines; replacements contribute to both added and removed lines. Nearby edits may form one navigation block. For very different documents, a bounded fallback groups changes more coarsely to keep the editor responsive. Each text file is limited to 2 million characters; a project may contain up to 1,000 files and 40 MB of text and binary assets.

On phones, unified view is the default, with separate Original/Revised editing tabs. Keyboard focus indicators, non-color change markers, and reduced-motion support are included.

## Compile LaTeX

Install a TeX distribution with `latexmk`, `latexdiff`, `latexpand`, and at least one of pdfLaTeX, XeLaTeX, or LuaLaTeX. This Mac's existing `/Library/TeX/texbin` installation is detected automatically. The selected engine must have the packages and fonts your document requires; the app does not install packages or enable shell escape.

1. Upload each version as a `.tex` file, folder, or ZIP. Include its images, bibliography, and local packages.
2. In the Files drawer, select each version's root `.tex` document if more than one candidate exists. Edit included text files directly from the drawer.
3. Open PDF and click **Compile comparison**.
4. Inspect **Changes**, **Original**, and **Revised**. Download PDFs, generated change source, or read the compilation log. Edited sources mark existing results as stale.

Original and revised projects compile separately. Their compiled BibTeX bibliographies are inlined where available; `latexpand` flattens standard nested inputs. `latexdiff` uses whole-equation markup and version-qualified graphics so equal image filenames remain distinct. Successful PDFs remain available when another compilation fails.

Compilation is for **trusted local projects**, not an arbitrary-code sandbox. Unsupported macros, dynamic image paths, unflattened inclusions, shell-escape packages, or complex bibliography/package interactions can prevent change-document generation; errors and original PDFs remain available. Root paths resolve from the uploaded project directory, so use project-relative inclusion paths. Generated change source can depend on the uploaded assets and packages; the standalone `.tex` download is not a self-contained project archive. `original/`, `revised/`, `old-flat.tex`, `new-flat.tex`, and `changes.tex` are reserved in the generated change workspace.

The companion binds to loopback, checks Host/Origin and a local-session token, ignores project `latexmkrc` configuration, disables shell escape, rejects unsafe/duplicate paths, and uses disposable job directories. One job runs at a time. Commands have a 90-second deadline, output logs are bounded, and PDFs are limited to 30 MB. Finished job files expire after one hour and are removed on normal shutdown. No Git remote is configured or pushed by the app.

## Local API

All `/api` routes except `GET /api/session` require `x-diff-token` from that same-origin session response.

| Endpoint                            | Purpose                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/capabilities`             | Installed tools and compiler engines                                                                                 |
| `POST /api/jobs`                    | Compile `{ original, revised, engine }`; each project has `{ root, files: [{ path, data }] }`, with base64 file data |
| `GET /api/jobs/:id`                 | Status, current stage, errors, and available artifact names                                                          |
| `DELETE /api/jobs/:id`              | Cancel a job and terminate its active process group                                                                  |
| `GET /api/jobs/:id/artifacts/:name` | Retrieve an available PDF, generated source, or log                                                                  |

Job statuses are `queued`, `running`, `complete`, `failed`, and `cancelled`. A failed job can still contain usable original/revised artifacts. Unknown or expired job IDs return 404.

## Checks and implementation

```sh
npm test
npm run build
npm audit
```

Tests include Unicode and line endings, LaTeX tokens/comments/math/verbatim/reflow, binary/encoding handling, import paths, escaped exports, large input, real three-PDF compilation, nested includes, bibliography, different version assets, missing packages, invalid TeX, cancellation, and timeouts. Integration tests require the local TeX tools above.

React and CodeMirror own the source workspace, PDF.js is loaded on demand, and the Node companion owns temporary compilation jobs. The approved visual reference is [docs/design-concept.png](docs/design-concept.png). The implementation intentionally adds functional editor actions, an empty state, actual change counts, responsive editing tabs, and the PDF/project workflows to that reference.
