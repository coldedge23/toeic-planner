# 多益備考 TOEIC PLANNER

個人用的 TOEIC 備考網頁 App：繁體中文介面、英文題目。目前範圍是閱讀 Part 5–7。

架構與決策紀錄：[docs/20261010_TOEIC備考App架構計畫_v2.md](docs/20261010_TOEIC備考App架構計畫_v2.md)

## 架構摘要

- 純前端：Vite＋React＋TypeScript，靜態部署，電腦與手機共用同一個網址。
- 資料存在瀏覽器的 IndexedDB（Dexie）。電腦與手機的紀錄**不會自動同步**，需要用 JSON 備份手動搬移。
- 題庫來源：Google 試算表發佈成 CSV，App 只匯入狀態為「已審核」的題目。
- AI 出題由 Google Apps Script 執行（每天 06:00 自動出題，或從 Sheet 選單手動出題）；App 內不存放任何 API 金鑰。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 單元測試（Vitest + fake-indexeddb）
npm run typecheck
npm run build      # 輸出到 dist/
npm run preview:pages  # 以 /toeic-planner/ 為根路徑建置並預覽（模擬 GitHub Pages）
```

## 部署（GitHub Pages）

推送到 `main` 後，`.github/workflows/deploy.yml` 會自動：安裝套件 → 執行測試 → 以 `/<repo 名稱>/` 為根路徑建置 → 部署到 `https://<帳號>.github.io/<repo 名稱>/`。測試沒過就不會部署。

第一次需在 GitHub repo 的 Settings → Pages → Build and deployment → Source 選「GitHub Actions」。

## 手機使用

- 用手機瀏覽器開啟網址後，「加入主畫面」即可像 App 一樣開啟（PWA），開過一次後離線也能作答。
- 電腦與手機的紀錄各自獨立，換裝置時用「設定 → 備份與還原」搬移。

## 目錄

| 路徑 | 內容 |
|---|---|
| `src/domain/` | 純函式與 Zod schema，不依賴畫面或儲存層 |
| `src/storage/Repository.ts` | 儲存層介面；畫面只透過這些介面讀寫 |
| `src/storage/dexie/` | IndexedDB 實作 |
| `src/fixtures/demo-bank.ts` | 內建 demo 題庫（原創練習題，非官方試題） |
| `src/pages/` | 六個頁面：設定／計畫／今日／模擬考／錯題本／題庫 |
| `tests/` | 單元測試 |

## 進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| P0 | schema、demo 題庫、Repository、測試 | 完成 |
| P1 | 六頁骨架、響應式、設定頁 | 完成 |
| P2 | 計畫（排程、重排預覽、模擬考日）與今日（四張卡、追進度建議） | 完成 |
| P3 | 模擬考：抽題（題組完整）、計時與暫停、續答、交卷、逐題解析、歷次成績 | 完成 |
| P4 | 錯題本（自動收錄、錯題重考、連續答對 2 次封存、清空可復原）、JSON 備份匯出／還原 | 完成 |
| P5 | 題庫匯入（Sheet CSV 網址或本機檔、預覽、錯誤定位、只收已審核、版本更新與下架）、CSV 匯出與範本 | 完成 |
| P6 | PWA（離線可用、可加入主畫面）、頁面按需載入、GitHub Pages 自動部署 | 完成（待推送） |
| P7 | Apps Script：建題庫 Sheet、每日與手動出題 | 未開始 |

## 限制

- 清除瀏覽器網站資料會讓學習紀錄消失，請定期到「設定 → 備份與還原」匯出 JSON 備份。備份不含音訊與圖片檔。
- 正確率不會換算成多益官方分數。
- demo 題庫是原創練習題，不是 ETS 官方試題。
