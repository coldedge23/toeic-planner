import { useRef, useState } from "react";
import { repos } from "@/storage";
import { downloadText } from "@/lib/download";
import { backupFileName, parseBackup } from "@/domain/backup-migrations";
import { todayInTaipei } from "@/domain/dates";
import type { Backup } from "@/domain/schema";

type Preview = { backup: Backup; fileName: string; migratedFrom: number | null };

const exportedAt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
});

function counts(b: Backup) {
  return [
    ["設定", b.settings.length],
    ["計畫任務", b.study_tasks.length],
    ["題目", b.questions.length],
    ["測驗", b.sessions.length],
    ["作答紀錄", b.attempts.length],
    ["錯題", b.mistake_items.length],
    ["單字", b.vocabulary_words.length],
    ["單字複習", b.vocabulary_reviews.length],
  ] as const;
}

async function downloadBackup(beforeRestore = false) {
  const backup = await repos.backups.exportAll();
  const name = beforeRestore ? backupFileName(todayInTaipei()).replace(".json", "_還原前.json") : backupFileName(todayInTaipei());
  downloadText(JSON.stringify(backup, null, 2), name, "application/json");
}

export function BackupCard({ onRestored }: { onRestored?: () => void | Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const onExport = async () => {
    setMessage(null);
    try {
      await downloadBackup();
      setMessage({ kind: "ok", text: "已匯出備份檔" });
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: "匯出失敗，請再試一次" });
    }
  };

  const onFile = async (file: File | undefined) => {
    setMessage(null);
    setPreview(null);
    setAcknowledged(false);
    if (!file) return;
    const result = parseBackup(await file.text());
    if (fileRef.current) fileRef.current.value = "";
    if (!result.ok) {
      setMessage({ kind: "err", text: `無法匯入：${result.error}。目前資料沒有變更。` });
      return;
    }
    setPreview({ backup: result.backup, fileName: file.name, migratedFrom: result.migratedFrom });
  };

  const onImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await downloadBackup(true);
      await repos.backups.importAll(preview.backup);
      setPreview(null);
      setMessage({ kind: "ok", text: "已還原備份；還原前資料已另行匯出，請確認下載檔已保存" });
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: "還原失敗，目前資料沒有變更" });
      return;
    } finally {
      setBusy(false);
    }
    // 畫面刷新失敗不代表資料交易失敗，避免誤報「目前資料沒有變更」。
    if (onRestored) {
      try { await onRestored(); } catch (err) { console.error("還原後畫面更新失敗", err); }
    }
  };

  return (
    <section className="card">
      <h2>備份與還原</h2>
      <p className="card-desc">
        學習紀錄只存在這個瀏覽器。換裝置或清除瀏覽器資料前，請先匯出 JSON 備份。備份不含音訊與圖片檔。
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onExport()}>
          匯出備份
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          選擇備份檔還原…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {message && (
          <span role="status" className={`status-msg ${message.kind}`}>
            {message.text}
          </span>
        )}
      </div>

      {preview && (
        <div className="card card-emphasis" style={{ marginTop: 16 }} aria-labelledby="restore-title">
          <h2 id="restore-title">還原預覽</h2>
          <p className="card-desc">
            {preview.fileName}｜匯出時間 {exportedAt.format(new Date(preview.backup.exported_at))}
            {preview.migratedFrom !== null && `｜舊版 v${preview.migratedFrom} 備份，已自動轉換`}
          </p>
          <table className="table">
            <tbody>
              {counts(preview.backup).map(([label, n]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="notice notice-warn" style={{ marginTop: 12 }}>
            還原會<strong>取代</strong>這個瀏覽器中目前的所有資料。確認時會先下載「還原前」備份，請保留該檔案。
          </p>
          <label className="inline-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            我了解目前資料會被取代
          </label>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={!acknowledged || busy} onClick={() => void onImport()}>
              {busy ? "還原中…" : "確認還原"}
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
