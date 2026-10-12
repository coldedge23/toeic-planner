import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";
import { VocabularyInputSchema, type VocabularyInput } from "@/domain/schema";
import { parseVocabularyCsv, previewVocabularyImport, vocabularyTemplateCsv } from "@/domain/vocabulary-import";
import { VOCABULARY_STARTER, VOCABULARY_STARTER_V1 } from "@/fixtures/vocabulary-starter";
import { normalizeTerm } from "@/domain/vocabulary";
import { parseBackup } from "@/domain/backup-migrations";

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;
const word = (term: string): VocabularyInput => ({ term, meaning_zh: "自訂意思", part_of_speech: "", example: "", source: null });
const header = "term,meaning_zh,part_of_speech,example\r\n";
beforeEach(() => { db = new ToeicDB(`vocab-import-${crypto.randomUUID()}`); repos = createDexieRepositories(db); });
afterEach(async () => { await db.delete(); });

describe("單字入門包與安全批次匯入", () => {
  it("入門包十個主題各50筆共500筆不重複且皆有釋義、詞性與英文例句；不自動寫入", async () => {
    const words = VOCABULARY_STARTER.topics.flatMap((topic) => topic.words);
    expect(VOCABULARY_STARTER.topics).toHaveLength(10);
    expect(VOCABULARY_STARTER.topics.map((t) => t.words.length)).toEqual(Array(10).fill(50));
    expect(words).toHaveLength(500);
    expect(new Set(words.map((w) => normalizeTerm(w.term))).size).toBe(500);
    for (const entry of words) {
      expect(VocabularyInputSchema.safeParse(entry).success).toBe(true);
      expect(entry.meaning_zh).toMatch(/[\u4e00-\u9fff]/);
      expect(entry.part_of_speech).not.toBe("");
      expect(entry.example).toMatch(/[a-z]/i);
      expect(entry.source).toBeNull();
    }
    expect(await repos.vocabulary.list()).toEqual([]);
  });

  it("原版100筆文字保留；擴充僅補400筆，保留使用者編輯、來源與複習進度", async () => {
    const oldWords = VOCABULARY_STARTER_V1.topics.flatMap((t) => t.words);
    const allWords = VOCABULARY_STARTER.topics.flatMap((t) => t.words);
    expect(oldWords).toHaveLength(100);
    for (const original of oldWords) expect(allWords.find((w) => w.term === original.term)).toEqual(original);
    await repos.vocabulary.importBatch(oldWords);
    const stored = (await repos.vocabulary.findByTerm("shipment"))!;
    await repos.vocabulary.update(stored.id, { ...stored, meaning_zh: "我的修改", example: "My shipment arrives tomorrow." }, stored.updated_at);
    const edited = (await repos.vocabulary.get(stored.id))!;
    await repos.vocabulary.review({ wordId: edited.id, rating: "known", reviewId: crypto.randomUUID(), expectedUpdatedAt: edited.updated_at, now: new Date() });
    const before = await repos.backups.exportAll();
    const preview = previewVocabularyImport(allWords.map((input, i) => ({ input, line: i + 1 })), before.vocabulary_words);
    expect(preview.filter((row) => row.status === "new")).toHaveLength(400);
    expect(await repos.vocabulary.importBatch(allWords)).toEqual({ added: 400, skipped: 100 });
    const after = await repos.backups.exportAll();
    for (const existing of before.vocabulary_words) expect(after.vocabulary_words.find((w) => w.id === existing.id)).toEqual(existing);
    expect(after.vocabulary_reviews).toEqual(before.vocabulary_reviews);
    expect(await repos.vocabulary.importBatch(allWords)).toEqual({ added: 0, skipped: 500 });
  });

  it("CSV 範本 BOM、中文欄名、選填欄位、逗號、跳脫引號與跨行例句可用，錯誤回報實體行號", () => {
    const template = vocabularyTemplateCsv();
    expect(template.charCodeAt(0)).toBe(0xfeff);
    expect(parseVocabularyCsv(template)).toMatchObject({ errors: [], rows: [{ input: { term: "appointment" } }, { input: { term: "out of stock" } }] });
    const text = '\uFEFF英文單字／片語,繁中意思,詞性,英文例句\r\n\r\nshipment,貨物,n.,"The shipment, marked ""urgent"",\r\nis ready."\r\ntruck,,n.,A truck arrived.\r\n';
    const parsed = parseVocabularyCsv(text);
    expect(parsed.rows[0]).toMatchObject({ line: 3, input: { example: 'The shipment, marked "urgent",\nis ready.' } });
    expect(parsed.errors).toEqual([{ line: 5, message: "請填寫並確認中文意思" }]);
    expect(parseVocabularyCsv("meaning_zh,term\n貨物,shipment").rows[0].input).toEqual({ ...word("shipment"), meaning_zh: "貨物" });
  });

  it("未關閉引號、引號後字元、錯欄數、重複或缺失欄名、題庫CSV、空檔及超過1000筆會阻擋", () => {
    for (const text of [header + 'truck,貨物,n.,"open', header + 'truck,貨物,n.,"closed"x', header + "truck,貨物,n.,a,b",
      "term,term,meaning_zh\na,a,甲", "term,example\na,A", "id,part,question\nq1,5,A", "", header,
      header + Array.from({ length: 1001 }, (_, i) => `word${i},意思,,`).join("\n")]) {
      expect(parseVocabularyCsv(text).errors.length, text.slice(0, 60)).toBeGreaterThan(0);
    }
    expect(parseVocabularyCsv(header + 'ab"cd,意思,,').errors[0].line).toBe(2);
  });

  it("預覽不寫入，既有與批內重複區分；略過保留釋義、識別碼、排程與複習紀錄", async () => {
    const existing = await repos.vocabulary.add(word("Shipment"));
    await repos.vocabulary.review({ wordId: existing.id, rating: "known", reviewId: crypto.randomUUID(), expectedUpdatedAt: existing.updated_at, now: new Date() });
    const before = await repos.backups.exportAll();
    const parsed = parseVocabularyCsv(header + " shipment ,新意思,n.,Other example\nwarehouse,倉庫,n.,A warehouse.\nWAREHOUSE,重複,n.,Duplicate.");
    const preview = previewVocabularyImport(parsed.rows, await repos.vocabulary.list());
    expect(preview.map((p) => p.status)).toEqual(["existing", "new", "repeated"]);
    expect(await repos.vocabulary.list()).toHaveLength(1);
    expect(await repos.vocabulary.importBatch(parsed.rows.map((p) => p.input))).toEqual({ added: 1, skipped: 2 });
    const after = await repos.backups.exportAll();
    expect(after.vocabulary_words.find((w) => w.id === existing.id)).toEqual(before.vocabulary_words[0]);
    expect(after.vocabulary_reviews).toEqual(before.vocabulary_reviews);
    expect(await repos.vocabulary.importBatch(parsed.rows.map((p) => p.input))).toEqual({ added: 0, skipped: 3 });
  });

  it("確認時重查其他分頁資料；兩批同時加入只保留一份", async () => {
    const rows = [word("warehouse"), word("truck")];
    const results = await Promise.all([repos.vocabulary.importBatch(rows), repos.vocabulary.importBatch(rows)]);
    expect(results.map((r) => r.added).sort()).toEqual([0, 2]);
    expect(await repos.vocabulary.list()).toHaveLength(2);
  });

  it("任一輸入無效或寫入中斷，全批不寫入且舊資料保留", async () => {
    const existing = await repos.vocabulary.add(word("existing"));
    await expect(repos.vocabulary.importBatch([word("truck"), { ...word("warehouse"), meaning_zh: "" }])).rejects.toThrow();
    expect(await repos.vocabulary.list()).toEqual([existing]);
    const rejectWrite = (_key: unknown, obj: { term?: string }) => { if (obj.term === "warehouse") throw new Error("simulated write failure"); };
    db.vocabulary_words.hook("creating", rejectWrite);
    try { await expect(repos.vocabulary.importBatch([word("truck"), word("warehouse")])).rejects.toThrow("simulated"); }
    finally { db.vocabulary_words.hook("creating").unsubscribe(rejectWrite); }
    expect(await repos.vocabulary.list()).toEqual([existing]);
    await expect(repos.vocabulary.importBatch([])).rejects.toThrow();
    await expect(repos.vocabulary.importBatch(Array.from({ length: 1001 }, () => word("a")))).rejects.toThrow();
  });

  it("加入整包與CSV後，每日量不變且完整v4備份可還原", async () => {
    await repos.vocabulary.saveSettings({ review_limit: 12, new_limit: 3 });
    expect(await repos.vocabulary.importBatch(VOCABULARY_STARTER.topics.flatMap((t) => t.words))).toEqual({ added: 500, skipped: 0 });
    await repos.vocabulary.importBatch(parseVocabularyCsv(vocabularyTemplateCsv()).rows.map((r) => r.input));
    const backup = await repos.backups.exportAll();
    expect(backup.schema_version).toBe(4);
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
    expect((await repos.vocabulary.daily(backup.vocabulary_words[0].due_date)).queue).toHaveLength(3);
    await repos.backups.importAll(backup);
    // 範本 appointment 已包含在新版入門包，僅補 out of stock。
    expect(await repos.vocabulary.list()).toHaveLength(501);
    expect(await repos.vocabulary.settings()).toMatchObject({ new_limit: 3, review_limit: 12 });
    expect((await repos.backups.exportAll()).vocabulary_words).toEqual(backup.vocabulary_words);
  });
});
