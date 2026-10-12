import type { ContentGroup, Question } from "@/domain/schema";
import { VocabularyCapture } from "./VocabularyCapture";

/** activeBlank：要特別標出的空格編號（錯題本用來指出是哪一格） */
export function Passage({ group, activeBlank, question }: { group: ContentGroup; activeBlank?: number; question?: Question }) {
  const content = (
    <div className="passages">
      {group.passages.map((p, i) => (
        <article key={i} className="passage" lang="en">
          {p.title && <h3 className="passage-title">{p.title}</h3>}
          <div className="passage-body">{markBlanks(p.body, activeBlank)}</div>
        </article>
      ))}
    </div>
  );
  return question ? <VocabularyCapture question={question} group={group}>{content}</VocabularyCapture> : content;
}

/** 把文章裡的空格 [1]、[2]… 標成方框，方便和題目對照（文字仍保留 [n]，螢幕報讀照常唸出） */
function markBlanks(body: string, activeBlank?: number) {
  return body.split(/(\[\d{1,2}\])/).map((part, i) =>
    /^\[\d{1,2}\]$/.test(part) ? (
      <span key={i} className={`blank num${Number(part.slice(1, -1)) === activeBlank ? " active" : ""}`}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Part 6 的空格編號：題幹寫了 [n] 就用 n，留白時依題組內順序推算；其他題型回傳 null */
export function blankNumber(question: Question, posInGroup: number): number | null {
  if (question.part !== 6) return null;
  const blank = /^\[(\d+)\]$/.exec(question.stem.trim());
  if (blank) return Number(blank[1]);
  return question.stem.trim() === "" ? posInGroup + 1 : null;
}

/**
 * Part 6 的題幹可填空格編號（例如 [2]）或留白；留白時依題組內順序推算空格編號。
 */
export function questionHeading(question: Question, posInGroup: number) {
  const blank = blankNumber(question, posInGroup);
  if (blank !== null) return <span>選出最適合填入空格 [{blank}] 的選項</span>;
  return <span lang="en">{question.stem.trim()}</span>;
}
