import type {
  Backup,
  ContentGroup,
  Part,
  Question,
  Settings,
  SettingsInput,
  StudyPlan,
  StudyTask,
} from "@/domain/schema";

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
  getActivePlan(): Promise<StudyPlan | null>;
  listTasks(planId: string): Promise<StudyTask[]>;
}

export interface BankStats {
  total: number;
  byPart: Partial<Record<Part, number>>;
}

export interface BankRepository {
  /** 寫入內建 demo 題庫；以固定 id 覆蓋，重複呼叫不會重複新增。 */
  seedDemo(): Promise<void>;
  /** 只統計可被抽題的「已審核」題目。 */
  stats(): Promise<BankStats>;
  listApproved(parts?: readonly Part[]): Promise<Question[]>;
  getGroups(ids: readonly string[]): Promise<ContentGroup[]>;
}

export interface SessionsRepository {}

export interface MistakesRepository {
  countActive(): Promise<number>;
}

export interface BackupsRepository {
  exportAll(): Promise<Backup>;
}

export interface Repositories {
  settings: SettingsRepository;
  plans: PlansRepository;
  bank: BankRepository;
  sessions: SessionsRepository;
  mistakes: MistakesRepository;
  backups: BackupsRepository;
}
