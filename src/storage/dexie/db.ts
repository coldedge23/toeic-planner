import Dexie, { type EntityTable } from "dexie";
import type { ListeningSession } from "@/domain/schema";
import type {
  Answer,
  Attempt,
  ContentGroup,
  GenerationJob,
  ImportBatch,
  MediaAsset,
  MistakeItem,
  Question,
  Session,
  Settings,
  StudyPlan,
  StudyTask,
  VocabularyWord, VocabularyReview, VocabularySettings,
} from "@/domain/schema";

export class ToeicDB extends Dexie {
  listening_sessions!: EntityTable<ListeningSession, "id">;
  settings!: EntityTable<Settings, "id">;
  study_plans!: EntityTable<StudyPlan, "id">;
  study_tasks!: EntityTable<StudyTask, "id">;
  content_groups!: EntityTable<ContentGroup, "id">;
  questions!: EntityTable<Question, "id">;
  media_assets!: EntityTable<MediaAsset, "id">;
  sessions!: EntityTable<Session, "id">;
  answers!: EntityTable<Answer, "id">;
  attempts!: EntityTable<Attempt, "id">;
  mistake_items!: EntityTable<MistakeItem, "id">;
  import_batches!: EntityTable<ImportBatch, "id">;
  generation_jobs!: EntityTable<GenerationJob, "id">;
  vocabulary_words!: EntityTable<VocabularyWord, "id">;
  vocabulary_reviews!: EntityTable<VocabularyReview, "id">;
  vocabulary_settings!: EntityTable<VocabularySettings, "id">;

  constructor(name = "toeic-planner") {
    super(name);
    // 只列需要查詢的欄位；索引變更時新增 version(n) 並撰寫 upgrade，不可改舊版本。
    this.version(1).stores({
      settings: "id",
      study_plans: "id, status",
      study_tasks: "id, plan_id, date, [plan_id+date]",
      content_groups: "id, part",
      questions: "id, part, status, group_id, &source_id, [status+part]",
      media_assets: "id",
      sessions: "id, status, started_at, &idempotency_key",
      answers: "id, session_id, &[session_id+question_id]",
      attempts: "id, session_id, question_id",
      mistake_items: "id, &question_id, state",
      import_batches: "id, checksum",
      generation_jobs: "id, &job_key, status",
    });
    // v2：同一場測驗的同一題只能有一筆 attempt（交卷重送不重複寫入）
    this.version(2).stores({
      attempts: "id, session_id, question_id, &[session_id+question_id]",
    });
    this.version(3).stores({
      sessions: "id, status, started_at, &idempotency_key, study_task_id",
    }).upgrade(async (tx) => {
      await tx.table("sessions").toCollection().modify((session) => {
        session.study_task_id = null;
      });
    });
    this.version(4).stores({
      vocabulary_words: "id, &normalized_term, state, due_date",
      vocabulary_reviews: "id, word_id, date",
      vocabulary_settings: "id",
    }).upgrade(async () => {
      // 新增空資料表；舊學習資料與v3的任務關聯完全保留，不自動新增單字。
    });
    this.version(5).stores({
      listening_sessions: "id, status, updated_at",
    }).upgrade(async () => {
      // 僅新增聽力資料表；保留 v1–v4 全部紀錄，不自動載入音訊或題目。
    });
  }
}
