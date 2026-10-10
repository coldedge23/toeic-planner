import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/domain/csv";
import { bankToCsv, planImport, splitPassages, validateCsv } from "@/domain/import-validator";
import { buildSession, gradeSession } from "@/domain/exam-engine";
import { QuestionSchema } from "@/domain/schema";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";

const HEADER = "id,part,difficulty,group_id,passage,question,a,b,c,d,answer,explanation,tags,status,version,created_at";
const P5 = (id: string, extra: Partial<Record<string, string>> = {}) => {
  const v = {
    id,
    part: "5",
    difficulty: "基礎",
    group_id: "",
    passage: "",
    question: `Question ${id} ------- here.`,
    a: "one",
    b: "two",
    c: "three",
    d: "four",
    answer: "B",
    explanation: "解析內容",
    tags: "詞性;時態",
    status: "已審核",
    version: "1",
    created_at: "2026-10-10",
    ...extra,
  };
  return toCsv([[...Object.values(v)]]).replace("﻿", "").trim();
};
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

const P7_PASSAGE = '"Notice\nThe office will close early on Friday.\n---\nReply\nThanks, noted."';
const P7 = [
  `P7-0001,7,中階,G1,${P7_PASSAGE},What is the notice about?,A closure,A sale,A hire,A move,A,第一篇說明提早關門。,,已審核,1,2026-10-10`,
  `P7-0002,7,中階,G1,,Who replied?,The manager,A customer,Nobody,The writer of the reply,D,第二篇是回覆。,,已審核,1,2026-10-10`,
];

describe("parseCsv", () => {
  it("處理引號、欄位內逗號與換行、跳脫雙引號、CRLF 與 BOM", () => {
    const text = '﻿a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""",\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x, y", "line1\nline2"],
      ['say "hi"', ""],
    ]);
  });
  it("toCsv → parseCsv 往返一致", () => {
    const rows = [["a", 'q"uote'], ["多行\n文字", "逗,號"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("validateCsv", () => {
  it("合法資料：Part 5、Part 7 多篇文章題組", () => {
    const r = validateCsv(csv(P5("P5-0001"), ...P7));
    expect(r.errors).toEqual([]);
    expect(r.counts).toEqual({ total: 3, approved: 3, draft: 0, rejected: 0 });
    expect(splitPassages(r.rows[1].passage)).toHaveLength(2);
  });

  it("缺少必要欄位", () => {
    const r = validateCsv("id,part,question\nP5-1,5,x");
    expect(r.errors[0].message).toContain("缺少必要欄位");
  });

  it("接受提示詞包的中文欄名", () => {
    const zh = "ID,單元,難度,題目,選項A,選項B,選項C,選項D,正確答案,解析,狀態,建立日期\nP5-0001,Part 5,進階,Q ------- x,a,b,c,d,C,解析,已審核,2026-10-10";
    const r = validateCsv(zh);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ part: 5, difficulty: "advanced", answer: "C", version: 1 });
  });

  it("錯誤定位到列號與欄位；重複 id", () => {
    const r = validateCsv(
      csv(
        P5("P5-0001"),
        P5("P5-0002", { answer: "E" }),
        P5("P5-0003", { c: "" }),
        P5("P5-0001"),
        P5("P5-0004", { part: "2" }),
        P5("P5-0005", { status: "待審" }),
      ),
    );
    expect(r.errors).toEqual([
      { row: 3, field: "answer", message: "正確答案須為 A、B、C 或 D" },
      { row: 4, field: "c", message: "選項 C 不可空白" },
      { row: 5, field: "id", message: "id 重複（與第 2 列相同）" },
      { row: 6, field: "part", message: "目前只支援閱讀 Part 5–7" },
      { row: 7, field: "status", message: "狀態須為 草稿／已審核／退回" },
    ]);
  });

  it("草稿與退回不檢查內容；題組沒有文章或文章不一致時報錯", () => {
    const r = validateCsv(
      csv(
        "P5-0009,5,,,,,,,,,,,,草稿,,",
        "P7-0101,7,基礎,G9,,Q1?,a,b,c,d,A,解析,,已審核,1,",
        "P7-0201,7,基礎,G8,Passage one,Q1?,a,b,c,d,A,解析,,已審核,1,",
        "P7-0202,7,基礎,G8,Passage two,Q2?,a,b,c,d,A,解析,,已審核,1,",
      ),
    );
    expect(r.counts.draft).toBe(1);
    expect(r.errors.map((e) => e.message)).toEqual([
      "題組 G9 沒有文章（請在其中一列填 passage）",
      "題組 G8 有多段不同的文章，請只在一列填寫",
    ]);
  });
});

describe("planImport", () => {
  const NOW = "2026-10-12T00:00:00.000Z";
  let n = 0;
  const newId = () => `00000000-0000-4000-9000-${(++n).toString().padStart(12, "0")}`;

  it("新增的題目通過 QuestionSchema，題組附上 source_id", () => {
    const r = validateCsv(csv(P5("P5-0001"), ...P7));
    const plan = planImport(r.rows, [], [], NOW, newId);
    expect(plan.summary.added).toBe(3);
    for (const q of plan.questions) expect(QuestionSchema.safeParse(q).success).toBe(true);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ source_id: "G1", part: 7 });
    expect(plan.groups[0].passages).toHaveLength(2);
  });

  it("相同版本不變；版本加 1 才更新並沿用原 UUID；內容改了但版本沒加會提醒並略過", () => {
    const first = planImport(validateCsv(csv(P5("P5-0001"))).rows, [], [], NOW, newId);
    const existing = first.questions;

    expect(planImport(validateCsv(csv(P5("P5-0001"))).rows, existing, [], NOW, newId).summary.unchanged).toBe(1);

    const sameVersion = planImport(validateCsv(csv(P5("P5-0001", { answer: "C" }))).rows, existing, [], NOW, newId);
    expect(sameVersion.questions).toEqual([]);
    expect(sameVersion.notices[0].message).toContain("版本沒有加 1");

    const bumped = planImport(validateCsv(csv(P5("P5-0001", { answer: "C", version: "2" }))).rows, existing, [], NOW, newId);
    expect(bumped.summary.updated).toBe(1);
    expect(bumped.questions[0]).toMatchObject({ id: existing[0].id, correct_key: "C", version: 2 });
  });

  it("Sheet 上改成退回或草稿：App 內下架", () => {
    const existing = planImport(validateCsv(csv(P5("P5-0001"), P5("P5-0002"))).rows, [], [], NOW, newId).questions;
    const plan = planImport(
      validateCsv(csv(P5("P5-0001", { status: "退回" }), P5("P5-0002", { status: "草稿" }), P5("P5-0003", { status: "草稿" }))).rows,
      existing,
      [],
      NOW,
      newId,
    );
    expect(plan.summary).toMatchObject({ unpublished: 2, skippedDraft: 1, added: 0 });
    expect(plan.questions.map((q) => q.status).sort()).toEqual(["draft", "rejected"]);
  });

  it("demo 題庫匯出成 CSV 後可以通過驗證（範本可用）", () => {
    const r = validateCsv(bankToCsv(demoQuestions, demoGroups));
    expect(r.errors).toEqual([]);
    expect(r.counts.approved).toBe(demoQuestions.length);
  });
});

describe("Dexie：commitImport", () => {
  let db: ToeicDB;
  let repos: ReturnType<typeof createDexieRepositories>;
  beforeEach(async () => {
    db = new ToeicDB(`test-${crypto.randomUUID()}`);
    repos = createDexieRepositories(db);
    await repos.bank.seedDemo();
  });
  afterEach(async () => {
    await db.delete();
  });

  it("寫入新題目並記錄批次；demo 題庫不受影響", async () => {
    const r = validateCsv(csv(P5("P5-0001"), ...P7));
    const result = await repos.bank.commitImport({ rows: r.rows, source: "test.csv", checksum: "abc" });
    expect(result.summary.added).toBe(3);
    expect((await repos.bank.stats()).total).toBe(demoQuestions.length + 3);
    const batches = await repos.bank.listImportBatches(5);
    expect(batches[0]).toMatchObject({ source: "test.csv", status: "committed", valid_count: 3 });
  });

  it("題目改版後，過去測驗的作答結果不變（使用快照）", async () => {
    await repos.bank.commitImport({ rows: validateCsv(csv(P5("P5-0001"))).rows, source: "v1", checksum: "1" });
    const [q] = (await repos.bank.listAll()).questions.filter((x) => x.source_id === "P5-0001");
    const session = buildSession(
      { source: "bank", parts: [5], count: 1, secondsPerQuestion: null },
      [{ question: q, group: null }],
      new Date("2026-10-12T00:00:00Z"),
      () => crypto.randomUUID(),
    );
    await repos.sessions.create(session);
    await repos.sessions.saveAnswer({ sessionId: session.id, questionId: q.id, selectedKey: "B", elapsedMs: 0 });
    await repos.sessions.submit(session.id, new Date("2026-10-12T00:01:00Z"));

    await repos.bank.commitImport({
      rows: validateCsv(csv(P5("P5-0001", { answer: "D", version: "2" }))).rows,
      source: "v2",
      checksum: "2",
    });
    const updated = await db.questions.get(q.id);
    expect(updated).toMatchObject({ correct_key: "D", version: 2 });

    const stored = (await repos.sessions.get(session.id))!;
    const grade = gradeSession(stored, await repos.sessions.getAnswers(session.id));
    expect(grade.items[0].isCorrect).toBe(true);
    expect((await repos.sessions.listAttempts(session.id))[0].question_version).toBe(1);
  });
});
