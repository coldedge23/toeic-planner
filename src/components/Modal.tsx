import { useEffect, useRef, type ReactNode } from "react";

/**
 * 原生 <dialog> 的 showModal：浮在畫面中央、背景不可操作、焦點鎖在對話框內，Esc 關閉。
 * 開關由 open 控制；按 Esc 時呼叫 onClose，由呼叫端決定要不要關。開啟時焦點移到 data-autofocus 元素。
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal 會把焦點放在第一個可聚焦元素；改放到標記 data-autofocus 的主要按鈕
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}
