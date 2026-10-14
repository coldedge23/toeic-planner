import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '@/components/ui';
import { useTaipeiToday } from '@/hooks/useTaipeiToday';
import { repos } from '@/storage';
import { analyzeWeakness, focusQuestions, type WeaknessMetric } from '@/domain/weakness';
import { checkAvailability, formatPercent } from '@/domain/exam-engine';
import { PART_LABELS } from '@/domain/schema';

const statusLabel = { insufficient: '資料不足', priority: '優先加強', stable: '持續練習' };

export function WeaknessPage() {
  const today = useTaipeiToday();
  const [range, setRange] = useState<'30' | 'all'>('30');
  const data = useLiveQuery(async () => {
    const sessions = await repos.sessions.listSubmitted();
    const records = await Promise.all(sessions.map(async session => ({ session, attempts: await repos.sessions.listAttempts(session.id) })));
    return { records, questions: await repos.bank.listApproved() };
  }, []);
  if (!data) return <p className="loading">讀取弱點分析…</p>;
  const analysis = analyzeWeakness(data.records, today, range);
  const practice = (metric: WeaknessMetric) => {
    const questions = focusQuestions(data.questions, [metric.part], metric.tag);
    const availability = checkAvailability(questions, [metric.part]);
    const counts = [...availability.achievable].filter(n => n > 0).sort((a, b) => a - b);
    const count = counts.filter(n => n <= 10).at(-1) ?? counts[0];
    if (!count) return <span className="field-hint">目前沒有符合條件的已審核題目。請先補充題庫。</span>;
    const params = new URLSearchParams({ parts: String(metric.part), count: String(count), sec: '45', focus: '1' });
    if (metric.tag) params.set('tag', metric.tag);
    return <><Link className="btn" to={`/mock?${params}`}>開始練習</Link><span className="field-hint">建議 {count} 題，完整題組。{availability.available < 10 ? `題庫目前僅 ${availability.available} 題。` : ''}</span></>;
  };
  const renderTable = (metrics: WeaknessMetric[], topics: boolean) => <div className="table-wrap"><table className="table weakness-table">
    <thead><tr><th scope="col">{topics ? '考點／單元' : '單元'}</th><th scope="col">答對率</th><th scope="col">作答／答對／答錯</th><th scope="col">判讀與練習</th></tr></thead>
    <tbody>{metrics.map(m => <tr key={JSON.stringify([m.part, m.tag])}>
      <th scope="row">{m.tag ? <>{m.tag}<br/><span className="field-hint">Part {m.part}</span></> : PART_LABELS[m.part]}</th>
      <td className="num" data-label="答對率">{m.accuracy === null ? '—' : formatPercent(m.accuracy)}</td>
      <td className="num" data-label="作答／答對／答錯">{m.total}／{m.correct}／{m.wrong}<br/><span className="field-hint">{m.distinct} 道不同題目</span></td>
      <td className="weakness-action"><p className="stat-note">{statusLabel[m.status]}</p><div className="weakness-practice">{practice(m)}</div></td>
    </tr>)}</tbody>
  </table></div>;
  return <>
    <PageHeader title="弱點分析" subtitle="從作答紀錄找出優先加強的單元與考點" />
    <section className="card">
      <label className="field"><span className="field-label">分析期間</span><select className="input" value={range} onChange={e => setRange(e.target.value as '30' | 'all')}>
        <option value="30">最近 30 天</option><option value="all">全部紀錄</option>
      </select></label>
      <p className="card-desc">{analysis.start ? `${analysis.start} 至 ${today}` : `截至 ${today}`}｜{analysis.sessions} 場已交卷練習（含錯題重考）。</p>
      <p className="notice">至少作答 10 次且涵蓋 5 道不同題目，才判定資料足夠；答對率低於 70% 標示「優先加強」。這是練習參考，並非多益官方分數。</p>
      <p className="field-hint">同一題跨場重考會重複計入；未作答計為答錯。每題可有多個考點，各考點題數不可相加。分析使用作答當時的題目標籤，練習使用目前已審核題庫；Part 6／7 會包含同篇的其他題目。</p>
      {!analysis.sessions && <p className="notice" role="status">這段期間還沒有已交卷的練習。<Link to="/mock">先完成一次練習</Link>，再回來查看分析。</p>}
    </section>
    <section className="card"><h2>單元分析</h2>{renderTable(analysis.metrics.filter(m => m.tag === null), false)}</section>
    <section className="card"><h2>考點分析</h2><p className="card-desc">優先顯示需要加強、且資料足夠的考點。</p>
      {analysis.metrics.some(m => m.tag !== null) ? renderTable(analysis.metrics.filter(m => m.tag !== null), true) : <p className="notice">尚無可分析的考點。完成練習後，題目有填寫 tags 標籤才會出現在這裡。</p>}
    </section>
  </>;
}
