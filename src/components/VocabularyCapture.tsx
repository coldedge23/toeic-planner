import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ContentGroup, Question } from "@/domain/schema";
import { Modal } from "./Modal";
import { VocabularyForm } from "./VocabularyForm";

export function VocabularyCapture({ question, group, children }: { question: Question; group: ContentGroup | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ term: "", example: "" });
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const selected = () => {
      const s = document.getSelection();
      if (!s || !s.rangeCount || !ref.current?.contains(s.getRangeAt(0).commonAncestorContainer)) return;
      const term = s.toString().trim();
      if (!term || term.length > 120 || !/[a-z]/i.test(term)) return;
      const parent = s.anchorNode?.parentElement?.closest("p, .passage-body, .option-text, legend");
      setSelection({ term, example: (parent?.textContent ?? question.stem).trim().slice(0, 2000) });
    };
    document.addEventListener("selectionchange", selected);
    return () => document.removeEventListener("selectionchange", selected);
  }, [question]);
  return (
    <div className="vocab-capture">
      <div ref={ref}>{children}</div>
      <div className="vocab-capture-actions">
        <button type="button" className="btn btn-small" onClick={() => { setSaved(false); setOpen(true); }}>
          {selection.term ? `收錄「${selection.term}」` : "收錄單字"}
        </button>
        <span className="field-hint">可先選取英文；手機也可按收錄後輸入。</span>
        {saved && <span className="status-msg ok" role="status">已加入單字本</span>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={`vocab-title-${question.id}`}>
        <h2 id={`vocab-title-${question.id}`}>收錄單字</h2>
        <VocabularyForm initial={{ ...selection, source: { question, group } }} onSaved={() => { setOpen(false); setSaved(true); }} onCancel={() => setOpen(false)} />
      </Modal>
    </div>
  );
}
