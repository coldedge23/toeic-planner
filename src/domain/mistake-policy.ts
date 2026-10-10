import type { Attempt, MistakeItem } from "./schema";

/** 連續答對幾次後自動封存 */
export const MASTERY_STREAK = 2;

/**
 * 依一次交卷的 attempts 更新錯題本（純函式）。呼叫端必須保證同一場交卷只處理一次。
 * - 答錯（含未作答）：沒有錯題就新增；已有則 wrong_count +1、連續答對歸零；已封存者重新啟用
 * - 答對：只影響進行中的錯題，連續答對 +1，達 MASTERY_STREAK 次即封存
 * 回傳需要寫入的錯題（新增或更新）。
 */
export function applyAttempts(
  existing: ReadonlyMap<string, MistakeItem>,
  attempts: readonly Attempt[],
  now: string,
  newId: () => string,
): MistakeItem[] {
  const changed = new Map<string, MistakeItem>();
  for (const a of attempts) {
    const current = changed.get(a.question_id) ?? existing.get(a.question_id);
    if (!a.is_correct) {
      changed.set(a.question_id, {
        id: current?.id ?? newId(),
        created_at: current?.created_at ?? now,
        updated_at: now,
        question_id: a.question_id,
        wrong_count: (current?.wrong_count ?? 0) + 1,
        correct_streak: 0,
        last_attempt_id: a.id,
        state: "active",
        archived_at: null,
        archive_reason: null,
      });
    } else if (current && current.state === "active") {
      const streak = current.correct_streak + 1;
      const mastered = streak >= MASTERY_STREAK;
      changed.set(a.question_id, {
        ...current,
        updated_at: now,
        correct_streak: streak,
        last_attempt_id: a.id,
        state: mastered ? "archived" : "active",
        archived_at: mastered ? now : null,
        archive_reason: mastered ? "mastered" : null,
      });
    }
  }
  return [...changed.values()];
}

/** 清空錯題本：全部改為封存（原因 cleared），可依 archived_at 一次復原。 */
export function clearItems(items: readonly MistakeItem[], now: string): MistakeItem[] {
  return items
    .filter((i) => i.state === "active")
    .map((i) => ({ ...i, state: "archived", archived_at: now, archive_reason: "cleared", updated_at: now }));
}

/**
 * 復原封存的錯題：保留答錯次數。清空的錯題保留連續答對進度；
 * 已熟練封存的錯題重新練習，連續答對歸零。
 */
export function restoreItem(item: MistakeItem, now: string): MistakeItem {
  return {
    ...item,
    state: "active",
    correct_streak: item.archive_reason === "mastered" ? 0 : item.correct_streak,
    archived_at: null,
    archive_reason: null,
    updated_at: now,
  };
}
