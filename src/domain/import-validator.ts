import { parseCsv, toCsv } from "./csv";
import {
  OptionKeySchema,
  QUESTION_STATUS_LABELS,
  type ContentGroup,
  type Difficulty,
  type OptionKey,
  type Question,
  type QuestionStatus,
} from "./schema";

/** 題庫 Sheet 欄位（英文 key）與可接受的中文欄名。 */
export const CSV_COLUMNS = [
  { key: "id", aliases: ["ID", "編號"], required: true },
  { key: "part", aliases: ["單元", "Part"], required: true },
  { key: "difficulty", aliases: ["難度"], required: true },
  { key: "group_id", aliases: ["題組", "題組ID"], required: false },
  { key: "passage", aliases: ["文章"], required: false },
  { key: "question", aliases: ["題目", "題幹"], required: true },
  { key: "a", aliases: ["選項A", "選項 A"], required: true },
  { key: "b", aliases: ["選項B", "選項 B"], required: true },
  { key: "c", aliases: ["選項C", "選項 C"], required: true },
  { key: "d", aliases: ["選項D", "選項 D"], required: true },
  { key: "answer", aliases: ["正確答案", "答案"], required: true },
  { key: "explanation", aliases: ["解析"], required: true },
  { key: "tags", aliases: ["標籤"], required: false },
  { key: "status", aliases: ["狀態"], required: true },
  { key: "version", aliases: ["版本"], required: false },
  { key: "created_at", aliases: ["建立日期"], required: false },
] as const;

type ColumnKey = (typeof CSV_COLUMNS)[number]["key"];

export interface ImportIssue {
  /** 試算表上的列號（標題為第 1 列） */
  row: number;
  field?: string;
  message: string;
}

export interface CsvRow {
  row: number;
  sourceId: string;
  status: QuestionStatus;
  /** 以下欄位只在 status = approved 且驗證通過時保證有效 */
  part: 5 | 6 | 7;
  difficulty: Difficulty;
  groupSourceId: string | null;
  passage: string;
  stem: string;
  options: { key: OptionKey; text: string }[];
  answer: OptionKey;
  explanation: string;
  tags: string[];
  version: number;
}

export interface ValidationResult {
  rows: CsvRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: { total: number; approved: number; draft: number; rejected: number };
}

const STATUS_MAP: Record<string, QuestionStatus> = {
  草稿: "draft",
  draft: "draft",
  已審核: "approved",
  approved: "approved",
  退回: "rejected",
  rejected: "rejected",
};

const DIFFICULTY_MAP: Record<string, Difficulty> = {
  基礎: "basic",
  basic: "basic",
  中階: "intermediate",
  intermediate: "intermediate",
  進階: "advanced",
  advanced: "advanced",
};

const DIFFICULTY_ZH: Record<Difficulty, string> = { basic: "基礎", intermediate: "中階", advanced: "進階" };

const normalizeHeader = (h: string) => h.trim().replace(/\s+/g, "").toLowerCase();

function mapHeader(header: string[]): { index: Partial<Record<ColumnKey, number>>; missing: string[]; unknown: string[] } {
  const index: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const h = normalizeHeader(raw);
    const col = CSV_COLUMNS.find(
      (c) => normalizeHeader(c.key) === h || c.aliases.some((a) => normalizeHeader(a) === h),
    );
    if (col && index[col.key] === undefined) index[col.key] = i;
    else if (raw.trim() !== "") unknown.push(raw.trim());
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && index[c.key] === undefined).map((c) => c.key);
  return { index, missing, unknown };
}

export function validateCsv(text: string): ValidationResult {
  const result: ValidationResult = {
    rows: [],
    errors: [],
    warnings: [],
    counts: { total: 0, approved: 0, draft: 0, rejected: 0 },
  };
  const records = parseCsv(text);
  if (records.length === 0) {
    result.errors.push({ row: 1, message: "檔案是空的" });
    return result;
  }
  const { index, missing, unknown } = mapHeader(records[0]);
  if (missing.length > 0) {
    result.errors.push({ row: 1, message: `缺少必要欄位：${missing.join("、")}` });
    return result;
  }
  if (unknown.length > 0) result.warnings.push({ row: 1, message: `以下欄位不認得，已忽略：${unknown.join("、")}` });

  const seenIds = new Map<string, number>();
  records.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (k: ColumnKey) => {
      const idx = index[k];
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    const err = (field: string, message: string) => result.errors.push({ row, field, message });
    result.counts.total += 1;

    const sourceId = get("id");
    if (!sourceId) {
      err("id", "id 不可空白");
      return;
    }
    if (seenIds.has(sourceId)) {
      err("id", `id 重複（與第 ${seenIds.get(sourceId)} 列相同）`);
      return;
    }
    seenIds.set(sourceId, row);

    const status = STATUS_MAP[get("status")] ?? STATUS_MAP[get("status").toLowerCase()];
    if (!status) {
      err("status", "狀態須為 草稿／已審核／退回");
      return;
    }
    result.counts[status] += 1;

    const base = { row, sourceId, status } as CsvRow;
    if (status !== "approved") {
      // 草稿與退回只需要 id 與狀態（用來下架），其餘欄位不檢查
      result.rows.push(base);
      return;
    }

    const before = result.errors.length;
    const partNum = Number(get("part").replace(/^part\s*/i, ""));
    if (![5, 6, 7].includes(partNum)) {
      err("part", [1, 2, 3, 4].includes(partNum) ? "目前只支援閱讀 Part 5–7" : "part 須為 5、6 或 7");
    }
    const difficulty = DIFFICULTY_MAP[get("difficulty")] ?? DIFFICULTY_MAP[get("difficulty").toLowerCase()];
    if (!difficulty) err("difficulty", "難度須為 基礎／中階／進階");

    const groupSourceId = get("group_id") || null;
    if ((partNum === 6 || partNum === 7) && !groupSourceId) err("group_id", "Part 6／7 必須填 group_id");
    if (partNum === 5 && groupSourceId) {
      result.warnings.push({ row, field: "group_id", message: "Part 5 不使用 group_id，已忽略" });
    }

    const stem = get("question");
    if (!stem && (partNum === 5 || partNum === 7)) err("question", "題目不可空白");

    const options = (["a", "b", "c", "d"] as const).map((k) => ({ key: k.toUpperCase() as OptionKey, text: get(k) }));
    for (const o of options) if (!o.text) err(o.key.toLowerCase(), `選項 ${o.key} 不可空白`);

    const answerParsed = OptionKeySchema.safeParse(get("answer").toUpperCase());
    if (!answerParsed.success) err("answer", "正確答案須為 A、B、C 或 D");

    const explanation = get("explanation");
    if (!explanation) err("explanation", "解析不可空白");

    const versionRaw = get("version");
    const version = versionRaw === "" ? 1 : Number(versionRaw);
    if (!Number.isInteger(version) || version < 1) err("version", "版本須為正整數");

    if (result.errors.length > before) return;
    result.rows.push({
      ...base,
      part: partNum as 5 | 6 | 7,
      difficulty,
      groupSourceId: partNum === 5 ? null : groupSourceId,
      passage: get("passage"),
      stem,
      options,
      answer: answerParsed.data!,
      explanation,
      tags: get("tags")
        .split(/[;；]/)
        .map((t) => t.trim())
        .filter(Boolean),
      version,
    });
  });

  // 題組檢查：同一題組的 Part 一致、恰有一段文章
  const groups = new Map<string, CsvRow[]>();
  for (const r of result.rows) {
    if (r.status === "approved" && r.groupSourceId) groups.set(r.groupSourceId, [...(groups.get(r.groupSourceId) ?? []), r]);
  }
  for (const [gid, rows] of groups) {
    const first = rows[0];
    if (rows.some((r) => r.part !== first.part)) {
      result.errors.push({ row: first.row, field: "group_id", message: `題組 ${gid} 內的 Part 不一致` });
    }
    const passages = [...new Set(rows.map((r) => r.passage).filter(Boolean))];
    if (passages.length === 0) {
      result.errors.push({ row: first.row, field: "passage", message: `題組 ${gid} 沒有文章（請在其中一列填 passage）` });
    } else if (passages.length > 1) {
      result.errors.push({ row: first.row, field: "passage", message: `題組 ${gid} 有多段不同的文章，請只在一列填寫` });
    }
  }
  result.errors.sort((a, b) => a.row - b.row);
  return result;
}

// ---------- 比對與寫入計畫 ----------

export interface ImportPlan {
  questions: Question[];
  groups: ContentGroup[];
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    unpublished: number;
    skippedDraft: number;
    skippedRejected: number;
  };
  /** 版本衝突等不阻擋寫入的提醒 */
  notices: ImportIssue[];
}

/** 文章欄用單獨一行 --- 分隔多篇文章（Part 7 多篇閱讀）。 */
export function splitPassages(text: string): { body: string }[] {
  return text
    .split(/\r?\n\s*---\s*\r?\n/)
    .map((body) => body.trim())
    .filter(Boolean)
    .map((body) => ({ body }));
}

function sameContent(q: Question, next: Omit<Question, "id" | "created_at" | "updated_at">): boolean {
  const pick = (x: typeof next) =>
    JSON.stringify([x.part, x.stem, x.options, x.correct_key, x.explanation_zh, x.tags, x.difficulty, x.group_id]);
  return pick(q) === pick(next);
}

/**
 * 依 CSV 與現有題庫算出要寫入的題目與題組（純函式）。
 * 以 source_id 對應既有題目並沿用其 UUID，錯題與作答紀錄因此維持連結。
 */
export function planImport(
  rows: readonly CsvRow[],
  existingQuestions: readonly Question[],
  existingGroups: readonly ContentGroup[],
  now: string,
  newId: () => string,
): ImportPlan {
  const plan: ImportPlan = {
    questions: [],
    groups: [],
    summary: { added: 0, updated: 0, unchanged: 0, unpublished: 0, skippedDraft: 0, skippedRejected: 0 },
    notices: [],
  };
  const qBySource = new Map(existingQuestions.map((q) => [q.source_id, q]));
  const gBySource = new Map(existingGroups.filter((g) => g.source_id).map((g) => [g.source_id!, g]));

  // 題組
  const groupIdBySource = new Map<string, string>();
  const blockedGroups = new Set<string>();
  const rowBySource = new Map(rows.map((r) => [r.sourceId, r]));
  const approved = rows.filter((r) => r.status === "approved");
  for (const r of approved) {
    if (!r.groupSourceId || groupIdBySource.has(r.groupSourceId)) continue;
    const passageText = approved.find((x) => x.groupSourceId === r.groupSourceId && x.passage)?.passage ?? "";
    const passages = splitPassages(passageText);
    const existing = gBySource.get(r.groupSourceId);
    groupIdBySource.set(r.groupSourceId, existing?.id ?? newId());
    if (existing && JSON.stringify(existing.passages) === JSON.stringify(passages) && existing.part === r.part) continue;
    if (existing) {
      const incoming = approved.filter((q) => q.groupSourceId === r.groupSourceId);
      const members = existingQuestions.filter((q) => q.group_id === existing.id);
      const missingOrOld = members.some((q) => {
        const next = rowBySource.get(q.source_id);
        // 明確下架的題目可保留舊版本；仍在使用者須隨文章升版。
        if (next && next.status !== "approved") return false;
        if (!next) return q.status === "approved";
        return next.groupSourceId !== r.groupSourceId || next.version <= q.version;
      });
      const incomingOld = incoming.some((next) => {
        const q = qBySource.get(next.sourceId);
        return q && next.version <= q.version;
      });
      if (missingOrOld || incomingOld) {
        blockedGroups.add(r.groupSourceId);
        plan.notices.push({ row: r.row, field: "version", message: `題組 ${r.groupSourceId} 的文章已修改；請提供所有仍在使用的同組題目並將版本加 1。文章與同組題目已一併略過` });
        continue;
      }
    }
    plan.groups.push({
      id: groupIdBySource.get(r.groupSourceId)!,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      part: r.part,
      passages,
      image_asset_id: null,
      audio_asset_id: null,
      transcript: null,
      speaker_labels: [],
      source_id: r.groupSourceId,
    });
  }

  for (const r of rows) {
    const existing = qBySource.get(r.sourceId);
    if (r.status !== "approved") {
      if (existing?.status === "approved") {
        plan.questions.push({ ...existing, status: r.status, updated_at: now });
        plan.summary.unpublished += 1;
      } else if (r.status === "draft") plan.summary.skippedDraft += 1;
      else plan.summary.skippedRejected += 1;
      continue;
    }

    if ((r.groupSourceId && blockedGroups.has(r.groupSourceId)) ||
        (existing?.group_id && existingGroups.some((g) => g.id === existing.group_id && g.source_id && blockedGroups.has(g.source_id)))) continue;

    const content = {
      group_id: r.groupSourceId ? groupIdBySource.get(r.groupSourceId)! : null,
      part: r.part,
      stem: r.stem,
      options: r.options,
      correct_key: r.answer,
      explanation_zh: r.explanation,
      tags: r.tags,
      difficulty: r.difficulty,
      source_id: r.sourceId,
      version: r.version,
      status: "approved" as const,
    };

    if (!existing) {
      plan.questions.push({ id: newId(), created_at: now, updated_at: now, ...content });
      plan.summary.added += 1;
      continue;
    }
    const contentSame = sameContent(existing, content);
    if (r.version > existing.version) {
      plan.questions.push({ ...existing, ...content, updated_at: now });
      plan.summary.updated += 1;
    } else if (r.version < existing.version) {
      plan.notices.push({ row: r.row, field: "version", message: `版本 ${r.version} 比 App 內的 v${existing.version} 舊，已略過` });
    } else if (!contentSame) {
      plan.notices.push({
        row: r.row,
        field: "version",
        message: `內容與 App 內不同，但版本沒有加 1（仍是 v${r.version}），已略過；修改題目請把 version 加 1`,
      });
    } else if (existing.status !== "approved") {
      plan.questions.push({ ...existing, status: "approved", updated_at: now });
      plan.summary.updated += 1;
    } else {
      plan.summary.unchanged += 1;
    }
  }
  return plan;
}

// ---------- 匯出 ----------

export function bankToCsv(questions: readonly Question[], groups: readonly ContentGroup[]): string {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupSource = (g: ContentGroup) => g.source_id ?? `G-${g.id}`;
  const seenGroup = new Set<string>();
  const sorted = [...questions].sort((a, b) => a.part - b.part || a.source_id.localeCompare(b.source_id));
  const header = CSV_COLUMNS.map((c) => c.key as string);
  const body = sorted.map((q) => {
    const g = q.group_id ? groupById.get(q.group_id) : undefined;
    const firstInGroup = g && !seenGroup.has(g.id);
    if (g) seenGroup.add(g.id);
    const opt = (k: OptionKey) => q.options.find((o) => o.key === k)?.text ?? "";
    const values: Record<ColumnKey, string> = {
      id: q.source_id,
      part: String(q.part),
      difficulty: DIFFICULTY_ZH[q.difficulty],
      group_id: g ? groupSource(g) : "",
      passage: firstInGroup ? g!.passages.map((p) => (p.title ? `${p.title}\n${p.body}` : p.body)).join("\n---\n") : "",
      question: q.stem,
      a: opt("A"),
      b: opt("B"),
      c: opt("C"),
      d: opt("D"),
      answer: q.correct_key,
      explanation: q.explanation_zh,
      tags: q.tags.join(";"),
      status: QUESTION_STATUS_LABELS[q.status],
      version: String(q.version),
      created_at: q.created_at.slice(0, 10),
    };
    return header.map((k) => values[k as ColumnKey]);
  });
  return toCsv([header, ...body]);
}
