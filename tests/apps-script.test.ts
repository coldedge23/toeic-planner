import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { toCsv } from "@/domain/csv";
import { validateCsv } from "@/domain/import-validator";

/** 在 Node 的隔離環境載入 Code.gs，只測不呼叫 Google 服務的純函式 */
const ctx = vm.createContext({});
vm.runInContext(readFileSync(path.resolve(import.meta.dirname, "../apps-script/Code.gs"), "utf8"), ctx);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gs = ctx as any;

const q = (over: Record<string, unknown> = {}) => ({
  question: "The manager asked us to ------- the report by Friday.",
  a: "submit",
  b: "submits",
  c: "submitting",
  d: "submitted",
  answer: "A",
  explanation: "ask 某人 to 後接原形動詞。",
  tags: ["動詞", "不定詞"],
  ...over,
});

const p6Group = (passage = "Dear team, the office [1] next week. Please [2] early. [3]. Thank you for your [4].") => ({
  passage,
  questions: [1, 2, 3, 4].map((n) => q({ question: `[${n}]`, a: `opt${n}a`, b: `opt${n}b`, c: `opt${n}c`, d: `opt${n}d` })),
});

const existingRow = (over: Record<string, string>) => ({
  id: "",
  part: "5",
  difficulty: "中階",
  group_id: "",
  passage: "",
  question: "",
  ...over,
});

describe("Code.gs 純函式", () => {
  it("planGroups：Part 6 每篇 4 題、Part 7 每篇 3 題，題數向上湊整", () => {
    expect(gs.planGroups(5, 10)).toEqual({ groups: 10, perGroup: 1, total: 10 });
    expect(gs.planGroups(6, 10)).toEqual({ groups: 3, perGroup: 4, total: 12 });
    expect(gs.planGroups(7, 10)).toEqual({ groups: 4, perGroup: 3, total: 12 });
    expect(() => gs.planGroups(2, 5)).toThrow();
  });

  it("nextSerial 接續既有編號", () => {
    const next = gs.nextSerial(["P5-0007", "P5-0012", "P7-0099", "x"], "P5-", 4);
    expect([next(), next()]).toEqual(["P5-0013", "P5-0014"]);
  });

  it("parseModelJson 容許 ``` 圍欄；缺 groups 時報錯", () => {
    expect(gs.parseModelJson('```json\n{"groups":[]}\n```').groups).toEqual([]);
    expect(() => gs.parseModelJson("沒有 JSON")).toThrow();
    expect(() => gs.parseModelJson('{"items":[]}')).toThrow();
  });

  it("rotationPart 依台北日期輪替", () => {
    const rot = gs.parseRotation("5,5,6,7");
    const parts = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((d) => gs.rotationPart(rot, d));
    expect(new Set(parts)).toEqual(new Set([5, 6, 7]));
    expect(gs.parseRotation("abc")).toEqual([5, 6, 7]);
  });

  it("buildRows：寫成草稿、編號接續、略過不合格與重複的題目", () => {
    const existing = [existingRow({ id: "P5-0003", question: "Existing question ------- here." })];
    const data = {
      groups: [
        { passage: "", questions: [q()] },
        { passage: "", questions: [q({ question: "Existing question ------- here!" })] }, // 與既有重複
        { passage: "", questions: [q({ question: "Another ------- sentence.", answer: "E" })] }, // 正解錯誤
        { passage: "", questions: [q({ question: "No blank in this sentence." })] }, // 沒有空格
        { passage: "", questions: [q({ question: "Dup ------- options.", b: "submit" })] }, // 選項重複
        { passage: "", questions: [q({ question: "English ------- only.", explanation: "Because." })] }, // 解析非中文
        { passage: "", questions: [q()] }, // 與同批第一題重複
      ],
    };
    const r = gs.buildRows(5, "中階", data, existing, "2026-10-10", 30);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].slice(0, 4)).toEqual(["P5-0004", 5, "中階", ""]);
    expect(r.rows[0].slice(13)).toEqual(["草稿", 1, "2026-10-10"]);
    expect(r.skipped).toHaveLength(6);
  });

  it("buildRows：Part 6 文章缺空格整組略過；超過上限的組不寫入", () => {
    const data = { groups: [p6Group(), p6Group("No markers here at all, just text."), p6Group("Other [1] [2] [3] [4].")] };
    const r = gs.buildRows(6, "基礎", data, [], "2026-10-10", 4);
    expect(r.rows).toHaveLength(4);
    expect(r.rows.map((x: unknown[]) => x[3])).toEqual(["P6-G001", "P6-G001", "P6-G001", "P6-G001"]);
    expect(r.rows.map((x: unknown[]) => x[5])).toEqual(["[1]", "[2]", "[3]", "[4]"]);
    expect(r.rows[0][4]).toContain("[1]");
    expect(r.rows[1][4]).toBe("");
    expect(r.skipped.join("|")).toMatch(/缺少空格.*上限/);
  });

  it("產生的列（審核後）可以通過 App 的 CSV 匯入驗證", () => {
    const p7 = {
      passage: "Notice\nThe library will extend its hours.\n---\nReply\nGreat news.",
      questions: [
        q({ question: "What is announced?", a: "Longer hours", b: "A closure", c: "A sale", d: "A move" }),
        q({ question: "What is the reply?", a: "Thanks", b: "Complaint", c: "Question", d: "Order" }),
        q({ question: "Where is this?", a: "Library", b: "Bank", c: "Hotel", d: "Airport" }),
      ],
    };
    const rows = [
      ...gs.buildRows(5, "進階", { groups: [{ passage: "", questions: [q()] }] }, [], "2026-10-10", 30).rows,
      ...gs.buildRows(6, "中階", { groups: [p6Group()] }, [], "2026-10-10", 30).rows,
      ...gs.buildRows(7, "中階", { groups: [p7] }, [], "2026-10-10", 30).rows,
    ].map((r: unknown[]) => r.map(String));
    const approved = rows.map((r: string[]) => r.map((v, i) => (i === 13 ? "已審核" : v)));
    const result = validateCsv(toCsv([gs.COLUMNS, ...approved]));
    expect(result.errors).toEqual([]);
    expect(result.counts.approved).toBe(1 + 4 + 3);
  });

  it("buildVerifyPrompt：附上文章、題目與選項，但不洩漏正解與解析", () => {
    const rows = gs.buildRows(6, "中階", { groups: [p6Group()] }, [], "2026-10-10", 30).rows;
    const prompt: string = gs.buildVerifyPrompt(rows);
    expect(prompt).toContain("=== Passage (P6-G001) ===");
    expect(prompt.match(/=== Passage/g)).toHaveLength(1);
    expect(prompt).toContain("[P6-0001] [1]");
    expect(prompt).toContain("(D) opt4d");
    expect(prompt).not.toContain("原形動詞");
  });

  it("parseVerifyJson 容許圍欄、答案轉大寫；格式錯誤時報錯", () => {
    expect(gs.parseVerifyJson('```json\n{"answers":[{"id":"P5-0001","answer":"b"}]}\n```')).toEqual({ "P5-0001": "B" });
    expect(() => gs.parseVerifyJson('{"groups":[]}')).toThrow();
  });

  it("applyVerification：Part 5 逐題判定；題組只要一題不一致整組維持草稿", () => {
    const p5 = gs.buildRows(
      5,
      "中階",
      { groups: [{ passage: "", questions: [q()] }, { passage: "", questions: [q({ question: "Second ------- one." })] }] },
      [],
      "2026-10-10",
      30,
    ).rows;
    const r5 = gs.applyVerification(p5, { "P5-0001": "A", "P5-0002": "C" });
    expect(p5.map((r: unknown[]) => r[13])).toEqual(["已審核", "草稿"]);
    expect(r5.approved).toBe(1);
    expect(r5.mismatched[0]).toContain("P5-0002");

    const p6 = gs.buildRows(6, "中階", { groups: [p6Group(), p6Group("Other [1] [2] [3] [4].")] }, [], "2026-10-10", 30).rows;
    const answers: Record<string, string> = {};
    p6.forEach((r: string[]) => (answers[r[0]] = "A"));
    delete answers["P6-0002"]; // 第一篇有一題沒作答
    const r6 = gs.applyVerification(p6, answers);
    expect(p6.map((r: unknown[]) => r[13])).toEqual([...Array(4).fill("草稿"), ...Array(4).fill("已審核")]);
    expect(r6.approved).toBe(4);
  });

  it("自動審核後的列可以直接通過 App 的 CSV 匯入驗證（含維持草稿的題組）", () => {
    const rows = gs.buildRows(6, "中階", { groups: [p6Group(), p6Group("Other [1] [2] [3] [4].")] }, [], "2026-10-10", 30).rows;
    const answers: Record<string, string> = {};
    rows.forEach((r: string[]) => (answers[r[0]] = "A"));
    answers["P6-0003"] = "B";
    gs.applyVerification(rows, answers);
    const result = validateCsv(toCsv([gs.COLUMNS, ...rows.map((r: unknown[]) => r.map(String))]));
    expect(result.errors).toEqual([]);
    expect(result.counts.approved).toBe(4);
    expect(result.counts.draft).toBe(4);
  });

  it("parseYesNo：留白視為否，其他值報錯", () => {
    expect(gs.parseYesNo("", "自動審核")).toBe(false);
    expect(gs.parseYesNo("否", "自動審核")).toBe(false);
    expect(gs.parseYesNo(" 是 ", "自動審核")).toBe(true);
    expect(() => gs.parseYesNo("yes", "自動審核")).toThrow(/自動審核/);
  });

  it("pickGeminiModel：挑最新穩定版 Flash，排除 lite／preview／不支援 generateContent 的模型", () => {
    const m = (name: string, methods = ["generateContent"]) => ({ name: `models/${name}`, supportedGenerationMethods: methods });
    const list = [
      m("gemini-2.5-flash"),
      m("gemini-3.8-flash"),
      m("gemini-3.8-flash-lite"),
      m("gemini-4.0-flash-preview-0901"),
      m("gemini-3.10-flash", ["embedContent"]),
      m("gemini-3.8-pro"),
      m("text-embedding-004", ["embedContent"]),
    ];
    expect(gs.pickGeminiModel(list)).toBe("gemini-3.8-flash");
    // 沒有穩定版時退而選最新預覽版
    expect(gs.pickGeminiModel([m("gemini-4.0-flash-preview-0901"), m("gemini-3.8-flash-lite")])).toBe(
      "gemini-4.0-flash-preview-0901",
    );
    expect(gs.pickGeminiModel([m("gemini-3.8-pro")])).toBe("");
    expect(gs.pickGeminiModel(undefined)).toBe("");
  });

  it("apiErrorMessage 只取出錯誤說明，不顯示整段 JSON", () => {
    expect(gs.apiErrorMessage('{"error":{"code":404,"message":"model not found"}}')).toBe("model not found");
    expect(gs.apiErrorMessage("plain text")).toBe("plain text");
  });

  it("Claude structured outputs 的 schema 每層都禁止多餘欄位", () => {
    const s = gs.responseSchema();
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.groups.items.additionalProperties).toBe(false);
    expect(s.properties.groups.items.properties.questions.items.additionalProperties).toBe(false);
  });
});
