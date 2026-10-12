import { checkAvailability } from "./exam-engine";
import { READING_PARTS, type Question, type ReadingPart, type Session, type StudyTask } from "./schema";

/** 題數只是練習量估算，不是官方配速或完成任務的判定標準。 */
export function recommendTaskPractice(task: StudyTask, questions: readonly Question[]) {
  const parts: ReadingPart[] = task.part === null ? [...READING_PARTS] : READING_PARTS.filter((p) => p === task.part);
  const seconds = task.part === 5 ? 45 : task.part === 7 ? 90 : 60;
  const estimatedCount = Math.max(1, Math.floor(task.minutes * 60 / seconds));
  const availability = checkAvailability(questions, parts);
  const achievable = [...availability.achievable].filter((n) => n > 0).sort((a, b) => a - b);
  const count = achievable.filter((n) => n <= estimatedCount).at(-1) ?? achievable[0] ?? 0;
  const missingParts = parts.filter((p) => !questions.some((q) => q.status === "approved" && q.part === p));
  let notice: string | null = null;
  if (count === 0) notice = "這項任務目前沒有可用的已審核題目，請先到題庫匯入。";
  else if (availability.available < estimatedCount) notice = `依 ${task.minutes} 分鐘估算約 ${estimatedCount} 題，目前只有 ${availability.available} 題可用，建議先練習 ${count} 題。`;
  else if (count !== estimatedCount) notice = `為保留完整文章題組，建議題數由 ${estimatedCount} 題調整為 ${count} 題。`;
  if (count > 0 && missingParts.length) notice = `${notice ?? ""} 缺少 Part ${missingParts.join("、")} 的已審核題目，本次只練習可用單元。`.trim();
  return { parts, count, seconds, estimatedCount, notice };
}

export function sessionMatchesTask(session: Session, task: StudyTask): boolean {
  return session.question_snapshot.length > 0 && session.question_snapshot.every(({ question }) =>
    READING_PARTS.includes(question.part as ReadingPart) && (task.part === null || question.part === task.part));
}
