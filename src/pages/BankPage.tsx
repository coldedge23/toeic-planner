import { useRef, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader, StatCard } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";
import { repos } from "@/storage";
import { downloadText, sha256 } from "@/lib/download";
import { todayInTaipei } from "@/domain/dates";
import {
  bankToCsv,
  CSV_COLUMNS,
  planImport,
  validateCsv,
  type ImportPlan,
  type ValidationResult,
} from "@/domain/import-validator";
import { DIFFICULTY_LABELS, PART_LABELS, READING_PARTS, type Difficulty } from "@/domain/schema";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";

interface Preview {
  source: string;
  text: string;
  validation: ValidationResult;
  plan: ImportPlan | null;
}

const timeFmt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DIFFS: Difficulty[] = ["basic", "intermediate", "advanced"];
const stamp = () => todayInTaipei().replaceAll("-", "");

function PreviewCard({
  preview,
  busy,
  onCommit,
  onCancel,
}: {
  preview: Preview;
  busy: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { validation: v, plan } = preview;
  const hasErrors = v.errors.length > 0;
  const nothing =
    plan !== null && plan.summary.added + plan.summary.updated + plan.summary.unpublished === 0;
  return (
    <section className="card card-emphasis" aria-labelledby="import-preview-title">
      <h2 id="import-preview-title">匯入預覽</h2>
      <p className="card-desc">
        來源：{preview.source}。確認前不會改動題庫。
      </p>
      <table className="table">
        <tbody>
          <tr>
            <th scope="row">CSV 題目列</th>
            <td className="num">
              {v.counts.total}（已審核 {v.counts.approved}／草稿 {v.counts.draft}／退回 {v.counts.rejected}）
            </td>
          </tr>
          {plan && (
            <tr>
              <th scope="row">匯入結果</th>
              <td className="num">
                新增 {plan.summary.added}・更新 {plan.summary.updated}・不變 {plan.summary.unchanged}・下架{" "}
                {plan.summary.unpublished}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {hasErrors && (
        <>
          <p className="notice notice-warn" role="alert" style={{ marginTop: 12 }}>
            有 {v.errors.length} 個錯誤，這批資料不會寫入，目前題庫維持不變。請在 Sheet 修正後重新載入。
          </p>
          <div className="table-scroll">
            <table className="table issue-table">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    列
                  </th>
                  <th scope="col">欄位</th>
                  <th scope="col">問題</th>
                </tr>
              </thead>
              <tbody>
                {v.errors.slice(0, 50).map((e, i) => (
                  <tr key={i}>
                    <td className="num">{e.row}</td>
                    <td className="nowrap">{e.field ?? "—"}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {v.errors.length > 50 && <p className="stat-note">只顯示前 50 個錯誤。</p>}
        </>
      )}

      {[...v.warnings, ...(plan?.notices ?? [])].length > 0 && (
        <>
          <h3 className="sub-title">提醒與略過項目</h3>
          <ul className="issue-list">
            {[...v.warnings, ...(plan?.notices ?? [])].map((w, i) => (
              <li key={i}>
                <span className="num">第 {w.row} 列</span>
                {w.field && <span className="num">｜{w.field}</span>}：{w.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={hasErrors || busy || nothing} onClick={onCommit}>
          {busy ? "匯入中…" : "確認匯入"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        {nothing && !hasErrors && <span className="field-hint">沒有可套用的變更；若有略過提醒，請先修正後重新載入。</span>}
      </div>
    </section>
  );
}

export function BankPage() {
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const all = await repos.bank.listAll();
    return { ...all, batches: await repos.bank.listImportBatches(5), mistakes: await repos.mistakes.countActive() };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const approved = data?.questions.filter((q) => q.status === "approved") ?? [];
  const count = (pred: (q: (typeof approved)[number]) => boolean) =>
    data === undefined ? "…" : approved.filter(pred).length;

  const openPreview = async (text: string, source: string) => {
    const validation = validateCsv(text);
    const all = await repos.bank.listAll();
    const plan =
      validation.errors.length === 0
        ? planImport(validation.rows, all.questions, all.groups, new Date().toISOString(), () => crypto.randomUUID())
        : null;
    setPreview({ source, text, validation, plan });
  };

  const loadFromUrl = async () => {
    const url = settings?.bank_csv_url;
    if (!url) return;
    setBusy(true);
    setMessage(null);
    setPreview(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await openPreview(await res.text(), "題庫 Sheet（CSV 網址）");
    } catch (err) {
      console.error(err);
      setMessage({
        kind: "err",
        text: "讀取失敗。請確認網路連線，以及網址是 Sheet「發佈到網路」後產生、格式為 CSV 的網址。",
      });
    } finally {
      setBusy(false);
    }
  };

  const loadFromFile = async (file: File | undefined) => {
    setMessage(null);
    setPreview(null);
    if (!file) return;
    try {
      await openPreview(await file.text(), `本機檔案 ${file.name}`);
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: "無法讀取這個檔案" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = async () => {
    if (!preview || preview.validation.errors.length > 0) return;
    setBusy(true);
    try {
      const result = await repos.bank.commitImport({
        rows: preview.validation.rows,
        source: preview.source,
        checksum: await sha256(preview.text),
      });
      const s = result.summary;
      setPreview(null);
      setMessage({ kind: "ok", text: `已匯入：新增 ${s.added}、更新 ${s.updated}、下架 ${s.unpublished}` });
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: "匯入失敗，題庫沒有變更" });
    } finally {
      setBusy(false);
    }
  };

  const exportBank = () => {
    if (!data) return;
    downloadText(bankToCsv(data.questions, data.groups), `${stamp()}_TOEIC題庫匯出_v1.csv`, "text/csv;charset=utf-8");
  };
  const exportTemplate = () =>
    downloadText(bankToCsv(demoQuestions, demoGroups), `${stamp()}_TOEIC題庫範本_v1.csv`, "text/csv;charset=utf-8");

  return (
    <>
      <PageHeader title="題庫" subtitle="只有「已審核」的題目會被抽到" />
      <div className="stat-grid">
        <StatCard label="可抽題數" value={count(() => true)} unit="題" />
        {READING_PARTS.map((p) => (
          <StatCard key={p} label={`Part ${p}`} value={count((q) => q.part === p)} unit="題" />
        ))}
      </div>

      <section className="card">
        <h2>從題庫 Sheet 載入</h2>
        {settings?.bank_csv_url ? (
          <p className="card-desc url-line" title={settings.bank_csv_url}>
            {settings.bank_csv_url}
          </p>
        ) : (
          <p className="card-desc">
            尚未設定 CSV 網址，請到 <Link to="/settings">設定</Link> 填寫；也可以直接上傳本機 CSV。
          </p>
        )}
        <div className="actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!settings?.bank_csv_url || busy}
            onClick={() => void loadFromUrl()}
          >
            {busy && !preview ? "讀取中…" : "重新載入"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            上傳本機 CSV…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => void loadFromFile(e.target.files?.[0])}
          />
          {message && (
            <span role="status" className={`status-msg ${message.kind}`}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      {preview && (
        <PreviewCard
          preview={preview}
          busy={busy}
          onCommit={() => void commit()}
          onCancel={() => setPreview(null)}
        />
      )}

      <section className="card">
        <h2>各單元題數</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">單元</th>
                {DIFFS.map((d) => (
                  <th key={d} scope="col" className="num">
                    {DIFFICULTY_LABELS[d]}
                  </th>
                ))}
                <th scope="col" className="num">
                  合計
                </th>
              </tr>
            </thead>
            <tbody>
              {READING_PARTS.map((p) => (
                <tr key={p}>
                  <td className="nowrap">{PART_LABELS[p]}</td>
                  {DIFFS.map((d) => (
                    <td key={d} className="num">
                      {count((q) => q.part === p && q.difficulty === d)}
                    </td>
                  ))}
                  <td className="num">{count((q) => q.part === p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="stat-note" style={{ marginTop: 10 }}>
          內建 demo 題庫為原創練習題，非官方試題。錯題本目前有 {data?.mistakes ?? "…"} 題。
        </p>
      </section>

      <section className="card">
        <h2>匯出與範本</h2>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" disabled={!data} onClick={exportBank}>
            下載目前題庫 CSV
          </button>
          <button type="button" className="btn" onClick={exportTemplate}>
            下載 CSV 範本
          </button>
        </div>
        <details className="csv-help">
          <summary>CSV 欄位說明</summary>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">欄位</th>
                  <th scope="col">也接受</th>
                  <th scope="col">必填</th>
                </tr>
              </thead>
              <tbody>
                {CSV_COLUMNS.map((c) => (
                  <tr key={c.key}>
                    <td className="num">{c.key}</td>
                    <td>{c.aliases.join("、")}</td>
                    <td>{c.required ? "是" : "否"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="issue-list">
            <li>status 只有「已審核」會匯入；Sheet 上改成「草稿」或「退回」，App 會下架該題。</li>
            <li>修改已審核題目時請把 version 加 1，否則 App 會略過。</li>
            <li>Part 6／7 同一篇文章的題目用相同 group_id，文章只需填在其中一列；多篇文章用單獨一行 --- 分隔。</li>
            <li>Part 6 的 question 可填空格編號，例如 [2]。</li>
          </ul>
        </details>
      </section>

      <section className="card">
        <h2>AI 出題</h2>
        <p className="notice">
          AI 出題在題庫 Sheet 裡由 Apps Script 執行：每天 06:00 自動出題，或從 Sheet 選單手動出一批。新題目預設標為「草稿」，改成「已審核」後再按「重新載入」才會進入題庫；Sheet「設定」分頁開啟「自動審核」時，AI 複核答案一致的題目會直接標為「已審核」。
        </p>
      </section>

      {data && data.batches.length > 0 && (
        <section className="card">
          <h2>匯入紀錄</h2>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">來源</th>
                  <th scope="col" className="num">
                    已審核列數
                  </th>
                  <th scope="col" className="num">
                    提醒
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map((b) => (
                  <tr key={b.id}>
                    <td className="num nowrap">{timeFmt.format(new Date(b.created_at))}</td>
                    <td>{b.source}</td>
                    <td className="num">{b.valid_count}</td>
                    <td className="num">{b.errors.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
