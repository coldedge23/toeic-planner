import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ToeicDB } from '@/storage/dexie/db';
import { createDexieRepositories } from '@/storage/dexie/DexieRepositories';
import { listeningPackKey, playlistFor, questionsInPack, type ListeningPack } from '@/domain/listening-packs';
import { listeningMistakes, practiceQuestions } from '@/domain/listening';
import { parseBackup } from '@/domain/backup-migrations';
import { SCHEMA_VERSION, type ListeningSession } from '@/domain/schema';
import legacy from '@/fixtures/listening-audio.json';

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;
let packs: ListeningPack[];
const cacheMaps = new Map<string, Map<string, Response>>();
const normalize = (input: RequestInfo | URL) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost').pathname;
const now = new Date('2026-10-14T00:00:00Z');
const responseFor = (path: string) => new Response(new Uint8Array(readFileSync(`public${path}`)).buffer, { headers: { 'Content-Type': 'audio/mpeg' } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  cacheMaps.clear();
  vi.stubGlobal('caches', {
    async open(name: string) {
      if (!cacheMaps.has(name)) cacheMaps.set(name, new Map());
      const entries = cacheMaps.get(name)!;
      return {
        async match(input: RequestInfo | URL) { return entries.get(normalize(input))?.clone(); },
        async put(input: RequestInfo | URL, response: Response) { entries.set(normalize(input), response.clone()); },
        async delete(input: RequestInfo | URL) { return entries.delete(normalize(input)); },
      };
    },
    async delete(name: string) { return cacheMaps.delete(name); },
  });
  vi.stubGlobal('navigator', { onLine: true });
  fetchMock = vi.fn(async (input: RequestInfo | URL) => responseFor(normalize(input)));
  vi.stubGlobal('fetch', fetchMock);
  db = new ToeicDB(`packs-${crypto.randomUUID()}`);
  repos = createDexieRepositories(db); packs = await repos.listening.packs();
});
afterEach(async () => { await db.delete(); vi.unstubAllGlobals(); });

async function sessionFor(pack: ListeningPack, mode: 'answer' | 'listen' = 'answer', minutes: 5 | 10 | 15 = 5) {
  const qs = questionsInPack(await repos.listening.questions(), pack);
  const snapshot = mode === 'listen' ? playlistFor(pack, minutes).ids.map(id => qs.find(q => q.id === id)!) : practiceQuestions(qs, minutes, () => 0.5);
  const s: ListeningSession = { id: crypto.randomUUID(), created_at: now.toISOString(), updated_at: now.toISOString(), mode, minutes, status: 'in_progress', revision: 0, position: 0, audio_position: 0, answers: [], question_snapshot: snapshot };
  await repos.listening.create(s); return s;
}

describe('可選且獨立下載的聽力題包', () => {
  it('完整分成 14／10／6 題且不重複；各包單段收聽音檔與清單一致', async () => {
    expect(packs.map(p => p.question_ids.length)).toEqual([14, 10, 6]);
    const ids = packs.flatMap(p => p.question_ids);
    expect(ids).toHaveLength(30); expect(new Set(ids).size).toBe(30);
    for (const pack of packs) {
      expect(questionsInPack(await repos.listening.questions(), pack).map(q => q.id)).toEqual(pack.question_ids);
      expect(new Set(pack.files.map(f => f.path)).size).toBe(pack.files.length);
      for (const file of pack.files) {
        const bytes = readFileSync(`public/${file.path}`);
        expect(bytes.length).toBe(file.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      }
      for (const minutes of [5, 10, 15]) {
        const playlist = playlistFor(pack, minutes);
        expect(playlist.duration).toBeLessThanOrEqual(minutes * 60);
        expect(playlist.ids.length).toBeGreaterThan(0);
        expect(playlist.ids.every(id => pack.question_ids.includes(id))).toBe(true);
        expect(new Set(playlist.ids).size).toBe(playlist.ids.length);
        expect(pack.files.some(f => f.path === playlist.file.path)).toBe(true);
      }
    }
    const short = packs[2];
    expect(playlistFor(short, 15).ids).toHaveLength(6);
    expect(playlistFor(short, 15).duration).toBeLessThan(5 * 60);
    expect(playlistFor(short, 15).file).toEqual(playlistFor(short, 5).file);
  });
  it('只抽選定題包及其錯題，短包不重复；音訊必須依完整快照順序與版本匹配', async () => {
    let s = await sessionFor(packs[2], 'answer', 15);
    expect(s.question_snapshot).toHaveLength(6);
    const q = s.question_snapshot[0];
    s = await repos.listening.answer(s.id, s.revision, q.correct_key === 'A' ? 'B' : 'A', now);
    const wrong = listeningMistakes([s]);
    expect(questionsInPack(await repos.listening.questions(), packs[0]).filter(q => wrong.has(q.id))).toHaveLength(0);
    expect(questionsInPack(await repos.listening.questions(), packs[2]).filter(q => wrong.has(q.id))).toHaveLength(1);
    expect((await repos.listening.playback(s)).packKey).toBe(listeningPackKey(packs[2]));
    await repos.listening.finish(s.id, s.revision, now);
    const listening = await sessionFor(packs[0], 'listen');
    const playback = await repos.listening.playback(listening);
    expect(playback.file).toEqual(playlistFor(packs[0], 5).file);
    expect(playback.legacy).toBe(false);
    await expect(repos.listening.playback({ ...listening, question_snapshot: [...listening.question_snapshot].reverse() })).rejects.toThrow('原本');
    await expect(repos.listening.playback({ ...listening, question_snapshot: listening.question_snapshot.map(q => ({ ...q, version: 2 })) })).rejects.toThrow('原本');
  });
  it('只下載指定包；移除另一包不影響已下載音訊與全部學習紀錄', async () => {
    await repos.bank.seedDemo();
    await repos.vocabulary.add({ term: 'route', meaning_zh: '路線', part_of_speech: '', example: '', source: null });
    const a = listeningPackKey(packs[0]), b = listeningPackKey(packs[1]);
    const snapshot = await repos.backups.exportAll();
    await repos.listening.audio.download(a, () => {});
    expect((await repos.listening.audio.status(a)).ready).toBe(true);
    expect((await repos.listening.audio.status(b)).count).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(packs[0].files.length);
    await repos.listening.audio.download(b, () => {});
    await repos.listening.audio.remove(a);
    expect((await repos.listening.audio.status(a)).count).toBe(0);
    expect((await repos.listening.audio.status(b)).ready).toBe(true);
    const after = await repos.backups.exportAll();
    expect({ ...after, exported_at: snapshot.exported_at }).toEqual(snapshot);
    await repos.listening.audio.download(a, () => {});
    expect((await repos.listening.audio.status(a)).ready).toBe(true);
  });
  it('下載中断保留已完成檔案，重試只抓缺少檔案；完整長度但錯誤內容不算下載成功', async () => {
    const pack = packs[2], key = listeningPackKey(pack);
    let calls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (++calls === 3) throw new Error('network interrupted');
      return responseFor(normalize(input));
    });
    await expect(repos.listening.audio.download(key, () => {})).rejects.toThrow('interrupted');
    expect((await repos.listening.audio.status(key)).count).toBe(2);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => responseFor(normalize(input)));
    const before = fetchMock.mock.calls.length;
    await repos.listening.audio.download(key, () => {});
    expect(fetchMock.mock.calls.length - before).toBe(pack.files.length - 2);
    const file = pack.files[0];
    cacheMaps.get(`toeic-listening-pack-${key}`)!.set('/' + file.path, new Response(new Uint8Array(file.bytes).buffer));
    expect((await repos.listening.audio.status(key)).count).toBe(pack.files.length - 1);
    await repos.listening.audio.download(key, () => {});
    expect((await repos.listening.audio.status(key)).ready).toBe(true);
  });
  it('沿用舊單題並複製到新包；移除舊整包後新包離線可用，不覆寫 v5 紀錄', async () => {
    const legacyCache = await caches.open('toeic-listening-part2-v1');
    for (const file of legacy.files) await legacyCache.put(`/audio/part2-v1/${file.name}`, responseFor(`/audio/part2-v1/${file.name}`));
    const qs = await repos.listening.questions();
    const old: ListeningSession = { id: crypto.randomUUID(), created_at: now.toISOString(), updated_at: now.toISOString(), mode: 'listen', minutes: 5, status: 'in_progress', revision: 0, position: 0, audio_position: 42, answers: [], question_snapshot: legacy.playlists[0].ids.map(id => qs.find(q => q.id === id)!) };
    await db.listening_sessions.add(old);
    const playback = await repos.listening.playback(old);
    expect(playback.legacy).toBe(true);
    expect(playback.file.path).toBe('audio/part2-v1/continuous-5.mp3');
    expect((await repos.listening.list())[0]).toEqual(old);
    await expect(repos.listening.audio.remove(listeningPackKey(packs[0]))).rejects.toThrow('進行中');
    await expect(repos.listening.audio.removeLegacy()).rejects.toThrow('進行中');
    const key = listeningPackKey(packs[0]);
    await repos.listening.audio.download(key, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(packs[0].files.length - packs[0].questions.length);
    await repos.listening.finish(old.id, old.revision, now);
    const backup = await repos.backups.exportAll();
    expect(backup.schema_version).toBe(5); expect(SCHEMA_VERSION).toBe(5);
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
    await repos.listening.audio.removeLegacy();
    expect((await repos.listening.audio.status(key)).ready).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    const playable = await repos.listening.audio.source({ title: packs[0].title, packKey: key, file: packs[0].questions[0].file, legacy: false });
    expect(playable.startsWith('blob:')).toBe(true); URL.revokeObjectURL(playable);
    await expect(repos.listening.audio.source({ title: packs[1].title, packKey: listeningPackKey(packs[1]), file: packs[1].questions[0].file, legacy: false })).rejects.toThrow('尚未下載');
    expect((await repos.backups.exportAll()).listening_sessions).toEqual(backup.listening_sessions);
  });
});
