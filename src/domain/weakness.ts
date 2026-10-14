import { addDays, toTaipeiDate } from './dates';
import { READING_PARTS, type Attempt, type Question, type ReadingPart, type Session } from './schema';

export interface WeaknessMetric {
  part: ReadingPart;
  tag: string | null;
  total: number;
  correct: number;
  wrong: number;
  distinct: number;
  accuracy: number | null;
  status: 'insufficient' | 'priority' | 'stable';
}

/** 使用交卷時的快照；一場同一題只算一次，跨場重考仍算練習次數。 */
export function analyzeWeakness(
  records: readonly { session: Session; attempts: readonly Attempt[] }[],
  today: string,
  range: '30' | 'all',
) {
  const start = range === '30' ? addDays(today, -29) : null;
  const buckets = new Map<string, { part: ReadingPart; tag: string | null; correct: number; total: number; ids: Set<string> }>();
  const add = (part: ReadingPart, tag: string | null, q: Question, correct: boolean) => {
    const key = JSON.stringify([part, tag]);
    const bucket = buckets.get(key) ?? { part, tag, correct: 0, total: 0, ids: new Set<string>() };
    bucket.total++; bucket.correct += Number(correct); bucket.ids.add(q.id);
    buckets.set(key, bucket);
  };
  let sessions = 0;
  for (const { session, attempts } of records) {
    if (session.status !== 'submitted' || !session.submitted_at) continue;
    const date = toTaipeiDate(new Date(session.submitted_at));
    if (date > today || (start && date < start)) continue;
    sessions++;
    const byId = new Map(attempts.filter(a => a.session_id === session.id).map(a => [a.question_id, a]));
    const seen = new Set<string>();
    for (const { question: q } of session.question_snapshot) {
      if (!(READING_PARTS as readonly number[]).includes(q.part) || seen.has(q.id)) continue;
      seen.add(q.id);
      const a = byId.get(q.id);
      if (!a) continue; // 異常缺失紀錄不推定為答錯。
      const part = q.part as ReadingPart;
      add(part, null, q, a.is_correct);
      for (const tag of new Set(q.tags.map(t => t.trim()).filter(t => t && t !== 'demo'))) add(part, tag, q, a.is_correct);
    }
  }
  const metrics: WeaknessMetric[] = [...buckets.values()].map(b => {
    const accuracy = b.total ? b.correct / b.total : null;
    return { part: b.part, tag: b.tag, total: b.total, correct: b.correct, wrong: b.total - b.correct,
      distinct: b.ids.size, accuracy,
      status: b.total < 10 || b.ids.size < 5 ? 'insufficient' : accuracy! < .7 ? 'priority' : 'stable' };
  });
  for (const part of READING_PARTS) if (!metrics.some(m => m.part === part && m.tag === null)) {
    metrics.push({ part, tag: null, total: 0, correct: 0, wrong: 0, distinct: 0, accuracy: null, status: 'insufficient' });
  }
  const rank = { priority: 0, stable: 1, insufficient: 2 };
  metrics.sort((a, b) => rank[a.status] - rank[b.status] || (a.accuracy ?? 1) - (b.accuracy ?? 1) || b.total - a.total || a.part - b.part || (a.tag ?? '').localeCompare(b.tag ?? ''));
  return { metrics, sessions, start };
}

/** 考點命中題組時，補回該單元同組全部已審核題目，不拆文章。 */
export function focusQuestions(questions: readonly Question[], parts: readonly ReadingPart[], tag: string | null): Question[] {
  const approved = questions.filter(q => q.status === 'approved' && parts.includes(q.part as ReadingPart));
  if (!tag) return approved;
  const matching = approved.filter(q => q.tags.some(t => t.trim() === tag));
  const ids = new Set(matching.map(q => q.id));
  const groups = new Set(matching.flatMap(q => q.group_id ? [q.group_id] : []));
  return approved.filter(q => ids.has(q.id) || (!!q.group_id && groups.has(q.group_id)));
}
