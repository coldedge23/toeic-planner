import { BackupSchema, SCHEMA_VERSION, type Backup } from "./schema";
import { validateBackup } from "./backup-integrity";

type Raw = Record<string, unknown>;

/**
 * 依序把舊版備份升級到目前版本。key = 來源版本，函式回傳下一版。
 * 新增版本時：SCHEMA_VERSION +1，並在這裡補上一個遷移步驟。
 */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  4: (raw) => ({ ...raw, schema_version: 5, listening_sessions: [] }),
  3: (raw) => ({ ...raw, schema_version: 4, vocabulary_words: [], vocabulary_reviews: [], vocabulary_settings: [] }),
  2: (raw) => ({
    ...raw,
    schema_version: 3,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map((s: Raw) => ({ ...s, study_task_id: null })) : raw.sessions,
  }),
  // v1 → v2：測驗紀錄新增暫停欄位
  1: (raw) => ({
    ...raw,
    schema_version: 2,
    sessions: Array.isArray(raw.sessions) ? (raw.sessions as Raw[]).map((s) => ({
      paused_at: null,
      paused_ms: 0,
      ...s,
    })) : raw.sessions,
  }),
};

export type BackupParseResult = { ok: true; backup: Backup; migratedFrom: number | null } | { ok: false; error: string };

export function parseBackup(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "檔案不是有效的 JSON，可能已損壞" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "檔案內容不是備份格式" };
  }
  const version = (raw as Raw).schema_version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "找不到備份版本（schema_version），這可能不是本 App 的備份檔" };
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, error: `這份備份來自較新版本（v${version}），目前 App 只支援到 v${SCHEMA_VERSION}` };
  }

  let current = raw as Raw;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, error: `缺少 v${v} 的遷移規則` };
    current = step(current);
  }

  const parsed = BackupSchema.safeParse(current);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `備份內容格式錯誤：${issue.path.join(".") || "(根層)"} — ${issue.message}` };
  }
  try {
    const backup = validateBackup(parsed.data);
    return { ok: true, backup, migratedFrom: version === SCHEMA_VERSION ? null : version };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "備份資料關聯錯誤" };
  }
}

/** 依使用者的檔名規則：YYYYMMDD_主題_vN（vN 為備份格式版本）。 */
export function backupFileName(today: string): string {
  return `${today.replaceAll("-", "")}_TOEIC備考備份_v${SCHEMA_VERSION}.json`;
}
