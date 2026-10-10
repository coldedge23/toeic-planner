import type { ContentGroup, Question } from "@/domain/schema";

export function Passage({ group }: { group: ContentGroup }) {
  return (
    <div className="passages">
      {group.passages.map((p, i) => (
        <article key={i} className="passage" lang="en">
          {p.title && <h3 className="passage-title">{p.title}</h3>}
          <div className="passage-body">{p.body}</div>
        </article>
      ))}
    </div>
  );
}

/** Part 6 題幹留白時，以文章中的空格編號作為題目標題。 */
export function questionHeading(question: Question, posInGroup: number) {
  if (question.stem.trim() !== "") return <span lang="en">{question.stem}</span>;
  return <span>選出最適合填入空格 [{posInGroup + 1}] 的選項</span>;
}
