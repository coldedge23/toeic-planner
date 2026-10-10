import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";
import { defaultSettingsInput } from "@/domain/settings";
import { BackupSchema } from "@/domain/schema";
import { demoQuestions } from "@/fixtures/demo-bank";

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;

beforeEach(() => {
  db = new ToeicDB(`test-${crypto.randomUUID()}`);
  repos = createDexieRepositories(db);
});
afterEach(async () => {
  await db.delete();
});

describe("SettingsRepository", () => {
  it("尚未儲存時回傳 null", async () => {
    expect(await repos.settings.get()).toBeNull();
  });

  it("儲存後重新開啟資料庫仍讀得到（模擬重新整理）", async () => {
    const saved = await repos.settings.save({ ...defaultSettingsInput(), target_score: 850 });
    db.close();
    const reopened = new ToeicDB(db.name);
    const loaded = await createDexieRepositories(reopened).settings.get();
    expect(loaded).toEqual(saved);
    expect(loaded?.timezone).toBe("Asia/Taipei");
    reopened.close();
    await db.open();
  });

  it("再次儲存更新同一筆，保留 id 與 created_at", async () => {
    const first = await repos.settings.save(defaultSettingsInput());
    const second = await repos.settings.save({ ...defaultSettingsInput(), daily_minutes: 90 });
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    expect(second.daily_minutes).toBe(90);
    expect(await db.settings.count()).toBe(1);
  });

  it("不合法的設定不會寫入", async () => {
    await expect(repos.settings.save({ ...defaultSettingsInput(), daily_minutes: 0 })).rejects.toThrow();
    expect(await db.settings.count()).toBe(0);
  });
});

describe("BankRepository", () => {
  it("seedDemo 重複呼叫不會重複新增", async () => {
    await repos.bank.seedDemo();
    await repos.bank.seedDemo();
    expect(await db.questions.count()).toBe(demoQuestions.length);
  });

  it("stats 只統計已審核題目，並依 Part 分組", async () => {
    await repos.bank.seedDemo();
    await db.questions.update(demoQuestions[0].id, { status: "draft" });
    const stats = await repos.bank.stats();
    expect(stats.total).toBe(demoQuestions.length - 1);
    expect(stats.byPart[5]).toBe(demoQuestions.filter((q) => q.part === 5).length - 1);
  });

  it("listApproved 依 Part 篩選", async () => {
    await repos.bank.seedDemo();
    const p7 = await repos.bank.listApproved([7]);
    expect(p7.length).toBe(demoQuestions.filter((q) => q.part === 7).length);
    expect(p7.every((q) => q.part === 7)).toBe(true);
  });
});

describe("BackupsRepository", () => {
  it("匯出內容通過 BackupSchema，且標示未包含媒體檔", async () => {
    await repos.bank.seedDemo();
    await repos.settings.save(defaultSettingsInput());
    const backup = await repos.backups.exportAll();
    expect(BackupSchema.safeParse(backup).success).toBe(true);
    expect(backup.media_binaries_included).toBe(false);
    expect(backup.questions.length).toBe(demoQuestions.length);
  });
});
