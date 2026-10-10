import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/ui";
import { useInProgressSession, useSessionHistory } from "@/hooks/useSessions";
import { repos } from "@/storage";
import {
  buildSession,
  checkAvailability,
  describeSelectError,
  formatDuration,
  formatPercent,
  activeElapsedMs,
  isExpired,
  selectQuestions,
} from "@/domain/exam-engine";
import { PART_LABELS, READING_PARTS, type ReadingPart } from "@/domain/schema";

const SECONDS_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "不限時" },
  { value: 30, label: "30 秒" },
  { value: 45, label: "45 秒" },
  { value: 60, label: "60 秒" },
  { value: 90, label: "90 秒" },
];

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 「再考一次」以網址參數帶回上次的設定，例如 ?parts=5,7&count=10&sec=45 */
function readInitial(params: URLSearchParams) {
  const parts = (params.get("parts") ?? "5,6,7")
    .split(",")
    .map(Number)
    .filter((p): p is ReadingPart => (READING_PARTS as readonly number[]).includes(p));
  const sec = params.get("sec");
  const secNum = sec === null ? 45 : sec === "none" ? null : Number(sec);
  return {
    source: params.get("source") === "mistakes" ? ("mistakes" as const) : ("bank" as const),
    parts: parts.length ? parts : [...READING_PARTS],
    count: params.get("count") ?? "10",
    seconds: SECONDS_OPTIONS.some((o) => o.value === secNum) ? secNum : 45,
  };
}

function StartForm() {
  const [params] = useSearchParams();
  const initial = useMemo(() => readInitial(params), [params]);
  const [source, setSource] = useState<"bank" | "mistakes">(initial.source);
  const [parts, setParts] = useState<ReadingPart[]>(initial.parts);
  const [count, setCount] = useState(initial.count);
  const [seconds, setSeconds] = useState<number | null>(initial.seconds);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const bank = useLiveQuery(async () => {
    const questions = source === "mistakes" ? await repos.mistakes.activeQuestions() : await repos.bank.listApproved();
    return { questions, groups: await repos.bank.getGroups([...new Set(questions.flatMap((q) => q.group_id ?? []))]) };
  }, [source]);

  const perPart = (p: ReadingPart) => bank?.questions.filter((q) => q.part === p).length ?? 0;
  const availability = bank ? checkAvailability(bank.questions, parts, source === "bank") : null;

  const togglePart = (p: ReadingPart) => {
    setError(null);
    setParts(parts.includes(p) ? parts.filter((x) => x !== p) : [...parts, p].sort((a, b) => a - b));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!bank) return;
    const config = { source, parts, count: Number(count), secondsPerQuestion: seconds };
    const result = selectQuestions(bank.questions, bank.groups, config);
    if (!result.ok) {
      setError(describeSelectError(result));
      return;
    }
    setBusy(true);
    try {
      const session = buildSession(config, result.items, new Date(), () => crypto.randomUUID());
      await repos.sessions.create(session);
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "建立測驗失敗，請再試一次");
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>開始模擬考</h2>
      <form onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <fieldset className="field fieldset">
            <legend className="field-label">Part（可複選）</legend>
            <div className="toggle-row">
              {READING_PARTS.map((p) => (
                <label key={p} className="toggle">
                  <input type="checkbox" checked={parts.includes(p)} onChange={() => togglePart(p)} />
                  <span>
                    Part {p}
                    <span className="toggle-count num">（{perPart(p)}）</span>
                  </span>
                </label>
              ))}
            </div>
            <span className="field-hint">
              括號內為{source === "mistakes" ? "錯題本中的" : "已審核"}題數。{parts.length > 0 && `已選：${parts.map((p) => PART_LABELS[p]).join("、")}`}
            </span>
          </fieldset>

          <label className="field">
            <span className="field-label">題數</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                setError(null);
              }}
            />
            <span className="field-hint num">
              {availability ? `目前可用 ${availability.available} 題` : "讀取題庫中…"}
            </span>
          </label>

          <label className="field">
            <span className="field-label">每題秒數</span>
            <select
              className="input"
              value={seconds === null ? "none" : String(seconds)}
              onChange={(e) => setSeconds(e.target.value === "none" ? null : Number(e.target.value))}
            >
              {SECONDS_OPTIONS.map((o) => (
                <option key={o.label} value={o.value === null ? "none" : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field-hint">總時限 = 題數 × 每題秒數；時間到自動交卷，可暫停。</span>
          </label>

          <fieldset className="field fieldset">
            <legend className="field-label">來源與模式</legend>
            <label className="inline-check">
              <input
                type="radio"
                name="source"
                checked={source === "bank"}
                onChange={() => {
                  setSource("bank");
                  setError(null);
                }}
              />
              題庫（只抽已審核題目）
            </label>
            <label className="inline-check">
              <input
                type="radio"
                name="source"
                checked={source === "mistakes"}
                onChange={() => {
                  setSource("mistakes");
                  setError(null);
                }}
              />
              錯題本（只出答錯的題目）
            </label>
            <span className="field-hint">目前為練習模式；整卷正式時限模式之後開放。</span>
          </fieldset>
        </div>

        {error && (
          <p className="notice notice-warn" role="alert" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !bank}>
            {busy ? "準備中…" : "開始"}
          </button>
        </div>
      </form>
    </section>
  );
}

function History() {
  const history = useSessionHistory();
  if (history === undefined) return <p className="loading">讀取中…</p>;
  if (history.length === 0) return <p className="notice">還沒有交卷紀錄。</p>;

  const data = history.map((h, i) => ({
    name: `#${i + 1}`,
    date: dateTime.format(new Date(h.session.submitted_at!)),
    accuracy: Math.round((h.total ? h.correct / h.total : 0) * 1000) / 10,
  }));

  return (
    <>
      <div className="chart-box" role="img" aria-label={`歷次正確率折線圖，共 ${history.length} 次`}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#DCD5C8" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5F6A73" }} stroke="#DCD5C8" />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: "#5F6A73" }} stroke="#DCD5C8" />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(1)}%`, "正確率"]}
              labelFormatter={(_, payload) => payload?.[0]?.payload.date ?? ""}
            />
            <Line type="monotone" dataKey="accuracy" stroke="#0D2235" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="table-scroll">
        <table className="table history-table">
          <thead>
            <tr>
              <th scope="col">交卷時間</th>
              <th scope="col">Part</th>
              <th scope="col" className="num">
                答對
              </th>
              <th scope="col" className="num">
                正確率
              </th>
              <th scope="col" className="num col-time">
                用時
              </th>
              <th scope="col" className="col-action">
                <span className="sr-only">檢討</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((h) => (
              <tr key={h.session.id}>
                <td className="num nowrap">{dateTime.format(new Date(h.session.submitted_at!))}</td>
                <td className="num nowrap">
                  {h.session.source === "mistakes" && <span className="tag">錯題</span>}{" "}
                  {/* 顯示實際抽到的 Part，而不是開考時勾選的 Part */}
                  {[...new Set(h.session.question_snapshot.map((it) => it.question.part))].sort().join("・")}
                </td>
                <td className="num">
                  {h.correct}/{h.total}
                </td>
                <td className="num">{formatPercent(h.total ? h.correct / h.total : 0)}</td>
                <td className="num col-time">{formatDuration(activeElapsedMs(h.session, new Date()))}</td>
                <td className="col-action">
                  <Link to={`/sessions/${h.session.id}/result`}>檢討</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function MockPage() {
  const inProgress = useInProgressSession();

  // 在其他頁面時時間已到：回到這頁時自動交卷（與作答頁相同規則）
  useEffect(() => {
    if (inProgress && isExpired(inProgress.session, new Date())) {
      repos.sessions.submit(inProgress.session.id, new Date()).catch((err) => console.error(err));
    }
  }, [inProgress]);

  return (
    <>
      <PageHeader title="模擬考" subtitle="從題庫抽題，計時作答後逐題檢討" />
      {inProgress ? (
        <section className="card card-emphasis">
          <h2>有一場測驗尚未交卷</h2>
          <p className="card-desc num">
            已作答 {inProgress.answered}/{inProgress.session.question_snapshot.length} 題
            {inProgress.session.paused_at && "（暫停中）"}
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            <Link className="btn btn-primary" to={`/sessions/${inProgress.session.id}`}>
              繼續作答
            </Link>
          </div>
        </section>
      ) : inProgress === null ? (
        <StartForm />
      ) : (
        <p className="loading">讀取中…</p>
      )}
      <section className="card">
        <h2>歷次成績</h2>
        <p className="card-desc">正確率不等於多益官方分數。</p>
        <History />
      </section>
    </>
  );
}
