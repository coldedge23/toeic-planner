import type { ReactNode } from "react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** 尚未實作的功能區塊，標明預計在哪個階段開放。 */
export function Upcoming({ stage, children }: { stage: string; children: ReactNode }) {
  return (
    <p className="notice">
      {children}（{stage} 開放）
    </p>
  );
}
