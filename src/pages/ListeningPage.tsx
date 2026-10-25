import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/ui';
import { repos } from '@/storage';
import { listeningMistakes, listeningScore, practiceQuestions } from '@/domain/listening';
import { listeningPackKey, playlistFor, questionsInPack, sessionPack, type ListeningDownloadStatus, type ListeningPack } from '@/domain/listening-packs';
import type { ListeningKey, ListeningQuestion, ListeningSession } from '@/domain/schema';
import { toTaipeiDate } from '@/domain/dates';
import { useTaipeiToday } from '@/hooks/useTaipeiToday';

const keys: ListeningKey[] = ['A', 'B', 'C'];
const timeLabel = (seconds: number) => { const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)} 分 ${rounded % 60} 秒`; };
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const cacheLabel = (status?: ListeningDownloadStatus) => !status ? '檢查下載狀態…' : !status.available ? '此瀏覽器無法保存離線音訊' : status.ready ? '已完整下載，可離線播放' : status.count ? `部分已下載（${status.count}／${status.total} 個音檔）` : '尚未下載';

export function ListeningPage() {
  const today = useTaipeiToday();
  const [questions, setQuestions] = useState<ListeningQuestion[]>([]);
  const [packs, setPacks] = useState<ListeningPack[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [cacheStates, setCacheStates] = useState<Record<string, ListeningDownloadStatus>>({});
  const [legacyCache, setLegacyCache] = useState<ListeningDownloadStatus | null>(null);
  const [records, setRecords] = useState<ListeningSession[]>([]);
  const [session, setSession] = useState<ListeningSession | null>(null);
  const current = useRef<ListeningSession | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const saving = useRef(false);
  const pending = useRef(Promise.resolve());
  const lastSave = useRef(0);
  const [mode, setMode] = useState<'answer' | 'listen'>('answer');
  const [minutes, setMinutes] = useState<5 | 10 | 15>(5);
  const [source, setSource] = useState<'all' | 'mistakes'>('all');
  const [audioSrc, setAudioSrc] = useState('');
  const [audioRetry, setAudioRetry] = useState(0);
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [audioOperation, setAudioOperation] = useState<{ key: string; action: 'download' | 'remove'; count: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const update = (s: ListeningSession | null) => { current.current = s; setSession(s); };
  const refresh = async () => {
    const rows = await repos.listening.list();
    setRecords(rows); update(rows.find(s => s.status === 'in_progress') ?? null);
  };
  const refreshCaches = async (catalog = packs) => {
    const statuses = await Promise.all(catalog.map(async p => [listeningPackKey(p), await repos.listening.audio.status(listeningPackKey(p))] as const));
    setCacheStates(Object.fromEntries(statuses));
    setLegacyCache(await repos.listening.audio.legacyStatus());
  };
  useEffect(() => {
    let alive = true;
    Promise.all([repos.listening.questions(), repos.listening.packs(), repos.listening.list()]).then(async ([qs, catalog, rows]) => {
      if (!alive) return;
      setQuestions(qs); setPacks(catalog); setRecords(rows);
      const active = rows.find(s => s.status === 'in_progress') ?? null;
      update(active);
      setSelectedKey(listeningPackKey(active && sessionPack(active, catalog) || catalog[0]));
      const statuses = await Promise.all(catalog.map(async p => [listeningPackKey(p), await repos.listening.audio.status(listeningPackKey(p))] as const));
      const legacy = await repos.listening.audio.legacyStatus();
      if (alive) { setCacheStates(Object.fromEntries(statuses)); setLegacyCache(legacy); }
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : '讀取題包失敗，請重新開啟此頁'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selectedPack = packs.find(p => listeningPackKey(p) === selectedKey) ?? packs[0];
  const activePack = session ? sessionPack(session, packs) : null;
  const activeTitle = activePack?.title ?? '舊版入門題包';
  const q = session?.question_snapshot[session.position];
  const answer = session?.answers.find(a => a.question_id === q?.id);
  useEffect(() => {
    setAudioSrc(''); setHeard(false); lastSave.current = 0;
    if (!session) return;
    let alive = true;
    let objectUrl = '';
    repos.listening.playback(session).then(playback => repos.listening.audio.source(playback)).then(src => {
      objectUrl = src;
      if (alive) setAudioSrc(src);
      else if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : '準備音訊失敗'); });
    return () => { alive = false; player.current?.pause(); if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl); };
  }, [session?.id, q?.id, q?.version, audioRetry]);

  useEffect(() => {
    if (!session || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: `Part 2 ${activeTitle}`, artist: 'TOEIC Planner 原創題包' });
    navigator.mediaSession.setActionHandler('play', () => { player.current?.play().catch(() => setError('請回到練習頁按播放')); });
    navigator.mediaSession.setActionHandler('pause', () => player.current?.pause());
    return () => { navigator.mediaSession.setActionHandler('play', null); navigator.mediaSession.setActionHandler('pause', null); navigator.mediaSession.metadata = null; };
  }, [session?.id, activeTitle]);

  const mutate = (action: (s: ListeningSession) => Promise<ListeningSession>) => {
    const id = current.current?.id;
    const task = pending.current.then(async () => {
      if (!current.current || current.current.id !== id) return;
      saving.current = true; setBusy(true); setError('');
      try {
        const next = await action(current.current);
        if (next.status === 'completed') {
          update(null); setNotice(next.mode === 'listen' ? '本次收聽已結束，不計入作答正確率。' : `本次已保存 ${next.answers.length} 題作答。`);
          setRecords(await repos.listening.list());
        } else { update(next); setRecords(rows => rows.map(row => row.id === next.id ? next : row)); }
      } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重試'); await refresh(); }
      finally { saving.current = false; setBusy(false); }
    });
    pending.current = task.catch(() => { setError('進度讀取失敗，請重新開啟此頁'); });
    return pending.current;
  };
  const savePosition = (force = false) => {
    const s = current.current, audio = player.current;
    if (!s || s.mode !== 'listen' || !audio || !Number.isFinite(audio.currentTime)) return;
    if ((!force && Date.now() - lastSave.current < 5000) || saving.current) return;
    const seconds = audio.currentTime;
    lastSave.current = Date.now();
    void mutate(s => repos.listening.progress(s.id, s.revision, seconds, new Date()));
  };
  const wrongIds = listeningMistakes(records);
  const packQuestions = selectedPack ? questionsInPack(questions, selectedPack) : [];
  const packWrongIds = new Set(packQuestions.filter(q => wrongIds.has(q.id)).map(q => q.id));
  const available = source === 'mistakes' ? packQuestions.filter(q => packWrongIds.has(q.id)) : packQuestions;
  const score = listeningScore(records);
  const todayScore = listeningScore(records.map(s => ({ ...s, answers: s.answers.filter(a => toTaipeiDate(new Date(a.answered_at)) === today) })));
  const playlist = selectedPack ? playlistFor(selectedPack, minutes) : null;
  const start = async () => {
    if (busy || audioOperation || session || !selectedPack || !playlist) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const selected = mode === 'listen' ? playlist.ids.map(id => packQuestions.find(q => q.id === id)!) : practiceQuestions(available, minutes);
      if (!selected.length || selected.some(q => !q)) throw new Error('目前沒有可練習的題目');
      const now = new Date().toISOString();
      const s: ListeningSession = { id: crypto.randomUUID(), created_at: now, updated_at: now, mode, minutes, status: 'in_progress', revision: 0, question_snapshot: selected, position: 0, audio_position: 0, answers: [] };
      await repos.listening.create(s);
      update(s); setRecords(rows => [...rows, s]);
    } catch (e) { setError(e instanceof Error ? e.message : '建立練習失敗'); await refresh(); }
    finally { setBusy(false); }
  };
  const manageAudio = async (key: string, action: 'download' | 'remove') => {
    if (audioOperation) return;
    const pack = packs.find(p => listeningPackKey(p) === key);
    const title = pack?.title ?? '舊版整包';
    const total = pack?.files.length ?? legacyCache?.total ?? 33;
    setAudioOperation({ key, action, count: 0, total }); setError(''); setNotice('');
    try {
      if (action === 'remove') {
        if (key === 'legacy') await repos.listening.audio.removeLegacy();
        else await repos.listening.audio.remove(key);
        setNotice(`已移除「${title}」的離線音訊，作答、錯題及學習紀錄保留。`);
      } else {
        const progress = (count: number, total: number) => setAudioOperation({ key, action, count, total });
        if (key === 'legacy') await repos.listening.audio.downloadLegacy(progress);
        else await repos.listening.audio.download(key, progress);
        setNotice(`「${title}」音訊已完整下載，可離線使用。`);
        if (current.current && !audioSrc) setAudioRetry(v => v + 1);
      }
    } catch (e) {
      if (action === 'remove') setError(`「${title}」音訊未能完全移除，請重新開啟此頁檢查下載狀態；作答與學習紀錄保留。`);
      else if (e instanceof Error && e.name === 'QuotaExceededError') setError(`裝置儲存空間不足，「${title}」下載未完成。已完成的下載保留；請移除不需要的音訊，再按「繼續下載」。`);
      else setError(`「${title}」音訊下載未完成，已完成的下載保留。請確認網路後按「繼續下載」重試。`);
    }
    finally { try { await refreshCaches(); } catch { setError('無法檢查離線音訊，請重新開啟此頁'); } setAudioOperation(null); }
  };
  const protectsPack = (pack: ListeningPack) => !!session && session.question_snapshot.some(q => pack.questions.some(ref => ref.id === q.id && ref.version === q.version));
  if (loading) return <p className="loading">讀取聽力題包…</p>;

  return <>
    <PageHeader title="聽力練習" subtitle="Part 2 應答問題 · 選一包，通勤時練一小段" />
    {error && <p className="notice listening-error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!session ? <section className="card">
      <h2>安排這次練習</h2>
      <label className="field listening-pack-select"><span className="field-label">題包</span><select className="input" value={selectedKey} onChange={e => { setSelectedKey(e.target.value); setSource('all'); }} disabled={!!audioOperation}>
        {packs.map(pack => <option value={listeningPackKey(pack)} key={listeningPackKey(pack)}>{pack.title} · {pack.question_ids.length} 題</option>)}
      </select></label>
      {selectedPack && <p className="listening-pack-summary">{selectedPack.description}<br/>{sizeLabel(selectedPack.files.reduce((sum, f) => sum + f.bytes, 0))} · <span role="status">{cacheLabel(cacheStates[selectedKey])}</span></p>}
      <div className="listening-settings">
        <label className="field"><span className="field-label">練習模式</span><select className="input" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setSource('all'); }}>
          <option value="answer">搭車作答 · 聽題後選答案</option><option value="listen">連續收聽 · 題目、停頓、答案解說</option></select></label>
        <label className="field"><span className="field-label">通勤時間</span><select className="input" value={minutes} onChange={e => setMinutes(Number(e.target.value) as typeof minutes)}>
          <option value={5}>5 分鐘</option><option value={10}>10 分鐘</option><option value={15}>15 分鐘</option></select></label>
        {mode === 'answer' && <label className="field"><span className="field-label">題目來源</span><select className="input" value={source} onChange={e => setSource(e.target.value as typeof source)}>
          <option value="all">此題包全部題目</option><option value="mistakes">此題包錯題（{packWrongIds.size} 題）</option></select></label>}
      </div>
      <p className="notice">{mode === 'listen' && playlist ? `播放 ${playlist.ids.length} 題，實際約 ${timeLabel(playlist.duration)}，不重複湊滿 ${minutes} 分鐘。每題保留 5 秒思考，接著播放英文答案與解說；連續收聽不計分。請在出發前設定並按播放。` : `預計 ${Math.min(minutes, available.length)} 題，含作答與檢討約 ${Math.min(minutes, available.length)} 分鐘；時間為估計，不強制交卷。${available.length < minutes ? '可用題目不足，不重複抽題。' : ''}`}</p>
      {!cacheStates[selectedKey]?.ready && <p className="field-hint">可先連線試聽；離線通勤前請下載所選題包，並開啟一次此頁。</p>}
      <div className="listening-start-actions">
        <button className="btn btn-primary listening-start" disabled={busy || !!audioOperation || !selectedPack || (mode === 'answer' && !available.length)} onClick={() => void start()}>開始{mode === 'answer' ? '聽力練習' : '連續收聽'}</button>
        {selectedPack && !cacheStates[selectedKey]?.ready && <button className="btn" disabled={!!audioOperation || !cacheStates[selectedKey]?.available} onClick={() => void manageAudio(selectedKey, 'download')}>下載此題包</button>}
      </div>
    </section> : <section className="card listening-player">
      <div className="listening-session-head"><h2>{session.mode === 'answer' ? `第 ${session.position + 1}／${session.question_snapshot.length} 題` : `連續收聽 · ${session.question_snapshot.length} 題`}</h2><span>進度自動保存</span></div>
      <p className="card-desc">{activeTitle} · {session.mode === 'answer' ? '聽完整問句與三個口語選項，再作答。' : '題目、5 秒思考與英文答案解說；中斷後回來續聽。'}</p>
      {!activePack && <p className="field-hint">沿用原本的題目、音檔與進度；結束本次後即可選擇新題包。</p>}
      {audioSrc ? <audio ref={player} controls preload="metadata" src={audioSrc} aria-label="Part 2 聽力播放器"
        onLoadedMetadata={() => { const s = current.current; if (s?.mode === 'listen' && player.current) player.current.currentTime = Math.min(s.audio_position, player.current.duration || 0); }}
        onTimeUpdate={() => savePosition()} onPause={() => savePosition(true)}
        onEnded={() => { if (current.current?.mode === 'answer') setHeard(true); else { player.current?.pause(); void mutate(s => repos.listening.finish(s.id, s.revision, new Date())); } }}
        onError={() => { setAudioSrc(''); setError('音訊無法播放，請連線後下載對應題包，再按「重新準備音訊」續練。'); }} /> : <div><p role="status">尚未準備好音訊。若離線檔案缺少，請在下方下載題包。</p><button className="btn" disabled={busy || !!audioOperation} onClick={() => { setError(''); setAudioRetry(v => v + 1); }}>重新準備音訊</button></div>}
      {session.mode === 'answer' && q && <>
        <div className="listening-answers" role="group" aria-label="選擇口語答案">
          {keys.map(key => <button key={key} className={`btn listening-choice ${answer ? 'listening-answered' : ''} ${answer?.selected === key ? 'listening-selected' : ''}`} disabled={busy || !heard || !!answer} onClick={() => { player.current?.pause(); void mutate(s => repos.listening.answer(s.id, s.revision, key, new Date())); }} aria-label={`選擇 ${key}`}>
            <span>{key}</span>{answer && <span lang="en">{q.options[key]}</span>}{answer?.selected === key && <span>你的答案</span>}
          </button>)}
        </div>
        {!heard && !answer && <p className="field-hint">完整播放後會開放作答；逐字稿會在作答後顯示。</p>}
        {answer && <div className={`listening-review ${answer.selected === q.correct_key ? 'listening-correct' : 'listening-wrong'}`}>
          <h3>{answer.selected === q.correct_key ? '答對' : '答錯'} · 正確答案 {q.correct_key}</h3>
          <p lang="en" className="listening-transcript">{q.prompt}</p><p>{q.explanation_zh}</p><p className="field-hint">考點：{q.tag}</p>
          <button className="btn" disabled={busy} onClick={() => { player.current?.pause(); void mutate(s => repos.listening.next(s.id, s.revision, new Date())); }}>{session.position + 1 === session.question_snapshot.length ? '完成本次練習' : '下一題'}</button>
        </div>}
      </>}
      <div className="listening-end"><Link className="btn" to="/today" onClick={() => player.current?.pause()}>暫停，稍後續練</Link>
      <button className="btn" disabled={busy} onClick={() => { player.current?.pause(); void mutate(s => repos.listening.finish(s.id, s.revision, new Date())); }}>結束本次練習</button></div>
    </section>}

    <section className="card" aria-label="離線題包管理"><h2>離線題包</h2><p className="card-desc">共 {questions.filter(q => q.status === 'approved').length} 題原創美式英語合成音訊。只下載需要的包；移除音訊保留學習紀錄。</p>
      <ul className="listening-pack-list">{packs.map(pack => {
        const key = listeningPackKey(pack), status = cacheStates[key];
        const operation = audioOperation?.key === key ? audioOperation : null;
        const protectedPack = protectsPack(pack);
        return <li key={key} className="listening-pack-row">
          <div><h3>{pack.title}{!session && selectedKey === key && <span className="listening-pack-current">目前選用</span>}</h3>
            <p>{pack.description}</p><p className="field-hint">{pack.question_ids.length} 題 · {sizeLabel(pack.files.reduce((sum, f) => sum + f.bytes, 0))} · 版本 {pack.version}</p>
            <p role="status">{operation ? operation.action === 'download' ? `正在檢查／下載 ${operation.count}／${operation.total}` : '正在移除音訊…' : cacheLabel(status)}</p>
            {protectedPack && <p className="field-hint">本次練習使用此包，結束後可移除音訊。</p>}
          </div>
          <div className="listening-pack-actions">
            <button className="btn" aria-label={`選用${pack.title}`} aria-pressed={selectedKey === key} disabled={!!session || !!audioOperation} onClick={() => { setSelectedKey(key); setSource('all'); setNotice(''); }}>選用此包</button>
            <button className="btn" aria-label={`下載${pack.title}題包`} disabled={!!audioOperation || !status?.available} onClick={() => void manageAudio(key, 'download')}>{status?.ready ? '檢查／重新下載' : status?.count ? '繼續下載' : '下載音訊'}</button>
            <button className="btn" aria-label={`移除${pack.title}音訊`} disabled={!!audioOperation || protectedPack || !status?.count} onClick={() => void manageAudio(key, 'remove')}>移除音訊</button>
          </div>
        </li>;
      })}</ul>
      {(!!legacyCache?.count || !!session && !activePack) && <div className="listening-legacy">
        <h3>舊版整包音訊</h3><p className="field-hint">保留供舊練習續答；新題包會沿用可用的單題音檔。各新包下載完成後，可移除此舊包節省空間。</p>
        <p role="status">{audioOperation?.key === 'legacy' ? `正在處理 ${audioOperation.count}／${audioOperation.total}` : `舊版快取 ${legacyCache?.count ?? 0}／${legacyCache?.total ?? 33} 個音檔，${sizeLabel(legacyCache?.bytes ?? 0)}`}</p>
        {!!session && !activePack && <button className="btn" disabled={!!audioOperation} onClick={() => void manageAudio('legacy', 'download')}>補下載舊版音訊</button>}
        <button className="btn" disabled={!!audioOperation || !!session || !legacyCache?.count} onClick={() => void manageAudio('legacy', 'remove')}>移除舊版整包音訊</button>
      </div>}
    </section>
    <section className="card"><h2>聽力紀錄</h2><p>今日已作答 {todayScore.total} 題 · 答對 {todayScore.correct} 題</p>
      <p>累計作答 {score.total} 題，答對 {score.correct} 題{score.total ? `，正確率 ${Math.round(score.correct / score.total * 100)}%` : ''}。待複習錯題 {wrongIds.size} 題。</p>
      <p className="field-hint">聽力與閱讀分開統計。連續收聽不影響正確率或錯題；這些數據不是官方多益分數。</p>
    </section>
    <p className="field-hint">iPhone 首次播放請手動按播放；鎖屏、來電或切換 App 後若停止，回到此頁續聽。出門前確認所選題包已下載。學習紀錄可從設定頁備份，音訊需另行下載。</p>
  </>;
}
