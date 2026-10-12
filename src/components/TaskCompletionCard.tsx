import { useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { formatDateLabel } from "@/domain/dates";

export function TaskCompletionCard({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const session = await repos.sessions.get(sessionId);
    if (!session?.study_task_id || session.status !== "submitted") return null;
    const task = await repos.plans.getTask(session.study_task_id);
    const active = await repos.plans.getActivePlan();
    return { task, available: !!task && task.plan_id === active?.id };
  }, [sessionId]);
  if (!data) return null;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await repos.plans.completeFromSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="task-completion-title">
      <h2 id="task-completion-title">任務完成確認</h2>
      {data.task && <p className="card-desc">{formatDateLabel(data.task.date)}｜{data.task.title}｜預計 {data.task.minutes} 分鐘</p>}
      {!data.available && <p className="notice notice-warn">任務已重新排程，這場測驗仍保留在歷次成績。請回今日頁確認目前任務。</p>}
      {data.available && data.task?.completed_at && <p className="notice" role="status">這項任務已完成。你仍可在今日或計畫頁取消勾選。</p>}
      {data.available && !data.task?.completed_at && (
        <>
          <p className="notice">你已完成這項任務的練習與複習嗎？交卷不會自動標記完成，請依實際學習情況確認。</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? "更新中…" : "確認完成任務"}
            </button>
            <Link className="btn" to="/today">稍後再完成</Link>
          </div>
        </>
      )}
      {(data.task?.completed_at || !data.available) && <div className="actions"><Link className="btn" to="/today">返回今日</Link></div>}
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
    </section>
  );
}
