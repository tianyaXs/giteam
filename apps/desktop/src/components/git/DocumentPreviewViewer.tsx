import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview";
import * as XLSX from "xlsx";
import "@cyntler/react-doc-viewer/dist/index.css";
import { cn } from "@/lib/utils";
import type { GitWorktreeFileContent } from "../../lib/types";
import { MarkdownLite } from "../common/MarkdownLite";
import { Card, CardContent } from "../ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

type DocumentPreviewViewerProps = {
  filePath: string;
  content: GitWorktreeFileContent;
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "attachment";
}

function extensionFromName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function blobFromBase64(base64: string, mime?: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function textFromBase64(base64: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64ToUint8Array(base64));
  } catch {
    return "";
  }
}

function parseXlsxWorkbook(base64: string): XLSX.WorkBook | null {
  try {
    const data = base64ToUint8Array(base64);
    return XLSX.read(data, { type: "array" });
  } catch {
    return null;
  }
}

function getSheetData(workbook: XLSX.WorkBook, sheetName: string): (string | number | null)[][] {
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as (string | number | null)[][];
}

function PreviewEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-60 border-0">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PreviewShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("h-full min-h-0 border-0 bg-background shadow-none", className)}>
      <CardContent className="h-full min-h-0 p-0">{children}</CardContent>
    </Card>
  );
}

export function DocumentPreviewViewer({ filePath, content }: DocumentPreviewViewerProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [docxError, setDocxError] = useState("");
  const fileName = fileNameFromPath(filePath);
  const ext = extensionFromName(fileName);
  const isMarkdown = ext === "md" || ext === "markdown" || ext === "mdx" || content.previewKind === "markdown";
  const isDocx = ext === "docx" && content.dataBase64;
  const isSpreadsheet = (ext === "xlsx" || ext === "xls" || ext === "csv") && content.dataBase64;
  const [xlsxWorkbook, setXlsxWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [sheetRows, setSheetRows] = useState<(string | number | null)[][]>([]);
  const [xlsxError, setXlsxError] = useState("");

  useEffect(() => {
    if (!content.dataBase64) {
      setBlobUrl("");
      return undefined;
    }
    const blob = blobFromBase64(content.dataBase64, content.mime);
    const nextUrl = URL.createObjectURL(blob);
    setBlobUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [content.dataBase64, content.mime]);

  useEffect(() => {
    const container = docxContainerRef.current;
    if (!isDocx || !container || !content.dataBase64) return;
    container.innerHTML = "";
    setDocxError("");
    const blob = blobFromBase64(content.dataBase64, content.mime);
    void renderAsync(blob, container, undefined, {
      className: "docx-preview-page",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: false,
      renderFooters: false,
      renderFootnotes: true,
      renderEndnotes: true
    }).catch((error) => {
      setDocxError(String(error));
    });
  }, [content.dataBase64, content.mime, isDocx]);

  useEffect(() => {
    if (!isSpreadsheet || !content.dataBase64) {
      setXlsxWorkbook(null);
      setActiveSheet("");
      setSheetRows([]);
      setXlsxError("");
      return;
    }
    if (ext === "csv") {
      try {
        const text = atob(content.dataBase64);
        const workbook = XLSX.read(text, { type: "string" });
        if (workbook.SheetNames.length > 0) {
          setXlsxWorkbook(workbook);
          const firstSheet = workbook.SheetNames[0];
          setActiveSheet(firstSheet);
          setSheetRows(getSheetData(workbook, firstSheet));
          setXlsxError("");
        } else {
          setXlsxWorkbook(null);
          setActiveSheet("");
          setSheetRows([]);
          setXlsxError("无法解析该 CSV 文件。");
        }
      } catch {
        setXlsxWorkbook(null);
        setActiveSheet("");
        setSheetRows([]);
        setXlsxError("无法解析该 CSV 文件。");
      }
      return;
    }
    const workbook = parseXlsxWorkbook(content.dataBase64);
    if (workbook && workbook.SheetNames.length > 0) {
      setXlsxWorkbook(workbook);
      const firstSheet = workbook.SheetNames[0];
      setActiveSheet(firstSheet);
      setSheetRows(getSheetData(workbook, firstSheet));
      setXlsxError("");
    } else {
      setXlsxWorkbook(null);
      setActiveSheet("");
      setSheetRows([]);
      setXlsxError("无法解析该 Excel 文件，文件可能已损坏或格式不受支持。");
    }
  }, [content.dataBase64, isSpreadsheet, ext]);

  const handleSwitchSheet = (sheetName: string) => {
    if (!xlsxWorkbook || sheetName === activeSheet) return;
    setActiveSheet(sheetName);
    setSheetRows(getSheetData(xlsxWorkbook, sheetName));
  };

  const documents = useMemo(() => {
    if (!blobUrl) return [];
    return [{
      uri: blobUrl,
      fileName,
      fileType: ext
    }];
  }, [blobUrl, ext, fileName]);

  if (isMarkdown) {
    const markdown = content.modified || content.original || (content.dataBase64 ? textFromBase64(content.dataBase64) : "");
    return (
      <PreviewShell>
        <div className="h-full min-h-0 overflow-auto bg-background px-5 py-4 text-[13px] leading-6 md:px-7 md:py-5">
          {markdown.trim() ? (
            <MarkdownLite source={markdown} />
          ) : (
            <PreviewEmpty title="空的 Markdown 文件" description="该文件没有可显示的内容。" />
          )}
        </div>
      </PreviewShell>
    );
  }

  if (!content.dataBase64) {
    return (
      <PreviewEmpty title="不支持的预览类型" description="没有可用于预览的文件数据。" />
    );
  }

  if (isDocx) {
    return (
      <PreviewShell>
        {docxError ? (
          <PreviewEmpty title="DOCX 预览失败" description={docxError} />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-background p-3 pb-5 md:p-4">
            <div
              ref={docxContainerRef}
              className={cn(
                "min-h-full w-full overflow-x-hidden",
                "[&_.docx-preview-page-wrapper]:!flex [&_.docx-preview-page-wrapper]:!min-h-full",
                "[&_.docx-preview-page-wrapper]:!items-start [&_.docx-preview-page-wrapper]:!justify-center",
                "[&_.docx-preview-page-wrapper]:!bg-background [&_.docx-preview-page-wrapper]:!p-0",
                "[&_.docx-preview-page-wrapper]:!shadow-none",
                "[&_.docx-preview-page]:!mx-auto [&_.docx-preview-page]:!mb-5",
                "[&_.docx-preview-page]:shadow-sm"
              )}
            />
          </div>
        )}
      </PreviewShell>
    );
  }

  if (isSpreadsheet) {
    if (xlsxError) {
      return (
        <PreviewShell>
          <PreviewEmpty title="Excel 预览失败" description={xlsxError} />
        </PreviewShell>
      );
    }
    if (!xlsxWorkbook) {
      return (
        <PreviewShell>
          <PreviewEmpty title="正在准备预览" description="正在解析 Excel 文件数据..." />
        </PreviewShell>
      );
    }
    return (
      <PreviewShell>
        <div className="h-full min-h-0 overflow-auto bg-background p-4">
          <div className="inline-block min-w-full align-top">
            {xlsxWorkbook.SheetNames.length > 1 && (
              <ToggleGroup
                type="single"
                value={activeSheet}
                onValueChange={(sheetName) => {
                  if (sheetName) handleSwitchSheet(sheetName);
                }}
                variant="outline"
                size="sm"
                className="mb-3 max-w-full justify-start overflow-x-auto rounded-lg bg-muted/35 p-1"
              >
                {xlsxWorkbook.SheetNames.map((sheetName: string) => (
                  <ToggleGroupItem
                    key={sheetName}
                    value={sheetName}
                    className="max-w-56 justify-start truncate px-3"
                  >
                    {sheetName}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <div className="inline-block min-w-full overflow-hidden rounded-lg border border-border bg-card align-top">
              <table className="min-w-full border-collapse bg-card font-mono text-xs text-card-foreground">
                <tbody>
                  {sheetRows.map((row: (string | number | null)[], rowIndex: number) => (
                    <tr key={rowIndex}>
                      <td className="sticky left-0 min-w-10 border border-border bg-muted px-2 py-1.5 text-center font-semibold text-muted-foreground">
                        {rowIndex + 1}
                      </td>
                      {row.map((cell: string | number | null, cellIndex: number) => (
                        <td
                          key={cellIndex}
                          className={cn(
                            "min-w-20 max-w-80 truncate border border-border px-2 py-1.5 align-middle",
                            rowIndex === 0
                              ? "sticky top-0 bg-muted font-semibold text-foreground"
                              : "bg-card text-foreground"
                          )}
                        >
                          {cell ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell>
      <div className="h-full min-h-0 overflow-auto bg-background [&_#proxy-renderer]:min-h-full [&_#react-doc-viewer]:min-h-full [&_#react-doc-viewer]:bg-transparent">
        {documents.length > 0 ? (
          <DocViewer
            documents={documents}
            pluginRenderers={DocViewerRenderers}
            config={{
              header: { disableHeader: true },
              pdfZoom: { defaultZoom: 0.9, zoomJump: 0.15 }
            }}
          />
        ) : (
          <PreviewEmpty title="正在准备预览" description="文件数据载入后会自动显示。" />
        )}
      </div>
    </PreviewShell>
  );
}
