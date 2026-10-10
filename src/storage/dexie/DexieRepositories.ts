import {
  BackupSchema,
  SCHEMA_VERSION,
  SettingsInputSchema,
  SettingsSchema,
  TIMEZONE,
  type Part,
  type Settings,
  type SettingsInput,
} from "@/domain/schema";
import { nowIso } from "@/domain/dates";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";
import type { BankStats, Repositories } from "../Repository";
import type { ToeicDB } from "./db";

export function createDexieRepositories(db: ToeicDB): Repositories {
  return {
    settings: {
      async get() {
        return (await db.settings.toCollection().first()) ?? null;
      },
      async save(input: SettingsInput) {
        const value = SettingsInputSchema.parse(input);
        return db.transaction("rw", db.settings, async () => {
          const existing = await db.settings.toCollection().first();
          const now = nowIso();
          const record: Settings = SettingsSchema.parse({
            ...value,
            id: existing?.id ?? crypto.randomUUID(),
            created_at: existing?.created_at ?? now,
            updated_at: now,
            timezone: TIMEZONE,
          });
          await db.settings.put(record);
          return record;
        });
      },
    },

    plans: {
      async getActivePlan() {
        return (await db.study_plans.where("status").equals("active").first()) ?? null;
      },
      async listTasks(planId) {
        return db.study_tasks.where("plan_id").equals(planId).sortBy("date");
      },
    },

    bank: {
      async seedDemo() {
        await db.transaction("rw", db.content_groups, db.questions, async () => {
          await db.content_groups.bulkPut(demoGroups);
          await db.questions.bulkPut(demoQuestions);
        });
      },
      async stats() {
        const approved = await db.questions.where("status").equals("approved").toArray();
        const byPart: BankStats["byPart"] = {};
        for (const q of approved) byPart[q.part] = (byPart[q.part] ?? 0) + 1;
        return { total: approved.length, byPart };
      },
      async listApproved(parts?: readonly Part[]) {
        if (!parts) return db.questions.where("status").equals("approved").toArray();
        return db.questions
          .where("[status+part]")
          .anyOf(parts.map((p) => ["approved", p]))
          .toArray();
      },
      async getGroups(ids) {
        const groups = await db.content_groups.bulkGet([...ids]);
        return groups.filter((g) => g !== undefined);
      },
    },

    sessions: {},

    mistakes: {
      async countActive() {
        return db.mistake_items.where("state").equals("active").count();
      },
    },

    backups: {
      async exportAll() {
        return BackupSchema.parse({
          schema_version: SCHEMA_VERSION,
          exported_at: nowIso(),
          media_binaries_included: false,
          settings: await db.settings.toArray(),
          study_plans: await db.study_plans.toArray(),
          study_tasks: await db.study_tasks.toArray(),
          content_groups: await db.content_groups.toArray(),
          questions: await db.questions.toArray(),
          media_assets: await db.media_assets.toArray(),
          sessions: await db.sessions.toArray(),
          answers: await db.answers.toArray(),
          attempts: await db.attempts.toArray(),
          mistake_items: await db.mistake_items.toArray(),
          import_batches: await db.import_batches.toArray(),
          generation_jobs: await db.generation_jobs.toArray(),
        });
      },
    },
  };
}
