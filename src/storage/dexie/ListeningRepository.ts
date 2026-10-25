import { ListeningQuestionSchema, type ListeningSession } from '@/domain/schema';
import { validateListeningSession } from '@/domain/listening';
import data from '@/fixtures/listening-part2.json';
import batch2 from '@/fixtures/listening-part2-batch2.json';
import type { ListeningRepository } from '../Repository';
import type { ToeicDB } from './db';
import { listeningAudio, listeningPacks, resolveListeningPlayback } from '../listening-pack-audio';
import { listeningPackKey } from '@/domain/listening-packs';

export function createListeningRepository(db: ToeicDB): ListeningRepository {
  const change = async (id: string, revision: number, now: Date, update: (s: ListeningSession) => ListeningSession) => db.transaction('rw', db.listening_sessions, async () => {
    const s = await db.listening_sessions.get(id);
    if (!s || s.status !== 'in_progress' || s.revision !== revision) throw new Error('聽力進度已變更，請重新開啟練習');
    const next = validateListeningSession({ ...update(s), revision: s.revision + 1, updated_at: now.toISOString() });
    await db.listening_sessions.put(next);
    return next;
  });
  return {
    audio: {
      ...listeningAudio,
      async remove(key) {
        const pack = listeningPacks.find(p => listeningPackKey(p) === key);
        const active = await db.listening_sessions.where('status').equals('in_progress').toArray();
        if (pack && active.some(s => s.question_snapshot.some(q => pack.questions.some(ref => ref.id === q.id && ref.version === q.version)))) throw new Error('進行中的練習使用此題包，請先結束練習再移除音訊');
        await listeningAudio.remove(key);
      },
      async removeLegacy() {
        if (await db.listening_sessions.where('status').equals('in_progress').count()) throw new Error('請先結束進行中的練習，再移除舊版音訊');
        await listeningAudio.removeLegacy();
      },
    },
    async packs() { return structuredClone(listeningPacks); },
    async playback(session) { return resolveListeningPlayback(validateListeningSession(session)); },
    async questions() { return [...data, ...batch2].map(q => ListeningQuestionSchema.parse(q)); },
    async list() { return db.listening_sessions.toArray(); },
    async create(input) {
      const s = validateListeningSession(input);
      if (s.status !== 'in_progress' || s.position !== 0 || s.answers.length || s.revision !== 0) throw new Error('新聽力練習格式錯誤');
      await db.transaction('rw', db.listening_sessions, async () => {
        if (await db.listening_sessions.where('status').equals('in_progress').count()) throw new Error('請先續練或結束原有聽力練習');
        await db.listening_sessions.add(s);
      });
    },
    answer(id, revision, key, now) { return change(id, revision, now, s => {
      const q = s.question_snapshot[s.position];
      if (s.mode !== 'answer' || !q || s.answers.some(a => a.question_id === q.id)) throw new Error('這題已作答或不可作答');
      return { ...s, answers: [...s.answers, { question_id: q.id, selected: key, answered_at: now.toISOString() }] };
    }); },
    next(id, revision, now) { return change(id, revision, now, s => {
      if (s.mode !== 'answer' || !s.answers.some(a => a.question_id === s.question_snapshot[s.position]?.id)) throw new Error('請先作答');
      const position = s.position + 1;
      return { ...s, position, audio_position: 0, status: position === s.question_snapshot.length ? 'completed' : 'in_progress' };
    }); },
    progress(id, revision, seconds, now) { return change(id, revision, now, s => ({ ...s, audio_position: seconds })); },
    finish(id, revision, now) { return change(id, revision, now, s => ({ ...s, status: 'completed' })); },
  };
}
