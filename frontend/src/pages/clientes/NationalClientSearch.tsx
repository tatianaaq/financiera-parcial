
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
  documentType?: string;
  borrowerDocument?: string;
  borrowerName?: string;
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

function formatDate(date: string) {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match
      ? `${match[3]}/${match[2]}/${match[1]}`
      : date || '—';
}

function getLoanCode(id: number) {
  return `PR-${String(id).padStart(6, '0')}`;
}

export function NationalClientSearch({
                                       canGrantLoans = false,
                                       onRequestLoan,
                                       onRegisterNew,
                                       initialDni
                                     }: {
  canGrantLoans?: boolean;
  initialDni?: string;
  onRequestLoan?: (client: NationalClient) => void;
  onRegisterNew?: () => void;
}) {
  const [dni, setDni] = useState(initialDni ?? '');
  const [client, setClient] = useState<NationalClient | null>(null);

  const [schedule, setSchedule] = useState<{
    loan: NationalLoan;
    rows: NationalInstallment[];
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!initialDni || !/^\d{8}$/.test(initialDni)) {
      return;
    }

    let active = true;

    api<NationalClient>(
        `/clients/national?dni=${encodeURIComponent(initialDni)}`
    )
        .then(data => {
          if (active) setClient(data);
        })
        .catch(cause => {
          if (!active) return;

          setError(
              cause instanceof Error
                  ? cause.message
                  : 'No se pudo consultar el DNI.'
          );
        });

    return () => {
      active = false;
    };
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
      const result = await api<NationalClient>(
          `/clients/national?dni=${encodeURIComponent(dni)}`
      );

      setClient(result);
    } catch (cause) {
      const isNotFound =
          cause instanceof Error &&
          'status' in cause &&
          cause.status === 404;

      setNotFound(isNotFound);

      setError(
          cause instanceof Error
              ? cause.message
              : 'No se pudo consultar el DNI.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function openSchedule(loan: NationalLoan) {
    if (!client || scheduleBusy) return;

    setScheduleBusy(true);
    setError('');
    setSchedule(null);

    try {
      const rows = await api<NationalInstallment[]>(
          `/clients/national/${client.dni}/loans/${loan.id}/schedule`
      );

      setSchedule({ loan, rows });
    } catch (cause) {
      setError(
          cause instanceof Error
              ? cause.message
              : 'No se pudo cargar el cronograma.'
      );
    } finally {
      setScheduleBusy(false);
    }
  }

  const canEvaluate = Boolean(
      canGrantLoans &&
      onRequestLoan &&
      client?.active &&
      !client.hasOverdueInstallments &&
      client.availableOriginalCapital >= 1
  );

  return (
      <section
          className="national-client-lookup"
          aria-label="Consulta nacional de clientes"
      >
        <form
            className="national-client-form"
            onSubmit={search}
        >
          <label htmlFor="national-dni">
            DNI del cliente
          </label>

          <div className="national-client-form-row">
            <input
                id="national-dni"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{8}"
                maxLength={8}
                placeholder="Ingresa 8 dígitos"
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
            />

            <button
                type="submit"
                className="national-consult-button"
                disabled={
                    busy ||
                    !/^\d{8}$/.test(dni)
                }
            >
              {busy ? 'Consultando…' : 'Consultar'}
            </button>
          </div>
        </form>

        {error && (
            <div
                className="national-client-error"
                role="alert"
            >
              <span>{error}</span>

              {notFound && onRegisterNew && (
                  <button
                      type="button"
                      className="national-secondary-button"
                      onClick={onRegisterNew}
                  >
                    Ir a registrar cliente
                  </button>
              )}
            </div>
        )}

        {client && (
            <div className="national-client-results">
              <div className="national-client-identity">
                <div className="national-client-avatar">
                  <span aria-hidden="true">▤</span>
                </div>

                <div className="national-client-person">
                  <h3>
                    {client.names} {client.surnames}
                  </h3>

                  <p>
                    DNI {client.dni} · {client.agency}
                  </p>
                </div>

                <span className="national-client-count">
              {client.loans.length === 0
                  ? 'Sin préstamos'
                  : `${client.loans.length} ${
                      client.loans.length === 1
                          ? 'préstamo'
                          : 'préstamos'
                  }`}
            </span>
              </div>

              <div className="national-client-stats">
                <article>
                  <small>Capital activo</small>
                  <strong>
                    {money(client.activeOriginalCapital)}
                  </strong>
                </article>

                <article>
                  <small>Crédito disponible</small>
                  <strong>
                    {money(client.availableOriginalCapital)}
                  </strong>
                </article>

                <article>
                  <small>Cuotas vencidas</small>
                  <strong
                      className={
                        client.hasOverdueInstallments
                            ? 'national-negative'
                            : 'national-positive'
                      }
                  >
                    {client.hasOverdueInstallments
                        ? 'Sí'
                        : 'No'}
                  </strong>
                </article>
              </div>

              <div className="national-client-section-head">
                <h4>Historial de préstamos</h4>

                <span>
              {client.loans.length} registros
            </span>
              </div>

              {client.loans.length > 0 ? (
                  <div className="national-client-table-scroll">
                    <table className="national-client-table">
                      <thead>
                      <tr>
                        <th>Préstamo</th>
                        <th>Documento</th>
                        <th>Sede</th>
                        <th>Capital</th>
                        <th>Saldo</th>
                        <th>Cuotas</th>
                        <th>Estado</th>
                        <th>Consulta</th>
                      </tr>
                      </thead>

                      <tbody>
                      {client.loans.map(loan => (
                          <tr key={loan.id}>
                            <td className="national-loan-code">
                              {getLoanCode(loan.id)}
                            </td>

                            <td>
                              <strong>
                                {loan.documentType || 'DNI'}
                                {' '}
                                {loan.borrowerDocument || client.dni}
                              </strong>

                              {loan.documentType === 'RUC20' &&
                                  loan.borrowerName && (
                                      <small className="national-document-extra">
                                        {loan.borrowerName}
                                      </small>
                                  )}
                            </td>

                            <td>{loan.agency}</td>
                            <td>{money(loan.principal)}</td>
                            <td>
                              {money(loan.outstandingPrincipal)}
                            </td>
                            <td>{loan.installments}</td>

                            <td>
                        <span
                            className={`national-loan-status ${
                                loan.status === 'ACTIVO'
                                    ? 'active'
                                    : 'finished'
                            }`}
                        >
                          {loan.status}
                        </span>
                            </td>

                            <td>
                              <button
                                  type="button"
                                  className="national-table-button"
                                  disabled={scheduleBusy}
                                  onClick={() => {
                                    void openSchedule(loan);
                                  }}
                              >
                                Cronograma
                              </button>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                  </div>
              ) : (
                  <div className="national-client-empty">
                    <strong>Sin préstamos registrados</strong>
                    <p>El cliente no tiene historial crediticio.</p>
                  </div>
              )}

              {scheduleBusy && (
                  <p className="national-client-loading">
                    Cargando cronograma…
                  </p>
              )}

              {schedule && (
                  <section className="national-client-schedule">
                    <div className="national-client-section-head">
                      <div>
                        <h4>
                          Cronograma {getLoanCode(schedule.loan.id)}
                        </h4>
                        <small>{schedule.loan.agency}</small>
                      </div>

                      <button
                          type="button"
                          className="national-secondary-button"
                          onClick={() => setSchedule(null)}
                      >
                        Cerrar
                      </button>
                    </div>

                    <div className="national-client-table-scroll">
                      <table className="national-client-table">
                        <thead>
                        <tr>
                          <th>Cuota</th>
                          <th>Vencimiento</th>
                          <th>Capital</th>
                          <th>Interés</th>
                          <th>Seguro</th>
                          <th>Pagado</th>
                          <th>Saldo</th>
                          <th>Estado</th>
                        </tr>
                        </thead>

                        <tbody>
                        {schedule.rows.map(row => (
                            <tr key={row.id}>
                              <td>{row.number}</td>
                              <td>{formatDate(row.dueDate)}</td>
                              <td>{money(row.principal)}</td>
                              <td>{money(row.interest)}</td>
                              <td>{money(row.insurance)}</td>
                              <td>{money(row.paid)}</td>
                              <td>{money(row.outstanding)}</td>
                              <td>{row.status}</td>
                            </tr>
                        ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
              )}

              {canGrantLoans && onRequestLoan && (
                  <div className="national-loan-decision">
                    <div>
                      <strong>
                        {!client.active
                            ? 'Cliente inactivo'
                            : client.hasOverdueInstallments
                                ? 'Solicitud restringida'
                                : client.availableOriginalCapital < 1
                                    ? 'Sin crédito disponible'
                                    : 'Disponible para evaluación'}
                      </strong>

                      <p>
                        {!client.active
                            ? 'El cliente debe estar activo.'
                            : client.hasOverdueInstallments
                                ? 'Tiene cuotas vencidas.'
                                : client.availableOriginalCapital < 1
                                    ? 'Alcanzó el límite de S/ 10,000.'
                                    : `Puede solicitar hasta ${money(
                                        client.availableOriginalCapital
                                    )}, sujeto a evaluación.`}
                      </p>
                    </div>

                    <button
                        type="button"
                        className="national-consult-button"
                        disabled={!canEvaluate}
                        onClick={() => onRequestLoan(client)}
                    >
                      Evaluar préstamo
                    </button>
                  </div>
              )}
            </div>
        )}
      </section>
  );
}
