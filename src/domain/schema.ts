import { z } from "zod";

/** 備份與資料遷移使用的 schema 版本；結構有破壞性變更時遞增，並在 backup-migrations 補遷移。 */
export const SCHEMA_VERSION = 1;

export const TIMEZONE = "Asia/Taipei" as const;

export const PARTS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Part = (typeof PARTS)[number];
export const PartSchema = z.literal(PARTS);

export const LISTENING_PARTS = [1, 2, 3, 4] as const;
export const READING_PARTS = [5, 6, 7] as const;
export type ReadingPart = (typeof READING_PARTS)[number];
/** 目前開放的範圍：閱讀 Part 5–7。聽力 Part 1–4 保留在型別中，之後擴充。 */
export const ACTIVE_PARTS: readonly Part[] = READING_PARTS;

export const PART_LABELS: Record<Part, string> = {
  1: "Part 1 照片描述",
  2: "Part 2 應答問題",
  3: "Part 3 簡短對話",
  4: "Part 4 簡短獨白",
  5: "Part 5 句子填空",
  6: "Part 6 段落填空",
  7: "Part 7 閱讀理解",
};

/** Part 2 只有 A–C 三個選項，其餘 Part 皆為 A–D。 */
export function optionKeysForPart(part: Part): readonly OptionKey[] {
  return part === 2 ? ["A", "B", "C"] : ["A", "B", "C", "D"];
}

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

export const BaseRecordSchema = z.object({
  id: z.uuid(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

// ---------- settings ----------

/** 0 = 週日 … 6 = 週六（與 Date#getDay 相同）。 */
export const WeekdaySchema = z.number().int().min(0).max(6);
export const SelfRatingSchema = z.number().int().min(1).max(5);
export const ScoreSchema = z.number().int().min(10).max(990);

/** 自評只涵蓋目前開放的閱讀 Part 5–7。 */
export const SelfRatingsSchema = z.object({
  5: SelfRatingSchema,
  6: SelfRatingSchema,
  7: SelfRatingSchema,
});
export type SelfRatings = z.infer<typeof SelfRatingsSchema>;

/** 表單送出的欄位（不含 id / 時間戳），由 validateSettingsInput 再加上「考試日期不得早於今日」檢查。 */
export const SettingsInputSchema = z.object({
  exam_date: isoDate,
  target_score: ScoreSchema,
  current_score: ScoreSchema.nullable(),
  daily_minutes: z.number().int().positive().max(1440),
  available_weekdays: z.array(WeekdaySchema).min(1).refine((d) => new Set(d).size === d.length, "星期不可重複"),
  self_ratings: SelfRatingsSchema,
  /** 題庫 Sheet「發佈到網路」的 CSV 網址；未設定時只用內建 demo 題庫。 */
  bank_csv_url: z.url({ protocol: /^https$/ }).nullable(),
});
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

export const SettingsSchema = BaseRecordSchema.extend(SettingsInputSchema.shape).extend({
  timezone: z.literal(TIMEZONE),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ---------- 計畫 ----------

export const PhaseSchema = z.enum(["foundation", "intensive", "review"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const StudyPlanSchema = BaseRecordSchema.extend({
  version: z.number().int().positive(),
  start_date: isoDate,
  exam_date: isoDate,
  settings_snapshot: SettingsInputSchema,
  status: z.enum(["active", "superseded"]),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

export const StudyTaskSchema = BaseRecordSchema.extend({
  plan_id: z.uuid(),
  date: isoDate,
  part: PartSchema.nullable(),
  title: z.string().min(1),
  minutes: z.number().int().positive(),
  phase: PhaseSchema,
  completed_at: isoDateTime.nullable(),
});
export type StudyTask = z.infer<typeof StudyTaskSchema>;

// ---------- 題庫 ----------

export const OptionKeySchema = z.enum(["A", "B", "C", "D"]);
export type OptionKey = z.infer<typeof OptionKeySchema>;

export const OptionSchema = z.object({ key: OptionKeySchema, text: z.string() });

export const PassageSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1),
});

export const ContentGroupSchema = BaseRecordSchema.extend({
  part: PartSchema,
  passages: z.array(PassageSchema),
  image_asset_id: z.uuid().nullable(),
  audio_asset_id: z.uuid().nullable(),
  transcript: z.string().nullable(),
  speaker_labels: z.array(z.string()),
});
export type ContentGroup = z.infer<typeof ContentGroupSchema>;

/** 對應題庫 Sheet 的 status 欄：草稿／已審核／退回。只有 approved 會被抽題。 */
export const QuestionStatusSchema = z.enum(["draft", "approved", "rejected"]);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;
export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: "草稿",
  approved: "已審核",
  rejected: "退回",
};
export const DifficultySchema = z.enum(["basic", "intermediate", "advanced"]);
export type Difficulty = z.infer<typeof DifficultySchema>;
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  basic: "基礎",
  intermediate: "中階",
  advanced: "進階",
};

export const QuestionSchema = BaseRecordSchema.extend({
  group_id: z.uuid().nullable(),
  part: PartSchema,
  stem: z.string(),
  options: z.array(OptionSchema),
  correct_key: OptionKeySchema,
  explanation_zh: z.string().min(1),
  tags: z.array(z.string()),
  difficulty: DifficultySchema,
  /** 外部編號，例如題庫 Sheet 的 P5-0001，或 demo 題庫的 demo-P5-001。 */
  source_id: z.string().min(1),
  version: z.number().int().positive(),
  status: QuestionStatusSchema,
}).superRefine((q, ctx) => {
  const expected = optionKeysForPart(q.part);
  const keys = q.options.map((o) => o.key);
  if (keys.length !== expected.length || expected.some((k, i) => keys[i] !== k)) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: `Part ${q.part} 選項必須依序為 ${expected.join("、")}`,
    });
  }
  if (!keys.includes(q.correct_key)) {
    ctx.addIssue({ code: "custom", path: ["correct_key"], message: "正解不在選項中" });
  }
  if (q.options.some((o) => o.text.trim() === "") && q.part >= 3) {
    // Part 1／2 選項只在音訊中播出，可為空字串；其餘 Part 必須有文字。
    ctx.addIssue({ code: "custom", path: ["options"], message: "選項文字不可空白" });
  }
  if (q.stem.trim() === "" && (q.part === 5 || q.part === 7)) {
    // Part 6 的空格標在文章內（[1]、[2]），題幹可留白。
    ctx.addIssue({ code: "custom", path: ["stem"], message: "題幹不可空白" });
  }
  if ((q.part === 6 || q.part === 7) && q.group_id === null) {
    ctx.addIssue({ code: "custom", path: ["group_id"], message: "Part 6／7 必須屬於一個文章題組" });
  }
});
export type Question = z.infer<typeof QuestionSchema>;

export const MediaAssetSchema = BaseRecordSchema.extend({
  kind: z.enum(["audio", "image"]),
  storage_path: z.string().min(1),
  mime_type: z.string().min(1),
  duration: z.number().nonnegative().nullable(),
  source: z.string().min(1),
  license_status: z.enum(["owned", "licensed", "unknown"]),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// ---------- 測驗 ----------

export const SessionModeSchema = z.enum(["practice", "full"]);
export const SessionSourceSchema = z.enum(["bank", "mistakes"]);

export const SessionSchema = BaseRecordSchema.extend({
  mode: SessionModeSchema,
  source: SessionSourceSchema,
  parts: z.array(PartSchema).min(1),
  question_snapshot: z.array(z.object({ question: QuestionSchema, group: ContentGroupSchema.nullable() })),
  seconds_per_question: z.number().int().positive().nullable(),
  started_at: isoDateTime,
  /** 暫停時會往後延；null = 不限時 */
  deadline_at: isoDateTime.nullable(),
  /** 目前暫停的開始時間；null = 進行中 */
  paused_at: isoDateTime.nullable(),
  /** 已結束的暫停累計毫秒，用來計算實際作答時間 */
  paused_ms: z.number().int().nonnegative(),
  submitted_at: isoDateTime.nullable(),
  status: z.enum(["in_progress", "submitted"]),
  idempotency_key: z.string().min(1),
});
export type Session = z.infer<typeof SessionSchema>;

export const AnswerSchema = BaseRecordSchema.extend({
  session_id: z.uuid(),
  question_id: z.uuid(),
  selected_key: OptionKeySchema.nullable(),
  answered_at: isoDateTime.nullable(),
  elapsed_ms: z.number().int().nonnegative(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const AttemptSchema = BaseRecordSchema.extend({
  session_id: z.uuid(),
  question_id: z.uuid(),
  question_version: z.number().int().positive(),
  selected_key: OptionKeySchema.nullable(),
  is_correct: z.boolean(),
  submitted_at: isoDateTime,
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const MistakeItemSchema = BaseRecordSchema.extend({
  question_id: z.uuid(),
  wrong_count: z.number().int().nonnegative(),
  correct_streak: z.number().int().nonnegative(),
  last_attempt_id: z.uuid().nullable(),
  state: z.enum(["active", "archived"]),
  archived_at: isoDateTime.nullable(),
  archive_reason: z.enum(["mastered", "cleared"]).nullable(),
});
export type MistakeItem = z.infer<typeof MistakeItemSchema>;

// ---------- 匯入／生成 ----------

export const ImportBatchSchema = BaseRecordSchema.extend({
  source: z.string().min(1),
  checksum: z.string().min(1),
  status: z.enum(["previewed", "committed", "failed"]),
  valid_count: z.number().int().nonnegative(),
  errors: z.array(z.object({ row: z.number().int(), field: z.string().optional(), message: z.string() })),
  committed_at: isoDateTime.nullable(),
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const GenerationJobSchema = BaseRecordSchema.extend({
  part: PartSchema,
  difficulty: DifficultySchema,
  requested_count: z.number().int().positive(),
  provider: z.string().min(1),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  job_key: z.string().min(1),
  error: z.string().nullable(),
  generated_ids: z.array(z.uuid()),
  review_status: z.enum(["pending", "approved", "rejected"]),
  cost_metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

// ---------- 備份 ----------

export const BackupSchema = z.object({
  schema_version: z.number().int().positive(),
  exported_at: isoDateTime,
  /** 二進位音訊／圖片不在 JSON 內；只保留 media_assets 的中繼資料。 */
  media_binaries_included: z.literal(false),
  settings: z.array(SettingsSchema),
  study_plans: z.array(StudyPlanSchema),
  study_tasks: z.array(StudyTaskSchema),
  content_groups: z.array(ContentGroupSchema),
  questions: z.array(QuestionSchema),
  media_assets: z.array(MediaAssetSchema),
  sessions: z.array(SessionSchema),
  answers: z.array(AnswerSchema),
  attempts: z.array(AttemptSchema),
  mistake_items: z.array(MistakeItemSchema),
  import_batches: z.array(ImportBatchSchema),
  generation_jobs: z.array(GenerationJobSchema),
});
export type Backup = z.infer<typeof BackupSchema>;
