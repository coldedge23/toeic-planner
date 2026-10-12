import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { PageHeader } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { VocabularyForm } from "@/components/VocabularyForm";
import { VocabularyLibrary } from "@/components/VocabularyLibrary";
import { Passage, questionHeading } from "@/components/QuestionParts";
import { useTaipeiToday } from "@/hooks/useTaipeiToday";
import { VOCABULARY_RATINGS } from "@/domain/vocabulary";
import type { VocabularyRating, VocabularyWord } from "@/domain/schema";

export function VocabularyPage() {
  const [params, setParams] = useSearchParams();
  const today = useTaipeiToday();
  const data = useLiveQuery(async () => ({ words: await repos.vocabulary.list(), settings: await repos.vocabulary.settings(), daily: await repos.vocabulary.daily(today) }), [today]);
  const [form, setForm] = useState<"new" | VocabularyWord | null>(null);
  const [source, setSource] = useState<VocabularyWord | null>(null);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<{ word: VocabularyWord; reviewId: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const [limits, setLimits] = useState<{ review_limit: string; new_limit: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const start = () => {
    if (!data) return;
    setQueue(data.daily.queue.map((word) => ({ word, reviewId: crypto.randomUUID() })));
    setIndex(0); setRevealed(false); setError(null);
    setParams({ review: "1" }, { replace: true });
  };
  useEffect(() => { if (params.get("review") === "1" && data && queue === null) start(); }, [params, data]);
  useEffect(() => { if (queue !== null) reviewRef.current?.scrollIntoView({ block: "start" }); }, [queue]);
  const current = queue?.[index];
  const rate = async (rating: VocabularyRating) => {
    if (!current || !revealed || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      await repos.vocabulary.review({ wordId: current.word.id, rating, reviewId: current.reviewId, expectedUpdatedAt: current.word.updated_at, now: new Date() });
      setIndex((i) => i + 1); setRevealed(false);
    } catch (err) { setError(err instanceof Error ? err.message : "複習儲存失敗，可再試一次"); }
    finally { sending.current = false; setBusy(false); }
  };
  const finish = () => { setQueue(null); setParams({}, { replace: true }); setRevealed(false); setError(null); };
  const saveLimits = async () => {
    if (!limits) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      await repos.vocabulary.saveSettings({ review_limit: Number(limits.review_limit), new_limit: Number(limits.new_limit) });
      setLimits(null); setNotice("已更新每日量，已練習的紀錄保留");
    } catch { setError("每日複習請填 1–100，新字請填 0–30 的整數"); }
    finally { setBusy(false); }
  };
  if (!data) return <p className="loading">讀取單字本…</p>;
  const matching = data.words.filter((w) => `${w.term} ${w.meaning_zh}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.term.localeCompare(b.term));
  return (
    <>
      <PageHeader title="單字本" subtitle="收錄閱讀中的單字，回想後翻面，再安排下次複習" />
      {queue !== null ? (
        <section ref={reviewRef} className="card vocab-review" aria-labelledby="vocab-review-title">
          <h2 id="vocab-review-title">今日單字複習</h2>
          <p className="card-desc num">已完成 {index}/{queue.length} 個。離開或重整後，已評定的紀錄會保留。</p>
          {current ? <>
            <p className="vocab-term" lang="en">{current.word.term}</p>
            {!revealed ? <><p className="notice">先回想中文意思，再翻面檢查。</p><button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>翻面看解釋</button></>
              : <>
                <p className="vocab-meaning">{current.word.part_of_speech && <span className="tag">{current.word.part_of_speech}</span>} {current.word.meaning_zh}</p>
                {current.word.example && <p className="vocab-example" lang="en">{current.word.example}</p>}
                {current.word.source && <button type="button" className="btn btn-small" onClick={() => setSource(current.word)}>查看來源題目</button>}
                <p className="field-hint">依這次回想情況評定；不熟隔天複習，有印象至少 3 天，熟悉至少 7 天，之後逐步延長。</p>
                <div className="actions">{(Object.keys(VOCABULARY_RATINGS) as VocabularyRating[]).map((rating) => <button key={rating} type="button" className="btn" disabled={busy} onClick={() => void rate(rating)}>{VOCABULARY_RATINGS[rating]}</button>)}</div>
              </>}
            <div className="actions"><button type="button" className="btn" disabled={busy} onClick={finish}>先結束，保留進度</button></div>
          </> : <><p className="notice" role="status">{queue.length ? "本次單字複習已完成。" : "目前沒有可安排的單字，請新增單字或調整每日量。"}</p><div className="actions"><button type="button" className="btn" onClick={finish}>返回單字本</button><Link className="btn" to="/today">返回今日</Link></div></>}
          {error && <p className="notice notice-warn" role="alert">{error}</p>}
        </section>
      ) : <section className="card">
        <h2>每日複習</h2>
        <p className="card-desc num">到期 {data.daily.due} 個・新字 {data.daily.fresh} 個・今日已練習 {data.daily.reviewedToday} 個</p>
        <p className="notice">先複習到期字，再加入新字。每日最多複習 {data.settings.review_limit} 個到期字、加入 {data.settings.new_limit} 個新字；這是 App 的簡單排程規則。</p>
        <div className="actions"><button type="button" className="btn btn-primary" disabled={!data.daily.queue.length} onClick={start}>開始今日複習（{data.daily.queue.length} 個）</button>
          <button type="button" className="btn" onClick={() => setForm("new")}>手動新增單字</button>
          <button type="button" className="btn" onClick={() => { setError(null); setLimits({ review_limit: String(data.settings.review_limit), new_limit: String(data.settings.new_limit) }); }}>調整每日量</button></div>
        {notice && <p role="status" className="status-msg ok">{notice}</p>}
        {data.daily.queue.length === 0 && data.daily.due + data.daily.fresh > 0 && <p className="field-hint">今天的設定量已完成；增加每日量後可以繼續，或明天再練習。</p>}
      </section>}
      {queue === null && <VocabularyLibrary words={data.words} />}
      {queue === null && <section className="card">
        <h2>我的單字（{data.words.length} 個）</h2>
        <label className="field"><span className="field-label">搜尋英文或中文意思</span><input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        {!matching.length && <p className="notice">{data.words.length ? "沒有符合的單字。" : "尚未收錄單字。可先加入上方入門包、匯入 CSV，也能從題目收錄或手動新增。"}</p>}
        <ul className="vocab-list">{matching.map((word) => <li key={word.id}>
          <div><strong lang="en">{word.term}</strong><p className="vocab-meaning">{word.meaning_zh}</p><p className="field-hint num">{word.state === "new" ? "新字" : `下次複習 ${word.due_date}`}・已練習 {word.review_count} 次</p></div>
          <div className="actions"><button type="button" className="btn btn-small" onClick={() => setForm(word)}>編輯 {word.term}</button>{word.source && <button type="button" className="btn btn-small" onClick={() => setSource(word)}>來源 {word.term}</button>}</div>
        </li>)}</ul>
      </section>}
      <Modal open={form !== null} onClose={() => setForm(null)} labelledBy="vocab-form-title">
        <h2 id="vocab-form-title">{form === "new" ? "新增單字" : "編輯單字"}</h2>
        <VocabularyForm existing={form && form !== "new" ? form : undefined} onSaved={() => { setForm(null); setNotice("單字已儲存"); }} onCancel={() => setForm(null)} />
      </Modal>
      <Modal open={source !== null} onClose={() => setSource(null)} labelledBy="vocab-source-title">
        <h2 id="vocab-source-title">{source?.term} 的來源題目</h2>
        {source?.source && <><p className="card-desc">{source.source.question.source_id}｜收錄時的快照</p>
          {source.source.group && <Passage group={source.source.group} />}
          <p className="question-stem">{questionHeading(source.source.question, 0)}</p>
          <ul>{source.source.question.options.map((o) => <li key={o.key} lang="en">{o.key}. {o.text}</li>)}</ul>
          <p>{source.source.question.explanation_zh}</p></>}
        <div className="actions"><button type="button" className="btn" data-autofocus onClick={() => setSource(null)}>關閉</button></div>
      </Modal>
      <Modal open={limits !== null} onClose={() => setLimits(null)} labelledBy="vocab-limits-title">
        <h2 id="vocab-limits-title">每日單字量</h2>
        <p className="card-desc">降低上限不會刪除紀錄；增加上限後，今天可繼續練習。</p>
        {limits && <div className="vocab-form">
          <label className="field"><span className="field-label">每日到期字上限（1–100）</span><input className="input" type="number" min={1} max={100} value={limits.review_limit} onChange={(e) => setLimits({ ...limits, review_limit: e.target.value })} /></label>
          <label className="field"><span className="field-label">每日新字上限（0–30）</span><input className="input" type="number" min={0} max={30} value={limits.new_limit} onChange={(e) => setLimits({ ...limits, new_limit: e.target.value })} /></label>
          {error && <p className="notice notice-warn" role="alert">{error}</p>}
          <div className="actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveLimits()}>儲存每日量</button><button type="button" className="btn" disabled={busy} onClick={() => setLimits(null)}>取消</button></div>
        </div>}
      </Modal>
    </>
  );
}
