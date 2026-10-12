import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { repos } from "@/storage";
import { downloadText } from "@/lib/download";
import { VOCABULARY_STARTER } from "@/fixtures/vocabulary-starter";
import { parseVocabularyCsv, previewVocabularyImport, vocabularyTemplateCsv, VOCABULARY_CSV_MAX_BYTES,
  type VocabularyImportRow, type VocabularyImportIssue } from "@/domain/vocabulary-import";
import type { VocabularyWord } from "@/domain/schema";

const STATUS = { new: "新增", existing: "略過：已在單字本", repeated: "略過：本批重複" };

export function VocabularyLibrary({ words }: { words: VocabularyWord[] }) {
  const [mode, setMode] = useState<"starter" | "csv" | null>(null);
  const [topics, setTopics] = useState(VOCABULARY_STARTER.topics.map((t) => t.id));
  const [rows, setRows] = useState<VocabularyImportRow[] | null>(null);
  const [issues, setIssues] = useState<VocabularyImportIssue[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewPage, setPreviewPage] = useState(0);
  const sending = useRef(false);
  const previewList = useRef<HTMLUListElement>(null);
  const preview = rows ? previewVocabularyImport(rows, words) : [];
  const additions = preview.filter((r) => r.status === "new").length;
  const selected = VOCABULARY_STARTER.topics.filter((t) => topics.includes(t.id)).flatMap((t) => t.words);
  const total = VOCABULARY_STARTER.topics.reduce((sum, t) => sum + t.words.length, 0);
  const filteredPreview = preview.filter((row) => `${row.input.term} ${row.input.meaning_zh}`.toLowerCase().includes(previewSearch.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredPreview.length / 50));
  const currentPage = Math.min(previewPage, pageCount - 1);
  const displayedPreview = filteredPreview.slice(currentPage * 50, (currentPage + 1) * 50);
  useEffect(() => { previewList.current?.scrollTo({ top: 0 }); }, [currentPage, previewSearch, rows]);
  const reset = () => { setRows(null); setIssues([]); setError(null); setMessage(null); setFileName(""); setPreviewSearch(""); setPreviewPage(0); };
  const changeMode = (next: typeof mode) => { if (!sending.current) { reset(); setMode(next); } };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || sending.current) return;
    reset(); setFileName(file.name); setBusy(true); sending.current = true;
    try {
      if (file.size > VOCABULARY_CSV_MAX_BYTES) throw new Error("檔案超過 2 MB，請拆分後再匯入");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("無法讀取 UTF-8 CSV，請將檔案存為 UTF-8 編碼後重試"); }
      const parsed = parseVocabularyCsv(text);
      setRows(parsed.rows); setIssues(parsed.errors);
    } catch (err) { setError(err instanceof Error ? err.message : "讀檔失敗，請重新選擇檔案"); }
    finally { setBusy(false); sending.current = false; }
  };
  const commit = async () => {
    if (!rows?.length || issues.length || !additions || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const result = await repos.vocabulary.importBatch(rows.map((row) => row.input));
      setRows(null);
      setMessage(`已新增 ${result.added} 個單字，略過 ${result.skipped} 個重複項目。既有單字與複習進度已保留。`);
    } catch (err) { setError(err instanceof Error ? err.message : "匯入失敗，原資料保留，請重試"); }
    finally { setBusy(false); sending.current = false; }
  };
  return <section className="card vocab-library" aria-labelledby="vocab-library-title">
    <h2 id="vocab-library-title">增加練習單字</h2>
    <p className="card-desc">可加入自編入門包，或上傳自己的單字清單。預覽後再確認，重複單字會略過。</p>
    <div className="actions">
      <button type="button" className="btn" disabled={busy} aria-expanded={mode === "starter"} onClick={() => changeMode(mode === "starter" ? null : "starter")}>選擇入門包</button>
      <button type="button" className="btn" disabled={busy} aria-expanded={mode === "csv"} onClick={() => changeMode(mode === "csv" ? null : "csv")}>CSV 批次匯入</button>
      <button type="button" className="btn" onClick={() => downloadText(vocabularyTemplateCsv(), "單字匯入範本_v1.csv", "text/csv;charset=utf-8")}>下載 CSV 範本</button>
    </div>
    {mode === "starter" && <div className="vocab-library-panel">
      <h3>{VOCABULARY_STARTER.title}（{total} 個）</h3>
      <p className="card-desc">自編職場閱讀素材，含繁中意思、詞性與原創例句；非官方題庫或必考清單。選擇需要的主題後查看單字，再確認加入。</p>
      <fieldset className="vocab-topic-fieldset" disabled={busy}>
        <legend>選擇主題</legend>
        <div className="vocab-topics">{VOCABULARY_STARTER.topics.map((topic) => <label key={topic.id}>
          <input type="checkbox" checked={topics.includes(topic.id)} onChange={(e) => {
            reset(); setTopics(e.target.checked ? [...topics, topic.id] : topics.filter((id) => id !== topic.id));
          }} /><span>{topic.title}（{topic.words.length} 個）</span>
        </label>)}</div>
      </fieldset>
      <div className="actions">
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => { reset(); setTopics(VOCABULARY_STARTER.topics.map((t) => t.id)); }}>全選主題</button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => { reset(); setTopics([]); }}>取消全選</button>
        <button type="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={() => { setError(null); setMessage(null); setPreviewSearch(""); setPreviewPage(0); setRows(selected.map((input, i) => ({ line: i + 1, input }))); }}>預覽入門包（{selected.length} 個）</button>
      </div>
    </div>}
    {mode === "csv" && <div className="vocab-library-panel">
      <h3>上傳單字 CSV</h3>
      <p className="card-desc">英文單字／片語與繁中意思必填，詞性與英文例句選填。一次最多 1,000 筆、2 MB，請使用 UTF-8 編碼。</p>
      <label className="field"><span className="field-label">選擇 CSV 檔案</span><input className="input" type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void upload(event)} /></label>
      <p className="field-hint">範本含兩筆示例，可直接修改。英文欄名為 term、meaning_zh、part_of_speech、example；也接受「英文單字／片語、繁中意思、詞性、英文例句」。使用 Excel 2016 請保留 UTF-8 編碼；若存成一般 CSV 後無法讀取，可用記事本另存為 UTF-8。</p>
      {fileName && <p className="vocab-file-name">檔案：{fileName}</p>}
    </div>}
    {issues.length > 0 && <div className="notice notice-warn" role="alert">
      <p>找到 {issues.length} 個錯誤，尚未寫入任何單字。請修正後重新選擇檔案。</p>
      <ul>{issues.slice(0, 30).map((issue, i) => <li key={i}>第 {issue.line} 行：{issue.message}</li>)}</ul>
      {issues.length > 30 && <p>其餘 {issues.length - 30} 個錯誤暫不列出，請先修正上述項目。</p>}
    </div>}
    {rows !== null && <div className="vocab-import-preview">
      <h3>匯入預覽</h3>
      <p className="card-desc num">有效資料 {rows.length} 筆・預計新增 {additions} 個・重複略過 {preview.length - additions} 筆</p>
      <p className="field-hint">同字多義請編輯既有單字。確認時會再次檢查重複；其他分頁新增同字時，以實際匯入結果為準。</p>
      <label className="field vocab-preview-search"><span className="field-label">搜尋預覽單字或中文意思</span><input className="input" type="search" value={previewSearch} disabled={busy} onChange={(e) => { setPreviewSearch(e.target.value); setPreviewPage(0); }} /></label>
      <p className="field-hint">搜尋與分頁只影響顯示；確認加入仍會處理本批全部 {rows.length} 筆。</p>
      <p className="card-desc num" role="status">顯示 {filteredPreview.length ? currentPage * 50 + 1 : 0}–{Math.min((currentPage + 1) * 50, filteredPreview.length)}／{filteredPreview.length} 筆</p>
      {!filteredPreview.length && <p className="notice">沒有符合搜尋的預覽單字，請更改或清除搜尋。</p>}
      <ul ref={previewList} className="vocab-import-list" aria-label="待匯入單字">{displayedPreview.map((row) => <li key={row.line}>
        <div className="vocab-import-heading"><strong lang="en">{row.input.term}</strong><span className="tag">{STATUS[row.status]}</span></div>
        <p className="vocab-meaning">{row.input.part_of_speech && `${row.input.part_of_speech} `}{row.input.meaning_zh}</p>
        {row.input.example && <p className="vocab-example" lang="en">{row.input.example}</p>}
        {mode === "csv" && <p className="field-hint">CSV 第 {row.line} 行</p>}
      </li>)}</ul>
      {pageCount > 1 && <nav className="actions" aria-label="匯入預覽分頁">
        <button type="button" className="btn btn-small" disabled={busy || currentPage === 0} onClick={() => setPreviewPage(currentPage - 1)}>上一頁</button>
        <span className="num">第 {currentPage + 1}／{pageCount} 頁，每頁最多 50 筆</span>
        <button type="button" className="btn btn-small" disabled={busy || currentPage === pageCount - 1} onClick={() => setPreviewPage(currentPage + 1)}>下一頁</button>
      </nav>}
      {!additions && !issues.length && <p className="notice">這批單字已在單字本，沒有需要新增的項目。</p>}
      <div className="actions"><button type="button" className="btn btn-primary" disabled={busy || !!issues.length || !additions} onClick={() => void commit()}>{busy ? "匯入中…" : `確認加入 ${additions} 個單字`}</button>
        <button type="button" className="btn" disabled={busy} onClick={reset}>取消預覽</button></div>
    </div>}
    {busy && <p role="status">處理中，請稍候…</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="notice notice-warn" role="alert">{error}</p>}
  </section>;
}
