# TOEIC 備考網頁 App：Codex 實作計畫

日期：2026-10-10。狀態：規劃文件，尚未開發或部署。
影片來源：https://www.youtube.com/watch?v=D_7EgY6x6og

## 觀察邊界
已使用 Computer Use 操作 Chrome 播放與跳轉，直接觀察 12:14–15:06 內多個畫面，並非連續逐秒完整觀看。影片展示本身就是 TOEIC PLANNER。沒有操作影片中的 App 本體、取得原始碼或驗證其後端。

實際看見：深海軍藍側欄、米白主內容、六個入口（設定／計畫／今日／模擬考／錯題本／題庫）；設定中的考試日期、目標分數、目前分數、每日分鐘、星期選擇、自評 1–5、Google Sheet 來源與遮罩 API 欄位、儲存成功訊息；日期分組任務、分鐘數、勾選與刪除線；今日四張摘要卡；模考 Part 複選、題數、每題秒數、來源、開始按鈕；選項、交卷後紅綠標示、中文解析；歷次成績圖表與列表；錯題本重考與清空按鈕；題庫數量卡、重新載入、複製 CSV、單元與難度選擇、15 題 AI 批次生成及載入狀態。

僅看見畫面宣告：所有資料只存在本機瀏覽器；錯題連續答對 2 次自動移除。未驗證底層儲存或移除行為。
僅影片說明宣稱：每天早上 6 點自動出題。未驗證排程執行。
未確認：AI 生成成功入庫、Sheet 同步正確性、實際音訊播放、手機版、帳號／跨裝置同步、正式 200 題模式。
紅框、紅箭頭、講者圓形人像是影片解說疊圖，不是 App 元件。

## 產品決策
先做個人使用、繁體中文介面、英文題目、桌機優先且支援手機。第一階段免登入、使用 IndexedDB；保留 Repository 介面以後接雲端。AI 手動出題在核心流程完成後才接入；06:00 自動生成與跨裝置同步列後續階段。全部新增規則都屬本計畫設計，不能宣稱來自影片。

## 頁面與視覺
- /settings：四區表單（目標與時間／星期／Part 1–7 自評／題庫來源）；儲存後提示。
- /plan：生成／重排計畫，日期分組、階段標籤、任務、預估分鐘、勾選框；重排預覽差異，保留已完成項目。
- /today：距考試天數、今日完成數、落後天數、連續達標天數；下方任務清單。
- /mock：Part、題數、每題秒數、來源與模式，歷次圖表和列表；開始後 /sessions/:id，結果 /sessions/:id/result。
- /mistakes：活動錯題數、用錯題本出模考、清空；移除改成封存，提供復原。
- /bank：題數／聽力／閱讀／錯題卡，來源載入與 CSV 匯入／匯出，AI 單元／難度／批次生成，下方 Part 題數統計與草稿審查。

建議設計 token：側欄 #0D2235、背景 #F3EEDF、卡片 #FAF7EF、文字 #202A32、邊線 #DCD5C8、正解 #E0EEE5、錯選 #F3DDDD。顏色為視覺估計，不是影片原始色碼。桌機側欄 220px，主區間距 28–32px，摘要卡四欄；手機改抽屜與兩欄卡。字體 Microsoft JhengHei，英文 system-ui。保持矩形卡片、細邊框、深色主要按鈕，不加入影片疊圖。

## 業務規則
1. 設定：考試日期不得早於今日；分鐘為正整數；自評 1–5；目標分數 10–990。本次 TOEIC 範圍限定 Listening & Reading。
2. 計畫：只排勾選星期，每日總分鐘不得超額；Part 自評越弱，權重越高；規則式分配，無需 AI。分為基礎／強化／考前複習三階段，比例先設 40%／40%／20%，短期計畫可合併階段。重新生成先預覽，保留已完成任務。
3. 今日：以 Asia/Taipei 日界線計算；今日任務全部完成算達標；休息日不增加或中斷 streak；落後天數為至少一項未完成任務的過去學習日數。畫面名稱採影片，但以上計算規則是新設計。
4. 測驗：先篩選 published 題目，題組保持完整；不足時顯示實際可用數並要求調整，禁止悄悄重複湊題。保存題目版本快照與作答；交卷後鎖定，重送不重複增加 attempt 或錯題。
5. 作答時間：簡易練習每題限時；切背景用 deadline 計算剩餘秒數。整卷模式第二階段另實作段落時限。練習可暫停，整卷計時不因切頁停止。
6. 結果：正確率與 Part 分析；錯選紅、正解綠且有文字／圖示；不將正確率直接轉換官方分數。
7. 錯題：首次答錯建活動項目；每次完成的重考答對才加 correct_streak；答錯歸零；連續答對 2 次封存。同一提交只能處理一次。清空為可還原的封存。
8. 音訊：Part 1 圖片＋音訊；Part 2 三選項；Part 3／4 共用音訊題組；Part 5／6／7 四選項，Part 6／7 支援共用／多篇文章。逐字稿練習時可展開，整卷模式交卷後才展示。缺音訊標示文字練習，不當作聽力模考。

## 資料模型
所有記錄使用 UUID、created_at、updated_at；schema_version 用於備份遷移。
- settings：exam_date、target_score、current_score、daily_minutes、available_weekdays、self_ratings、timezone。
- study_plans：id、version、start_date、exam_date、settings_snapshot、status。
- study_tasks：plan_id、date、part、title、minutes、phase、completed_at；完成事件是唯一進度來源。
- content_groups：part、passages[]、image_asset_id、audio_asset_id、transcript、speaker_labels。
- questions：group_id、part、stem、options[{key,text}]、correct_key、explanation_zh、tags[]、difficulty、source_id、version、status(draft/reviewed/published/rejected)。
- media_assets：id、kind、storage_path、mime_type、duration、source、license_status。
- sessions：mode、source、parts、question_snapshot[]、started_at、deadline_at、submitted_at、status、idempotency_key。
- answers：session_id、question_id、selected_key、answered_at、elapsed_ms；unique(session_id,question_id)。
- attempts：session_id、question_id、question_version、selected_key、is_correct、submitted_at；一次交卷一筆，復原不重複寫入。
- mistake_items：question_id、wrong_count、correct_streak、last_attempt_id、state(active/archived)、archived_at、archive_reason。
- import_batches：source、checksum、status、valid_count、errors[]、committed_at。
- generation_jobs：part、difficulty、requested_count、provider、status、job_key、error、generated_ids[]、review_status、cost_metadata。

關聯：plan 1:N tasks；content_group 1:N questions；session 1:N answers/attempts；question 1:N attempts；個人 question 1:0..1 mistake_item。雲端版所有個人資料增 owner_id 並套用權限隔離。

## 技術選型
Next.js App Router＋TypeScript、React、CSS token／Tailwind、Dexie＋IndexedDB、Zod、Recharts。Next.js Route Handlers 處理 AI 代理與後續受控匯入；所有 provider key 僅在伺服器環境變數。服務端 AI 出題完成後先回草稿，須確認並發布才進正式題庫。
後續雲端：Supabase Postgres＋Auth＋Storage＋RLS＋Cron。Google Sheets 僅為內容匯入入口，學習紀錄另存 App 資料庫。公開題庫可用 CSV；私有 Sheet 後續走有授權的服務端讀取。MVP 優先本機 CSV 匯入，避免先把私有 Sheet 改公開。
本機版只在使用者開啟 App 時運行；關閉後不能承諾每天 06:00 出題。需要全天候排程才部署服務端 worker。

## API／模組契約
storage/Repository.ts：Settings、Plans、Bank、Sessions、Mistakes、Backups 分開介面。
domain/planner.ts、exam-engine.ts、mistake-policy.ts、import-validator.ts、backup-migrations.ts：純函式，與畫面分離。
POST /api/generation-jobs：驗證參數、費用／數量上限、回 job id；GET /api/generation-jobs/:id：查狀態；POST /api/generation-jobs/:id/approve：明確發布。個人本機階段生成草稿由客戶端 Repository 保存，不能假裝已有跨裝置工作佇列。
匯入兩步：preview→commit；成功批次才原子寫入，失敗保留原資料。CSV 保留 id,part,passage,question,a,b,c,d,answer,explanation,audio_url，相容影片樣式；擴充 group_id、image_url、tags、difficulty、version；Part 2 的 d 可空。
備份 JSON 必含設定、計畫、任務、題庫、題組、測驗、答案、attempt、錯題及 schema_version；二進位音訊須另外打包或清楚列為未包含，不可宣稱只有 URL 的 JSON 能完整離線還原。

## 開發順序與驗收
P0 規格與 fixture：交付 README、AGENTS、schema、demo 題庫；至少覆盖 Part 2 三選項、Part 5 四選項、Part 7 共用文章與一次錯題重考。
P1 介面與設定：六頁骨架、響應式、IndexedDB、設定驗證；重新整理設定不消失。
P2 計畫與今日：排程、勾選、重排預覽、四張卡；兩頁共享完成狀態，休息日與跨日計算一致。
P3 核心測驗：Part 篩選、題數、計時、存草稿、交卷、解析、歷史圖；重整續答、重複交卷不重複紀錄。
P4 錯題與備份：自動收錄、重考、兩次答對封存、復原、JSON 匯入／匯出；完整往返資料一致。
P5 題庫管理：CSV preview／commit、錯誤定位、題數統計；錯誤匯入不損壞現有資料。
P6 聽力內容：音訊／圖片／題組，瀏覽器需使用者手勢啟播、逐字稿策略；缺媒體明確提示。
P7 AI 手動出題：服務端金鑰、結構與答案一致性檢查、去重、審查發布、失敗可重試；無 AI 仍可讀書與作答。
P8 後續：正式整卷時限、雲端同步、06:00 批次排程、觀測與費用上限。先驗證跨裝置權限與排程紀錄，才對外宣稱功能可用。

## 必要測試
- 計畫：未選星期、最後一天、總時間超額、重新排程保留已完成。
- 測驗：Part 2 三選項、共用題組、題庫不足、背景切換、音訊失敗、重新整理、交卷重送。
- 錯題：錯→對→對封存；錯→對→錯歸零；重複提交不多計；清空可復原。
- 匯入與還原：損壞 JSON、舊版遷移、錯誤 CSV、重複 id、正式題庫版本更新後歷史不變。
- AI：逾時、缺選項、錯誤正解、重複題、缺音訊、審查前不可被抽到、金鑰不出現在瀏覽器。
- UI：360px 與桌機、鍵盤作答、顏色之外可辨識對錯、長英文不溢出。

## 可直接交給 Codex 的任務
依本文件先完成 P0–P5 的個人本機 MVP，再進 P6 與 P7。使用六個影片導航名稱，深海軍藍側欄／米白內容／矩形卡片／微軟正黑體，英文題目與繁體中文解析。不要加入影片紅框、人像或箭頭。先用人工審核 demo 題庫，AI 非必要依賴。每階段交付可操作畫面、相關驗收結果、剩餘限制；備份／匯入／重排必須保留既有資料。不要將只有文字的聽力題標成完整聽力測驗；不要將正確率當正式多益分數。未要求發布前先本機開發與驗收。本文件之新增規則不代表影片已實現。

## 官方參考
- TOEIC 格式：https://www.ets.org/toeic/about/listening-reading.html
- Next.js：https://nextjs.org/docs/app/getting-started/route-handlers
- Supabase RLS：https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Cron：https://supabase.com/docs/guides/cron
