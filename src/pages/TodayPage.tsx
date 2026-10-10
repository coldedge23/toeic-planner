import { Link } from "react-router";
import { PageHeader, StatCard, Upcoming } from "@/components/ui";
import { useDaysToExam } from "@/hooks/useSettings";

export function TodayPage() {
  const daysToExam = useDaysToExam();

  return (
    <>
      <PageHeader title="今日" subtitle="今天要完成的任務與進度" />
      <div className="stat-grid">
        <StatCard
          label="距考試"
          value={daysToExam === undefined ? "…" : daysToExam === null ? "—" : daysToExam}
          unit={daysToExam === null || daysToExam === undefined ? undefined : "天"}
          note={daysToExam === null ? "尚未設定考試日期" : undefined}
        />
        <StatCard label="今日完成" value="—" note="尚未建立計畫" />
        <StatCard label="落後天數" value="—" note="尚未建立計畫" />
        <StatCard label="連續達標" value="—" note="尚未建立計畫" />
      </div>
      <section className="card">
        <h2>今日任務</h2>
        {daysToExam === null ? (
          <p className="notice">
            請先到 <Link to="/settings">設定</Link> 填寫考試日期與讀書時間。
          </p>
        ) : (
          <Upcoming stage="P2">依計畫列出今日任務，打勾後與計畫頁同步</Upcoming>
        )}
      </section>
    </>
  );
}
