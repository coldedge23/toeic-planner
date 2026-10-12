import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { Modal } from "@/components/Modal";
import { Passage, questionHeading } from "@/components/QuestionParts";
import {
  activeElapsedMs,
  formatDuration,
  isExpired,
  pageUnits,
  remainingMs,
} from "@/domain/exam-engine";
import { PART_LABELS, type OptionKey } from "@/domain/schema";
import { VocabularyCapture } from "@/components/VocabularyCapture";

export function SessionPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const session = await repos.sessions.get(id);
    return session ? { session, answers: await repos.sessions.getAnswers(id), task: session.study_task_id ? await repos.plans.getTask(session.study_task_id) : null } : null;
  }, [id]);

  const [now, setNow] = useState(() => new Date());
  const [pageIndex, setPageIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showPassage, setShowPassage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const session = data?.session;
  const inProgress = session?.status === "in_progress";

  // 作答中點側欄或上一頁時先確認；交卷本身的跳轉不攔
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      inProgress && !submitting.current && currentLocation.pathname !== nextLocation.pathname,
  );

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
  const left = remainingMs(session, now);
  const paused = session.paused_at !== null;
  const page = pages[pageIndex];
  const firstItem = session.question_snapshot[page[0]];

  const goTo = (i: number) => {
    setPageIndex(i);
    setConfirming(false);
    setShowPassage(false);
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
  const timeWarning = left === null || paused ? null : left <= 60_000 ? "剩不到 1 分鐘" : left <= 300_000 ? "剩不到 5 分鐘" : null;
  const unansweredNos = session.question_snapshot
    .map((it, i) => ((selected.get(it.question.id) ?? null) === null ? i : -1))
    .filter((i) => i >= 0);
  const pageOf = (questionIndex: number) => pages.findIndex((idx) => idx.includes(questionIndex));

  const pauseAndLeave = async () => {
    try {
      if (!paused) await repos.sessions.pause(session.id, new Date());
      blocker.proceed?.();
    } catch (err) {
      console.error(err);
      blocker.reset?.();
      setError("暫停失敗，請再試一次");
    }
  };

  const questions = page.map((i, posInGroup) => {
    const { question, group } = session.question_snapshot[i];
    const current = selected.get(question.id) ?? null;
    return (
      <VocabularyCapture key={question.id} question={question} group={group}>
      <fieldset className="question">
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
      </VocabularyCapture>
    );
  });
  const lastPage = pageIndex === pages.length - 1;

  return (
    <div className="session">
      {data.task && <p className="notice">關聯任務：{data.task.title}。交卷後可確認是否完成。</p>}
      <div className="session-bar" role="region" aria-label="作答狀態">
        <span className="num">
          已答 <strong>{answeredCount}</strong>/{total}
        </span>
        <span className="timer-box">
          <span className={`timer num${lowTime ? " low" : ""}`}>
            {left === null ? `已用 ${formatDuration(activeElapsedMs(session, now))}` : `剩 ${formatDuration(left)}`}
          </span>
          {timeWarning && <span className={`timer-warn${lowTime ? " low" : ""}`}>{timeWarning}</span>}
        </span>
        <span className="sr-only" aria-live="assertive">
          {timeWarning && `${timeWarning}，時間到會自動交卷`}
        </span>
        <button type="button" className="btn btn-small" onClick={togglePause}>
          {paused ? "繼續" : "暫停"}
        </button>
        <button type="button" className="btn btn-small btn-primary bar-submit" onClick={() => setConfirming(true)}>
          交卷
        </button>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} labelledBy="confirm-title">
        <h2 id="confirm-title">確定交卷？</h2>
        {unansweredNos.length > 0 ? (
          <>
            <p className="modal-desc num">還有 {unansweredNos.length} 題未作答，未作答的題目會算答錯。點題號可以回去作答：</p>
            <div className="modal-jumps">
              {unansweredNos.map((i) => (
                <button
                  key={i}
                  type="button"
                  className="palette-btn num"
                  aria-label={`回到第 ${i + 1} 題`}
                  onClick={() => goTo(pageOf(i))}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="modal-desc">所有題目都已作答。</p>
        )}
        <p className="modal-desc">交卷後答案會鎖定，不能再修改。</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" data-autofocus onClick={() => void submit()}>
            確定交卷
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            繼續作答
          </button>
        </div>
      </Modal>

      <Modal open={blocker.state === "blocked"} onClose={() => blocker.reset?.()} labelledBy="leave-title">
        <h2 id="leave-title">離開這場測驗？</h2>
        <p className="modal-desc">
          已作答的答案都已儲存。離開時會先暫停計時，之後可以從「模擬考」頁回來繼續作答。
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" data-autofocus onClick={() => void pauseAndLeave()}>
            暫停並離開
          </button>
          <button type="button" className="btn" onClick={() => blocker.reset?.()}>
            繼續作答
          </button>
        </div>
      </Modal>

      {firstItem.group && (
        <Modal open={showPassage} onClose={() => setShowPassage(false)} labelledBy="sheet-title" variant="sheet">
          <div className="sheet-head">
            <h2 id="sheet-title">文章</h2>
            <button type="button" className="btn btn-small" data-autofocus onClick={() => setShowPassage(false)}>
              關閉
            </button>
          </div>
          <Passage group={firstItem.group} question={firstItem.question} />
        </Modal>
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
          <section
            className={`card question-card${firstItem.group ? " with-passage" : ""}`}
            aria-label={`第 ${pageIndex + 1} 頁`}
          >
            <p className="question-meta">{PART_LABELS[firstItem.question.part]}</p>
            {firstItem.group ? (
              // 桌機：左邊文章（獨立捲動）、右邊題目；較窄的畫面改為上下排列，另可從底部抽屜叫出文章
              <div className="split" key={firstItem.group.id}>
                <div className="split-passage" role="region" aria-label="文章" tabIndex={0}>
                  <Passage group={firstItem.group} question={firstItem.question} />
                </div>
                <div className="split-questions">{questions}</div>
              </div>
            ) : (
              questions
            )}
          </section>
        )}

        {/* 桌機：內容下方的換頁列；1023px 以下固定在畫面底部，拇指可及 */}
        <nav className="pager" aria-label="換頁">
          <button type="button" className="btn" disabled={pageIndex === 0 || paused} onClick={() => goTo(pageIndex - 1)}>
            上一頁
          </button>
          {firstItem.group && !paused && (
            <button
              type="button"
              className="btn pager-passage"
              aria-haspopup="dialog"
              onClick={() => setShowPassage(true)}
            >
              文章
            </button>
          )}
          <span className="num pager-pos">
            {pageIndex + 1} / {pages.length}
          </span>
          {!lastPage && (
            <button type="button" className="btn btn-primary" disabled={paused} onClick={() => goTo(pageIndex + 1)}>
              下一頁
            </button>
          )}
          <button
            type="button"
            className={`btn pager-submit${lastPage ? " btn-primary" : " compact-only"}`}
            onClick={() => setConfirming(true)}
          >
            交卷
          </button>
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
