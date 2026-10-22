import { type ReactNode, useEffect, useRef, useState } from 'react';

export function Modal({ title, children, close, modalClassName }: { title: string; children: ReactNode; close: () => void; modalClassName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [alert, setAlert] = useState<{ message: string; error: boolean }>();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  useEffect(() => { const handler = (event: Event) => { const detail = (event as CustomEvent<{ message: string; error: boolean }>).detail; setAlert(detail); }; window.addEventListener('loan-notice', handler); return () => window.removeEventListener('loan-notice', handler); }, []);
  return <dialog ref={ref} id="modal" className={`finance-modal ${modalClassName ?? ''}`} aria-labelledby="finance-modal-title" onCancel={close}>
    <div id="modal-form"><div className="modal-inner">
      <header className="finance-modal-header"><div><span className="eyebrow">PRÉSTAMO CASTILLO · GESTIÓN SEGURA</span><h3 id="finance-modal-title">{title}</h3></div>
      <button type="button" className="x" onClick={close} aria-label="Cerrar ventana">×</button></header>
      {alert && <div className={`modal-alert${alert.error ? ' error' : ''}`} role="alert">{alert.message}</div>}
      <div className="finance-modal-body">{children}</div>
    </div></div>
  </dialog>;
}
