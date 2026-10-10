import { describe, expect, it } from "vitest";
import { QuestionSchema, type Question } from "@/domain/schema";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";

const base = demoQuestions.find((q) => q.part === 5)!;

describe("QuestionSchema", () => {
  it("demo 題庫全部通過 schema", () => {
    for (const q of demoQuestions) expect(QuestionSchema.safeParse(q).success, q.source_id).toBe(true);
  });

  it("Part 5 四選項通過；缺 D 選項失敗", () => {
    expect(QuestionSchema.safeParse(base).success).toBe(true);
    const three: Question = { ...base, options: base.options.slice(0, 3) };
    expect(QuestionSchema.safeParse(three).success).toBe(false);
  });

  it("Part 2 只接受 A–C 三選項（保留給之後的聽力）", () => {
    const p2: Question = { ...base, part: 2, options: base.options.slice(0, 3), correct_key: "A" };
    expect(QuestionSchema.safeParse(p2).success).toBe(true);
    expect(QuestionSchema.safeParse({ ...p2, options: base.options }).success).toBe(false);
  });

  it("正解不在選項中時失敗", () => {
    const p2: Question = { ...base, part: 2, options: base.options.slice(0, 3), correct_key: "D" };
    expect(QuestionSchema.safeParse(p2).success).toBe(false);
  });

  it("Part 7 必須屬於文章題組", () => {
    const p7 = demoQuestions.find((q) => q.part === 7)!;
    expect(QuestionSchema.safeParse({ ...p7, group_id: null }).success).toBe(false);
  });

  it("Part 5 題幹不可空白；Part 6 題幹可留白", () => {
    expect(QuestionSchema.safeParse({ ...base, stem: " " }).success).toBe(false);
    const p6 = demoQuestions.find((q) => q.part === 6)!;
    expect(p6.stem).toBe("");
    expect(QuestionSchema.safeParse(p6).success).toBe(true);
  });
});

describe("demo 題庫內容", () => {
  it("涵蓋 Part 5、6、7，且 Part 7 有多題共用一篇文章", () => {
    const parts = new Set(demoQuestions.map((q) => q.part));
    expect([...parts].sort()).toEqual([5, 6, 7]);
    const p7Group = demoQuestions.filter((q) => q.part === 7).map((q) => q.group_id);
    expect(new Set(p7Group).size).toBe(1);
    expect(p7Group.length).toBeGreaterThanOrEqual(2);
  });

  it("每個 group_id 都有對應的題組，source_id 與 id 不重複", () => {
    const groupIds = new Set(demoGroups.map((g) => g.id));
    for (const q of demoQuestions) if (q.group_id) expect(groupIds.has(q.group_id)).toBe(true);
    expect(new Set(demoQuestions.map((q) => q.id)).size).toBe(demoQuestions.length);
    expect(new Set(demoQuestions.map((q) => q.source_id)).size).toBe(demoQuestions.length);
  });

  it("全部標示 demo 且為已審核", () => {
    for (const q of demoQuestions) {
      expect(q.tags).toContain("demo");
      expect(q.status).toBe("approved");
    }
  });
});
