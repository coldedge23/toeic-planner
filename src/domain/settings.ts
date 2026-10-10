import { SettingsInputSchema, type SettingsInput } from "./schema";
import { todayInTaipei } from "./dates";

export type FieldErrors = Partial<Record<string, string>>;

export type SettingsValidation =
  | { ok: true; value: SettingsInput }
  | { ok: false; errors: FieldErrors };

const FIELD_MESSAGES: Record<string, string> = {
  exam_date: "請輸入有效的考試日期",
  target_score: "目標分數須為 10–990 的整數",
  current_score: "目前分數須為 10–990 的整數，或留白",
  daily_minutes: "每日分鐘須為正整數（最多 1440）",
  available_weekdays: "至少勾選一個可讀書的星期",
  self_ratings: "每個 Part 自評須為 1–5",
  bank_csv_url: "CSV 網址須為 https 開頭的有效網址，或留白",
};

/**
 * 驗證設定表單。除 schema 規則外，考試日期不得早於今日（Asia/Taipei）。
 * 回傳以頂層欄位為 key 的中文錯誤訊息。
 */
export function validateSettingsInput(input: unknown, now: Date = new Date()): SettingsValidation {
  const parsed = SettingsInputSchema.safeParse(input);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      errors[field] ??= FIELD_MESSAGES[field] ?? issue.message;
    }
  }
  const examDate = (input as { exam_date?: unknown } | null)?.exam_date;
  if (typeof examDate === "string" && !errors.exam_date && examDate < todayInTaipei(now)) {
    errors.exam_date = "考試日期不得早於今日";
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, value: parsed.data };
}

export function defaultSettingsInput(now: Date = new Date()): SettingsInput {
  return {
    exam_date: todayInTaipei(now),
    target_score: 800,
    current_score: null,
    daily_minutes: 60,
    available_weekdays: [1, 2, 3, 4, 5],
    self_ratings: { 5: 3, 6: 3, 7: 3 },
    bank_csv_url: null,
  };
}
