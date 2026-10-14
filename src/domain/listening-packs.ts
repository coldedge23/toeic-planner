import type { ListeningQuestion, ListeningSession } from './schema';

export interface ListeningAudioFile { path: string; bytes: number; sha256: string }
export interface ListeningPlaylist { minutes: number; ids: string[]; duration: number; file: ListeningAudioFile }
export interface ListeningPack {
  id: string; version: number; title: string; description: string; question_ids: string[];
  questions: { id: string; version: number; file: ListeningAudioFile }[];
  playlists: ListeningPlaylist[]; files: ListeningAudioFile[];
}
export interface ListeningPlayback {
  title: string; packKey: string | null; file: ListeningAudioFile; legacy: boolean;
}
export interface ListeningDownloadStatus { ready: boolean; count: number; total: number; bytes: number; available: boolean }
export const listeningPackKey = (pack: Pick<ListeningPack, 'id' | 'version'>) => `${pack.id}-v${pack.version}`;

export function questionsInPack(questions: readonly ListeningQuestion[], pack: ListeningPack) {
  return pack.questions.flatMap(ref => {
    const q = questions.find(q => q.id === ref.id && q.version === ref.version && q.status === 'approved');
    return q ? [q] : [];
  });
}
export function sessionPack(session: ListeningSession, packs: readonly ListeningPack[]): ListeningPack | null {
  return packs.find(p => session.question_snapshot.every(q => p.questions.some(ref => ref.id === q.id && ref.version === q.version))) ?? null;
}
export function playlistFor(pack: ListeningPack, minutes: number) {
  const playlist = pack.playlists.find(p => p.minutes === minutes);
  if (!playlist) throw new Error('題包沒有對應的收聽音檔');
  return playlist;
}
/** 收聽必須逐題、依順序、依版本吻合，不能用新題包替換舊音訊。 */
export function matchesPlaylist(session: ListeningSession, playlist: ListeningPlaylist, versions: readonly { id: string; version: number }[]) {
  return session.question_snapshot.length === playlist.ids.length && session.question_snapshot.every((q, i) =>
    q.id === playlist.ids[i] && versions.some(ref => ref.id === q.id && ref.version === q.version));
}
