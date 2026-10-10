import {
  AnswerSchema,
  AttemptSchema,
  BackupSchema,
  SessionSchema,
  SCHEMA_VERSION,
  SettingsInputSchema,
  SettingsSchema,
  StudyPlanSchema,
  StudyTaskSchema,
  TIMEZONE,
  type Part,
  type Settings,
  type SettingsInput,
} from "@/domain/schema";
import { nowIso } from "@/domain/dates";
import { gradeSession, pauseSession, resumeSession } from "@/domain/exam-engine";
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
      async createPlan(plan, tasks) {
        const validPlan = StudyPlanSchema.parse(plan);
        const validTasks = tasks.map((t) => StudyTaskSchema.parse(t));
        await db.transaction("rw", db.study_plans, db.study_tasks, async () => {
          if ((await db.study_plans.where("status").equals("active").count()) > 0) {
            throw new Error("已有生效中的計畫，請改用重新排程");
          }
          await db.study_plans.add(validPlan);
          await db.study_tasks.bulkAdd(validTasks);
        });
      },
      async applyReschedule({ oldPlanId, newPlan, newTasks, keptTaskIds }) {
        const validPlan = StudyPlanSchema.parse(newPlan);
        const validTasks = newTasks.map((t) => StudyTaskSchema.parse(t));
        await db.transaction("rw", db.study_plans, db.study_tasks, async () => {
          const old = await db.study_plans.get(oldPlanId);
          if (!old || old.status !== "active") throw new Error("原計畫已不是生效中的版本，請重新整理後再試");
          const now = nowIso();
          await db.study_plans.update(oldPlanId, { status: "superseded", updated_at: now });
          await db.study_plans.add(validPlan);
          for (const id of keptTaskIds) {
            const task = await db.study_tasks.get(id);
            if (!task || task.plan_id !== oldPlanId || task.completed_at === null) {
              throw new Error("保留的任務狀態已變更，請重新預覽");
            }
            await db.study_tasks.update(id, { plan_id: validPlan.id, updated_at: now });
          }
          await db.study_tasks.bulkAdd(validTasks);
        });
      },
      async setTaskCompleted(taskId, completed) {
        const now = nowIso();
        const updated = await db.study_tasks.update(taskId, {
          completed_at: completed ? now : null,
          updated_at: now,
        });
        if (updated === 0) throw new Error("找不到這項任務");
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

    sessions: {
      async create(session) {
        const valid = SessionSchema.parse(session);
        await db.transaction("rw", db.sessions, async () => {
          if ((await db.sessions.where("status").equals("in_progress").count()) > 0) {
            throw new Error("還有一場測驗沒有交卷，請先完成或交卷");
          }
          await db.sessions.add(valid);
        });
      },
      async get(id) {
        return (await db.sessions.get(id)) ?? null;
      },
      async getInProgress() {
        return (await db.sessions.where("status").equals("in_progress").first()) ?? null;
      },
      async listSubmitted() {
        const list = await db.sessions.where("status").equals("submitted").toArray();
        return list.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
      },
      async getAnswers(sessionId) {
        return db.answers.where("session_id").equals(sessionId).toArray();
      },
      async listAttempts(sessionId) {
        return db.attempts.where("session_id").equals(sessionId).toArray();
      },
      async saveAnswer({ sessionId, questionId, selectedKey, elapsedMs }) {
        await db.transaction("rw", db.sessions, db.answers, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          if (session.status !== "in_progress") throw new Error("已交卷，無法再修改答案");
          if (!session.question_snapshot.some((it) => it.question.id === questionId)) {
            throw new Error("這題不在本次測驗中");
          }
          const now = nowIso();
          const existing = await db.answers.where("[session_id+question_id]").equals([sessionId, questionId]).first();
          await db.answers.put(
            AnswerSchema.parse({
              id: existing?.id ?? crypto.randomUUID(),
              created_at: existing?.created_at ?? now,
              updated_at: now,
              session_id: sessionId,
              question_id: questionId,
              selected_key: selectedKey,
              answered_at: selectedKey === null ? null : now,
              elapsed_ms: Math.max(0, Math.round(elapsedMs)),
            }),
          );
        });
      },
      async pause(sessionId, now) {
        await db.transaction("rw", db.sessions, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          await db.sessions.update(sessionId, pauseSession(session, now));
        });
      },
      async resume(sessionId, now) {
        await db.transaction("rw", db.sessions, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          await db.sessions.update(sessionId, resumeSession(session, now));
        });
      },
      async submit(sessionId, now) {
        return db.transaction("rw", db.sessions, db.answers, db.attempts, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          if (session.status === "submitted") {
            return {
              session,
              attempts: await db.attempts.where("session_id").equals(sessionId).toArray(),
              alreadySubmitted: true,
            };
          }
          // 暫停中交卷：暫停時間不計入作答時間
          const resumed = { ...session, ...resumeSession(session, now) };
          // 超過截止時間才交卷（例如關閉頁面後回來）：交卷時間記為截止時間
          const deadline = resumed.deadline_at ? Date.parse(resumed.deadline_at) : null;
          const at = deadline !== null && now.getTime() > deadline ? new Date(deadline) : now;
          const iso = at.toISOString();
          const submitted = SessionSchema.parse({ ...resumed, status: "submitted", submitted_at: iso, updated_at: iso });
          const graded = gradeSession(submitted, await db.answers.where("session_id").equals(sessionId).toArray());
          const attempts = graded.items.map((it) =>
            AttemptSchema.parse({
              id: crypto.randomUUID(),
              created_at: iso,
              updated_at: iso,
              session_id: sessionId,
              question_id: it.question.id,
              question_version: it.question.version,
              selected_key: it.selected,
              is_correct: it.isCorrect,
              submitted_at: iso,
            }),
          );
          await db.sessions.put(submitted);
          await db.attempts.bulkAdd(attempts);
          return { session: submitted, attempts, alreadySubmitted: false };
        });
      },
    },

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
