import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { repos } from "@/storage";
import { useTaipeiToday } from "@/hooks/useTaipeiToday";

export function DailyVocabularyCard() {
  const today = useTaipeiToday();
  const daily = useLiveQuery(() => repos.vocabulary.daily(today), [today]);
  return (
    <section className="card">
      <h2>每日單字</h2>
      {daily === undefined ? <p className="loading">讀取單字…</p> : <>
        <p className="card-desc num">到期 {daily.due} 個・新字 {daily.fresh} 個・今日已練習 {daily.reviewedToday} 個</p>
        <div className="actions">
          {daily.queue.length > 0 && <Link className="btn btn-primary" to="/vocabulary?review=1">開始今日單字（{daily.queue.length} 個）</Link>}
          <Link className="btn" to="/vocabulary">{daily.due + daily.fresh === 0 && daily.reviewedToday === 0 ? "建立單字本" : "查看單字本"}</Link>
        </div>
        {daily.queue.length === 0 && <p className="field-hint">{daily.due + daily.fresh > 0 ? "今天的設定量已完成，可到單字本調整每日量。" : daily.reviewedToday > 0 ? "今天的單字已完成，下次到期再複習。" : "從題目收錄單字或手動新增，就能開始每日複習。"}</p>}
      </>}
    </section>
  );
}
