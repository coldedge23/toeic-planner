import type { Question } from "./schema";

/** 在篩選錯題前，用完整題組固定留白題幹的空格編號；不修改儲存的題目。 */
export function numberPart6Questions(questions: readonly Question[], siblings: readonly Question[] = questions): Question[] {
  const groups = new Map<string, Question[]>();
  for (const q of siblings) {
    if (q.part === 6 && q.group_id) groups.set(q.group_id, [...(groups.get(q.group_id) ?? []), q]);
  }
  for (const group of groups.values()) group.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return questions.map((q) => {
    if (q.part !== 6 || !q.group_id || q.stem.trim() !== "") return q;
    const position = groups.get(q.group_id)?.findIndex((s) => s.id === q.id) ?? -1;
    return position < 0 ? q : { ...q, stem: `[${position + 1}]` };
  });
}
