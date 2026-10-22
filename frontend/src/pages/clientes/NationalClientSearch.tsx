import { useEffect, useState, type FormEvent } from 'react';
import { api, money } from '../../api/api';
import './NationalClientSearch.css';

type NationalLoan = {
  id: number;
  agency: string;
  agencyId: number;
  principal: number;
  outstandingPrincipal: number;
  installments: number;
  disbursedAt: string;
  status: string;
  documentType?: string; borrowerDocument?: string; borrowerName?: string;
};

export type NationalClient = {
  active: boolean;
  id: number;
  dni: string;
  names: string;
  surnames: string;
  agency: string;
  agencyId: number | null;
  activeOriginalCapital: number;
  availableOriginalCapital: number;
  hasOverdueInstallments: boolean;
  loans: NationalLoan[];
};

type NationalInstallment = {
  id: number;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  insurance: number;
  paid: number;
  outstanding: number;
  status: string;
};

export function NationalClientSearch({ canGrantLoans = false, onRequestLoan, onRegisterNew, initialDni }: {
  canGrantLoans?: boolean;
  initialDni?: string;
  onRequestLoan?: (client: NationalClient) => void;
  onRegisterNew?: () => void;
}) {
  const [dni, setDni] = useState(initialDni ?? '');
  const [client, setClient] = useState<NationalClient | null>(null);
  const [schedule, setSchedule] = useState<{ loan: NationalLoan; rows: NationalInstallment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!initialDni || !/^\d{8}$/.test(initialDni)) return;
    let active = true;
    api<NationalClient>(`/clients/national?dni=${encodeURIComponent(initialDni)}`)
      .then(data => { if (active) setClient(data); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el DNI.'); });
    return () => { active = false; };
  }, [initialDni]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{8}$/.test(dni) || busy) return;
    setBusy(true);
    setError('');
    setClient(null);
    setSchedule(null);
    setNotFound(false);
    try {
      const data = await api<NationalClient>(`/clients/national?dni=${encodeURIComponent(dni)}`);
      setClient(data);
    } catch (cause) {
      setNotFound(cause instanceof Error && 'status' in cause && cause.status === 404);
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el DNI.');
    } finally {
      setBusy(false);
    }
  }

  async function openSchedule(loan: NationalLoan) {
    if (!client || scheduleBusy) return;
    setScheduleBusy(true);
    setError('');
    try {
      const rows = await api<NationalInstallment[]>(`/clients/national/${client.dni}/loans/${loan.id}/schedule`);
      setSchedule({ loan, rows });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el cronograma.');
    } finally {
      setScheduleBusy(false);
    }
  }

  return (
    <section className="panel national-client-lookup" aria-label="Consulta nacional por DNI">
      <div className="panel-head">
        <div>
          <span className="eyebrow">CONSULTA NACIONAL · 5 AGENCIAS</span>
          <h3>Buscar un cliente antes de otorgar un préstamo</h3>
          <p className="muted">Busca su DNI en las cinco sedes, revisa sus créditos y evalúa un nuevo préstamo sin volver a registrarlo.</p>
        </div>
      </div>
      <form className="national-client-form" onSubmit={search}>
        <label htmlFor="national-dni">DNI de 8 dígitos</label>
        <div className="national-client-form-row">
          <input
            id="national-dni"
            inputMode="numeric"
            pattern="[0-9]{8}"
            maxLength={8}
            placeholder="Ej.: 12345678"
            value={dni}
            onChange={event => {
              const next = event.target.value;
              if (!/^\d{0,8}$/.test(next)) return;
              setDni(next);
              setClient(null);
              setSchedule(null);
              setError('');
              setNotFound(false);
            }}
            required
            aria-label="DNI para búsqueda nacional"
          />
          <button className="primary" type="submit" disabled={busy || !/^\d{8}$/.test(dni)}>
            {busy ? 'Consultando…' : 'Buscar a nivel nacional'}
          </button>
        </div>
      </form>
      {error && <div role="alert" className="national-client-error"><p>{error}</p>{notFound && onRegisterNew && <button className="secondary" type="button" onClick={onRegisterNew}>Ir a registrar un cliente nuevo</button>}</div>}
      {client && (
        <div className="national-client-results">
          <div className="national-client-identity">
            <div>
              <span className="eyebrow">CLIENTE ENCONTRADO</span>
              <h3>{client.names} {client.surnames}</h3>
              <p>DNI {client.dni} · Registrado en {client.agency}</p>
            </div>
            <span className="tag">{client.loans.length} préstamo(s)</span>
          </div>
          <div className="national-client-stats">
            <article><small>Capital original activo nacional</small><strong>{money(client.activeOriginalCapital)}</strong></article>
            <article><small>Disponible del límite S/ 10,000</small><strong>{money(client.availableOriginalCapital)}</strong></article>
            <article><small>Cuotas vencidas</small><strong>{client.hasOverdueInstallments ? 'Sí, revisar' : 'No'}</strong></article>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Préstamo</th><th>Documento utilizado</th><th>Sede</th><th>Capital original</th><th>Saldo capital</th><th>Cuotas</th><th>Estado</th><th>Consulta</th></tr></thead>
              <tbody>
                {client.loans.map(loan => (
                  <tr key={loan.id}>
                    <td>PR-{String(loan.id).padStart(6, '0')}</td>
                    <td>{loan.documentType || 'DNI'} {loan.borrowerDocument || client.dni}{loan.documentType === 'RUC20' && loan.borrowerName ? <small className="field-hint"> {loan.borrowerName}</small> : null}</td>
                    <td>{loan.agency}</td>
                    <td>{money(loan.principal)}</td>
                    <td>{money(loan.outstandingPrincipal)}</td>
                    <td>{loan.installments}</td>
                    <td>{loan.status}</td>
                    <td><button type="button" className="link" disabled={scheduleBusy} onClick={() => { void openSchedule(loan); }}>Ver cronograma</button></td>
                  </tr>
                ))}
                {client.loans.length === 0 && <tr><td colSpan={8}>Este cliente todavía no tiene préstamos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
          {schedule && (
            <div className="national-client-schedule">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">CRONOGRAMA · {schedule.loan.agency.toUpperCase()}</span>
                  <h3>PR-{String(schedule.loan.id).padStart(6, '0')}</h3>
                </div>
                <button type="button" className="secondary" onClick={() => setSchedule(null)}>Cerrar cronograma</button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Cuota</th><th>Vence</th><th>Capital</th><th>Interés</th><th>Seguro</th><th>Pagado</th><th>Pendiente</th><th>Estado</th></tr></thead>
                  <tbody>{schedule.rows.map(row => (
                    <tr key={row.id}>
                      <td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal)}</td>
                      <td>{money(row.interest)}</td><td>{money(row.insurance)}</td>
                      <td>{money(row.paid)}</td><td>{money(row.outstanding)}</td><td>{row.status}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {canGrantLoans && onRequestLoan && (
            <div className="national-loan-decision">
              <div>
                <strong>{!client.active ? 'Cliente inactivo' : client.hasOverdueInstallments ? 'Solicitud bloqueada por cuotas vencidas' : client.availableOriginalCapital < 1 ? 'Sin capital disponible' : 'Puedes evaluar otra solicitud'}</strong>
                <p>{!client.active ? 'El cliente debe estar activo para solicitar préstamos.' : client.hasOverdueInstallments ? 'El cliente debe regularizar las cuotas vencidas.' : client.availableOriginalCapital < 1 ? 'Ya llegó al límite nacional de S/ 10,000 de capital original activo.' : `Disponible máximo: ${money(client.availableOriginalCapital)}. El préstamo se registrará en tu sede, conservando el cliente y sus créditos anteriores.`}</p>
              </div>
              <button type="button" className="primary" disabled={!client.active || client.hasOverdueInstallments || client.availableOriginalCapital < 1} onClick={() => onRequestLoan(client)}>Evaluar nuevo préstamo</button>
            </div>
          )}
          <p className="national-client-notice">El historial de las otras sedes es de solo consulta. La evaluación y confirmación del nuevo préstamo validan nuevamente las reglas nacionales en el servidor.</p>
        </div>
      )}
    </section>
  );
}
