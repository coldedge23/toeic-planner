import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import type { Session } from "@/domain/schema";

export interface SessionSummary {
  session: Session;
  correct: number;
  total: number;
}

/** 已交卷的測驗與分數，依交卷時間由舊到新。 */
export function useSessionHistory(): SessionSummary[] | undefined {
  return useLiveQuery(async () => {
    const sessions = await repos.sessions.listSubmitted();
    return Promise.all(
      sessions.map(async (session) => {
        const attempts = await repos.sessions.listAttempts(session.id);
        return { session, correct: attempts.filter((a) => a.is_correct).length, total: attempts.length };
      }),
    );
  }, []);
}

/** undefined = 讀取中；null = 沒有進行中的測驗。 */
export function useInProgressSession() {
  return useLiveQuery(async () => {
    const session = await repos.sessions.getInProgress();
    if (!session) return null;
    const answers = await repos.sessions.getAnswers(session.id);
    return { session, answered: answers.filter((a) => a.selected_key !== null).length };
  }, []);
}
