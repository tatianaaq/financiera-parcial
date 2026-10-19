export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string>;
  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message); this.status = status; this.fieldErrors = fieldErrors;
  }
}

let credentials = sessionStorage.getItem('loan-auth') || '';
export function setCredentials(value: string) { credentials = value; }
export function getCredentials() { return credentials; }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(credentials ? { Authorization: `Basic ${credentials}` } : {}), ...options.headers },
  });
  if (response.status === 401) {
    sessionStorage.removeItem('loan-auth'); sessionStorage.removeItem('loan-me'); setCredentials('');
    window.dispatchEvent(new Event('loan-session-expired'));
    throw new ApiError('Credenciales inválidas o sesión expirada.', 401);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || data.message || 'No se pudo completar la operación.', response.status, data.fieldErrors || {});
  return data as T;
}

export const money = (value: number | string | null | undefined) => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const esc = (value: unknown) => String(value ?? '');
