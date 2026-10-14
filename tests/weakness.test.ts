import { describe, expect, it } from 'vitest';
import { analyzeWeakness, focusQuestions } from '@/domain/weakness';
import { buildSession, checkAvailability, selectQuestions } from '@/domain/exam-engine';
import { demoQuestions, demoGroups } from '@/fixtures/demo-bank';
import type { Attempt, Session } from '@/domain/schema';

let serial = 0;
const id = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
function record(date: string, correct = false) {
  const questions = demoQuestions.filter(q => q.part === 5).slice(0, 5).map(q => ({ ...q, tags: ['demo', '詞性', ' 詞性 ', '時態'] }));
  const session: Session = { ...buildSession({ source: 'bank', parts: [5], count: 5, secondsPerQuestion: 45 }, questions.map(question => ({ question, group: null })), new Date(date), id), status: 'submitted', submitted_at: date };
  const attempts: Attempt[] = questions.map(q => ({ id: id(), created_at: date, updated_at: date, session_id: session.id, question_id: q.id, question_version: q.version, selected_key: correct ? q.correct_key : null, is_correct: correct, submitted_at: date }));
  return { session, attempts };
}

describe('弱點分析與針對性練習', () => {
  it('10 次且 5 道不同題目才判定優先加強；考點去重，未作答保留錯誤', () => {
    const first = record('2026-10-12T16:00:00.000Z');
    const second = record('2026-10-13T01:00:00.000Z', true);
    first.attempts.push(first.attempts[0]);
    const analysis = analyzeWeakness([first, second], '2026-10-13', '30');
    const part = analysis.metrics.find(m => m.part === 5 && m.tag === null)!;
    expect(part).toMatchObject({ total: 10, correct: 5, wrong: 5, distinct: 5, accuracy: .5, status: 'priority' });
    expect(analysis.metrics.find(m => m.tag === '詞性')?.total).toBe(10);
    expect(analysis.metrics.some(m => m.tag === 'demo')).toBe(false);
    expect(analysis.metrics.find(m => m.part === 6)?.accuracy).toBeNull();
    expect(analyzeWeakness([first], '2026-10-13', 'all').metrics.find(m => m.part === 5 && m.tag === null)?.status).toBe('insufficient');
  });
  it('台北 30 天包含首日午夜，排除未交卷與未來紀錄；全部可讀舊紀錄', () => {
    const before = record('2026-09-13T15:59:59.000Z');
    const boundary = record('2026-09-13T16:00:00.000Z');
    const future = record('2026-10-13T16:00:00.000Z');
    const progress = record('2026-10-13T01:00:00.000Z');
    progress.session.status = 'in_progress';
    expect(analyzeWeakness([before, boundary, future, progress], '2026-10-13', '30').sessions).toBe(1);
    expect(analyzeWeakness([before, boundary, future, progress], '2026-10-13', 'all').sessions).toBe(2);
  });
  it('70% 為持續練習，不錯標為優先加強', () => {
    const first = record('2026-10-13T01:00:00.000Z', true);
    const second = record('2026-10-13T02:00:00.000Z');
    second.attempts.slice(0, 2).forEach(a => { a.is_correct = true; a.selected_key = first.session.question_snapshot.find(q => q.question.id === a.question_id)!.question.correct_key; });
    expect(analyzeWeakness([first, second], '2026-10-13', 'all').metrics.find(m => m.tag === null && m.part === 5)).toMatchObject({ accuracy: .7, status: 'stable' });
  });
  it('缺失或其他場的 attempts 不推定答錯；反覆只練一題仍標資料不足', () => {
    const r = record('2026-10-13T01:00:00.000Z');
    r.attempts = r.attempts.slice(0, 1);
    r.attempts.push({ ...r.attempts[0], question_id: r.session.question_snapshot[1].question.id, session_id: id() });
    const a = analyzeWeakness([r], '2026-10-13', 'all');
    expect(a.metrics.find(m => m.part === 5 && m.tag === null)?.total).toBe(1);
    const repeats = Array.from({ length: 12 }, () => { const r = record('2026-10-13T01:00:00.000Z'); r.attempts = r.attempts.slice(0, 1); return r; });
    expect(analyzeWeakness(repeats, '2026-10-13', 'all').metrics.find(m => m.tag === null && m.part === 5)).toMatchObject({ total: 12, distinct: 1, status: 'insufficient' });
  });
  it('考點只命中 Part 6 一題時，仍可抽出整篇四題，且不混入其他 Part 或草稿', () => {
    const p6 = demoQuestions.filter(q => q.part === 6);
    const questions = demoQuestions.map(q => ({ ...q, tags: q.id === p6[0].id || q.part === 5 ? ['目標'] : [] }));
    const focused = focusQuestions(questions, [6], '目標');
    expect(focused).toHaveLength(4);
    expect(checkAvailability(focused, [6]).achievable).toEqual(new Set([0, 4]));
    const result = selectQuestions(focused, demoGroups, { source: 'bank', parts: [6], count: 4, secondsPerQuestion: 45 });
    expect(result.ok && result.items.map(i => i.question.id).sort()).toEqual(p6.map(q => q.id).sort());
    expect(focusQuestions(questions.map(q => ({ ...q, status: 'draft' as const })), [6], '目標')).toEqual([]);
    expect(focusQuestions(questions, [7], '不存在')).toEqual([]);
  });
});
