import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronDown,
  Settings,
  Download,
  Copy,
  Trash2,
  Search,
  Undo2,
  Redo2,
  FolderOpen,
  X,
  Check,
  FileText,
  PanelLeftClose,
  ShieldCheck,
} from "lucide-react";
import { Editors, type EditorHandle } from "./Editors";
const PdfPanel = lazy(() =>
  import("./PdfPanel").then((module) => ({ default: module.PdfPanel })),
);
import { defaultOptions } from "./diff";
import {
  emptyProject,
  exampleA,
  exampleB,
  importFiles,
  textOf,
  updateText,
  download,
  type DocumentProject,
} from "./files";
type Menu = "options" | "export" | "settings" | null;
function App() {
  const [projects, setProjects] = useState<DocumentProject[]>([
    emptyProject("original.tex"),
    emptyProject("revised.tex"),
  ]);
  const [identity, setIdentity] = useState(0),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState("source"),
    [pdfOpened, setPdfOpened] = useState(false),
    [menu, setMenu] = useState<Menu>(null),
    [options, setOptions] = useState(defaultOptions),
    [wrap, setWrap] = useState(false),
    [sync, setSync] = useState(true),
    [collapse, setCollapse] = useState(false),
    [view, setView] = useState<"split" | "unified">("split"),
    [mobile, setMobile] = useState(window.innerWidth < 760),
    [mobileView, setMobileView] = useState<"unified" | "original" | "revised">(
      "unified",
    ),
    [encoding, setEncoding] = useState("utf-8"),
    [saveDraft, setSaveDraft] = useState(false),
    [filesOpen, setFilesOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [stats, setStats] = useState({
      count: 0,
      added: 0,
      removed: 0,
      current: 0,
    }),
    [dragSide, setDragSide] = useState<number | null>(null),
    [confirmAction, setConfirmAction] = useState<null | (() => void)>(null);
  const editor = useRef<EditorHandle>(null),
    uploads = useRef<(HTMLInputElement | null)[]>([]),
    folders = useRef<(HTMLInputElement | null)[]>([]),
    menuRef = useRef<HTMLDivElement>(null),
    draftLoaded = useRef(false);
  const a = textOf(projects[0]),
    b = textOf(projects[1]),
    isEmpty = !a && !b,
    mode = mobile ? mobileView : view;
  useEffect(() => {
    if (mobile) setWrap(true);
  }, [mobile]);
  const pendingCommand = useRef<{ side: number; action: string } | null>(null);
  function runCommand(side: number, action: string) {
    if (mode === "split" || (mode === "original" ? side === 0 : side === 1)) {
      editor.current?.command(side, action);
      return;
    }
    pendingCommand.current = { side, action };
    if (mobile) setMobileView(side === 0 ? "original" : "revised");
    else setView("split");
  }
  function navigate(direction: number) {
    if (mode === "original" || mode === "revised") {
      pendingCommand.current = { side: direction, action: "navigate" };
      setMobileView("unified");
      return;
    }
    editor.current?.navigate(direction);
  }
  useEffect(() => {
    const pending = pendingCommand.current;
    if (!pending) return;
    pendingCommand.current = null;
    if (pending.action === "navigate") editor.current?.navigate(pending.side);
    else editor.current?.command(pending.side, pending.action);
  }, [mode]);
  useEffect(() => {
    if (!confirmAction) return;
    const previous = document.activeElement as HTMLElement;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmAction(null);
        return;
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            ".confirm-dialog button",
          ),
        );
        const index = controls.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        event.preventDefault();
        controls[
          (index + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [confirmAction]);
  const [restorable, setRestorable] = useState(false);
  useEffect(() => {
    try {
      setRestorable(!!localStorage.getItem("diff-draft"));
    } catch {}
    draftLoaded.current = true;
    const query = matchMedia("(max-width:759px)");
    const listener = () => setMobile(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const click = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  useEffect(() => {
    if (!saveDraft || !draftLoaded.current) return;
    const timer = setTimeout(() => {
      try {
        const textProjects = projects.map((p) => ({
          ...p,
          files: p.files.map((f) => ({ ...f, bytes: Array.from(f.bytes) })),
        }));
        const json = JSON.stringify(textProjects);
        if (json.length > 4_000_000)
          throw Error(
            "Draft is too large for browser storage. Download your files to keep them.",
          );
        localStorage.setItem("diff-draft", json);
      } catch (e) {
        setNotice((e as Error).message);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [projects, saveDraft]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  function replace(next: DocumentProject[]) {
    setProjects(next);
    setIdentity((i) => i + 1);
    setRevision((i) => i + 1);
  }
  function edit(side: number, text: string) {
    setProjects((ps) =>
      ps.map((p, i) => (i === side ? updateText(p, text) : p)),
    );
    setRevision((i) => i + 1);
  }
  function guarded(action: () => void) {
    if (a || b) setConfirmAction(() => action);
    else action();
  }
  async function upload(side: number, files: File[]) {
    try {
      const project = await importFiles(files, encoding);
      const next = projects.map((p, i) => (i === side ? project : p));
      replace(next);
      if (project.files.length > 1) setFilesOpen(true);
      if (project.active.endsWith(".tex"))
        setOptions((o) => ({ ...o, latex: true }));
      setNotice(
        `Opened ${project.files.length === 1 ? project.active : project.files.length + " project files"}`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function demo() {
    replace([
      updateText(emptyProject("paper-v1.tex"), exampleA),
      updateText(emptyProject("paper-v2.tex"), exampleB),
    ]);
    setOptions(defaultOptions);
  }
  function exportFile(kind: "patch" | "report") {
    setMenu(null);
    setNotice("Preparing export…");
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      setNotice("This export is taking too long. Try comparing smaller files.");
    }, 15000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) {
        setNotice(event.data.error);
        return;
      }
      download(
        event.data.data,
        kind === "patch" ? "comparison.patch" : "comparison.html",
        kind === "patch" ? "text/plain" : "text/html",
      );
      setNotice("Export ready");
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      setNotice("Could not prepare the export. Please try again.");
    };
    worker.postMessage({
      kind,
      a,
      b,
      nameA: projects[0].active,
      nameB: projects[1].active,
      options,
    });
  }
  async function copy(side: number) {
    try {
      await navigator.clipboard.writeText(side === 0 ? a : b);
      setNotice("Text copied");
    } catch {
      setNotice(
        "Clipboard unavailable. Select the editor text and copy with your keyboard.",
      );
    }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem("diff-draft") || "null");
      if (!Array.isArray(saved) || saved.length !== 2)
        throw Error("Saved draft is invalid.");
      replace(
        saved.map((p) => ({
          ...p,
          files: p.files.map((f: { bytes: number[] }) => ({
            ...f,
            bytes: new Uint8Array(f.bytes),
          })),
        })),
      );
      setSaveDraft(true);
      setRestorable(false);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const check = (
    label: string,
    value: boolean,
    change: () => void,
    description?: string,
  ) => (
    <label className="check-row">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={change} />
    </label>
  );
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          Diff<span className="brand-period">.</span>
        </div>
        <span className="tagline">Text comparison, with LaTeX in mind.</span>
        <div className="privacy">
          <ShieldCheck size={14} />
          <span>Local only</span>
        </div>
        <button
          className={`icon-button ${menu === "settings" ? "active" : ""}`}
          title="Settings"
          aria-label="Settings"
          onClick={() => setMenu(menu === "settings" ? null : "settings")}
        >
          <Settings size={20} strokeWidth={1.6} />
        </button>
      </header>
      <div className="workspace-toolbar">
        <nav aria-label="Comparison view" className="view-tabs">
          <button
            className={tab === "source" ? "tab active" : "tab"}
            onClick={() => setTab("source")}
          >
            Source
          </button>
          <button
            className={tab === "pdf" ? "tab active" : "tab"}
            onClick={() => {
              setPdfOpened(true);
              setTab("pdf");
            }}
          >
            PDF
          </button>
        </nav>
        <div className="toolbar-right">
          <select
            aria-label="Text format"
            value={options.latex ? "latex" : "text"}
            onChange={(e) =>
              setOptions((o) => ({ ...o, latex: e.target.value === "latex" }))
            }
          >
            <option value="latex">LaTeX</option>
            <option value="text">Plain text</option>
          </select>
          <button
            aria-expanded={menu === "options"}
            onClick={() => setMenu(menu === "options" ? null : "options")}
          >
            Options
            <ChevronDown size={14} />
          </button>
          <button
            aria-expanded={menu === "export"}
            onClick={() => setMenu(menu === "export" ? null : "export")}
          >
            Export
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {menu && (
        <div
          ref={menuRef}
          className={`popover ${menu}`}
          role="dialog"
          aria-label={`${menu} menu`}
        >
          <div className="popover-title">
            {menu[0].toUpperCase() + menu.slice(1)}
            <button
              className="icon-button"
              aria-label="Close menu"
              onClick={() => setMenu(null)}
            >
              <X size={15} />
            </button>
          </div>
          {menu === "options" ? (
            <>
              <div className="field-label">Layout</div>
              <div className="segmented wide">
                <button
                  className={view === "split" ? "selected" : ""}
                  onClick={() => {
                    setView("split");
                    setMobileView("revised");
                  }}
                >
                  Side by side
                </button>
                <button
                  className={view === "unified" ? "selected" : ""}
                  onClick={() => {
                    setView("unified");
                    setMobileView("unified");
                  }}
                >
                  Unified
                </button>
              </div>
              {check("Wrap long lines", wrap, () => setWrap(!wrap))}
              {check("Synchronized scrolling", sync, () => setSync(!sync))}
              {check("Collapse unchanged sections", collapse, () =>
                setCollapse(!collapse),
              )}
              <div className="menu-divider" />
              <div className="field-label">Compare</div>
              {check("Ignore letter case", options.ignoreCase, () =>
                setOptions((o) => ({ ...o, ignoreCase: !o.ignoreCase })),
              )}
              {check(
                "Ignore whitespace",
                options.whitespace,
                () => setOptions((o) => ({ ...o, whitespace: !o.whitespace })),
                options.latex
                  ? "Preserves math and verbatim spacing"
                  : undefined,
              )}
              {options.latex && (
                <>
                  {check("Ignore LaTeX comments", options.comments, () =>
                    setOptions((o) => ({ ...o, comments: !o.comments })),
                  )}
                  {check(
                    "Ignore prose line wrapping",
                    options.reflow,
                    () => setOptions((o) => ({ ...o, reflow: !o.reflow })),
                    "Preserves paragraph boundaries",
                  )}
                </>
              )}
              <p className="menu-note">
                Filters affect source highlights only. Your text and compiled
                PDFs stay unchanged.
              </p>
            </>
          ) : menu === "export" ? (
            <>
              <button
                className="menu-action"
                onClick={() => {
                  download(a, projects[0].active.split("/").pop()!);
                  setMenu(null);
                }}
              >
                <Download size={15} />
                Original text
              </button>
              <button
                className="menu-action"
                onClick={() => {
                  download(b, projects[1].active.split("/").pop()!);
                  setMenu(null);
                }}
              >
                <Download size={15} />
                Revised text
              </button>
              <div className="menu-divider" />
              <button
                className="menu-action"
                onClick={() => exportFile("patch")}
              >
                <FileText size={15} />
                Unified patch <small>Unfiltered</small>
              </button>
              <button
                className="menu-action"
                onClick={() => exportFile("report")}
              >
                <FileText size={15} />
                Highlighted HTML report
              </button>
            </>
          ) : (
            <>
              <div className="field-label">Import encoding</div>
              <select
                className="wide"
                aria-label="Import encoding"
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                <option value="utf-8">UTF-8 (auto-detect BOM)</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="utf-16be">UTF-16 BE</option>
                <option value="windows-1252">Windows-1252</option>
              </select>
              <div className="menu-divider" />
              {check(
                "Save draft on this device",
                saveDraft,
                () => {
                  setSaveDraft(!saveDraft);
                  if (saveDraft) {
                    localStorage.removeItem("diff-draft");
                    setRestorable(false);
                  }
                },
                "Off by default. Uses this browser’s storage.",
              )}
              <button
                className="menu-action danger"
                onClick={() => {
                  localStorage.removeItem("diff-draft");
                  setSaveDraft(false);
                  setRestorable(false);
                  setNotice("Saved draft cleared");
                }}
              >
                <Trash2 size={15} />
                Clear saved data
              </button>
              <div className="menu-divider" />
              <button
                className="menu-action"
                onClick={() => {
                  guarded(demo);
                  setMenu(null);
                }}
              >
                <FileText size={15} />
                Load LaTeX example
              </button>
              <p className="menu-note">
                Source comparison stays in your browser. PDF compilation uses
                the companion on this computer.
              </p>
            </>
          )}
        </div>
      )}
      <div className="changes-bar">
        <div className="change-summary">
          <strong>
            {stats.count} {stats.count === 1 ? "change" : "changes"}
          </strong>
          {stats.added > 0 && (
            <span className="added">+{stats.added} added</span>
          )}
          {stats.removed > 0 && (
            <span className="removed">−{stats.removed} removed</span>
          )}
          {!isEmpty && stats.count === 0 && (
            <span className="muted">
              No differences
              {Object.entries(options).some(([k, v]) => k !== "latex" && v)
                ? " with current filters"
                : ""}
            </span>
          )}
        </div>
        <div className="change-navigation">
          {projects.some((p) => p.files.length > 1) && (
            <button
              className={filesOpen ? "active" : ""}
              onClick={() => setFilesOpen(!filesOpen)}
            >
              <FolderOpen size={14} />
              <span>Files</span>
            </button>
          )}
          <button
            aria-label="Previous change"
            disabled={!stats.count || tab !== "source"}
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={17} />
          </button>
          <span>
            {stats.count ? `${stats.current || 1} of ${stats.count}` : "—"}
          </span>
          <button
            aria-label="Next change"
            disabled={!stats.count || tab !== "source"}
            onClick={() => navigate(1)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      <main className="main-workspace">
        {filesOpen && (
          <aside className="files-drawer">
            <div className="drawer-heading">
              Project files
              <button
                className="icon-button"
                aria-label="Close files"
                onClick={() => setFilesOpen(false)}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            {projects.map((project, side) => (
              <section key={side}>
                <h3>{side === 0 ? "Original" : "Revised"}</h3>
                <label className="field-label" htmlFor={`root-${side}`}>
                  Root document
                </label>
                <select
                  id={`root-${side}`}
                  value={project.root}
                  onChange={(e) => {
                    setProjects((ps) =>
                      ps.map((p, i) =>
                        i === side ? { ...p, root: e.target.value } : p,
                      ),
                    );
                    setRevision((r) => r + 1);
                  }}
                >
                  <option value="">Choose root .tex…</option>
                  {project.files
                    .filter((f) => f.path.endsWith(".tex"))
                    .map((f) => (
                      <option key={f.path}>{f.path}</option>
                    ))}
                </select>
                <div className="file-list">
                  {project.files.map((file) => (
                    <button
                      key={file.path}
                      title={file.path}
                      disabled={file.text === undefined}
                      className={project.active === file.path ? "selected" : ""}
                      onClick={() => {
                        setProjects(
                          projects.map((p, i) =>
                            i === side ? { ...p, active: file.path } : p,
                          ),
                        );
                        setIdentity((i) => i + 1);
                      }}
                    >
                      <FileText size={13} />
                      {file.path}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </aside>
        )}
        <div className="comparison-body">
          <div className="source-content" hidden={tab !== "source"}>
            <div className="document-headers">
              {projects.map((project, side) => (
                <div
                  className={`document-header ${dragSide === side ? "drag-over" : ""}`}
                  key={side}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragSide(side);
                  }}
                  onDragLeave={() => setDragSide(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragSide(null);
                    void upload(side, Array.from(e.dataTransfer.files));
                  }}
                >
                  <strong>{side === 0 ? "Original" : "Revised"}</strong>
                  <span className="filename" title={project.active}>
                    {project.active}
                  </span>
                  <button
                    className="icon-button upload-button"
                    title={`Upload ${side === 0 ? "original" : "revised"} file or ZIP`}
                    aria-label={`Upload ${side === 0 ? "original" : "revised"} file`}
                    onClick={() => uploads.current[side]?.click()}
                  >
                    <ArrowUpFromLine size={17} />
                  </button>
                  <div className="document-actions">
                    <button
                      className="icon-button"
                      title="Upload project folder"
                      aria-label={`Upload ${side === 0 ? "original" : "revised"} folder`}
                      onClick={() => folders.current[side]?.click()}
                    >
                      <FolderOpen size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Find text (⌘F)"
                      aria-label={`Search ${side === 0 ? "original" : "revised"}`}
                      onClick={() => runCommand(side, "search")}
                    >
                      <Search size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Undo"
                      aria-label={`Undo ${side === 0 ? "original" : "revised"}`}
                      onClick={() => runCommand(side, "undo")}
                    >
                      <Undo2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Redo"
                      aria-label={`Redo ${side === 0 ? "original" : "revised"}`}
                      onClick={() => runCommand(side, "redo")}
                    >
                      <Redo2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Copy text"
                      aria-label={`Copy ${side === 0 ? "original" : "revised"}`}
                      onClick={() => void copy(side)}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Clear text"
                      aria-label={`Clear ${side === 0 ? "original" : "revised"}`}
                      onClick={() => {
                        if (textOf(project))
                          setConfirmAction(
                            () => () =>
                              replace(
                                projects.map((p, i) =>
                                  i === side ? updateText(p, "") : p,
                                ),
                              ),
                          );
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    type="file"
                    multiple
                    hidden
                    ref={(el) => {
                      uploads.current[side] = el;
                    }}
                    onChange={(e) => {
                      void upload(side, Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                  <input
                    type="file"
                    multiple
                    hidden
                    {...{ webkitdirectory: "" }}
                    ref={(el) => {
                      folders.current[side] = el;
                    }}
                    onChange={(e) => {
                      void upload(side, Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </div>
              ))}
              <button
                className="swap-button"
                title="Swap original and revised"
                aria-label="Swap original and revised"
                onClick={() => replace([projects[1], projects[0]])}
              >
                <ArrowLeftRight size={18} />
              </button>
            </div>
            {mobile && (
              <div className="mobile-tabs segmented">
                {(["unified", "original", "revised"] as const).map((v) => (
                  <button
                    key={v}
                    className={mobileView === v ? "selected" : ""}
                    onClick={() => setMobileView(v)}
                  >
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <div
              className="editors-wrap"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const side = e.clientX < rect.left + rect.width / 2 ? 0 : 1;
                void upload(side, Array.from(e.dataTransfer.files));
              }}
            >
              <Editors
                ref={editor}
                a={a}
                b={b}
                identity={String(identity)}
                options={options}
                wrap={wrap}
                collapse={collapse}
                sync={sync}
                mode={mode}
                onChange={edit}
                onLimit={() =>
                  setNotice(
                    "The editor limit is 2 million characters per file. Split larger documents into separate files.",
                  )
                }
                onStats={setStats}
              />
              {isEmpty && (
                <div className="empty-prompt">
                  <div className="empty-icon">
                    <ArrowLeftRight size={26} strokeWidth={1.4} />
                  </div>
                  <h1>A little clarity between versions.</h1>
                  <p>Paste your text above, or drop a file on either side.</p>
                  <button className="example-button" onClick={demo}>
                    Try a LaTeX example
                    <ArrowRight size={14} />
                  </button>
                  {restorable && (
                    <button className="text-button" onClick={restore}>
                      Restore saved draft
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="pdf-content" hidden={tab !== "pdf"}>
            {pdfOpened && (
              <Suspense
                fallback={<div className="pdf-empty">Loading PDF tools…</div>}
              >
                <PdfPanel projects={projects} revision={revision} />
              </Suspense>
            )}
          </div>
        </div>
      </main>
      <footer>
        <div>
          <span>{encoding.toUpperCase()}</span>
          <span>
            {a.includes("\r\n") || b.includes("\r\n") ? "CRLF" : "LF"}
          </span>
        </div>
        <span className="footer-center">Changes update as you type</span>
        <span className="footer-privacy">Processed on this device</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {confirmAction && (
        <div className="modal-backdrop" onClick={() => setConfirmAction(null)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title">Replace the current text?</h2>
            <p>Download anything you want to keep before continuing.</p>
            <div>
              <button autoFocus onClick={() => setConfirmAction(null)}>
                Keep editing
              </button>
              <button
                className="primary"
                onClick={() => {
                  confirmAction();
                  setConfirmAction(null);
                }}
              >
                <Check size={14} />
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
