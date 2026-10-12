import { useEffect, useState } from "react";
import { todayInTaipei } from "@/domain/dates";

/** 長時間開著或從背景回來時，仍依台北日界線更新今日資料。 */
export function useTaipeiToday() {
  const [today, setToday] = useState(todayInTaipei);
  useEffect(() => {
    const update = () => setToday(todayInTaipei());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
