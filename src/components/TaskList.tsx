import { useState } from "react";
import { repos } from "@/storage";
import { formatDateLabel } from "@/domain/dates";
import { PHASE_LABELS } from "@/domain/planner";
import type { StudyTask } from "@/domain/schema";

export function TaskItem({ task, showDate = false }: { task: StudyTask; showDate?: boolean }) {
  const [error, setError] = useState(false);
  const done = task.completed_at !== null;

  const toggle = async () => {
    setError(false);
    try {
      await repos.plans.setTaskCompleted(task.id, !done);
    } catch (err) {
      console.error(err);
      setError(true);
    }
  };

  return (
    <li className={`task${done ? " done" : ""}`}>
      <label className="task-label">
        <input type="checkbox" className="task-check" checked={done} onChange={toggle} />
        <span className="task-title">
          {showDate && <span className="task-date num">{formatDateLabel(task.date)}</span>}
          {task.title}
          {done && <span className="sr-only">（已完成）</span>}
        </span>
        <span className="task-minutes num">{task.minutes} 分</span>
      </label>
      {error && <span className="field-error">更新失敗，請再試一次</span>}
    </li>
  );
}

export function DateGroup({ date, tasks, today }: { date: string; tasks: StudyTask[]; today: string }) {
  const minutes = tasks.reduce((s, t) => s + t.minutes, 0);
  const done = tasks.filter((t) => t.completed_at !== null).length;
  const phase = tasks[0]?.phase;
  const isMock = tasks.some((t) => t.part === null);
  return (
    <section className="date-group" aria-label={formatDateLabel(date)}>
      <header className="date-head">
        <h3 className="num">{formatDateLabel(date)}</h3>
        {date === today && <span className="tag tag-today">今天</span>}
        {phase && <span className="tag">{PHASE_LABELS[phase]}</span>}
        {isMock && <span className="tag tag-mock">模擬考日</span>}
        <span className="date-meta num">
          {done}/{tasks.length} 完成・{minutes} 分
        </span>
      </header>
      <ul className="task-list">
        {tasks.map((t) => (
          <TaskItem key={t.id} task={t} />
        ))}
      </ul>
    </section>
  );
}

export function groupTasksByDate(tasks: readonly StudyTask[]): [string, StudyTask[]][] {
  const map = new Map<string, StudyTask[]>();
  for (const t of tasks) map.set(t.date, [...(map.get(t.date) ?? []), t]);
  for (const list of map.values()) list.sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
