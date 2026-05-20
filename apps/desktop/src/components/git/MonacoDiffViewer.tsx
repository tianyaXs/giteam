import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

type MonacoDiffViewerProps = {
  filePath: string;
  original: string;
  modified: string;
  language: string;
  theme: "light" | "dark";
};

export default function MonacoDiffViewer(props: MonacoDiffViewerProps) {
  return (
    <DiffEditor
      key={props.filePath}
      height="100%"
      width="100%"
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      original={props.original}
      modified={props.modified}
      language={props.language}
      theme={props.theme === "light" ? "light" : "vs-dark"}
      options={{
        readOnly: true,
        renderSideBySide: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        folding: true,
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
