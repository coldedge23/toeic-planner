import type { ContentGroup, Question } from "@/domain/schema";

export function Passage({ group }: { group: ContentGroup }) {
  return (
    <div className="passages">
      {group.passages.map((p, i) => (
        <article key={i} className="passage" lang="en">
          {p.title && <h3 className="passage-title">{p.title}</h3>}
          <div className="passage-body">{markBlanks(p.body)}</div>
        </article>
      ))}
    </div>
  );
}

/** 把文章裡的空格 [1]、[2]… 標成方框，方便和題目對照（文字仍保留 [n]，螢幕報讀照常唸出） */
function markBlanks(body: string) {
  return body.split(/(\[\d{1,2}\])/).map((part, i) =>
    /^\[\d{1,2}\]$/.test(part) ? (
      <span key={i} className="blank num">
        {part}
      </span>
    ) : (
      part
    ),
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
