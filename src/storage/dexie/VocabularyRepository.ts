import { z } from "zod";
import { VocabularyInputSchema, VocabularyWordSchema, VocabularyReviewSchema, VocabularyRatingSchema, VocabularySettingsSchema } from "@/domain/schema";
import { nowIso, toTaipeiDate, todayInTaipei } from "@/domain/dates";
import { dailyVocabulary, DEFAULT_VOCABULARY_LIMITS, nextVocabularyReview, normalizeTerm } from "@/domain/vocabulary";
import type { VocabularyRepository } from "../Repository";
import type { ToeicDB } from "./db";
import { VOCABULARY_IMPORT_LIMIT } from "@/domain/vocabulary-import";

export function createVocabularyRepository(db: ToeicDB): VocabularyRepository {
  const settings = async () => (await db.vocabulary_settings.get("daily")) ?? {
    id: "daily" as const, updated_at: nowIso(), ...DEFAULT_VOCABULARY_LIMITS,
  };
  const parseInput = (input: unknown) => {
    const value = VocabularyInputSchema.parse(input);
    if (value.source?.question.group_id && (value.source.group?.id !== value.source.question.group_id || value.source.group.part !== value.source.question.part)) {
      throw new Error("來源文章不完整，請重新收錄");
    }
    return value;
  };
  return {
    list: () => db.vocabulary_words.toArray(),
    async get(id) { return (await db.vocabulary_words.get(id)) ?? null; },
    async findByTerm(term) { return (await db.vocabulary_words.where("normalized_term").equals(normalizeTerm(term)).first()) ?? null; },
    async add(input) {
      const value = parseInput(input);
      const key = normalizeTerm(value.term);
      return db.transaction("rw", db.vocabulary_words, async () => {
        if (await db.vocabulary_words.where("normalized_term").equals(key).count()) throw new Error("這個單字或片語已在單字本，請查看或編輯既有單字");
        const now = nowIso();
        const word = VocabularyWordSchema.parse({ ...value, id: crypto.randomUUID(), created_at: now, updated_at: now,
          normalized_term: key, state: "new", due_date: todayInTaipei(), interval_days: 0, review_count: 0, last_review_at: null });
        await db.vocabulary_words.add(word);
        return word;
      });
    },
    async importBatch(inputs) {
      if (inputs.length < 1 || inputs.length > VOCABULARY_IMPORT_LIMIT) throw new Error(`一次請匯入 1–${VOCABULARY_IMPORT_LIMIT} 筆單字`);
      // 任何一筆無效都不得寫入；確認匯入時再次驗證，不信任畫面預覽。
      const values = inputs.map(parseInput);
      return db.transaction("rw", db.vocabulary_words, async () => {
        const seen = new Set((await db.vocabulary_words.toArray()).map((word) => word.normalized_term));
        const now = nowIso(), due = todayInTaipei();
        const additions = [];
        for (const value of values) {
          const key = normalizeTerm(value.term);
          if (seen.has(key)) continue;
          seen.add(key);
          additions.push(VocabularyWordSchema.parse({ ...value, id: crypto.randomUUID(), created_at: now, updated_at: now,
            normalized_term: key, state: "new", due_date: due, interval_days: 0, review_count: 0, last_review_at: null }));
        }
        await db.vocabulary_words.bulkAdd(additions);
        return { added: additions.length, skipped: values.length - additions.length };
      });
    },
    async update(id, input, expectedUpdatedAt) {
      const value = parseInput(input);
      const key = normalizeTerm(value.term);
      await db.transaction("rw", db.vocabulary_words, async () => {
        const word = await db.vocabulary_words.get(id);
        if (!word || word.updated_at !== expectedUpdatedAt) throw new Error("單字已在其他頁面更新，請重新開啟再編輯");
        const existing = await db.vocabulary_words.where("normalized_term").equals(key).first();
        if (existing && existing.id !== id) throw new Error("這個單字或片語已在單字本");
        await db.vocabulary_words.put(VocabularyWordSchema.parse({ ...word, ...value, normalized_term: key,
          updated_at: new Date(Math.max(Date.now(), Date.parse(word.updated_at) + 1)).toISOString() }));
      });
    },
    settings,
    async saveSettings(limits) {
      await db.vocabulary_settings.put(VocabularySettingsSchema.parse({ id: "daily", updated_at: nowIso(), ...limits }));
    },
    async daily(today) {
      z.iso.date().parse(today);
      return db.transaction("r", db.vocabulary_words, db.vocabulary_reviews, db.vocabulary_settings, async () =>
        dailyVocabulary(await db.vocabulary_words.toArray(), await db.vocabulary_reviews.where("date").equals(today).toArray(), await settings(), today));
    },
    async review({ wordId, rating, reviewId, expectedUpdatedAt, now }) {
      z.uuid().parse(reviewId);
      VocabularyRatingSchema.parse(rating);
      const at = nowIso(now);
      const today = toTaipeiDate(now);
      return db.transaction("rw", db.vocabulary_words, db.vocabulary_reviews, db.vocabulary_settings, async () => {
        const previous = await db.vocabulary_reviews.get(reviewId);
        if (previous) {
          if (previous.word_id !== wordId || previous.rating !== rating) throw new Error("複習識別碼已使用，請重新開始");
          return previous;
        }
        const word = await db.vocabulary_words.get(wordId);
        if (!word || word.updated_at !== expectedUpdatedAt) throw new Error("單字已更新或複習，請重新開始今日複習");
        const reviews = await db.vocabulary_reviews.where("date").equals(today).toArray();
        if (reviews.some((r) => r.word_id === wordId)) throw new Error("這個單字今天已複習，請重新開始今日複習");
        if (word.state === "learning" && word.due_date > today) throw new Error("這個單字尚未到複習日期");
        const prefs = await settings();
        const used = new Set(reviews.filter((r) => r.was_new === (word.state === "new")).map((r) => r.word_id)).size;
        if (used >= (word.state === "new" ? prefs.new_limit : prefs.review_limit)) throw new Error("今天的單字練習量已完成，可調整每日量或明天繼續");
        const next = nextVocabularyReview(word, rating, now);
        const review = VocabularyReviewSchema.parse({ id: reviewId, created_at: at, updated_at: at, word_id: word.id,
          rating, reviewed_at: at, date: today, was_new: word.state === "new", next_due_date: next.due_date, interval_days: next.interval_days });
        await db.vocabulary_reviews.add(review);
        await db.vocabulary_words.put(VocabularyWordSchema.parse({ ...word, ...next, state: "learning", review_count: word.review_count + 1,
          last_review_at: at, updated_at: new Date(Math.max(now.getTime(), Date.parse(word.updated_at) + 1)).toISOString() }));
        return review;
      });
    },
  };
}
