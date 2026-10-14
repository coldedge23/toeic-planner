import type {
  Answer,
  Attempt,
  Backup,
  ContentGroup,
  ImportBatch,
  MistakeItem,
  Part,
  OptionKey,
  Question,
  Session,
  Settings,
  SettingsInput,
  StudyPlan,
  StudyTask,
  VocabularyInput, VocabularyWord, VocabularyReview, VocabularySettings, VocabularyRating,
} from "@/domain/schema";
import type { CsvRow, ImportPlan } from "@/domain/import-validator";
import type { ListeningQuestion, ListeningSession, ListeningKey } from "@/domain/schema";
import type { ListeningPack, ListeningPlayback } from "@/domain/listening-packs";

export interface ListeningRepository {
  audio: typeof import('./listening-audio').listeningAudio;
  packs(): Promise<ListeningPack[]>;
  playback(session: ListeningSession): Promise<ListeningPlayback>;
  questions(): Promise<ListeningQuestion[]>;
  list(): Promise<ListeningSession[]>;
  create(session: ListeningSession): Promise<void>;
  answer(id: string, revision: number, key: ListeningKey, now: Date): Promise<ListeningSession>;
  next(id: string, revision: number, now: Date): Promise<ListeningSession>;
  progress(id: string, revision: number, seconds: number, now: Date): Promise<ListeningSession>;
  finish(id: string, revision: number, now: Date): Promise<ListeningSession>;
}

/**
 * 儲存層介面。畫面只透過這些介面讀寫，之後接雲端（例如 Supabase）時替換實作即可。
 * 各介面依 P 階段逐步實作；尚未實作的方法會在對應階段補上。
 */

export interface SettingsRepository {
  get(): Promise<Settings | null>;
  /** 寫入前已通過 validateSettingsInput；第一次儲存建立新紀錄，之後更新同一筆。 */
  save(input: SettingsInput): Promise<Settings>;
}

export interface PlansRepository {
  getTask(taskId: string): Promise<StudyTask | null>;
  /** 使用者在交卷後明確確認才完成任務；重複確認不改寫完成時間。 */
  completeFromSession(sessionId: string): Promise<void>;
  getActivePlan(): Promise<StudyPlan | null>;
  listTasks(planId: string): Promise<StudyTask[]>;
  /** 建立第一份計畫；已有生效中的計畫時拋出錯誤（請改用 applyReschedule）。 */
  createPlan(plan: StudyPlan, tasks: StudyTask[]): Promise<void>;
  /**
   * 原子性地套用重新排程：舊計畫標為 superseded（其未完成任務留在舊計畫不刪），
   * 已完成任務移到新計畫，再寫入新任務。任一步失敗時全部不變。
   */
  applyReschedule(input: {
    oldPlanId: string;
    newPlan: StudyPlan;
    newTasks: StudyTask[];
    keptTaskIds: string[];
  }): Promise<void>;
  /** 勾選或取消勾選任務；完成時間是唯一的進度來源。 */
  setTaskCompleted(taskId: string, completed: boolean): Promise<void>;
}

export interface BankStats {
  total: number;
  byPart: Partial<Record<Part, number>>;
}

export interface ImportCommitResult {
  batch: ImportBatch;
  summary: ImportPlan["summary"];
  notices: ImportPlan["notices"];
}

export interface BankRepository {
  /** 僅補入缺少的內建 demo 題庫；既有題目與文章不覆寫。 */
  seedDemo(): Promise<void>;
  /** 全部題目（含草稿與退回）與題組，供匯入比對與匯出。 */
  listAll(): Promise<{ questions: Question[]; groups: ContentGroup[] }>;
  /**
   * 在單一交易中重新比對並寫入匯入結果，同時記錄匯入批次。
   * 驗證有錯誤的資料不可傳入（呼叫端先擋下）。
   */
  commitImport(input: { rows: CsvRow[]; source: string; checksum: string }): Promise<ImportCommitResult>;
  listImportBatches(limit: number): Promise<ImportBatch[]>;
  /** 只統計可被抽題的「已審核」題目。 */
  stats(): Promise<BankStats>;
  listApproved(parts?: readonly Part[]): Promise<Question[]>;
  getGroups(ids: readonly string[]): Promise<ContentGroup[]>;
}

export interface SubmitResult {
  session: Session;
  attempts: Attempt[];
  /** true = 這次呼叫之前就已交卷（重送），沒有新增任何紀錄 */
  alreadySubmitted: boolean;
}

export interface SessionsRepository {
  create(session: Session): Promise<void>;
  get(id: string): Promise<Session | null>;
  /** 進行中的測驗（最多一場）。 */
  getInProgress(): Promise<Session | null>;
  listSubmitted(): Promise<Session[]>;
  getAnswers(sessionId: string): Promise<Answer[]>;
  listAttempts(sessionId: string): Promise<Attempt[]>;
  /** 存作答草稿；已交卷的測驗會拒絕寫入。 */
  saveAnswer(input: { sessionId: string; questionId: string; selectedKey: OptionKey | null; elapsedMs: number }): Promise<void>;
  pause(sessionId: string, now: Date): Promise<void>;
  resume(sessionId: string, now: Date): Promise<void>;
  /** 交卷並寫入 attempts。冪等：重複呼叫不會重複寫入。 */
  submit(sessionId: string, now: Date): Promise<SubmitResult>;
}

export interface MistakeEntry {
  item: MistakeItem;
  /** 題庫中目前的題目；題目已被刪除時為 null */
  question: Question | null;
  /** Part 6／7 的文章題組；Part 5 或題組已不在題庫時為 null */
  group: ContentGroup | null;
  /** 在題組中的順序（0 起算，依 source_id 排序，與出題順序相同）；用來推算 Part 6 的空格編號 */
  positionInGroup: number;
  /** 最後一次答錯時的作答；selected_key 為 null 表示未作答 */
  lastWrong: { selected_key: OptionKey | null; submitted_at: string } | null;
}

export interface MistakesRepository {
  countActive(): Promise<number>;
  listActive(): Promise<MistakeEntry[]>;
  listArchived(): Promise<MistakeEntry[]>;
  /** 進行中錯題對應的題目（只含已審核者，供錯題本出題）。 */
  activeQuestions(): Promise<Question[]>;
  /** 清空：全部改為封存，回傳本次清空的時間戳（用於復原）。沒有錯題時回傳 null。 */
  clearAll(now: Date): Promise<string | null>;
  /** 復原某次清空的所有錯題，回傳復原筆數。 */
  restoreCleared(clearedAt: string): Promise<number>;
  restore(itemId: string): Promise<void>;
}

export interface BackupsRepository {
  exportAll(): Promise<Backup>;
  /** 以備份取代目前全部資料；在單一交易中完成，失敗時原資料不變。 */
  importAll(backup: Backup): Promise<void>;
}

export interface Repositories {
  listening: ListeningRepository;
  vocabulary: VocabularyRepository;
  settings: SettingsRepository;
  plans: PlansRepository;
  bank: BankRepository;
  sessions: SessionsRepository;
  mistakes: MistakesRepository;
  backups: BackupsRepository;
}

export interface VocabularyRepository {
  list(): Promise<VocabularyWord[]>;
  get(wordId: string): Promise<VocabularyWord | null>;
  findByTerm(term: string): Promise<VocabularyWord | null>;
  add(input: VocabularyInput): Promise<VocabularyWord>;
  /** 全批驗證後以單一交易新增；重複單字略過，既有釋義與複習進度不變。 */
  importBatch(inputs: readonly VocabularyInput[]): Promise<{ added: number; skipped: number }>;
  update(wordId: string, input: VocabularyInput, expectedUpdatedAt: string): Promise<void>;
  settings(): Promise<VocabularySettings>;
  saveSettings(limits: Pick<VocabularySettings, "review_limit" | "new_limit">): Promise<void>;
  daily(today: string): Promise<{ queue: VocabularyWord[]; due: number; fresh: number; reviewedToday: number }>;
  review(input: { wordId: string; rating: VocabularyRating; reviewId: string; expectedUpdatedAt: string; now: Date }): Promise<VocabularyReview>;
}
