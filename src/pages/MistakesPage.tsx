import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader, StatCard, Upcoming } from "@/components/ui";
import { repos } from "@/storage";

export function MistakesPage() {
  const active = useLiveQuery(() => repos.mistakes.countActive(), []);

  return (
    <>
      <PageHeader title="錯題本" subtitle="答錯的題目自動收錄，連續答對 2 次後封存" />
      <div className="stat-grid">
        <StatCard label="待複習錯題" value={active ?? "…"} unit="題" />
      </div>
      <section className="card">
        <h2>錯題重考</h2>
        <Upcoming stage="P4">用錯題出一份模擬考；清空錯題本可以復原</Upcoming>
      </section>
    </>
  );
}
