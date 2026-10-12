import { addDays, toTaipeiDate } from "./dates";
import type { VocabularyRating, VocabularyReview, VocabularySettings, VocabularyWord } from "./schema";

export const VOCABULARY_RATINGS: Record<VocabularyRating, string> = { again: "不熟", familiar: "有印象", known: "熟悉" };
export const DEFAULT_VOCABULARY_LIMITS = { review_limit: 20, new_limit: 5 };
export function normalizeTerm(term: string): string {
  return term.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
/** App的規則式複習間隔，並非官方評量或熟練度認證。 */
export function nextVocabularyReview(word: VocabularyWord, rating: VocabularyRating, now: Date) {
  const interval = rating === "again" ? 1 : rating === "familiar"
    ? Math.min(30, Math.max(3, Math.ceil(word.interval_days * 1.5)))
    : Math.min(60, Math.max(7, word.interval_days * 2));
  return { interval_days: interval, due_date: addDays(toTaipeiDate(now), interval) };
}
export function dailyVocabulary(words: readonly VocabularyWord[], reviews: readonly VocabularyReview[],
  settings: Pick<VocabularySettings, "review_limit" | "new_limit">, today: string) {
  const todays = reviews.filter((r) => r.date === today);
  const seen = new Set(todays.map((r) => r.word_id));
  const newSeen = new Set(todays.filter((r) => r.was_new).map((r) => r.word_id));
  const oldSeen = new Set(todays.filter((r) => !r.was_new).map((r) => r.word_id));
  const sort = (a: VocabularyWord, b: VocabularyWord) => a.due_date.localeCompare(b.due_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  const due = words.filter((w) => w.state === "learning" && w.due_date <= today && !seen.has(w.id)).sort(sort);
  const fresh = words.filter((w) => w.state === "new" && !seen.has(w.id)).sort(sort);
  const queue = [...due.slice(0, Math.max(0, settings.review_limit - oldSeen.size)),
    ...fresh.slice(0, Math.max(0, settings.new_limit - newSeen.size))];
  return { queue, due: due.length, fresh: fresh.length, reviewedToday: seen.size };
}
