import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { Passage, questionHeading } from "@/components/QuestionParts";
import {
  activeElapsedMs,
  formatDuration,
  isExpired,
  pageUnits,
  remainingMs,
} from "@/domain/exam-engine";
import { PART_LABELS, type OptionKey } from "@/domain/schema";

export function SessionPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const session = await repos.sessions.get(id);
    return session ? { session, answers: await repos.sessions.getAnswers(id) } : null;
  }, [id]);

  const [now, setNow] = useState(() => new Date());
  const [pageIndex, setPageIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const session = data?.session;
  const pages = useMemo(() => (session ? pageUnits(session) : []), [session]);
  const selected = useMemo(
    () => new Map((data?.answers ?? []).map((a) => [a.question_id, a.selected_key])),
    [data?.answers],
  );

  const submit = async () => {
    if (!session || submitting.current) return;
    submitting.current = true;
    try {
      await repos.sessions.submit(session.id, new Date());
      navigate(`/sessions/${session.id}/result`, { replace: true });
    } catch (err) {
      console.error(err);
      setError("交卷失敗，作答內容仍保留，請再按一次交卷");
      submitting.current = false;
    }
  };

  // 以截止時間計算倒數：切到背景或重新整理後回來，剩餘時間仍正確；時間到自動交卷
  useEffect(() => {
    if (!session || session.status !== "in_progress") return;
    const tick = () => {
      const t = new Date();
      setNow(t);
      if (isExpired(session, t)) void submit();
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [session]);

  // 重新整理後從第一個尚未作答的頁面繼續
  useEffect(() => {
    if (pageIndex !== null || !session || !data) return;
    const first = pages.findIndex((idx) =>
      idx.some((i) => (selected.get(session.question_snapshot[i].question.id) ?? null) === null),
    );
    setPageIndex(first === -1 ? 0 : first);
  }, [pageIndex, session, data, pages, selected]);

  if (data === undefined || pageIndex === null) {
    return data === null ? <Missing /> : <p className="loading">讀取中…</p>;
  }
  if (data === null || !session) return <Missing />;
  if (session.status === "submitted") return <Navigate to={`/sessions/${session.id}/result`} replace />;

  const total = session.question_snapshot.length;
  const answeredCount = session.question_snapshot.filter((it) => (selected.get(it.question.id) ?? null) !== null).length;
  const unanswered = total - answeredCount;
  const left = remainingMs(session, now);
  const paused = session.paused_at !== null;
  const page = pages[pageIndex];
  const firstItem = session.question_snapshot[page[0]];

  const goTo = (i: number) => {
    setPageIndex(i);
    setConfirming(false);
    contentRef.current?.scrollIntoView({ block: "start" });
  };

  const choose = async (questionId: string, key: OptionKey) => {
    setError(null);
    try {
      await repos.sessions.saveAnswer({
        sessionId: session.id,
        questionId,
        selectedKey: key,
        elapsedMs: activeElapsedMs(session, new Date()),
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "答案儲存失敗，請再選一次");
    }
  };

  const togglePause = async () => {
    try {
      if (paused) await repos.sessions.resume(session.id, new Date());
      else await repos.sessions.pause(session.id, new Date());
    } catch (err) {
      console.error(err);
      setError("操作失敗，請再試一次");
    }
  };

  const lowTime = left !== null && left <= 60_000;

  return (
    <div className="session">
      <div className="session-bar" role="region" aria-label="作答狀態">
        <span className="num">
          已答 <strong>{answeredCount}</strong>/{total}
        </span>
        <span className={`timer num${lowTime ? " low" : ""}`} aria-label="剩餘時間">
          {left === null ? `已用 ${formatDuration(activeElapsedMs(session, now))}` : `剩 ${formatDuration(left)}`}
        </span>
        <button type="button" className="btn btn-small" onClick={togglePause}>
          {paused ? "繼續" : "暫停"}
        </button>
        <button type="button" className="btn btn-small btn-primary" onClick={() => setConfirming(true)}>
          交卷
        </button>
      </div>

      {confirming && (
        <div className="card card-emphasis" role="alertdialog" aria-labelledby="confirm-title">
          <h2 id="confirm-title">確定交卷？</h2>
          <p className="card-desc num">
            {unanswered > 0 ? `還有 ${unanswered} 題未作答，未作答的題目會算答錯。` : "所有題目都已作答。"}
            交卷後答案會鎖定，不能再修改。
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary" onClick={() => void submit()}>
              確定交卷
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              繼續作答
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      )}

      <div ref={contentRef} className="session-body">
        {paused ? (
          <section className="card paused-card">
            <h2>已暫停</h2>
            <p className="card-desc">暫停期間不計時，題目暫時隱藏。</p>
            <button type="button" className="btn btn-primary" onClick={togglePause}>
              繼續作答
            </button>
          </section>
        ) : (
          <section className="card question-card" aria-label={`第 ${pageIndex + 1} 頁`}>
            <p className="question-meta">{PART_LABELS[firstItem.question.part]}</p>
            {firstItem.group && <Passage group={firstItem.group} />}
            {page.map((i, posInGroup) => {
              const { question } = session.question_snapshot[i];
              const current = selected.get(question.id) ?? null;
              return (
                <fieldset key={question.id} className="question">
                  <legend className="question-stem">
                    <span className="q-no num">{i + 1}.</span>
                    {questionHeading(question, posInGroup)}
                  </legend>
                  <div className="options">
                    {question.options.map((o) => (
                      <label key={o.key} className={`option${current === o.key ? " chosen" : ""}`}>
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          checked={current === o.key}
                          onChange={() => void choose(question.id, o.key)}
                        />
                        <span className="option-key">{o.key}</span>
                        <span className="option-text">{o.text}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </section>
        )}

        <nav className="pager" aria-label="換頁">
          <button type="button" className="btn" disabled={pageIndex === 0 || paused} onClick={() => goTo(pageIndex - 1)}>
            上一頁
          </button>
          <span className="num pager-pos">
            {pageIndex + 1} / {pages.length}
          </span>
          {pageIndex < pages.length - 1 ? (
            <button type="button" className="btn btn-primary" disabled={paused} onClick={() => goTo(pageIndex + 1)}>
              下一頁
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
              交卷
            </button>
          )}
        </nav>

        <div className="palette" aria-label="題號">
          {pages.map((idx, p) => (
            <span key={p} className="palette-page">
              {idx.map((i) => {
                const done = (selected.get(session.question_snapshot[i].question.id) ?? null) !== null;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={paused}
                    className={`palette-btn num${done ? " done" : ""}${p === pageIndex ? " here" : ""}`}
                    aria-label={`第 ${i + 1} 題，${done ? "已作答" : "未作答"}`}
                    aria-current={p === pageIndex ? "step" : undefined}
                    onClick={() => goTo(p)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Missing() {
  return (
    <p className="notice">
      找不到這場測驗。<Link to="/mock">回到模擬考</Link>
    </p>
  );
}
