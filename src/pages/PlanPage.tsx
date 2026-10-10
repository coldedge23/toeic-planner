import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/ui";
import { DateGroup, groupTasksByDate } from "@/components/TaskList";
import { useSettings } from "@/hooks/useSettings";
import { useActivePlan } from "@/hooks/usePlan";
import { repos } from "@/storage";
import { formatDateLabel, nowIso, todayInTaipei } from "@/domain/dates";
import {
  buildPlanRecords,
  generatePlanTasks,
  PHASE_LABELS,
  PLAN_ERROR_MESSAGES,
  PLAN_RULES,
  previewReschedule,
  settingsChangedSincePlan,
  type PlanResult,
  type ReschedulePreview,
} from "@/domain/planner";
import { PART_LABELS, type Phase, type Settings, type SettingsInput } from "@/domain/schema";

const PAGE_SIZE = 14;

function toInput(s: Settings): SettingsInput {
  const { exam_date, target_score, current_score, daily_minutes, available_weekdays, self_ratings, bank_csv_url } = s;
  return { exam_date, target_score, current_score, daily_minutes, available_weekdays, self_ratings, bank_csv_url };
}

function PlanSummary({ result }: { result: Extract<PlanResult, { ok: true }> }) {
  const phaseDays = (p: Phase) => result.phases.filter((x) => x === p).length;
  const mocks = result.tasks.filter((t) => t.part === null).length;
  const firstDay = result.tasks.filter((t) => t.date === result.studyDates[0] && t.part !== null);
  return (
    <table className="table">
      <tbody>
        <tr>
          <th scope="row">讀書日</th>
          <td className="num">
            {result.studyDates.length} 天（{formatDateLabel(result.studyDates[0])} ～ {formatDateLabel(result.studyDates.at(-1)!)}）
          </td>
        </tr>
        <tr>
          <th scope="row">階段</th>
          <td className="num">
            {(["foundation", "intensive", "review"] as const)
              .filter((p) => phaseDays(p) > 0)
              .map((p) => `${PHASE_LABELS[p]} ${phaseDays(p)} 天`)
              .join("／")}
          </td>
        </tr>
        <tr>
          <th scope="row">模擬考日</th>
          <td className="num">{mocks} 天（強化與複習階段每 {PLAN_RULES.mockEvery} 個讀書日一次）</td>
        </tr>
        <tr>
          <th scope="row">每日分配</th>
          <td className="num">
            {firstDay.length > 0
              ? firstDay.map((t) => `${PART_LABELS[t.part!]} ${t.minutes} 分`).join("、")
              : "—"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function RescheduleCard({
  preview,
  onConfirm,
  onCancel,
  busy,
}: {
  preview: ReschedulePreview;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? preview.changedDates : preview.changedDates.slice(0, 7);
  // 今天起內容不變且沒有過去未完成任務時，重排只會多一個相同的版本
  const nothingToDo = preview.changedDates.length === 0 && preview.droppedPast.length === 0;
  return (
    <section className="card card-emphasis" aria-labelledby="reschedule-title">
      <h2 id="reschedule-title">重新排程預覽</h2>
      <p className="card-desc">確認前不會改動任何資料。舊計畫會保留在資料庫中，不會刪除。</p>
      <ul className="diff-summary">
        <li>
          保留已完成任務 <strong className="num">{preview.kept.length}</strong> 項
        </li>
        <li>
          新增任務 <strong className="num">{preview.added.length}</strong> 項
        </li>
        <li>
          取代今天起未完成的任務 <strong className="num">{preview.replacedFuture.length}</strong> 項
        </li>
        <li>
          不再列入的過去未完成任務 <strong className="num">{preview.droppedPast.length}</strong> 項（落後天數會歸零）
        </li>
      </ul>

      {preview.changedDates.length === 0 ? (
        <p className="notice">
          今天起的任務內容沒有變化{preview.droppedPast.length === 0 ? "，不需要重新排程" : "；確認後只會清除過去未完成的任務"}。
        </p>
      ) : (
        <>
          <h3 className="sub-title">有變動的日期（{preview.changedDates.length} 天）</h3>
          <div className="table-scroll">
            <table className="table diff-table">
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">原本</th>
                  <th scope="col">重排後</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.date}>
                    <td className="num nowrap">{formatDateLabel(d.date)}</td>
                    <td>{d.before.length ? d.before.map((x) => <div key={x}>{x}</div>) : "（休息）"}</td>
                    <td>{d.after.length ? d.after.map((x) => <div key={x}>{x}</div>) : "（休息）"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.changedDates.length > shown.length && (
            <button type="button" className="btn btn-text" onClick={() => setShowAll(true)}>
              顯示全部 {preview.changedDates.length} 天
            </button>
          )}
        </>
      )}

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy || nothingToDo}>
          {busy ? "套用中…" : "確認重新排程"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </section>
  );
}

export function PlanPage() {
  const settings = useSettings();
  const active = useActivePlan();
  const today = todayInTaipei();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [includePast, setIncludePast] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const input = useMemo(() => (settings ? toInput(settings) : null), [settings]);
  const draft = useMemo(() => (input ? generatePlanTasks(input, today) : null), [input, today]);
  // 預覽依最新的任務即時重算，避免開著預覽時勾選任務造成內容過期
  const diff = useMemo(
    () => (previewOpen && active && draft?.ok ? previewReschedule(active.tasks, draft.tasks, today) : null),
    [previewOpen, active, draft, today],
  );

  if (settings === undefined || active === undefined) {
    return (
      <>
        <PageHeader title="計畫" subtitle="依考試日期與可讀書時間排出每日任務" />
        <p className="loading">讀取中…</p>
      </>
    );
  }

  if (settings === null || input === null || draft === null) {
    return (
      <>
        <PageHeader title="計畫" subtitle="依考試日期與可讀書時間排出每日任務" />
        <p className="notice">
          請先到 <Link to="/settings">設定</Link> 填寫考試日期與讀書時間。
        </p>
      </>
    );
  }

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: "ok", text: ok });
    } catch (err) {
      console.error(err);
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "操作失敗，資料沒有變更" });
    } finally {
      setBusy(false);
    }
  };

  const createPlan = () => {
    if (!draft.ok) return;
    const { plan, tasks } = buildPlanRecords({
      settings: input,
      startDate: today,
      tasks: draft.tasks,
      version: 1,
      now: nowIso(),
      newId: () => crypto.randomUUID(),
    });
    void run(() => repos.plans.createPlan(plan, tasks), "計畫已建立");
  };

  const openPreview = () => {
    setMessage(null);
    setPreviewOpen(true);
  };

  const confirmReschedule = () => {
    if (!active || !diff) return;
    const { plan, tasks } = buildPlanRecords({
      settings: input,
      startDate: today,
      tasks: diff.added,
      version: active.plan.version + 1,
      now: nowIso(),
      newId: () => crypto.randomUUID(),
    });
    void run(async () => {
      await repos.plans.applyReschedule({
        oldPlanId: active.plan.id,
        newPlan: plan,
        newTasks: tasks,
        keptTaskIds: diff.kept.map((t) => t.id),
      });
      setPreviewOpen(false);
    }, "已重新排程");
  };

  const status = message && (
    <p role="status" className={`status-msg ${message.kind}`}>
      {message.text}
    </p>
  );

  // ---------- 尚未建立計畫 ----------
  if (active === null) {
    return (
      <>
        <PageHeader title="計畫" subtitle="依考試日期與可讀書時間排出每日任務" />
        <section className="card">
          <h2>生成計畫</h2>
          {draft.ok ? (
            <>
              <p className="card-desc">從今天排到考試前一天，只排勾選的星期。生成後可以隨時重新排程。</p>
              <PlanSummary result={draft} />
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={createPlan} disabled={busy}>
                  生成計畫
                </button>
                {status}
              </div>
            </>
          ) : (
            <p className="notice">
              {PLAN_ERROR_MESSAGES[draft.error]}。請到 <Link to="/settings">設定</Link> 調整。
            </p>
          )}
        </section>
      </>
    );
  }

  // ---------- 已有計畫 ----------
  const { plan, tasks } = active;
  const changed = settingsChangedSincePlan(plan, input);
  const doneCount = tasks.filter((t) => t.completed_at !== null).length;
  const groups = groupTasksByDate(includePast ? tasks : tasks.filter((t) => t.date >= today));
  const visible = groups.slice(0, limit);

  return (
    <>
      <PageHeader title="計畫" subtitle="依考試日期與可讀書時間排出每日任務" />

      <section className="card">
        <div className="plan-head">
          <div>
            <h2>
              讀書計畫 <span className="num muted">v{plan.version}</span>
            </h2>
            <p className="card-desc num">
              {formatDateLabel(plan.start_date)} 起，考試日 {formatDateLabel(plan.exam_date)}｜已完成 {doneCount}/
              {tasks.length} 項
            </p>
          </div>
          <button type="button" className="btn" onClick={openPreview} disabled={busy || !draft.ok || previewOpen}>
            重新排程
          </button>
        </div>
        {changed && (
          <p className="notice notice-warn">設定已變更（考試日期、每日分鐘、星期或自評），建議重新排程讓計畫套用新設定。</p>
        )}
        {!draft.ok && <p className="notice notice-warn">無法重新排程：{PLAN_ERROR_MESSAGES[draft.error]}。</p>}
        {status}
      </section>

      {diff && (
        <RescheduleCard
          preview={diff}
          busy={busy}
          onConfirm={confirmReschedule}
          onCancel={() => setPreviewOpen(false)}
        />
      )}

      <section className="card">
        <div className="plan-head">
          <h2>每日任務</h2>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => {
                setIncludePast(e.target.checked);
                setLimit(PAGE_SIZE);
              }}
            />
            顯示過去日期
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="notice">今天起沒有排定的任務。</p>
        ) : (
          visible.map(([date, list]) => <DateGroup key={date} date={date} tasks={list} today={today} />)
        )}
        {groups.length > visible.length && (
          <button type="button" className="btn btn-text" onClick={() => setLimit(limit + PAGE_SIZE)}>
            再顯示 {Math.min(PAGE_SIZE, groups.length - visible.length)} 天（還有 {groups.length - visible.length} 天）
          </button>
        )}
      </section>
    </>
  );
}
