# AGENTS.md

給在本專案工作的 AI 代理（Claude Code、Codex）的規則。架構決策以 `docs/20261010_TOEIC備考App架構計畫_v2.md` 為準；原始計畫 `TOEIC_App_Codex實作計畫.md` 是 v1，有衝突時以 v2 為準。

## 溝通
- 回覆一律用繁體中文；程式碼、指令、檔名維持原文。
- 多步驟任務先列計畫，等使用者確認後才動手。

## 架構邊界
- 純前端 SPA（Vite＋React＋TypeScript）。不要加入伺服器端程式或 Next.js。
- 畫面只能透過 `src/storage/Repository.ts` 的介面存取資料，不要在元件裡直接呼叫 Dexie。
- `src/domain/` 只放純函式與 schema，不可 import React、Dexie 或瀏覽器 API（`Intl` 除外）。
- 閱讀排程、題庫匯入與模擬考維持 Part 5–7（`ACTIVE_PARTS`）。2026-10-14 使用者同意新增獨立 Part 2 聽力頁；聽力使用自己的 Repository、三選項題型與紀錄，不混入閱讀排程／抽題。Part 1／3／4 尚未開放。
- App 內不得出現 API 金鑰欄位或任何金鑰；AI 出題只在 Google Apps Script 進行。

## 資料規則
- 日期一律用 Asia/Taipei 日界線（`src/domain/dates.ts`）。
- 只有 `status = "approved"`（Sheet 上的「已審核」）的題目可以被抽到。
- 修改 Dexie schema 時新增 `version(n)` 並寫 upgrade，不可改舊版本；備份格式變更時遞增 `SCHEMA_VERSION`。
- 匯入、備份還原、重排計畫都不可以損壞或覆蓋既有資料；失敗時保留原資料。
- 不要把正確率換算成多益官方分數；題目內容不得抄襲官方或網路試題。

## 驗收
- 每次變更後執行 `npm test` 與 `npm run typecheck`，兩者都要通過。
- UI 變更要確認桌機版與 360px 寬度，並且對錯不可只靠顏色區分（要有文字或圖示）。
- 視覺：深海軍藍側欄、米白內容、矩形卡片與細邊框；字體 Noto Sans TC（中文）＋Jost（英文、數字）；不使用 emoji。
