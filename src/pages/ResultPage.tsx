import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader } from "@/components/ui";
import { Passage, questionHeading } from "@/components/QuestionParts";
import { repos } from "@/storage";
import {
  activeElapsedMs,
  buildSession,
  formatDuration,
  formatPercent,
  formatPointDelta,
  gradeSession,
  previousComparable,
  selectQuestions,
  type GradedItem,
} from "@/domain/exam-engine";
import { PART_LABELS, READING_PARTS } from "@/domain/schema";
import { CheckIcon, CrossIcon } from "@/components/ui";


function ReviewItem({ item, total, posInGroup }: { item: GradedItem; total: number; posInGroup: number }) {
  const { question, selected, isCorrect } = item;
  return (
    <article className={`review-item ${isCorrect ? "is-correct" : "is-wrong"}`}>
      <header className="review-head">
        <span className="num">
          {item.index + 1} / {total}
        </span>
        <span className={`verdict ${isCorrect ? "ok" : "bad"}`}>
          {isCorrect ? <CheckIcon /> : <CrossIcon />}
          {isCorrect ? "答對" : selected === null ? "未作答" : "答錯"}
        </span>
        <span className="review-part">{PART_LABELS[question.part]}</span>
      </header>
      <p className="question-stem">{questionHeading(question, posInGroup)}</p>
      <ul className="options review-options">
        {question.options.map((o) => {
          const isAnswer = o.key === question.correct_key;
          const isPicked = o.key === selected;
          const cls = isAnswer ? " answer" : isPicked ? " picked-wrong" : "";
          return (
            <li key={o.key} className={`option${cls}`}>
              <span className="option-key">{o.key}</span>
              <span className="option-text" lang="en">
                {o.text}
              </span>
              {isAnswer && (
                <span className="option-flag ok">
                  <CheckIcon />
                  正解{isPicked ? "（你的答案）" : ""}
                </span>
              )}
              {isPicked && !isAnswer && (
                <span className="option-flag bad">
                  <CrossIcon />
                  你的答案
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* 答錯的題目預設展開解析；答對的收合，需要時再點開 */}
      <details className="explanation" open={!isCorrect}>
        <summary>解析</summary>
        <p>{question.explanation_zh}</p>
      </details>
    </article>
  );
}

export function ResultPage() {
  const { id = "" } = useParams();
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const session = await repos.sessions.get(id);
    if (!session) return null;
    const answers = await repos.sessions.getAnswers(id);
    const prev = previousComparable(await repos.sessions.listSubmitted(), session);
    const prevAttempts = prev ? await repos.sessions.listAttempts(prev.id) : [];
    const previous =
      prev && prevAttempts.length
        ? { session: prev, accuracy: prevAttempts.filter((a) => a.is_correct).length / prevAttempts.length }
        : null;
    return { session, answers, previous };
  }, [id]);

  if (data === undefined) return <p className="loading">讀取中…</p>;
  if (data === null) {
    return (
      <p className="notice">
        找不到這場測驗。<Link to="/mock">回到模擬考</Link>
      </p>
    );
  }
  const { session, answers, previous } = data;
  if (session.status !== "submitted") return <Navigate to={`/sessions/${session.id}`} replace />;

  const result = gradeSession(session, answers);
  const retryQuery = new URLSearchParams({
    source: session.source,
    parts: session.parts.join(","),
    count: String(result.total),
    sec: session.seconds_per_question === null ? "none" : String(session.seconds_per_question),
  });
  const shown = onlyWrong ? result.items.filter((i) => !i.isCorrect) : result.items;
  const wrongItems = result.items.filter((i) => !i.isCorrect);
  const wrong = wrongItems.length;

  // 只重做這場答錯（含未作答）的題目；同題組的文章會一起附上
  const reviewWrong = async () => {
    setError(null);
    const config = {
      source: "mistakes" as const,
      parts: READING_PARTS.filter((p) => wrongItems.some((i) => i.question.part === p)),
      count: wrong,
      secondsPerQuestion: session.seconds_per_question,
    };
    const groups = [...new Map(wrongItems.flatMap((i) => (i.group ? [[i.group.id, i.group] as const] : []))).values()];
    const picked = selectQuestions(
      wrongItems.map((i) => i.question),
      groups,
      config,
    );
    if (!picked.ok) {
      setError("無法建立複習測驗，請改從錯題本出題");
      return;
    }
    setBusy(true);
    try {
      const next = buildSession(config, picked.items, new Date(), () => crypto.randomUUID());
      await repos.sessions.create(next);
      navigate(`/sessions/${next.id}`);
    } catch (err) {
      console.error(err);
      setError("目前有一場測驗尚未交卷，請先到模擬考頁完成或交卷");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="模擬考" subtitle="交卷結果與逐題檢討" />

      <section className="card score-card">
        <div className="score-main">
          <span className="score-value num">{formatPercent(result.accuracy)}</span>
          <div>
            <p className="score-line num">
              答對 <strong>{result.correct}</strong> / {result.total}
            </p>
            <p className="score-parts num">
              {result.byPart.map((p) => `Part ${p.part}：${p.correct}/${p.total}`).join("　")}
            </p>
            <p className="score-parts num">作答時間 {formatDuration(activeElapsedMs(session, new Date()))}</p>
          </div>
        </div>
        <ul className="score-facts">
          {previous && (
            <li className="num">
              比上次{session.source === "mistakes" ? "錯題重考" : "練習"}（{formatPercent(previous.accuracy)}）
              <strong>{formatPointDelta(result.accuracy, previous.accuracy)}</strong> 個百分點
            </li>
          )}
          <li className="num">
            {wrong === 0 ? (
              session.source === "mistakes" ? (
                "全部答對，這些錯題的連續答對次數都加一。"
              ) : (
                "全部答對，沒有新增錯題。"
              )
            ) : (
              <>
                {session.source === "mistakes"
                  ? `${wrong} 題仍留在錯題本，連續答對次數歸零。`
                  : `答錯與未作答的 ${wrong} 題已收進錯題本。`}
                <Link to="/mistakes">查看錯題本</Link>
              </>
            )}
          </li>
        </ul>
        <p className="stat-note">正確率僅反映本次練習，不等於多益官方分數。</p>
        <div className="actions">
          {wrong > 0 && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void reviewWrong()}>
              複習答錯的 {wrong} 題
            </button>
          )}
          <Link className={`btn${wrong > 0 ? "" : " btn-primary"}`} to={`/mock?${retryQuery}`}>
            再考一次
          </Link>
          <Link className="btn" to="/mock">
            回到模擬考
          </Link>
          {error && (
            <span role="alert" className="status-msg err">
              {error}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <div className="plan-head">
          <h2>逐題檢討</h2>
          <label className="inline-check">
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
            只看答錯（{result.total - result.correct}）
          </label>
        </div>
        {shown.length === 0 && <p className="notice">全部答對。</p>}
        {shown.map((item, k) => {
          const prev = shown[k - 1];
          const newGroup = item.group && prev?.group?.id !== item.group.id;
          const posInGroup = item.group
            ? result.items.filter((x) => x.group?.id === item.group!.id).findIndex((x) => x.index === item.index)
            : 0;
          return (
            <div key={item.question.id}>
              {newGroup && (
                <details className="review-passage">
                  <summary>查看文章：{item.group!.passages[0]?.title ?? "題組文章"}</summary>
                  <Passage group={item.group!} />
                </details>
              )}
              <ReviewItem item={item} total={result.total} posInGroup={posInGroup} />
            </div>
          );
        })}
      </section>
    </>
  );
}
