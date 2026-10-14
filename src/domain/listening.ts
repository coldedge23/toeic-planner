import { ListeningSessionSchema, type ListeningQuestion, type ListeningSession } from './schema';

export function validateListeningSession(input: unknown): ListeningSession {
  const s = ListeningSessionSchema.parse(input);
  const ids = s.question_snapshot.map(q => q.id);
  if (new Set(ids).size !== ids.length || s.position > ids.length) throw new Error('聽力題目或進度不完整');
  if (s.status === 'in_progress' && s.position === ids.length) throw new Error('聽力進度已到結尾，狀態不符');
  const answered = new Set(s.answers.map(a => a.question_id));
  if (answered.size !== s.answers.length || s.answers.some(a => !ids.includes(a.question_id))) throw new Error('聽力作答重複或找不到題目');
  if (s.mode === 'listen' && s.answers.length) throw new Error('連續收聽不可計入作答');
  if (s.mode === 'answer') {
    if (s.answers.some((a, i) => a.question_id !== ids[i]) || s.answers.length < s.position || s.answers.length > Math.min(s.position + 1, ids.length)) throw new Error('聽力作答與進度不符');
  }
  return s;
}

export function listeningScore(sessions: readonly ListeningSession[]) {
  let total = 0, correct = 0;
  for (const s of sessions.filter(s => s.mode === 'answer')) for (const a of s.answers) {
    const q = s.question_snapshot.find(q => q.id === a.question_id);
    if (q) { total++; if (q.correct_key === a.selected) correct++; }
  }
  return { total, correct };
}

/** 最近一次已作答仍答錯的題目；連續收聽不影響錯題。 */
export function listeningMistakes(sessions: readonly ListeningSession[]): Set<string> {
  const latest = new Map<string, { at: string; wrong: boolean }>();
  for (const s of sessions.filter(s => s.mode === 'answer')) for (const a of s.answers) {
    const q = s.question_snapshot.find(q => q.id === a.question_id);
    if (q && (!latest.has(q.id) || latest.get(q.id)!.at < a.answered_at)) latest.set(q.id, { at: a.answered_at, wrong: a.selected !== q.correct_key });
  }
  return new Set([...latest].filter(([, v]) => v.wrong).map(([id]) => id));
}

export function practiceQuestions(questions: readonly ListeningQuestion[], minutes: 5 | 10 | 15, random: () => number = Math.random) {
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // 搭車模式為含聽題、作答與檢討的估計時間，不強制倒數交卷。
  return shuffled.slice(0, minutes);
}
