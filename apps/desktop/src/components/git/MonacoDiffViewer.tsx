import { DiffEditor, Editor, loader } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

type MonacoDiffViewerProps = {
  filePath: string;
  original: string;
  modified: string;
  language: string;
  theme: "light" | "dark";
  focusLine?: number;
  singleFile?: boolean;
  inlineDiff?: boolean;
};

export default function MonacoDiffViewer(props: MonacoDiffViewerProps) {
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const codeEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const codeDecorationsRef = useRef<string[]>([]);
  const diffDecorationsRef = useRef<string[]>([]);
  const diffUpdateDisposableRef = useRef<monaco.IDisposable | null>(null);
  const focusLineRef = useRef<number | undefined>(props.focusLine);

  focusLineRef.current = props.focusLine;

  const highlightLine = (editor: monaco.editor.IStandaloneCodeEditor | null, line?: number, target: "code" | "diff" = "code") => {
    if (!editor) return;
    const previous = target === "code" ? codeDecorationsRef.current : diffDecorationsRef.current;
    const model = editor.getModel();
    if (!model || !line) {
      const cleared = editor.deltaDecorations(previous, []);
      if (target === "code") codeDecorationsRef.current = cleared;
      else diffDecorationsRef.current = cleared;
      return;
    }
    const safeLine = Math.min(Math.max(1, Math.floor(line)), model.getLineCount());
    const top = editor.getTopForLineNumber(safeLine);
    const layout = editor.getLayoutInfo();
    const nextScrollTop = Math.max(0, top - Math.max(0, layout.height / 2 - 36));
    editor.setPosition({ lineNumber: safeLine, column: 1 });
    editor.setScrollPosition({ scrollTop: nextScrollTop });
    editor.revealLineInCenter(safeLine);
    editor.revealPositionInCenterIfOutsideViewport({ lineNumber: safeLine, column: 1 });
    editor.setSelection(new monaco.Selection(safeLine, 1, safeLine, model.getLineMaxColumn(safeLine)));
    const next = editor.deltaDecorations(previous, [
      {
        range: new monaco.Range(safeLine, 1, safeLine, model.getLineMaxColumn(safeLine)),
        options: {
          isWholeLine: true,
          className: "gt-monaco-focus-line",
          inlineClassName: "gt-monaco-focus-inline",
          linesDecorationsClassName: "gt-monaco-focus-line-gutter",
          glyphMarginClassName: "gt-monaco-focus-line-glyph",
          overviewRuler: {
            color: "rgba(88, 166, 255, 0.85)",
            position: monaco.editor.OverviewRulerLane.Center
          }
        }
      }
    ]);
    if (target === "code") codeDecorationsRef.current = next;
    else diffDecorationsRef.current = next;
    editor.focus();
  };

  const scheduleHighlight = (editor: monaco.editor.IStandaloneCodeEditor | null, line?: number, target: "code" | "diff" = "code") => {
    if (!editor) return;
    highlightLine(editor, line, target);
    requestAnimationFrame(() => {
      highlightLine(editor, line, target);
      setTimeout(() => highlightLine(editor, line, target), 80);
      setTimeout(() => highlightLine(editor, line, target), 220);
      setTimeout(() => highlightLine(editor, line, target), 520);
    });
  };

  useEffect(() => {
    if (props.singleFile) {
      scheduleHighlight(codeEditorRef.current, props.focusLine, "code");
      return;
    }
    scheduleHighlight(diffEditorRef.current?.getModifiedEditor() || null, props.focusLine, "diff");
  }, [props.filePath, props.focusLine, props.singleFile, props.modified, props.original]);

  useEffect(() => {
    return () => {
      diffUpdateDisposableRef.current?.dispose();
      diffUpdateDisposableRef.current = null;
    };
  }, []);

  if (props.singleFile) {
    return (
      <Editor
        key={`${props.filePath}:file`}
        height="100%"
        width="100%"
        value={props.modified || props.original}
        language={props.language}
        theme={props.theme === "light" ? "light" : "vs-dark"}
        onMount={(editor) => {
          codeEditorRef.current = editor;
          scheduleHighlight(editor, props.focusLine, "code");
        }}
        options={{
          readOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          folding: true,
          glyphMargin: true,
          fontSize: 12,
          lineHeight: 18,
          wordWrap: "off",
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontalScrollbarSize: 10,
            verticalScrollbarSize: 10
          }
        }}
      />
    );
  }

  return (
    <DiffEditor
      key={`${props.filePath}:diff`}
      height="100%"
      width="100%"
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      original={props.original}
      modified={props.modified}
      language={props.language}
      theme={props.theme === "light" ? "light" : "vs-dark"}
      onMount={(editor) => {
        diffEditorRef.current = editor;
        diffUpdateDisposableRef.current?.dispose();
        diffUpdateDisposableRef.current = editor.onDidUpdateDiff(() => {
          scheduleHighlight(editor.getModifiedEditor(), focusLineRef.current, "diff");
        });
        scheduleHighlight(editor.getModifiedEditor(), props.focusLine, "diff");
      }}
      options={{
        readOnly: true,
        renderSideBySide: !props.inlineDiff,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        folding: true,
        glyphMargin: true,
        fontSize: 12,
        lineHeight: 18,
        wordWrap: "off",
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10
        }
      }}
    />
  );
}
