import { describe, expect, it } from "vitest";
import { defaultSettingsInput, validateSettingsInput } from "@/domain/settings";
import { daysBetween, todayInTaipei } from "@/domain/dates";

// 2026-10-10 00:30 台北時間 = 2026-10-09 16:30 UTC
const NOW = new Date("2026-10-09T16:30:00Z");
const valid = { ...defaultSettingsInput(NOW), exam_date: "2026-12-01" };

describe("todayInTaipei", () => {
  it("以台北日界線換日，而非 UTC", () => {
    expect(todayInTaipei(NOW)).toBe("2026-10-10");
  });
  it("daysBetween 計算日差", () => {
    expect(daysBetween("2026-10-10", "2026-12-01")).toBe(52);
  });
});

describe("validateSettingsInput", () => {
  it("合法設定通過", () => {
    expect(validateSettingsInput(valid, NOW).ok).toBe(true);
  });

  it("考試日期早於今日（台北）失敗；等於今日通過", () => {
    const past = validateSettingsInput({ ...valid, exam_date: "2026-10-09" }, NOW);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors.exam_date).toBe("考試日期不得早於今日");
    expect(validateSettingsInput({ ...valid, exam_date: "2026-10-10" }, NOW).ok).toBe(true);
  });

  it.each([
    ["target_score", 5],
    ["target_score", 995],
    ["target_score", 800.5],
    ["current_score", 0],
    ["daily_minutes", 0],
    ["daily_minutes", -30],
    ["daily_minutes", 12.5],
    ["available_weekdays", []],
    ["available_weekdays", [1, 1]],
    ["available_weekdays", [7]],
  ])("%s = %j 失敗", (field, value) => {
    const r = validateSettingsInput({ ...valid, [field]: value }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toBeTruthy();
  });

  it("自評超出 1–5 失敗", () => {
    const r = validateSettingsInput({ ...valid, self_ratings: { 5: 0, 6: 3, 7: 6 } }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.self_ratings).toBeTruthy();
  });

  it("目前分數可留白", () => {
    expect(validateSettingsInput({ ...valid, current_score: null }, NOW).ok).toBe(true);
  });

  it("CSV 網址必須是 https，可留白", () => {
    expect(validateSettingsInput({ ...valid, bank_csv_url: "http://example.com/a.csv" }, NOW).ok).toBe(false);
    expect(validateSettingsInput({ ...valid, bank_csv_url: "not a url" }, NOW).ok).toBe(false);
    expect(
      validateSettingsInput(
        { ...valid, bank_csv_url: "https://docs.google.com/spreadsheets/d/e/x/pub?output=csv" },
        NOW,
      ).ok,
    ).toBe(true);
  });
});
