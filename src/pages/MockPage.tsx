import { PageHeader, Upcoming } from "@/components/ui";

export function MockPage() {
  return (
    <>
      <PageHeader title="模擬考" subtitle="從題庫抽題，計時作答後逐題檢討" />
      <section className="card">
        <h2>開始模擬考</h2>
        <Upcoming stage="P3">選擇 Part、題數與每題秒數後開始作答；交卷後顯示正確率與逐題解析</Upcoming>
      </section>
      <section className="card">
        <h2>歷次成績</h2>
        <Upcoming stage="P3">歷次正確率圖表與紀錄列表</Upcoming>
      </section>
    </>
  );
}
