import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";
import { normalizeTerm, nextVocabularyReview } from "@/domain/vocabulary";
import { parseBackup } from "@/domain/backup-migrations";
import { buildSession } from "@/domain/exam-engine";
import { demoQuestions, demoGroups } from "@/fixtures/demo-bank";
import type { VocabularyInput } from "@/domain/schema";

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;
const input = (term: string): VocabularyInput => ({ term, meaning_zh: "貨物", example: "The shipment is ready.", part_of_speech: "n.", source: null });
beforeEach(async () => { db = new ToeicDB(`vocab-${crypto.randomUUID()}`); repos = createDexieRepositories(db); await repos.bank.seedDemo(); });
afterEach(async () => { await db.delete(); });

describe("單字本與每日複習", () => {
  it("大小寫、空白與全形視為同字，重複收錄不覆蓋；同時新增也僅一筆", async () => {
    expect(normalizeTerm(" Ａ  Shipment ")).toBe("a shipment");
    const word = await repos.vocabulary.add(input("Shipment"));
    await expect(repos.vocabulary.add({ ...input(" shipment "), meaning_zh: "另一個意思" })).rejects.toThrow("已在");
    expect((await repos.vocabulary.get(word.id))?.meaning_zh).toBe("貨物");
    const added = await Promise.allSettled([repos.vocabulary.add(input("warehouse")), repos.vocabulary.add(input("WAREHOUSE"))]);
    expect(added.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await repos.vocabulary.list()).toHaveLength(2);
    await expect(repos.vocabulary.add({ ...input("truck"), meaning_zh: "" })).rejects.toThrow();
  });

  it("不熟、熟悉的間隔遵守台北日界線並有上限", async () => {
    const word = await repos.vocabulary.add(input("shipment"));
    expect(nextVocabularyReview(word, "again", new Date("2026-10-12T15:59:59Z"))).toEqual({ interval_days: 1, due_date: "2026-10-13" });
    expect(nextVocabularyReview(word, "known", new Date("2026-10-12T16:00:00Z"))).toEqual({ interval_days: 7, due_date: "2026-10-20" });
    expect(nextVocabularyReview({ ...word, interval_days: 60 }, "known", new Date("2026-10-12T16:00:00Z")).interval_days).toBe(60);
  });

  it("先到期字再新字，每日量扣除已練習字；降低上限與重開不刪紀錄", async () => {
    await repos.vocabulary.saveSettings({ review_limit: 1, new_limit: 1 });
    const old = await repos.vocabulary.add(input("shipment"));
    await repos.vocabulary.review({ wordId: old.id, rating: "again", reviewId: crypto.randomUUID(), expectedUpdatedAt: old.updated_at, now: new Date("2026-10-12T10:00:00Z") });
    const fresh = await repos.vocabulary.add(input("warehouse"));
    await repos.vocabulary.add(input("delivery"));
    const daily = await repos.vocabulary.daily("2026-10-13");
    expect(daily.queue[0].id).toBe(old.id);
    expect(daily.queue).toHaveLength(2);
    for (const word of daily.queue) await repos.vocabulary.review({ wordId: word.id, rating: "known", reviewId: crypto.randomUUID(), expectedUpdatedAt: word.updated_at, now: new Date("2026-10-13T10:00:00Z") });
    expect((await repos.vocabulary.daily("2026-10-13")).queue).toEqual([]);
    expect((await repos.vocabulary.daily("2026-10-13")).reviewedToday).toBe(2);
    const remaining = (await repos.vocabulary.list()).find((w) => w.state === "new")!;
    await expect(repos.vocabulary.review({ wordId: remaining.id, rating: "again", reviewId: crypto.randomUUID(), expectedUpdatedAt: remaining.updated_at, now: new Date("2026-10-13T10:00:00Z") })).rejects.toThrow("練習量已完成");
    await repos.vocabulary.saveSettings({ review_limit: 1, new_limit: 0 });
    db.close(); await db.open();
    expect((await repos.vocabulary.settings()).new_limit).toBe(0);
    expect(await repos.vocabulary.get(fresh.id)).not.toBeNull();
    expect(await db.vocabulary_reviews.count()).toBe(3);
  });

  it("評定重送冪等，不同重送識別碼與舊畫面不能重複排程", async () => {
    const word = await repos.vocabulary.add(input("shipment"));
    const args = { wordId: word.id, rating: "again" as const, reviewId: crypto.randomUUID(), expectedUpdatedAt: word.updated_at, now: new Date("2026-10-13T00:00:00Z") };
    const [a, b] = await Promise.all([repos.vocabulary.review(args), repos.vocabulary.review(args)]);
    expect(a.id).toBe(b.id);
    expect((await repos.vocabulary.get(word.id))?.review_count).toBe(1);
    await expect(repos.vocabulary.review({ ...args, reviewId: crypto.randomUUID() })).rejects.toThrow("已更新");
    await expect(repos.vocabulary.update(word.id, input("shipment"), word.updated_at)).rejects.toThrow("其他頁面");
    const current = (await repos.vocabulary.get(word.id))!;
    await repos.vocabulary.update(word.id, { ...input("shipment"), meaning_zh: "出貨／貨物" }, current.updated_at);
    expect(await repos.vocabulary.get(word.id)).toMatchObject({ review_count: 1, due_date: "2026-10-14", meaning_zh: "出貨／貨物" });
  });

  it("來源快照不受題庫改版影響；單字與複習備份往返，關聯損壞拒絕且保留原資料", async () => {
    const question = demoQuestions.find((q) => q.part === 7)!;
    const group = demoGroups.find((g) => g.id === question.group_id)!;
    const word = await repos.vocabulary.add({ ...input("shipment"), source: { question, group } });
    await db.content_groups.update(group.id, { passages: [{ body: "Changed" }] });
    expect((await repos.vocabulary.get(word.id))?.source?.group?.passages).toEqual(group.passages);
    await repos.vocabulary.review({ wordId: word.id, rating: "familiar", reviewId: crypto.randomUUID(), expectedUpdatedAt: word.updated_at, now: new Date("2026-10-13T00:00:00Z") });
    const backup = await repos.backups.exportAll();
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
    await repos.backups.importAll(backup);
    expect((await repos.vocabulary.get(word.id))?.review_count).toBe(1);
    const broken = { ...backup, vocabulary_reviews: backup.vocabulary_reviews.map((r) => ({ ...r, word_id: crypto.randomUUID() })) };
    await expect(repos.backups.importAll(broken)).rejects.toThrow();
    expect(await repos.vocabulary.list()).toHaveLength(1);
    expect(await db.vocabulary_reviews.count()).toBe(1);
    const wrongSchedule = { ...backup, vocabulary_words: backup.vocabulary_words.map((w) => ({ ...w, due_date: "2026-12-31" })) };
    expect(parseBackup(JSON.stringify(wrongSchedule)).ok).toBe(false);
    const old = { ...backup, schema_version: 3 } as Record<string, unknown>;
    delete old.vocabulary_words; delete old.vocabulary_reviews; delete old.vocabulary_settings;
    const parsed = parseBackup(JSON.stringify(old));
    expect(parsed.ok && parsed.backup.vocabulary_words).toEqual([]);
    expect(parsed.ok && parsed.migratedFrom).toBe(3);
  });

  it("IndexedDB v3升級不改舊測驗與答案，新單字表為空", async () => {
    const name = `old-v3-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores(Object.fromEntries(db.tables.filter((t) => !t.name.startsWith("vocabulary_")).map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(",")])));
    const q = demoQuestions[0];
    const s = buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null }, [{ question: q, group: null }], new Date("2026-10-12T00:00:00Z"), () => crypto.randomUUID());
    await legacy.table("sessions").add(s);
    const answer = { id: crypto.randomUUID(), session_id: s.id, question_id: q.id, selected_key: q.correct_key, answered_at: s.started_at, elapsed_ms: 1000, created_at: s.started_at, updated_at: s.started_at };
    await legacy.table("answers").add(answer);
    legacy.close();
    const upgraded = new ToeicDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.sessions.get(s.id)).toEqual(s);
      expect(await upgraded.answers.get(answer.id)).toEqual(answer);
      expect(await upgraded.vocabulary_words.count()).toBe(0);
    } finally { await upgraded.delete(); }
  });
});
