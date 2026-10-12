import { VocabularyInputSchema, type VocabularyInput, type VocabularyWord } from "./schema";
import { normalizeTerm } from "./vocabulary";
import { toCsv } from "./csv";

export const VOCABULARY_IMPORT_LIMIT = 1000;
export const VOCABULARY_CSV_MAX_BYTES = 2 * 1024 * 1024;
const COLUMNS = [
  { key: "term", label: "英文單字／片語", required: true },
  { key: "meaning_zh", label: "繁中意思", required: true },
  { key: "part_of_speech", label: "詞性", required: false },
  { key: "example", label: "英文例句", required: false },
] as const;
export type VocabularyImportRow = { line: number; input: VocabularyInput };
export type VocabularyImportIssue = { line: number; message: string };
export type VocabularyCsvResult = { rows: VocabularyImportRow[]; errors: VocabularyImportIssue[] };
export type VocabularyPreviewRow = VocabularyImportRow & { status: "new" | "existing" | "repeated" };

/** 嚴格解析 CSV；保留實體行號，錯誤引號不能靜默吞掉後續資料。 */
function records(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^\uFEFF/, "");
  const result: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], field = "", line = 1, start = 1;
  let state: "plain" | "quoted" | "closed" = "plain";
  const finish = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim())) result.push({ line: start, cells });
    cells = []; field = ""; state = "plain";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (state === "quoted") {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else state = "closed";
      } else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        field += "\n"; line++;
      } else field += ch;
      continue;
    }
    if (ch === ",") { cells.push(field); field = ""; state = "plain"; }
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      finish(); line++; start = line;
    } else if (state === "closed") {
      throw { line, message: "雙引號結束後只能接逗號或換行，請檢查 CSV 格式" };
    } else if (ch === '"') {
      if (field !== "") throw { line, message: "欄位內的雙引號需以兩個雙引號跳脫，並把整個欄位包在雙引號內" };
      state = "quoted";
    } else field += ch;
  }
  if (state === "quoted") throw { line: start, message: "雙引號未關閉，請檢查 CSV 格式" };
  if (field !== "" || cells.length || state === "closed") finish();
  return result;
}

export function parseVocabularyCsv(text: string): VocabularyCsvResult {
  const errors: VocabularyImportIssue[] = [], rows: VocabularyImportRow[] = [];
  // UTF-8 最小每字元一位元組；精確的檔案位元組限制由讀檔端檢查。
  if (text.length > VOCABULARY_CSV_MAX_BYTES) return { rows, errors: [{ line: 1, message: "檔案過大，請拆成不超過 2 MB 的檔案" }] };
  let data: ReturnType<typeof records>;
  try { data = records(text); }
  catch (issue) { return { rows, errors: [issue as VocabularyImportIssue] }; }
  if (data.length < 2) return { rows, errors: [{ line: 1, message: "請提供標題列與至少一筆單字資料" }] };
  if (data.length - 1 > VOCABULARY_IMPORT_LIMIT) return { rows, errors: [{ line: 1, message: `一次最多 ${VOCABULARY_IMPORT_LIMIT} 筆，請拆分檔案` }] };
  const header = data[0];
  const keys = header.cells.map((h) => COLUMNS.find((c) => c.key === h.trim().toLowerCase() || c.label === h.trim())?.key);
  keys.forEach((key, i) => {
    if (!key) errors.push({ line: header.line, message: `不認得欄名「${header.cells[i]}」，請使用單字 CSV 範本` });
    else if (keys.indexOf(key) !== i) errors.push({ line: header.line, message: `欄位「${key}」重複` });
  });
  COLUMNS.filter((c) => c.required && !keys.includes(c.key)).forEach((c) => errors.push({ line: header.line, message: `缺少必填欄位「${c.label}」` }));
  if (errors.length) return { rows, errors };
  for (const record of data.slice(1)) {
    if (record.cells.length !== header.cells.length) { errors.push({ line: record.line, message: "欄位數量與標題不同，含逗號的內容需用雙引號包住" }); continue; }
    const input = { term: "", meaning_zh: "", part_of_speech: "", example: "", source: null };
    keys.forEach((key, i) => { if (key) input[key] = record.cells[i]; });
    const parsed = VocabularyInputSchema.safeParse(input);
    if (parsed.success) rows.push({ line: record.line, input: parsed.data });
    else errors.push({ line: record.line, message: parsed.error.issues.map((issue) => issue.message).join("；") });
  }
  return { rows, errors };
}

export function previewVocabularyImport(rows: readonly VocabularyImportRow[], existing: readonly VocabularyWord[]): VocabularyPreviewRow[] {
  const stored = new Set(existing.map((word) => word.normalized_term)), seen = new Set<string>();
  return rows.map((row) => {
    const key = normalizeTerm(row.input.term);
    const status = stored.has(key) ? "existing" : seen.has(key) ? "repeated" : "new";
    seen.add(key);
    return { ...row, status };
  });
}

export function vocabularyTemplateCsv(): string {
  return toCsv([
    COLUMNS.map((c) => c.key),
    ["appointment", "預約；約定", "n.", "Please confirm your appointment before visiting the office."],
    ["out of stock", "缺貨", "片語", "The requested size is currently out of stock."],
  ]);
}
