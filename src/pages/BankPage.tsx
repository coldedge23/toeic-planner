import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader, StatCard, Upcoming } from "@/components/ui";
import { repos } from "@/storage";
import { PART_LABELS, READING_PARTS } from "@/domain/schema";

export function BankPage() {
  const stats = useLiveQuery(() => repos.bank.stats(), []);
  const count = (n: number | undefined) => (stats === undefined ? "…" : (n ?? 0));

  return (
    <>
      <PageHeader title="題庫" subtitle="只有「已審核」的題目會被抽到" />
      <div className="stat-grid">
        <StatCard label="可抽題數" value={count(stats?.total)} unit="題" />
        {READING_PARTS.map((p) => (
          <StatCard key={p} label={`Part ${p}`} value={count(stats?.byPart[p])} unit="題" />
        ))}
      </div>

      <section className="card">
        <h2>從題庫 Sheet 載入</h2>
        <Upcoming stage="P5">讀取設定頁的 CSV 網址或上傳本機 CSV，先預覽、確認後才寫入</Upcoming>
      </section>

      <section className="card">
        <h2>AI 出題</h2>
        <p className="notice">
          AI 出題在題庫 Sheet 裡由 Apps Script 執行：每天 06:00 自動出題，或從 Sheet 選單手動出一批。新題目先標為「草稿」，改成「已審核」後才會匯入（P7 建置）。
        </p>
      </section>

      <section className="card">
        <h2>各單元題數</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">單元</th>
              <th scope="col" className="num">
                已審核題數
              </th>
            </tr>
          </thead>
          <tbody>
            {READING_PARTS.map((p) => (
              <tr key={p}>
                <td>{PART_LABELS[p]}</td>
                <td className="num">{count(stats?.byPart[p])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="stat-note" style={{ marginTop: 10 }}>
          目前只有內建 demo 題庫（原創練習題，非官方試題）。
        </p>
      </section>
    </>
  );
}
