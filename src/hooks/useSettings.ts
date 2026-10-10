import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { daysBetween, todayInTaipei } from "@/domain/dates";
import type { Settings } from "@/domain/schema";

/** undefined = 讀取中；null = 尚未儲存過設定。資料變動時自動更新（跨頁共用）。 */
export function useSettings(): Settings | null | undefined {
  return useLiveQuery(() => repos.settings.get(), []);
}

/** undefined = 讀取中；null = 尚未設定考試日期。 */
export function useDaysToExam(): number | null | undefined {
  const settings = useSettings();
  if (settings === undefined) return undefined;
  if (settings === null) return null;
  return daysBetween(todayInTaipei(), settings.exam_date);
}
