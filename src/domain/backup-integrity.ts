import { BackupSchema, SCHEMA_VERSION, type Backup } from "./schema";
import { sessionMatchesTask } from "./task-practice";
import { normalizeTerm } from "./vocabulary";
import { toTaipeiDate } from "./dates";

/** 格式與跨表關聯均通過後才允許還原；歷史題目以測驗快照為準。 */
export function validateBackup(input: unknown): Backup {
  const b = BackupSchema.parse(input);
  const fail = (message: string): never => { throw new Error(`備份資料關聯錯誤：${message}`); };
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) fail(`${label} 重複`);
  };
  if (b.schema_version !== SCHEMA_VERSION) fail("備份版本尚未轉換");
  unique(b.vocabulary_words.map((w) => w.normalized_term), "單字");
  unique(b.vocabulary_reviews.map((r) => `${r.word_id}/${r.date}`), "同日單字複習");
  if (b.vocabulary_settings.length > 1) fail("單字每日設定超過一筆");
  const words = new Map(b.vocabulary_words.map((w) => [w.id, w]));
  for (const w of words.values()) {
    if (w.normalized_term !== normalizeTerm(w.term)) fail(`單字 ${w.term} 的識別文字不符`);
    if (w.source?.question.group_id && (w.source.group?.id !== w.source.question.group_id || w.source.group.part !== w.source.question.part)) fail(`單字 ${w.term} 的來源文章不完整`);
    const records = b.vocabulary_reviews.filter((r) => r.word_id === w.id);
    if (w.review_count !== records.length || (w.state === "new" && records.length > 0) || (w.state === "learning" && records.length === 0)) fail(`單字 ${w.term} 的複習次數或狀態不符`);
    const last = [...records].sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))[0];
    if (w.state === "new" && (w.interval_days !== 0 || w.last_review_at !== null)) fail(`新單字 ${w.term} 的排程不符`);
    if (last && (w.last_review_at !== last.reviewed_at || w.due_date !== last.next_due_date || w.interval_days !== last.interval_days)) fail(`單字 ${w.term} 的最新複習排程不符`);
  }
  for (const r of b.vocabulary_reviews) {
    if (!words.has(r.word_id) || r.date !== toTaipeiDate(new Date(r.reviewed_at))) fail(`單字複習 ${r.id} 的來源或台北日期不符`);
  }
  for (const [name, rows] of Object.entries(b)) {
    if (Array.isArray(rows)) unique(rows.map((r: { id: string }) => r.id), `${name} 的 id`);
  }
  unique(b.questions.map((q) => q.source_id), "題目來源編號");
  unique(b.content_groups.flatMap((g) => g.source_id ? [g.source_id] : []), "題組來源編號");
  unique(b.sessions.map((s) => s.idempotency_key), "測驗識別碼");
  unique(b.generation_jobs.map((j) => j.job_key), "出題工作識別碼");
  unique(b.answers.map((a) => `${a.session_id}/${a.question_id}`), "測驗答案");
  unique(b.attempts.map((a) => `${a.session_id}/${a.question_id}`), "交卷作答");
  unique(b.mistake_items.map((m) => m.question_id), "錯題");
  if (b.settings.length > 1 || b.study_plans.filter((p) => p.status === "active").length > 1 ||
      b.sessions.filter((s) => s.status === "in_progress").length > 1) fail("設定、生效計畫或進行中測驗超過一筆");
  const plans = new Set(b.study_plans.map((p) => p.id));
  const tasks = new Map(b.study_tasks.map((t) => [t.id, t]));
  const groups = new Map(b.content_groups.map((g) => [g.id, g]));
  const media = new Set(b.media_assets.map((m) => m.id));
  const sessions = new Map(b.sessions.map((s) => [s.id, s]));
  const attempts = new Map(b.attempts.map((a) => [a.id, a]));
  const answers = new Map(b.answers.map((a) => [`${a.session_id}/${a.question_id}`, a]));
  const knownQuestions = new Set(b.questions.map((q) => q.id));
  for (const t of b.study_tasks) if (!plans.has(t.plan_id)) fail(`任務 ${t.id} 找不到計畫`);
  for (const q of b.questions) {
    if (q.group_id && groups.get(q.group_id)?.part !== q.part) fail(`題目 ${q.source_id} 找不到相同 Part 的文章`);
  }
  for (const g of b.content_groups) {
    for (const id of [g.image_asset_id, g.audio_asset_id]) if (id && !media.has(id)) fail(`題組 ${g.id} 找不到媒體資料`);
  }
  for (const s of b.sessions) {
    if (s.study_task_id && !tasks.has(s.study_task_id)) fail(`測驗 ${s.id} 找不到關聯任務`);
    if (s.study_task_id && !sessionMatchesTask(s, tasks.get(s.study_task_id)!)) fail(`測驗 ${s.id} 與關聯任務的單元不符`);
    unique(s.question_snapshot.map((i) => i.question.id), `測驗 ${s.id} 快照題目`);
    for (const i of s.question_snapshot) {
      knownQuestions.add(i.question.id);
      if (i.question.group_id && (i.group?.id !== i.question.group_id || i.group.part !== i.question.part)) {
        fail(`測驗 ${s.id} 的文章快照不完整`);
      }
    }
    if (s.status === "submitted" && (!s.submitted_at || b.attempts.filter((a) => a.session_id === s.id).length !== s.question_snapshot.length)) {
      fail(`測驗 ${s.id} 的交卷作答不完整`);
    }
  }
  for (const a of [...b.answers, ...b.attempts]) {
    const s = sessions.get(a.session_id);
    if (!s?.question_snapshot.some((i) => i.question.id === a.question_id)) fail(`作答 ${a.id} 找不到測驗或快照題目`);
  }
  for (const a of b.attempts) {
    const s = sessions.get(a.session_id)!;
    const q = s.question_snapshot.find((i) => i.question.id === a.question_id)!.question;
    if (s.status !== "submitted" || q.version !== a.question_version) fail(`交卷作答 ${a.id} 的狀態或題目版本不符`);
    if (a.is_correct !== (a.selected_key === q.correct_key)) fail(`交卷作答 ${a.id} 的評分不符快照`);
    if ((answers.get(`${a.session_id}/${a.question_id}`)?.selected_key ?? null) !== a.selected_key) {
      fail(`交卷作答 ${a.id} 與儲存答案不一致`);
    }
  }
  for (const m of b.mistake_items) {
    if (!knownQuestions.has(m.question_id)) fail(`錯題 ${m.id} 找不到題目或歷史快照`);
    if (m.last_attempt_id && attempts.get(m.last_attempt_id)?.question_id !== m.question_id) fail(`錯題 ${m.id} 的最後作答不符`);
  }
  return b;
}
