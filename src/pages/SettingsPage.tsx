import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui";
import { BackupCard } from "@/components/BackupCard";
import { useSettings } from "@/hooks/useSettings";
import { repos } from "@/storage";
import { defaultSettingsInput, validateSettingsInput, type FieldErrors } from "@/domain/settings";
import { READING_PARTS, PART_LABELS, type ReadingPart, type SettingsInput } from "@/domain/schema";

/** 表單內數字欄位先保留字串，送出時才轉換，避免輸入途中被強制改值。 */
interface FormState {
  exam_date: string;
  target_score: string;
  current_score: string;
  daily_minutes: string;
  available_weekdays: number[];
  self_ratings: Record<ReadingPart, number>;
  bank_csv_url: string;
}

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

const RATINGS = [1, 2, 3, 4, 5];

/** 欄位在畫面上的順序；驗證失敗時把焦點移到第一個出錯的欄位。 */
const FIELD_ORDER = [
  "exam_date",
  "daily_minutes",
  "target_score",
  "current_score",
  "available_weekdays",
  "self_ratings",
  "bank_csv_url",
] as const;

function toForm(s: SettingsInput): FormState {
  return {
    exam_date: s.exam_date,
    target_score: String(s.target_score),
    current_score: s.current_score === null ? "" : String(s.current_score),
    daily_minutes: String(s.daily_minutes),
    available_weekdays: [...s.available_weekdays],
    self_ratings: { ...s.self_ratings },
    bank_csv_url: s.bank_csv_url ?? "",
  };
}

const toNumber = (v: string) => (v.trim() === "" ? NaN : Number(v));

function fromForm(f: FormState): unknown {
  return {
    exam_date: f.exam_date,
    target_score: toNumber(f.target_score),
    current_score: f.current_score.trim() === "" ? null : toNumber(f.current_score),
    daily_minutes: toNumber(f.daily_minutes),
    available_weekdays: [...f.available_weekdays].sort((a, b) => a - b),
    self_ratings: f.self_ratings,
    bank_csv_url: f.bank_csv_url.trim() === "" ? null : f.bank_csv_url.trim(),
  };
}

type SaveStatus = { kind: "idle" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

export function SettingsPage() {
  const stored = useSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  // 第一次讀到資料時填入表單；之後不再覆蓋使用者正在編輯的內容。
  useEffect(() => {
    if (stored === undefined || form !== null) return;
    setForm(toForm(stored ?? defaultSettingsInput()));
  }, [stored, form]);

  if (form === null) {
    return (
      <>
        <PageHeader title="設定" subtitle="考試目標、讀書時間與題庫來源" />
        <p className="loading">讀取中…</p>
      </>
    );
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...form, [key]: value });
    setStatus({ kind: "idle" });
  };

  const toggleWeekday = (day: number) => {
    const has = form.available_weekdays.includes(day);
    update(
      "available_weekdays",
      has ? form.available_weekdays.filter((d) => d !== day) : [...form.available_weekdays, day],
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validateSettingsInput(fromForm(form));
    if (!result.ok) {
      setErrors(result.errors);
      setStatus({ kind: "error", message: "有欄位需要修正，請看紅字說明" });
      const first = FIELD_ORDER.find((key) => result.errors[key]);
      if (first) document.getElementById(`field-${first}`)?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await repos.settings.save(result.value);
      setForm(toForm(saved));
      setStatus({ kind: "saved", at: new Date(saved.updated_at).toLocaleTimeString("zh-TW", { hour12: false }) });
    } catch (err) {
      console.error(err);
      setStatus({ kind: "error", message: "儲存失敗，資料沒有變更，請再試一次" });
    } finally {
      setSaving(false);
    }
  };

  const err = (key: string) =>
    errors[key] ? (
      <span className="field-error" id={`err-${key}`}>
        {errors[key]}
      </span>
    ) : null;
  const invalid = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `err-${key}` } : {});

  return (
    <>
      <PageHeader title="設定" subtitle="考試目標、讀書時間與題庫來源" />
      <form onSubmit={onSubmit} noValidate>
        <section className="card">
          <h2>目標與時間</h2>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">考試日期</span>
              <input
                id="field-exam_date"
                className="input"
                type="date"
                value={form.exam_date}
                onChange={(e) => update("exam_date", e.target.value)}
                {...invalid("exam_date")}
              />
              {err("exam_date")}
            </label>
            <label className="field">
              <span className="field-label">每日可讀書分鐘</span>
              <input
                id="field-daily_minutes"
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={form.daily_minutes}
                onChange={(e) => update("daily_minutes", e.target.value)}
                {...invalid("daily_minutes")}
              />
              {err("daily_minutes")}
            </label>
            <label className="field">
              <span className="field-label">目標分數</span>
              <input
                id="field-target_score"
                className="input"
                type="number"
                inputMode="numeric"
                min={10}
                max={990}
                step={5}
                value={form.target_score}
                onChange={(e) => update("target_score", e.target.value)}
                {...invalid("target_score")}
              />
              {err("target_score")}
            </label>
            <label className="field">
              <span className="field-label">目前分數（選填）</span>
              <input
                id="field-current_score"
                className="input"
                type="number"
                inputMode="numeric"
                min={10}
                max={990}
                step={5}
                placeholder="沒考過可留白"
                value={form.current_score}
                onChange={(e) => update("current_score", e.target.value)}
                {...invalid("current_score")}
              />
              {err("current_score")}
            </label>
          </div>
        </section>

        <section className="card">
          <h2 id="weekday-label">可讀書的星期</h2>
          <p className="card-desc">計畫只會排在勾選的日子。</p>
          <div
            id="field-available_weekdays"
            className="toggle-row"
            role="group"
            aria-labelledby="weekday-label"
            tabIndex={-1}
          >
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="toggle">
                <input
                  type="checkbox"
                  checked={form.available_weekdays.includes(d.value)}
                  onChange={() => toggleWeekday(d.value)}
                  aria-label={`星期${d.label}`}
                />
                <span>{d.label}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>{err("available_weekdays")}</div>
        </section>

        <section className="card">
          <h2>單元自評</h2>
          <p className="card-desc">1 = 很弱，5 = 很有把握。自評越低的單元，計畫會分配越多時間。</p>
          <table className="rating-table" id="field-self_ratings" tabIndex={-1}>
            <tbody>
              {READING_PARTS.map((part) => (
                <tr key={part}>
                  <th scope="row" id={`rating-${part}`}>
                    {PART_LABELS[part]}
                  </th>
                  <td>
                    <div className="toggle-row" role="radiogroup" aria-labelledby={`rating-${part}`}>
                      {RATINGS.map((r) => (
                        <label key={r} className="toggle">
                          <input
                            type="radio"
                            name={`rating-${part}`}
                            checked={form.self_ratings[part] === r}
                            onChange={() => update("self_ratings", { ...form.self_ratings, [part]: r })}
                            aria-label={`${r} 分`}
                          />
                          <span className="num">{r}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {err("self_ratings")}
        </section>

        <section className="card">
          <h2>題庫來源</h2>
          <p className="card-desc">
            內建 demo 題庫一直可以用。之後建立題庫 Sheet 並「發佈到網路」成 CSV 後，把網址貼在這裡；讀取功能在 P5 開放。
          </p>
          <label className="field">
            <span className="field-label">題庫 Sheet 的 CSV 網址（選填）</span>
            <input
              id="field-bank_csv_url"
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv"
              value={form.bank_csv_url}
              onChange={(e) => update("bank_csv_url", e.target.value)}
              {...invalid("bank_csv_url")}
            />
            <span className="field-hint">發佈後的網址是公開的，Sheet 裡只放題目，不要放個人資料。</span>
            {err("bank_csv_url")}
          </label>
        </section>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存設定"}
          </button>
          <span
            role="status"
            aria-live="polite"
            className={`status-msg ${status.kind === "saved" ? "ok" : status.kind === "error" ? "err" : ""}`}
          >
            {status.kind === "saved" && `已儲存（${status.at}）`}
            {status.kind === "error" && status.message}
          </span>
        </div>
      </form>

      <BackupCard
        onRestored={async () => {
          // 還原後直接從資料庫重新讀取設定到表單（不卸載備份區塊，保留成功訊息）
          const restored = await repos.settings.get();
          setForm(toForm(restored ?? defaultSettingsInput()));
          setErrors({});
          setStatus({ kind: "idle" });
        }}
      />
    </>
  );
}
