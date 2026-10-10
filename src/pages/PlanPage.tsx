import { PageHeader, Upcoming } from "@/components/ui";

export function PlanPage() {
  return (
    <>
      <PageHeader title="計畫" subtitle="依考試日期與可讀書時間排出每日任務" />
      <section className="card">
        <h2>讀書計畫</h2>
        <Upcoming stage="P2">
          依設定生成每日任務（基礎／強化／考前複習三階段，定期安排模擬考日）；重排前先預覽差異，已完成的任務會保留
        </Upcoming>
      </section>
    </>
  );
}
