import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import type { StudyPlan, StudyTask } from "@/domain/schema";

export type ActivePlan = { plan: StudyPlan; tasks: StudyTask[] } | null;

/**
 * 生效中的計畫與任務。undefined = 讀取中；null = 尚未建立。
 * 以 liveQuery 訂閱 IndexedDB，計畫頁與今日頁勾選後會同步更新。
 */
export function useActivePlan(): ActivePlan | undefined {
  return useLiveQuery(async () => {
    const plan = await repos.plans.getActivePlan();
    if (!plan) return null;
    return { plan, tasks: await repos.plans.listTasks(plan.id) };
  }, []);
}
