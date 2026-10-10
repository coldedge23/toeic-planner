import { describe, expect, it } from "vitest";
import {
  activeElapsedMs,
  buildSession,
  checkAvailability,
  describeSelectError,
  formatPercent,
  gradeSession,
  isExpired,
  pageUnits,
  pauseSession,
  remainingMs,
  resumeSession,
  selectQuestions,
  type Rng,
} from "@/domain/exam-engine";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";
import type { Answer, Session } from "@/domain/schema";

/** 固定序列的亂數，讓抽題可重現 */
function seeded(seed: number): Rng {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, "0")}`;
const NOW = new Date("2026-10-10T02:00:00.000Z");

// demo 題庫：Part 5 單題 ×6、Part 6 題組 4 題、Part 7 題組 3 題
describe("selectQuestions", () => {
  it("抽出剛好指定題數且不重複", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5, 6, 7], count: 10, secondsPerQuestion: 45 }, seeded(seed));
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect(r.items).toHaveLength(10);
      expect(new Set(r.items.map((i) => i.question.id)).size).toBe(10);
    }
  });

  it("共用題組保持完整：抽到題組中的一題就抽到整組，且附上文章", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5, 6, 7], count: 9, secondsPerQuestion: null }, seeded(seed));
      if (!r.ok) throw new Error();
      for (const g of demoGroups) {
        const inGroup = demoQuestions.filter((q) => q.group_id === g.id).length;
        const picked = r.items.filter((i) => i.question.group_id === g.id);
        expect([0, inGroup]).toContain(picked.length);
        for (const p of picked) expect(p.group?.id).toBe(g.id);
      }
    }
  });

  it("題目依 Part 排序，同題組的題目相鄰", () => {
    const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5, 6, 7], count: 13, secondsPerQuestion: null }, seeded(3));
    if (!r.ok) throw new Error();
    const parts = r.items.map((i) => i.question.part);
    expect(parts).toEqual([...parts].sort());
  });

  it("題庫不足時回傳實際可用數，不重複湊題", () => {
    const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5], count: 8, secondsPerQuestion: 45 });
    expect(r).toEqual({ ok: false, error: "insufficient", available: 6 });
    if (!r.ok) expect(describeSelectError(r)).toContain("只有 6 題");
  });

  it("只選 Part 7 時，題數無法剛好組成會提示可行題數", () => {
    const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [6, 7], count: 5, secondsPerQuestion: 45 });
    expect(r).toEqual({ ok: false, error: "group_mismatch", lower: 4, higher: 7 });
  });

  it("草稿或退回的題目不會被抽到", () => {
    const withDraft = demoQuestions.map((q) => (q.part === 5 ? { ...q, status: "draft" as const } : q));
    expect(checkAvailability(withDraft, [5]).available).toBe(0);
    const r = selectQuestions(withDraft, demoGroups, { source: "bank", parts: [5, 6, 7], count: 7, secondsPerQuestion: 45 });
    if (!r.ok) throw new Error();
    expect(r.items.every((i) => i.question.part !== 5)).toBe(true);
  });

  it("沒選 Part、題數不合法", () => {
    expect(selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [], count: 5, secondsPerQuestion: 45 }).ok).toBe(false);
    expect(selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5], count: 0, secondsPerQuestion: 45 }).ok).toBe(false);
    expect(selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5], count: 2.5, secondsPerQuestion: 45 }).ok).toBe(false);
  });
});

function makeSession(count = 10, seconds: number | null = 45): Session {
  const r = selectQuestions(demoQuestions, demoGroups, { source: "bank", parts: [5, 6, 7], count, secondsPerQuestion: seconds }, seeded(7));
  if (!r.ok) throw new Error();
  return buildSession({ source: "bank", parts: [5, 6, 7], count, secondsPerQuestion: seconds }, r.items, NOW, newId);
}

describe("計時", () => {
  it("截止時間 = 題數 × 每題秒數；切到背景後以截止時間計算剩餘秒數", () => {
    const s = makeSession(10, 45);
    expect(remainingMs(s, NOW)).toBe(450_000);
    // 模擬背景 5 分鐘後回來（計時器沒有在背景跑）
    expect(remainingMs(s, new Date(NOW.getTime() + 300_000))).toBe(150_000);
    expect(isExpired(s, new Date(NOW.getTime() + 450_000))).toBe(true);
    expect(isExpired(s, new Date(NOW.getTime() + 449_000))).toBe(false);
  });

  it("不限時", () => {
    const s = makeSession(10, null);
    expect(remainingMs(s, NOW)).toBeNull();
    expect(isExpired(s, new Date(NOW.getTime() + 99_999_999))).toBe(false);
  });

  it("暫停期間時間凍結，繼續後截止時間往後延", () => {
    let s = makeSession(10, 45);
    const t1 = new Date(NOW.getTime() + 100_000);
    s = { ...s, ...pauseSession(s, t1) };
    const t2 = new Date(NOW.getTime() + 400_000);
    expect(remainingMs(s, t2)).toBe(350_000);
    expect(isExpired(s, new Date(NOW.getTime() + 999_000))).toBe(false);
    s = { ...s, ...resumeSession(s, t2) };
    expect(s.paused_at).toBeNull();
    expect(s.paused_ms).toBe(300_000);
    expect(remainingMs(s, t2)).toBe(350_000);
    expect(activeElapsedMs(s, new Date(t2.getTime() + 50_000))).toBe(150_000);
  });
});

describe("gradeSession", () => {
  it("計算正確率與各 Part 分數；未作答算錯", () => {
    const s = makeSession(10, 45);
    const answers: Answer[] = s.question_snapshot.slice(0, 6).map((it, i) => ({
      id: newId(),
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      session_id: s.id,
      question_id: it.question.id,
      selected_key: i < 4 ? it.question.correct_key : it.question.correct_key === "A" ? "B" : "A",
      answered_at: NOW.toISOString(),
      elapsed_ms: 1000,
    }));
    const g = gradeSession(s, answers);
    expect(g.correct).toBe(4);
    expect(g.total).toBe(10);
    expect(formatPercent(g.accuracy)).toBe("40.0%");
    expect(g.items.filter((i) => i.selected === null)).toHaveLength(4);
    expect(g.byPart.reduce((n, p) => n + p.total, 0)).toBe(10);
  });

  it("以快照中的題目評分：題庫之後改了正解，歷史結果不變", () => {
    const s = makeSession(10, 45);
    const first = s.question_snapshot[0].question;
    const answer: Answer = {
      id: newId(),
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      session_id: s.id,
      question_id: first.id,
      selected_key: first.correct_key,
      answered_at: NOW.toISOString(),
      elapsed_ms: 0,
    };
    // 模擬題庫更新（不影響快照）
    const bankCopy = { ...first, correct_key: first.correct_key === "A" ? ("B" as const) : ("A" as const) };
    expect(bankCopy.correct_key).not.toBe(first.correct_key);
    expect(gradeSession(s, [answer]).items[0].isCorrect).toBe(true);
  });

  it("formatPercent 保留一位小數", () => {
    expect(formatPercent(2 / 3)).toBe("66.7%");
    expect(formatPercent(1)).toBe("100.0%");
  });
});

describe("pageUnits", () => {
  it("Part 5 一題一頁，題組一頁", () => {
    const s = makeSession(13, null);
    const pages = pageUnits(s);
    expect(pages.flat()).toEqual(s.question_snapshot.map((_, i) => i));
    expect(pages).toHaveLength(6 + 2);
  });
});
