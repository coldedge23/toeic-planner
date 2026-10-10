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

/**
 * Part 6 的題幹可填空格編號（例如 [2]）或留白；留白時依題組內順序推算空格編號。
 */
export function questionHeading(question: Question, posInGroup: number) {
  const stem = question.stem.trim();
  const blank = /^\[(\d+)\]$/.exec(stem);
  if (question.part === 6 && (stem === "" || blank)) {
    return <span>選出最適合填入空格 [{blank ? blank[1] : posInGroup + 1}] 的選項</span>;
  }
  return <span lang="en">{stem}</span>;
}
