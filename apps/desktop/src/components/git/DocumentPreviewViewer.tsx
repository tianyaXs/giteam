import { useEffect, useMemo, useRef, useState } from "react";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview";
import * as XLSX from "xlsx";
import "@cyntler/react-doc-viewer/dist/index.css";
import type { GitWorktreeFileContent } from "../../lib/types";

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

export function DocumentPreviewViewer({ filePath, content }: DocumentPreviewViewerProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [docxError, setDocxError] = useState("");
  const fileName = fileNameFromPath(filePath);
  const ext = extensionFromName(fileName);
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
      className: "gt-docx-preview-doc",
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

  if (!content.dataBase64) {
    return (
      <div className="gt-document-preview-empty">
        <strong>不支持的预览类型</strong>
        <span>没有可用于预览的文件数据。</span>
      </div>
    );
  }

  if (isDocx) {
    return (
      <div className="gt-document-preview-shell is-docx">
        {docxError ? (
          <div className="gt-document-preview-empty">
            <strong>DOCX 预览失败</strong>
            <span>{docxError}</span>
          </div>
        ) : (
          <div className="gt-document-preview-scroll is-docx">
            <div ref={docxContainerRef} className="gt-docx-preview" />
          </div>
        )}
      </div>
    );
  }

  if (isSpreadsheet) {
    if (xlsxError) {
      return (
        <div className="gt-document-preview-shell">
          <div className="gt-document-preview-empty">
            <strong>Excel 预览失败</strong>
            <span>{xlsxError}</span>
          </div>
        </div>
      );
    }
    if (!xlsxWorkbook) {
      return (
        <div className="gt-document-preview-shell">
          <div className="gt-document-preview-empty">
            <strong>正在准备预览</strong>
            <span>正在解析 Excel 文件数据...</span>
          </div>
        </div>
      );
    }
    return (
      <div className="gt-document-preview-shell">
        <div className="gt-spreadsheet-preview-scroll">
          <div className="gt-spreadsheet-preview">
            {xlsxWorkbook.SheetNames.length > 1 && (
              <div className="gt-spreadsheet-tabs">
                {xlsxWorkbook.SheetNames.map((sheetName: string) => (
                  <button
                    type="button"
                    key={sheetName}
                    className={sheetName === activeSheet ? "gt-spreadsheet-tab active" : "gt-spreadsheet-tab"}
                    onClick={() => handleSwitchSheet(sheetName)}
                  >
                    {sheetName}
                  </button>
                ))}
              </div>
            )}
            <table className="gt-spreadsheet-table">
              <tbody>
                {sheetRows.map((row: (string | number | null)[], rowIndex: number) => (
                  <tr key={rowIndex}>
                    <td className="gt-spreadsheet-row-header">{rowIndex + 1}</td>
                    {row.map((cell: string | number | null, cellIndex: number) => (
                      <td key={cellIndex} className={rowIndex === 0 ? "gt-spreadsheet-header-cell" : "gt-spreadsheet-cell"}>
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
    );
  }

  return (
    <div className="gt-document-preview-shell">
      <div className="gt-document-preview-viewer">
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
          <div className="gt-document-preview-empty">
            <strong>正在准备预览</strong>
            <span>文件数据载入后会自动显示。</span>
          </div>
        )}
      </div>
    </div>
  );
}
