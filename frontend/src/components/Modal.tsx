import { type ReactNode, useEffect, useRef, useState } from 'react';

export function Modal({ title, children, close, modalClassName }: { title: string; children: ReactNode; close: () => void; modalClassName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [alert, setAlert] = useState<{ message: string; error: boolean }>();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  useEffect(() => { const handler = (event: Event) => { const detail = (event as CustomEvent<{ message: string; error: boolean }>).detail; setAlert(detail); }; window.addEventListener('loan-notice', handler); return () => window.removeEventListener('loan-notice', handler); }, []);
  return <dialog ref={ref} id="modal" className={modalClassName} onCancel={close}><button type="button" className="x" onClick={close}>×</button><div id="modal-form"><div className="modal-inner"><h3>{title}</h3>{alert && <div className={`modal-alert${alert.error ? ' error' : ''}`} role="alert">{alert.message}</div>}{children}</div></div></dialog>;
}
