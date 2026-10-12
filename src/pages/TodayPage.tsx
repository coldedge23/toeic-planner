import { Link } from "react-router";
import { PageHeader, StatCard } from "@/components/ui";
import { TaskItem, groupTasksByDate } from "@/components/TaskList";
import { useDaysToExam } from "@/hooks/useSettings";
import { useActivePlan } from "@/hooks/usePlan";
import { formatDateLabel, todayInTaipei } from "@/domain/dates";
import { PHASE_LABELS } from "@/domain/planner";
import { catchUpSuggestion, computeTodayStats } from "@/domain/progress";

export function TodayPage() {
  const daysToExam = useDaysToExam();
  const active = useActivePlan();
  const today = todayInTaipei();

  const header = <PageHeader title="今日" subtitle={`${formatDateLabel(today)}｜今天要完成的任務與進度`} />;

  if (daysToExam === undefined || active === undefined) {
    return (
      <>
        {header}
        <p className="loading">讀取中…</p>
      </>
    );
  }

  const daysCard = (
    <StatCard
      label="距考試"
      value={daysToExam === null ? "—" : daysToExam}
      unit={daysToExam === null ? undefined : "天"}
      note={daysToExam === null ? "尚未設定考試日期" : daysToExam < 0 ? "考試日期已過" : undefined}
    />
  );

  if (active === null) {
    return (
      <>
        {header}
        <div className="stat-grid">
          {daysCard}
          <StatCard label="今日完成" value="—" note="尚未建立計畫" />
          <StatCard label="落後天數" value="—" note="尚未建立計畫" />
          <StatCard label="連續達標" value="—" note="尚未建立計畫" />
        </div>
        <section className="card">
          <h2>今日任務</h2>
          <p className="notice">
            {daysToExam === null ? (
              <>
                請先到 <Link to="/settings">設定</Link> 填寫考試日期與讀書時間，再到 <Link to="/plan">計畫</Link> 生成計畫。
              </>
            ) : (
              <>
                尚未建立讀書計畫，請到 <Link to="/plan">計畫</Link> 生成。
              </>
            )}
          </p>
        </section>
      </>
    );
  }

  const stats = computeTodayStats(active.tasks, today);
  const todays = active.tasks.filter((t) => t.date === today).sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
  const suggestion = catchUpSuggestion(stats);
  const nextStudy = groupTasksByDate(active.tasks.filter((t) => t.date > today))[0];

  return (
    <>
      {header}
      <div className="stat-grid">
        {daysCard}
        <StatCard
          label="今日完成"
          value={stats.todayTotal === 0 ? "—" : `${stats.todayDone}/${stats.todayTotal}`}
          unit={stats.todayTotal === 0 ? undefined : "項"}
          note={stats.todayTotal === 0 ? "今天是休息日" : stats.todayAchieved ? "今日已達標" : undefined}
        />
        <StatCard label="落後天數" value={stats.behindDays} unit="天" />
        <StatCard label="連續達標" value={stats.streak} unit="天" note="休息日不中斷" />
      </div>

      <section className="card">
        <h2>
          今日任務
          {todays[0] && <span className="tag tag-inline">{PHASE_LABELS[todays[0].phase]}</span>}
        </h2>
        {todays.length === 0 ? (
          <p className="notice">
            今天是休息日。
            {nextStudy && `下一個讀書日是 ${formatDateLabel(nextStudy[0])}。`}
          </p>
        ) : (
          <>
            <ul className="task-list">
              {todays.map((t) => (
                <TaskItem key={t.id} task={t} practice />
              ))}
            </ul>
            <p className="field-hint">從任務開始練習，交卷後可確認是否完成；也可直接勾選已完成的學習任務。</p>
          </>
        )}
      </section>

      {stats.behindDays > 0 && (
        <section className="card">
          <h2>落後的任務</h2>
          {suggestion && <p className="notice notice-warn">{suggestion}</p>}
          <ul className="task-list" style={{ marginTop: 12 }}>
            {[...stats.overdue].sort((a, b) => a.date.localeCompare(b.date) || (a.part ?? 0) - (b.part ?? 0)).map((t) => (
              <TaskItem key={t.id} task={t} showDate practice />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
