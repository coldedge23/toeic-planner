import { useRef, useState, type FormEvent } from "react";
import { repos } from "@/storage";
import { VocabularyInputSchema, type VocabularyInput, type VocabularyWord } from "@/domain/schema";

export function VocabularyForm({ initial, existing, onSaved, onCancel }: {
  initial?: Partial<VocabularyInput>; existing?: VocabularyWord; onSaved: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<VocabularyInput>({ term: "", meaning_zh: "", part_of_speech: "", example: "", source: null, ...initial, ...existing });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const currentTerm = useRef(form.term);
  currentTerm.current = form.term;
  const checkDuplicate = async () => {
    const checkedTerm = form.term;
    try {
      const word = await repos.vocabulary.findByTerm(checkedTerm);
      if (currentTerm.current !== checkedTerm) return;
      setDuplicate(word && word.id !== existing?.id ? `「${word.term}」已在單字本，這次不會覆蓋它。請取消後到單字本編輯。` : null);
    } catch { setError("無法檢查重複單字，請再試一次"); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = VocabularyInputSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true);
    try {
      if (existing) await repos.vocabulary.update(existing.id, parsed.data, existing.updated_at);
      else await repos.vocabulary.add(parsed.data);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "儲存失敗，請再試一次"); }
    finally { setBusy(false); }
  };
  const field = (key: "term" | "meaning_zh" | "part_of_speech" | "example", label: string, multiline = false) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? <textarea className="input" rows={3} value={form[key]} maxLength={key === "example" ? 2000 : 1000}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        : <input className="input" data-autofocus={key === "term" ? true : undefined} value={form[key]}
          maxLength={key === "term" ? 120 : 80} onBlur={key === "term" ? () => void checkDuplicate() : undefined}
          onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setDuplicate(null); }} />}
    </label>
  );
  return (
    <form onSubmit={save} className="vocab-form">
      <p className="card-desc">請確認中文意思；此功能不會自動產生釋義。同字不同意思可補在既有單字中。</p>
      {field("term", "英文單字／片語（必填）")}
      {field("meaning_zh", "繁中意思（必填）", true)}
      {field("part_of_speech", "詞性（選填）")}
      {field("example", "英文例句（選填）", true)}
      {form.source && <p className="field-hint">來源：{form.source.question.source_id}。保存當時的題目與文章，不因題庫改版而變更。</p>}
      {duplicate && <p className="notice notice-warn" role="status">{duplicate}</p>}
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !!duplicate}>{busy ? "儲存中…" : existing ? "儲存修改" : "加入單字本"}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>取消</button></div>
    </form>
  );
}
