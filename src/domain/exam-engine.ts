import type {
  Answer,
  ContentGroup,
  OptionKey,
  Part,
  Question,
  ReadingPart,
  Session,
} from "./schema";

export interface SessionConfig {
  /** bank = 題庫（題組整組抽）；mistakes = 錯題本（只出答錯的題目，同題組相鄰並附文章） */
  source: "bank" | "mistakes";
  parts: ReadingPart[];
  count: number;
  /** null = 不限時 */
  secondsPerQuestion: number | null;
}

export type SnapshotItem = Session["question_snapshot"][number];

/** 抽題單位：Part 5 單題；Part 6／7 同一題組的全部題目（不可拆開）。 */
interface Unit {
  key: string;
  part: Part;
  questions: Question[];
}

function buildUnits(questions: readonly Question[], parts: readonly Part[], wholeGroups = true): Unit[] {
  const units = new Map<string, Unit>();
  for (const q of questions) {
    if (q.status !== "approved" || !parts.includes(q.part)) continue;
    const key = wholeGroups && q.group_id ? q.group_id : `q:${q.id}`;
    const unit = units.get(key) ?? { key, part: q.part, questions: [] };
    unit.questions.push(q);
    units.set(key, unit);
  }
  for (const u of units.values()) u.questions.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return [...units.values()];
}

/** 用題組大小能組成的所有題數（子集合和）。 */
function achievableCounts(units: readonly Unit[]): Set<number> {
  let sums = new Set([0]);
  for (const u of units) {
    const next = new Set(sums);
    for (const s of sums) next.add(s + u.questions.length);
    sums = next;
  }
  return sums;
}

export interface Availability {
  /** 選定 Part 中已審核的題數 */
  available: number;
  achievable: Set<number>;
}

export function checkAvailability(
  questions: readonly Question[],
  parts: readonly Part[],
  wholeGroups = true,
): Availability {
  const units = buildUnits(questions, parts, wholeGroups);
  return {
    available: units.reduce((s, u) => s + u.questions.length, 0),
    achievable: achievableCounts(units),
  };
}

export type SelectError =
  | { error: "no_parts" }
  | { error: "invalid_count" }
  | { error: "insufficient"; available: number }
  | { error: "group_mismatch"; lower: number | null; higher: number | null };

export type SelectResult = { ok: true; items: SnapshotItem[] } | ({ ok: false } & SelectError);

export function describeSelectError(e: SelectError): string {
  switch (e.error) {
    case "no_parts":
      return "請至少選擇一個 Part";
    case "invalid_count":
      return "題數須為正整數";
    case "insufficient":
      return `題庫中符合條件的已審核題目只有 ${e.available} 題，請把題數調整為 ${e.available} 題以內`;
    case "group_mismatch": {
      const options = [e.lower, e.higher].filter((n): n is number => n !== null && n > 0);
      return `Part 6／7 同一篇文章的題目必須一起出，無法剛好組成這個題數。可改為 ${options.join(" 或 ")} 題`;
    }
  }
}

/** 0 ≤ rng() < 1。測試時傳入固定序列即可重現。 */
export type Rng = () => number;

function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 隨機抽出剛好 count 題，題組保持完整，不重複任何題目。
 * 題數不足或無法剛好組成時回傳錯誤，不會悄悄重複或少給。
 */
export function selectQuestions(
  questions: readonly Question[],
  groups: readonly ContentGroup[],
  config: SessionConfig,
  rng: Rng = Math.random,
): SelectResult {
  if (config.parts.length === 0) return { ok: false, error: "no_parts" };
  if (!Number.isInteger(config.count) || config.count <= 0) return { ok: false, error: "invalid_count" };

  const units = shuffle(buildUnits(questions, config.parts, config.source === "bank"), rng);
  const available = units.reduce((s, u) => s + u.questions.length, 0);
  if (config.count > available) return { ok: false, error: "insufficient", available };

  // 子集合和 DP：reach[s] 記錄第一次湊到 s 時使用的單位索引，用來回推組合
  const target = config.count;
  const reach: (number | undefined)[] = Array(target + 1);
  reach[0] = -1;
  units.forEach((u, i) => {
    const size = u.questions.length;
    for (let s = target; s >= size; s--) {
      if (reach[s] === undefined && reach[s - size] !== undefined && reach[s - size]! < i) reach[s] = i;
    }
  });

  if (reach[target] === undefined) {
    const sums = [...achievableCounts(units)].sort((a, b) => a - b);
    const lower = sums.filter((s) => s < target).at(-1) ?? null;
    const higher = sums.find((s) => s > target) ?? null;
    return { ok: false, error: "group_mismatch", lower, higher };
  }

  const picked: Unit[] = [];
  for (let s = target; s > 0; ) {
    const unit = units[reach[s]!];
    picked.push(unit);
    s -= unit.questions.length;
  }

  // 依 Part 排序（同 TOEIC 順序），同 Part 內維持隨機順序；錯題模式下同題組的題目排在一起
  const groupOrder = new Map<string, number>();
  picked.forEach((u, i) => {
    const g = u.questions[0].group_id;
    if (g && !groupOrder.has(g)) groupOrder.set(g, i);
  });
  const rank = (u: Unit) => groupOrder.get(u.questions[0].group_id ?? "") ?? picked.indexOf(u);
  picked.sort(
    (a, b) => a.part - b.part || rank(a) - rank(b) || a.questions[0].source_id.localeCompare(b.questions[0].source_id),
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const items: SnapshotItem[] = picked.flatMap((u) =>
    u.questions.map((question) => ({
      question,
      group: question.group_id ? (groupById.get(question.group_id) ?? null) : null,
    })),
  );
  if (items.some((it) => it.question.group_id && !it.group)) {
    throw new Error("題組資料缺漏：有題目找不到對應的文章");
  }
  return { ok: true, items };
}

// ---------- 建立與計時 ----------

export function buildSession(
  config: SessionConfig,
  items: SnapshotItem[],
  now: Date,
  newId: () => string,
): Session {
  const iso = now.toISOString();
  return {
    id: newId(),
    created_at: iso,
    updated_at: iso,
    mode: "practice",
    source: config.source,
    parts: [...config.parts].sort((a, b) => a - b),
    question_snapshot: items,
    seconds_per_question: config.secondsPerQuestion,
    started_at: iso,
    deadline_at:
      config.secondsPerQuestion === null
        ? null
        : new Date(now.getTime() + config.secondsPerQuestion * items.length * 1000).toISOString(),
    paused_at: null,
    paused_ms: 0,
    submitted_at: null,
    status: "in_progress",
    idempotency_key: newId(),
  };
}

/** 剩餘毫秒；不限時回傳 null。暫停中以暫停當下計算（時間凍結）。 */
export function remainingMs(session: Session, now: Date): number | null {
  if (session.deadline_at === null) return null;
  const ref = session.paused_at ? Date.parse(session.paused_at) : now.getTime();
  return Math.max(0, Date.parse(session.deadline_at) - ref);
}

export function isExpired(session: Session, now: Date): boolean {
  const left = remainingMs(session, now);
  return session.status === "in_progress" && left !== null && left === 0;
}

/** 實際作答時間（扣除暫停）。 */
export function activeElapsedMs(session: Session, now: Date): number {
  const end = session.submitted_at
    ? Date.parse(session.submitted_at)
    : session.paused_at
      ? Date.parse(session.paused_at)
      : now.getTime();
  return Math.max(0, end - Date.parse(session.started_at) - session.paused_ms);
}

export function pauseSession(session: Session, now: Date): Partial<Session> {
  if (session.paused_at || session.status !== "in_progress") return {};
  return { paused_at: now.toISOString(), updated_at: now.toISOString() };
}

export function resumeSession(session: Session, now: Date): Partial<Session> {
  if (!session.paused_at) return {};
  const pausedFor = Math.max(0, now.getTime() - Date.parse(session.paused_at));
  return {
    paused_at: null,
    paused_ms: session.paused_ms + pausedFor,
    deadline_at: session.deadline_at ? new Date(Date.parse(session.deadline_at) + pausedFor).toISOString() : null,
    updated_at: now.toISOString(),
  };
}

// ---------- 評分 ----------

export interface GradedItem extends SnapshotItem {
  index: number;
  selected: OptionKey | null;
  isCorrect: boolean;
}

export interface PartScore {
  part: Part;
  correct: number;
  total: number;
}

export interface GradeResult {
  items: GradedItem[];
  correct: number;
  total: number;
  /** 0–1；不是多益官方分數 */
  accuracy: number;
  byPart: PartScore[];
}

export function gradeSession(session: Session, answers: readonly Answer[]): GradeResult {
  const selectedById = new Map(answers.map((a) => [a.question_id, a.selected_key]));
  const items = session.question_snapshot.map((it, index) => {
    const selected = selectedById.get(it.question.id) ?? null;
    return { ...it, index, selected, isCorrect: selected === it.question.correct_key };
  });
  const byPartMap = new Map<Part, PartScore>();
  for (const it of items) {
    const p = byPartMap.get(it.question.part) ?? { part: it.question.part, correct: 0, total: 0 };
    p.total += 1;
    if (it.isCorrect) p.correct += 1;
    byPartMap.set(it.question.part, p);
  }
  const correct = items.filter((i) => i.isCorrect).length;
  return {
    items,
    correct,
    total: items.length,
    accuracy: items.length === 0 ? 0 : correct / items.length,
    byPart: [...byPartMap.values()].sort((a, b) => a.part - b.part),
  };
}

/** 98.5% 格式（保留一位小數）。 */
/**
 * 找出「上一次同類練習」：同來源（一般題庫或錯題本）、在這場之前交卷的最近一場。
 * 錯題重考和一般練習分開比，避免題目難度不同造成誤判。
 */
export function previousComparable(sessions: readonly Session[], current: Session): Session | null {
  let best: Session | null = null;
  for (const s of sessions) {
    if (s.id === current.id || s.status !== "submitted" || s.source !== current.source) continue;
    if (!s.submitted_at || !current.submitted_at || s.submitted_at >= current.submitted_at) continue;
    if (!best || s.submitted_at > best.submitted_at!) best = s;
  }
  return best;
}

/** 兩次正確率的差，以百分點表示，例如 +12.5、−3.0、±0.0 */
export function formatPointDelta(current: number, previous: number): string {
  const diff = Math.round((current - previous) * 1000) / 10;
  if (diff === 0) return "±0.0";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}`;
}

export function formatPercent(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 作答頁的頁面單位：Part 5 單題一頁；同題組的題目同一頁。回傳每頁包含的題目索引。 */
export function pageUnits(session: Session): number[][] {
  const pages: number[][] = [];
  session.question_snapshot.forEach((it, i) => {
    const last = pages.at(-1);
    const prev = last ? session.question_snapshot[last[0]] : null;
    if (last && it.question.group_id && prev?.question.group_id === it.question.group_id) last.push(i);
    else pages.push([i]);
  });
  return pages;
}
