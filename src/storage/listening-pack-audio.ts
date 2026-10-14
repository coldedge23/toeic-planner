import manifest from '@/fixtures/listening-audio.json';
import packData from '@/fixtures/listening-pack-audio.json';
import { listeningPackKey, matchesPlaylist, playlistFor, sessionPack, type ListeningAudioFile, type ListeningDownloadStatus, type ListeningPack, type ListeningPlayback } from '@/domain/listening-packs';
import type { ListeningSession } from '@/domain/schema';

export const listeningPacks: ListeningPack[] = packData;
const legacyCache = 'toeic-listening-part2-v1';
const legacyFiles: ListeningAudioFile[] = manifest.files.map(f => ({ ...f, path: `audio/part2-v1/${f.name}` }));
const url = (file: ListeningAudioFile) => `${import.meta.env.BASE_URL}${file.path}`;
const cacheName = (key: string | null) => key ? `toeic-listening-pack-${key}` : legacyCache;
const getPack = (key: string) => {
  const pack = listeningPacks.find(p => listeningPackKey(p) === key);
  if (!pack) throw new Error('找不到這個題包版本，請更新 App');
  return pack;
};

async function verified(response: Response, file: ListeningAudioFile): Promise<Response> {
  if (!response.ok || response.status !== 200) throw new Error('音訊下載失敗，請確認網路後重試');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== file.bytes) throw new Error('音訊下載不完整，請重新下載');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== file.sha256) throw new Error('音訊版本不符，請重新下載');
  return new Response(buffer, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buffer.byteLength) } });
}

async function cachedFile(file: ListeningAudioFile, key: string | null) {
  if (!('caches' in globalThis)) return null;
  const names = key ? [cacheName(key), legacyCache] : [legacyCache];
  for (const name of names) {
    const candidate = await (await caches.open(name)).match(url(file));
    if (candidate) { try { return await verified(candidate, file); } catch { /* 重抓本檔，其他檔案保留。 */ } }
  }
  return null;
}
async function status(files: readonly ListeningAudioFile[], key: string | null): Promise<ListeningDownloadStatus> {
  if (!('caches' in globalThis)) return { ready: false, count: 0, total: files.length, bytes: 0, available: false };
  let count = 0, bytes = 0;
  for (const file of files) if (await cachedFile(file, key)) { count++; bytes += file.bytes; }
  return { ready: count === files.length, count, total: files.length, bytes, available: true };
}
const operations = new Map<string, Promise<void>>();
function exclusive(key: string | null, work: () => Promise<void>) {
  const name = cacheName(key);
  const next = (operations.get(name) ?? Promise.resolve()).catch(() => {}).then(work);
  operations.set(name, next);
  void next.finally(() => { if (operations.get(name) === next) operations.delete(name); }).catch(() => {});
  return next;
}
async function downloadFiles(files: readonly ListeningAudioFile[], key: string | null, progress: (count: number, total: number) => void) {
  if (!('caches' in globalThis)) throw new Error('此瀏覽器無法保存離線音訊，請使用 HTTPS 網址或本機預覽');
  return exclusive(key, async () => {
    const cache = await caches.open(cacheName(key));
    let count = 0;
    for (const file of files) {
      // 沿用經驗證的舊版單題，但複製到各包，移除舊包不影響已下載的新包。
      const cached = await cachedFile(file, key);
      await cache.put(url(file), cached ?? await verified(await fetch(url(file), { cache: 'no-store' }), file));
      progress(++count, files.length);
    }
  });
}

export function resolveListeningPlayback(session: ListeningSession): ListeningPlayback {
  const pack = sessionPack(session, listeningPacks);
  if (session.mode === 'answer') {
    const q = session.question_snapshot[session.position];
    const owner = listeningPacks.find(p => p.questions.some(ref => ref.id === q?.id && ref.version === q?.version));
    const file = owner?.questions.find(ref => ref.id === q?.id && ref.version === q?.version)?.file;
    if (!owner || !file) throw new Error('找不到作答當時的音訊版本；既有紀錄保留，請更新 App');
    return { title: pack?.title ?? '舊版入門題包', packKey: listeningPackKey(owner), file, legacy: !pack };
  }
  if (pack) {
    const playlist = playlistFor(pack, session.minutes);
    if (matchesPlaylist(session, playlist, pack.questions)) return { title: pack.title, packKey: listeningPackKey(pack), file: playlist.file, legacy: false };
  }
  const previous = manifest.playlists.find(p => p.minutes === session.minutes && matchesPlaylist(session, { ...p, file: { path: '', bytes: 0, sha256: '' } }, manifest.tracks.map(t => ({ id: t.id, version: 1 }))));
  const file = previous && legacyFiles.find(f => f.path.endsWith(`/${previous.name}`));
  if (!file) throw new Error('找不到原本的連續收聽音檔；既有紀錄保留，請更新 App');
  return { title: '舊版入門題包', packKey: null, file, legacy: true };
}

export const listeningAudio = {
  async status(key: string) { return status(getPack(key).files, key); },
  async legacyStatus() { return status(legacyFiles, null); },
  async download(key: string, progress: (count: number, total: number) => void) { return downloadFiles(getPack(key).files, key, progress); },
  async downloadLegacy(progress: (count: number, total: number) => void) { return downloadFiles(legacyFiles, null, progress); },
  async remove(key: string) {
    const pack = getPack(key);
    if (!('caches' in globalThis)) return;
    await exclusive(key, async () => {
      await caches.delete(cacheName(key));
      // 各包單題互不重疊；移除其舊快取副本，避免移除後仍占用空間。
      const old = await caches.open(legacyCache);
      for (const q of pack.questions) await old.delete(url(q.file));
    });
  },
  async removeLegacy() { if ('caches' in globalThis) await exclusive(null, async () => { await caches.delete(legacyCache); }); },
  /** Blob URL 支援離線 seek；只接受目錄中的音檔，不能替換進行中的舊版音訊。 */
  async source(playback: ListeningPlayback) {
    const known = [...legacyFiles, ...listeningPacks.flatMap(p => p.files)].some(f => f.path === playback.file.path && f.sha256 === playback.file.sha256);
    if (!known) throw new Error('找不到音訊版本，請更新 App');
    const cached = await cachedFile(playback.file, playback.packKey);
    if (cached) return URL.createObjectURL(await cached.blob());
    if (globalThis.navigator?.onLine === false) throw new Error('這個音訊尚未下載或已被清除；請連線後下載對應題包再續練');
    return url(playback.file);
  },
};
