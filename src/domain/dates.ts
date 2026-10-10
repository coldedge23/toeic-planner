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

/** 兩個 YYYY-MM-DD 之間相差的日數（to − from）。 */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
