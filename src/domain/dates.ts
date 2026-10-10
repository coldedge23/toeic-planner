import { TIMEZONE } from "./schema";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 以 Asia/Taipei 日界線取得 YYYY-MM-DD。 */
export function toTaipeiDate(instant: Date): string {
  return dateFormatter.format(instant);
}

export function todayInTaipei(now: Date = new Date()): string {
  return toTaipeiDate(now);
}

const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** 兩個 YYYY-MM-DD 之間相差的日數（to − from）。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = 週日 … 6 = 週六。日期字串本身沒有時區，直接以 UTC 解析即可。 */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/** 例：10/12（一） */
export function formatDateLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}（${WEEKDAY_ZH[weekdayOf(date)]}）`;
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
