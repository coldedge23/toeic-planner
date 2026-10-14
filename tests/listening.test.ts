import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToeicDB } from '@/storage/dexie/db';
import { createDexieRepositories } from '@/storage/dexie/DexieRepositories';
import { listeningMistakes, listeningScore, practiceQuestions } from '@/domain/listening';
import { parseBackup } from '@/domain/backup-migrations';
import { SCHEMA_VERSION, type ListeningSession } from '@/domain/schema';
import manifest from '@/fixtures/listening-audio.json';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;
const now = new Date('2026-10-14T00:00:00Z');
beforeEach(() => { db = new ToeicDB(`listening-${crypto.randomUUID()}`); repos = createDexieRepositories(db); });
afterEach(async () => { await db.delete(); });
const create = async (mode: 'answer' | 'listen' = 'answer') => {
  const questions = await repos.listening.questions();
  const session: ListeningSession = { id: crypto.randomUUID(), created_at: now.toISOString(), updated_at: now.toISOString(), mode, minutes: 5, status: 'in_progress', revision: 0, question_snapshot: questions.slice(0, 2), position: 0, audio_position: 0, answers: [] };
  await repos.listening.create(session);
  return session;
};

describe('聽力資料與原創音訊', () => {
  it('30 題均有三個選項、正解與解說，所有 MP3 實體檔案通過內容雜湊', async () => {
    const qs = await repos.listening.questions();
    expect(qs).toHaveLength(30);
    expect(new Set(qs.map(q => q.id)).size).toBe(30);
    expect(new Set(qs.map(q => q.prompt)).size).toBe(30);
    for (const q of qs) {
      expect(Object.keys(q.options)).toEqual(['A', 'B', 'C']);
      expect(q.options[q.correct_key].length).toBeGreaterThan(0);
      expect(manifest.files.some(f => f.name === `${q.id}.mp3`)).toBe(true);
    }
    for (const file of manifest.files) {
      const bytes = readFileSync(`public/audio/part2-v1/${file.name}`);
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    for (const p of manifest.playlists) {
      expect(p.duration).toBeLessThanOrEqual(p.minutes * 60);
      expect(p.ids.every(id => qs.some(q => q.id === id))).toBe(true);
      expect(p.duration).toBe(manifest.tracks.find(t => t.id === p.ids.at(-1))!.end);
    }
  });
  it('短題庫不重複抽題，錯題使用最近一次作答，收聽不影響統計', async () => {
    let s = await create();
    const q = s.question_snapshot[0];
    expect(practiceQuestions(s.question_snapshot, 15)).toHaveLength(2);
    expect(new Set(practiceQuestions(await repos.listening.questions(), 15).map(q => q.id)).size).toBe(15);
    s = await repos.listening.answer(s.id, s.revision, q.correct_key === 'A' ? 'B' : 'A', now);
    expect(listeningMistakes([s]).has(q.id)).toBe(true);
    const corrected = { ...s, id: crypto.randomUUID(), answers: [{ question_id: q.id, selected: q.correct_key, answered_at: '2026-10-15T00:00:00Z' }] };
    expect(listeningMistakes([corrected, s]).size).toBe(0);
    expect(listeningScore([s, { ...s, mode: 'listen', answers: [] }])).toEqual({ total: 1, correct: 0 });
  });
  it('拒絕搶開第二場、重送答案與過期進度；重新開啟後保留答案', async () => {
    let s = await create();
    await expect(create()).rejects.toThrow('先續練');
    await expect(repos.listening.next(s.id, s.revision, now)).rejects.toThrow('先作答');
    s = await repos.listening.answer(s.id, 0, 'A', now);
    await expect(repos.listening.answer(s.id, 0, 'B', now)).rejects.toThrow('已變更');
    await expect(repos.listening.answer(s.id, s.revision, 'B', now)).rejects.toThrow('已作答');
    db.close(); await db.open();
    expect((await repos.listening.list())[0]).toEqual(s);
    s = await repos.listening.next(s.id, s.revision, now);
    expect(s.position).toBe(1);
    s = await repos.listening.answer(s.id, s.revision, 'C', now);
    s = await repos.listening.next(s.id, s.revision, now);
    expect(s.status).toBe('completed');
    expect(s.answers).toHaveLength(2);
  });
  it('連續收聽保存播放位置，不能作答；結束不增加正確率或錯題', async () => {
    let s = await create('listen');
    await expect(repos.listening.answer(s.id, s.revision, 'A', now)).rejects.toThrow('不可作答');
    s = await repos.listening.progress(s.id, s.revision, 123.5, now);
    await expect(repos.listening.progress(s.id, s.revision, -1, now)).rejects.toThrow();
    s = await repos.listening.finish(s.id, s.revision, now);
    expect(s.audio_position).toBe(123.5);
    expect(listeningScore([s])).toEqual({ total: 0, correct: 0 });
    expect(listeningMistakes([s]).size).toBe(0);
  });
  it('v5 往返保留閱讀單字與聽力；破損聽力備份拒絕，原資料不变', async () => {
    await repos.bank.seedDemo();
    await repos.vocabulary.add({ term: 'dispatch', meaning_zh: '派遣', example: '', part_of_speech: '', source: null });
    const s = await create();
    await repos.listening.answer(s.id, 0, 'A', now);
    const b = await repos.backups.exportAll();
    expect(b.schema_version).toBe(SCHEMA_VERSION);
    expect(parseBackup(JSON.stringify(b)).ok).toBe(true);
    await repos.backups.importAll(b);
    const restored = await repos.backups.exportAll();
    expect({ ...restored, exported_at: b.exported_at }).toEqual(b);
    const broken = { ...b, listening_sessions: b.listening_sessions.map(s => ({ ...s, answers: [...s.answers, ...s.answers] })) };
    expect(parseBackup(JSON.stringify(broken)).ok).toBe(false);
    await expect(repos.backups.importAll(broken)).rejects.toThrow();
    expect((await repos.backups.exportAll()).listening_sessions).toEqual(b.listening_sessions);
    expect(await repos.vocabulary.list()).toHaveLength(1);
    const legacy = { ...b, schema_version: 4 } as Record<string, unknown>;
    delete legacy.listening_sessions;
    const migrated = parseBackup(JSON.stringify(legacy));
    expect(migrated.ok && migrated.backup.listening_sessions).toEqual([]);
    expect(migrated.ok && migrated.backup.vocabulary_words).toEqual(b.vocabulary_words);
    expect(migrated.ok && migrated.backup.questions).toEqual(b.questions);
  });
  it('真實 v4 資料庫升級只新增聽力表，不改題庫與單字', async () => {
    const name = `listen-old-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(4).stores(Object.fromEntries(db.tables.filter(t => t.name !== 'listening_sessions').map(t => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map(i => i.src)].join(',')])));
    const temp = createDexieRepositories(db);
    await temp.bank.seedDemo();
    const q = (await temp.bank.listAll()).questions[0];
    const word = await temp.vocabulary.add({ term: 'cargo', meaning_zh: '貨物', example: '', part_of_speech: '', source: null });
    await legacy.table('questions').add(q); await legacy.table('vocabulary_words').add(word);
    legacy.close();
    const upgraded = new ToeicDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.questions.get(q.id)).toEqual(q);
      expect(await upgraded.vocabulary_words.get(word.id)).toEqual(word);
      expect(await upgraded.listening_sessions.count()).toBe(0);
    } finally { await upgraded.delete(); }
  });
});
