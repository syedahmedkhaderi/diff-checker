import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { MergeView, unifiedMergeView, getChunks } from "@codemirror/merge";
import {
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { undo, redo, historyField } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { compare, type Options } from "./diff";
export type EditorHandle = {
  navigate: (direction: number) => void;
  command: (side: number, action: string) => void;
  getTexts: () => [string, string];
};
type Props = {
  a: string;
  b: string;
  identity: string;
  options: Options;
  wrap: boolean;
  collapse: boolean;
  sync: boolean;
  mode: "split" | "unified" | "original" | "revised";
  onLimit: () => void;
  onChange: (side: number, value: string) => void;
  onStats: (stats: {
    count: number;
    added: number;
    removed: number;
    current: number;
  }) => void;
};
export const Editors = forwardRef<EditorHandle, Props>(
  function Editors(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      merge = useRef<MergeView | null>(null),
      single = useRef<EditorView | null>(null),
      latest = useRef(props),
      current = useRef(-1),
      timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    latest.current = props;
    const savedStates = useRef<(EditorState | null)[]>([null, null]);
    const savedIdentity = useRef(props.identity);
    const views = () =>
      merge.current
        ? [merge.current.a, merge.current.b]
        : [single.current, single.current];
    const stats = () => {
      const chunks =
        merge.current?.chunks ||
        (single.current ? getChunks(single.current.state)?.chunks : []) ||
        [];
      const docA =
        merge.current?.a.state.doc ||
        EditorState.create({ doc: latest.current.a }).doc;
      const docB =
        merge.current?.b.state.doc ||
        EditorState.create({ doc: latest.current.b }).doc;
      const removed = new Set<number>(),
        added = new Set<number>();
      const changes =
        docA.length + docB.length > 200000 && chunks.length
          ? chunks.flatMap((chunk) =>
              chunk.changes.map((change) => ({
                fromA: chunk.fromA + change.fromA,
                toA: chunk.fromA + change.toA,
                fromB: chunk.fromB + change.fromB,
                toB: chunk.fromB + change.toB,
              })),
            )
          : compare(docA.toString(), docB.toString(), latest.current.options);
      for (const change of changes) {
        if (change.toA > change.fromA)
          for (
            let n = docA.lineAt(change.fromA).number;
            n <= docA.lineAt(change.toA - 1).number;
            n++
          )
            removed.add(n);
        if (change.toB > change.fromB)
          for (
            let n = docB.lineAt(change.fromB).number;
            n <= docB.lineAt(change.toB - 1).number;
            n++
          )
            added.add(n);
      }
      latest.current.onStats({
        count:
          chunks.length ||
          (latest.current.mode === "original" ||
          latest.current.mode === "revised"
            ? changes.length
            : 0),
        added: added.size,
        removed: removed.size,
        current: current.current < 0 ? 0 : current.current + 1,
      });
    };
    useImperativeHandle(ref, () => ({
      getTexts: () =>
        merge.current
          ? [merge.current.a.state.sliceDoc(), merge.current.b.state.sliceDoc()]
          : latest.current.mode === "original"
            ? [single.current?.state.sliceDoc() || "", latest.current.b]
            : [latest.current.a, single.current?.state.sliceDoc() || ""],
      navigate(direction) {
        const chunks =
          merge.current?.chunks ||
          (single.current ? getChunks(single.current.state)?.chunks : []) ||
          [];
        if (!chunks.length) return;
        current.current =
          current.current < 0
            ? direction > 0
              ? 0
              : chunks.length - 1
            : (current.current + direction + chunks.length) % chunks.length;
        const chunk = chunks[current.current];
        views().forEach((view, index) => {
          if (!view) return;
          const position = Math.min(
            index === 0 && merge.current ? chunk.fromA : chunk.fromB,
            view.state.doc.length,
          );
          view.dispatch({
            selection: { anchor: position },
            effects: EditorView.scrollIntoView(position, { y: "center" }),
          });
        });
        stats();
      },
      command(side, action) {
        const view = views()[side];
        if (!view) return;
        if (action === "undo") undo(view);
        if (action === "redo") redo(view);
        if (action === "search") {
          openSearchPanel(view);
          return;
        }
        view.focus();
      },
    }));
    useEffect(() => {
      if (!host.current) return;
      current.current = -1;
      if (savedIdentity.current !== props.identity) {
        savedStates.current = [null, null];
        savedIdentity.current = props.identity;
      }
      const extensions = (side: number) => [
        basicSetup,
        ...(savedStates.current[side]?.field(historyField, false)
          ? [
              historyField.init(() =>
                savedStates.current[side]!.field(historyField),
              ),
            ]
          : []),
        EditorState.lineSeparator.of(
          (side === 0 ? props.a : props.b).includes("\r\n") ? "\r\n" : "\n",
        ),
        EditorState.transactionFilter.of((transaction) =>
          transaction.newDoc.length > 2_000_000
            ? (queueMicrotask(() => latest.current.onLimit()), [])
            : transaction,
        ),
        placeholder(
          side === 0 ? "Paste original text here…" : "Paste revised text here…",
        ),
        syntaxHighlighting(defaultHighlightStyle),
        syntaxHighlighting(
          HighlightStyle.define([
            {
              tag: [
                tags.keyword,
                tags.tagName,
                tags.function(tags.variableName),
              ],
              color: "#2458df",
              class: "diff-syntax-command",
            },
            { tag: tags.comment, color: "#939bab" },
            { tag: tags.bracket, color: "#303642" },
          ]),
        ),
        ...(props.options.latex ? [StreamLanguage.define(stex)] : []),
        ...(props.wrap ? [EditorView.lineWrapping] : []),
        EditorView.contentAttributes.of({
          "aria-label": side === 0 ? "Original text" : "Revised text",
          spellcheck: "false",
        }),
        keymap.of([{ key: "Mod-Shift-z", run: redo }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            latest.current.onChange(side, update.state.sliceDoc());
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              current.current = -1;
              stats();
            }, 180);
          }
        }),
      ];
      const diffConfig = {
        override: (a: string, b: string) =>
          compare(a, b, latest.current.options),
        timeout: 50,
      };
      let unlisten = () => {};
      if (props.mode === "split") {
        const view = new MergeView({
          a: { doc: props.a, extensions: extensions(0) },
          b: { doc: props.b, extensions: extensions(1) },
          parent: host.current,
          gutter: true,
          highlightChanges: true,
          diffConfig,
          collapseUnchanged: props.collapse
            ? { margin: 3, minSize: 8 }
            : undefined,
        });
        merge.current = view;
        let locked = false;
        const sync = (source: EditorView, target: EditorView) => {
          if (!latest.current.sync || locked) return;
          locked = true;
          target.scrollDOM.scrollTop = source.scrollDOM.scrollTop;
          requestAnimationFrame(() => {
            locked = false;
          });
        };
        const a = () => sync(view.a, view.b),
          b = () => sync(view.b, view.a);
        view.a.scrollDOM.addEventListener("scroll", a);
        view.b.scrollDOM.addEventListener("scroll", b);
        unlisten = () => {
          view.a.scrollDOM.removeEventListener("scroll", a);
          view.b.scrollDOM.removeEventListener("scroll", b);
        };
      } else {
        const isOriginal = props.mode === "original";
        single.current = new EditorView({
          doc: isOriginal ? props.a : props.b,
          parent: host.current,
          extensions: [
            ...extensions(isOriginal ? 0 : 1),
            ...(props.mode === "unified"
              ? [
                  unifiedMergeView({
                    original: props.a,
                    diffConfig,
                    gutter: true,
                    mergeControls: false,
                    syntaxHighlightDeletions: true,
                    collapseUnchanged: props.collapse
                      ? { margin: 3, minSize: 8 }
                      : undefined,
                  }),
                ]
              : []),
          ],
        });
      }
      stats();
      return () => {
        clearTimeout(timer.current);
        unlisten();
        if (merge.current) {
          savedStates.current = [merge.current.a.state, merge.current.b.state];
        } else if (single.current) {
          savedStates.current[props.mode === "original" ? 0 : 1] =
            single.current.state;
        }
        merge.current?.destroy();
        single.current?.destroy();
        merge.current = null;
        single.current = null;
      };
      // Text edits stay inside the current editor; only explicit imports/selections change identity.
    }, [
      props.identity,
      props.mode,
      props.wrap,
      props.collapse,
      JSON.stringify(props.options),
    ]);
    return <div ref={host} className={`editor-host ${props.mode}`} />;
  },
);
