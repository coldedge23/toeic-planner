import { useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckIcon, CrossIcon, PageHeader, StatCard } from "@/components/ui";
import { blankNumber, Passage, questionHeading } from "@/components/QuestionParts";
import { repos } from "@/storage";
import type { MistakeEntry } from "@/storage/Repository";
import { MASTERY_STREAK } from "@/domain/mistake-policy";
import { PART_LABELS } from "@/domain/schema";

const dateFmt = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" });

/** 列表摘要：Part 6 顯示「空格 [n]＋文章標題」，其他題型顯示題幹 */
function summaryText(entry: MistakeEntry) {
  const { question, group, positionInGroup } = entry;
  if (!question) return entry.item.question_id;
  const blank = blankNumber(question, positionInGroup);
  if (blank === null) return question.stem;
  const first = group?.passages[0];
  const lead = first ? first.title || first.body.replace(/\s+/g, " ").slice(0, 60) : "";
  return `空格 [${blank}]${lead ? `｜${lead}` : ""}`;
}

/** 展開時把文章框捲到這題的空格，不用自己找 */
function scrollToActiveBlank(details: HTMLElement) {
  const box = details.querySelector<HTMLElement>(".mistake-passage");
  const blank = box?.querySelector<HTMLElement>(".blank.active");
  if (!box || !blank) return;
  const offset = blank.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTop += offset - box.clientHeight / 3;
}

function MistakeRow({ entry, onRestore }: { entry: MistakeEntry; onRestore?: () => void }) {
  const { item, question, group, positionInGroup, lastWrong } = entry;
  const archivedLabel =
    item.archive_reason === "mastered" ? `已熟練（連續答對 ${MASTERY_STREAK} 次）` : item.archive_reason === "cleared" ? "清空" : "";
  const picked = lastWrong?.selected_key ?? null;
  const blank = question ? blankNumber(question, positionInGroup) : null;
  return (
    <li className="mistake">
      <details onToggle={(e) => e.currentTarget.open && scrollToActiveBlank(e.currentTarget)}>
        <summary>
          <span className="mistake-main">
            <span className="mistake-part">
              {question ? PART_LABELS[question.part] : "題目已不在題庫"}
              {question?.part === 7 && group?.passages[0]?.title ? `｜${group.passages[0].title}` : ""}
            </span>
            <span className="mistake-stem" lang={blank === null ? "en" : undefined}>
              {summaryText(entry)}
            </span>
          </span>
          <span className="mistake-meta num">
            答錯 {item.wrong_count} 次
            {lastWrong && `・最後答錯 ${dateFmt.format(new Date(lastWrong.submitted_at))}`}
            {item.state === "active"
              ? `・連續答對 ${item.correct_streak}/${MASTERY_STREAK}`
              : `・${archivedLabel}・${dateFmt.format(new Date(item.archived_at!))}`}
          </span>
        </summary>
        {question && (
          <div className="mistake-detail">
            {group && (
              <div className="mistake-passage" role="region" aria-label="文章" tabIndex={0}>
                <Passage group={group} activeBlank={blank ?? undefined} />
              </div>
            )}
            <p className="question-stem">{questionHeading(question, positionInGroup)}</p>
            {lastWrong && picked === null && <p className="mistake-note">上次這題沒有作答。</p>}
            <ul className="options review-options">
              {question.options.map((o) => {
                const isAnswer = o.key === question.correct_key;
                const isPicked = o.key === picked;
                return (
                  <li
                    key={o.key}
                    className={`option${isAnswer ? " answer" : isPicked ? " picked-wrong" : ""}`}
                  >
                    <span className="option-key">{o.key}</span>
                    <span className="option-text" lang="en">
                      {o.text}
                    </span>
                    {isAnswer && (
                      <span className="option-flag ok">
                        <CheckIcon />
                        正解
                      </span>
                    )}
                    {isPicked && !isAnswer && (
                      <span className="option-flag bad">
                        <CrossIcon />
                        你上次的答案
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
          </div>
        )}
      </details>
      {onRestore && (
        <button type="button" className="btn btn-small" onClick={onRestore}>
          復原
        </button>
      )}
    </li>
  );
}

export function MistakesPage() {
  const data = useLiveQuery(async () => ({
    active: await repos.mistakes.listActive(),
    archived: await repos.mistakes.listArchived(),
  }));
  const [confirmClear, setConfirmClear] = useState(false);
  const [lastCleared, setLastCleared] = useState<{ at: string; count: number } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const act = async (fn: () => Promise<string | void>) => {
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: "ok", text });
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: "操作失敗，資料沒有變更" });
    }
  };

  const clear = () =>
    act(async () => {
      const count = data?.active.length ?? 0;
      const at = await repos.mistakes.clearAll(new Date());
      setConfirmClear(false);
      if (at) setLastCleared({ at, count });
    });

  const undoClear = () =>
    act(async () => {
      if (!lastCleared) return;
      const n = await repos.mistakes.restoreCleared(lastCleared.at);
      setLastCleared(null);
      return `已復原 ${n} 題`;
    });

  if (data === undefined) {
    return (
      <>
        <PageHeader title="錯題本" subtitle={`答錯的題目自動收錄，連續答對 ${MASTERY_STREAK} 次後封存`} />
        <p className="loading">讀取中…</p>
      </>
    );
  }

  const mastered = data.archived.filter((e) => e.item.archive_reason === "mastered").length;
  const activeParts = new Set(data.active.flatMap((e) => (e.question ? [e.question.part] : [])));
  const retestQuery = new URLSearchParams({
    source: "mistakes",
    parts: [...activeParts].sort().join(",") || "5,6,7",
    count: String(Math.min(data.active.length, 20) || 1),
    sec: "45",
  });

  return (
    <>
      <PageHeader title="錯題本" subtitle={`答錯的題目自動收錄，連續答對 ${MASTERY_STREAK} 次後封存`} />
      <div className="stat-grid">
        <StatCard label="待複習錯題" value={data.active.length} unit="題" />
        <StatCard label="已熟練封存" value={mastered} unit="題" />
        <StatCard
          label="累計答錯"
          value={[...data.active, ...data.archived].reduce((s, e) => s + e.item.wrong_count, 0)}
          unit="次"
        />
        <StatCard label="已封存（全部）" value={data.archived.length} unit="題" />
      </div>

      <section className="card">
        <h2>錯題重考</h2>
        <p className="card-desc">
          一般模擬考或錯題重考答對都算一次；答錯會把連續答對次數歸零。封存後再答錯，會重新放回錯題本。
        </p>
        {lastCleared && (
          <p className="notice notice-warn" role="status">
            已清空 {lastCleared.count} 題（封存，未刪除）。
            <button type="button" className="btn btn-text inline-btn" onClick={() => void undoClear()}>
              復原
            </button>
          </p>
        )}
        {confirmClear && (
          <div className="card card-emphasis" role="alertdialog" aria-labelledby="clear-title">
            <h2 id="clear-title">清空錯題本？</h2>
            <p className="card-desc">{data.active.length} 題會改為封存，答錯紀錄會保留，之後可以復原。</p>
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn btn-primary" onClick={() => void clear()}>
                確定清空
              </button>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                取消
              </button>
            </div>
          </div>
        )}
        <div className="actions">
          {data.active.length > 0 ? (
            <Link className="btn btn-primary" to={`/mock?${retestQuery}`}>
              用錯題本出模擬考
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" disabled>
              用錯題本出模擬考
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={data.active.length === 0 || confirmClear}
            onClick={() => setConfirmClear(true)}
          >
            清空錯題本
          </button>
          {message && (
            <span role="status" className={`status-msg ${message.kind}`}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>待複習（{data.active.length}）</h2>
        {data.active.length === 0 ? (
          <p className="notice">目前沒有待複習的錯題。模擬考答錯的題目會自動出現在這裡。</p>
        ) : (
          <ul className="mistake-list">
            {data.active.map((e) => (
              <MistakeRow key={e.item.id} entry={e} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="plan-head">
          <h2>已封存（{data.archived.length}）</h2>
          {data.archived.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "收合" : "展開"}
            </button>
          )}
        </div>
        {showArchived && (
          <ul className="mistake-list">
            {data.archived.map((e) => (
              <MistakeRow
                key={e.item.id}
                entry={e}
                onRestore={() => void act(async () => {
                  await repos.mistakes.restore(e.item.id);
                  return "已復原 1 題";
                })}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
