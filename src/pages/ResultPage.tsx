import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader } from "@/components/ui";
import { Passage, questionHeading } from "@/components/QuestionParts";
import { repos } from "@/storage";
import {
  activeElapsedMs,
  formatDuration,
  formatPercent,
  gradeSession,
  type GradedItem,
} from "@/domain/exam-engine";
import { PART_LABELS } from "@/domain/schema";
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
      <div className="explanation">
        <strong>解析</strong>
        <p>{question.explanation_zh}</p>
      </div>
    </article>
  );
}

export function ResultPage() {
  const { id = "" } = useParams();
  const [onlyWrong, setOnlyWrong] = useState(false);
  const data = useLiveQuery(async () => {
    const session = await repos.sessions.get(id);
    return session ? { session, answers: await repos.sessions.getAnswers(id) } : null;
  }, [id]);

  if (data === undefined) return <p className="loading">讀取中…</p>;
  if (data === null) {
    return (
      <p className="notice">
        找不到這場測驗。<Link to="/mock">回到模擬考</Link>
      </p>
    );
  }
  const { session, answers } = data;
  if (session.status !== "submitted") return <Navigate to={`/sessions/${session.id}`} replace />;

  const result = gradeSession(session, answers);
  const retryQuery = new URLSearchParams({
    source: session.source,
    parts: session.parts.join(","),
    count: String(result.total),
    sec: session.seconds_per_question === null ? "none" : String(session.seconds_per_question),
  });
  const shown = onlyWrong ? result.items.filter((i) => !i.isCorrect) : result.items;

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
        <p className="stat-note">正確率僅反映本次練習，不等於多益官方分數。</p>
        <div className="actions">
          <Link className="btn btn-primary" to={`/mock?${retryQuery}`}>
            再考一次
          </Link>
          <Link className="btn" to="/mock">
            回到模擬考
          </Link>
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
