/**
 * RFC 4180 CSV：支援雙引號欄位、欄位內換行與逗號、"" 跳脫、CRLF、UTF-8 BOM。
 * 回傳每一筆記錄的欄位陣列（含標題列）。
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 去掉完全空白的列（例如檔尾空行）
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** 輸出 CSV（含 UTF-8 BOM，Excel 2016 開啟時中文不會亂碼）。 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return "﻿" + rows.map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
