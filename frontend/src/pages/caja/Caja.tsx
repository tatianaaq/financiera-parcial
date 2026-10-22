
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, money } from '../../api/api';
import type { Me } from '../../types/models';
import './Caja.css';

type MovementType = 'INCOME' | 'EXPENSE' | 'REPLENISHMENT' | 'INCIDENT';

type CashMovement = {
  id: number;
  type: MovementType;
  amount: number;
  description: string;
  createdAt: string;
};

type CashState = {
  agencyId: number;
  open: boolean;
  sessionId?: number;
  openedAt?: string;
  openingAmount?: number;
  balance: number;
  movements: CashMovement[];
};

type CashHistory = {
  id: number;
  openedAt: string;
  openingAmount: number;
  closedAt: string | null;
  expectedAmount: number | null;
  countedAmount: number | null;
  differenceAmount: number | null;
  status: 'OPEN' | 'CLOSED';
};

const ADVISOR_LIMIT = 50000;

function moneyValue(value: number | string | null | undefined) {
  return money(value ?? 0);
}

function formatDate(value?: string | null) {
  if (!value) return '—';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
      ? error.message
      : 'No se pudo realizar la operación.';
}

function movementName(type: MovementType) {
  switch (type) {
    case 'INCOME':
      return 'Ingreso';
    case 'EXPENSE':
      return 'Salida';
    case 'REPLENISHMENT':
      return 'Reposición';
    case 'INCIDENT':
      return 'Incidencia';
  }
}

function parseAmount(value: string): number | null {
  const normalized = value.trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

export function Caja({ me }: { me: Me }) {
  const [cash, setCash] = useState<CashState | null>(null);
  const [history, setHistory] = useState<CashHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [openingAmount, setOpeningAmount] = useState('0.00');

  const [movementType, setMovementType] =
      useState<MovementType>('INCOME');

  const [movementAmount, setMovementAmount] = useState('');
  const [movementDescription, setMovementDescription] = useState('');

  const [countedAmount, setCountedAmount] = useState('');
  const [closingNote, setClosingNote] = useState('');

  const [showClose, setShowClose] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMovement, setShowMovement] = useState(false);

  const isAdvisor = me.role === 'ADVISOR';

  const refresh = useCallback(async () => {
    if (!isAdvisor) {
      setLoading(false);
      return;
    }

    try {
      const [state, sessions] = await Promise.all([
        api<CashState>('/cash'),
        api<CashHistory[]>('/cash/history')
      ]);

      setCash(state);
      setHistory(sessions);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isAdvisor]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(
      path: string,
      payload: object,
      successMessage: string
  ) {
    if (busy) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const state = await api<CashState>(path, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setCash(state);
      setMessage(successMessage);

      try {
        const sessions = await api<CashHistory[]>('/cash/history');
        setHistory(sessions);
      } catch {
        setMessage(
            `${successMessage} No se pudo actualizar el historial; usa Actualizar.`
        );
      }

      return true;
    } catch (err) {
      setError(getErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = parseAmount(openingAmount);

    if (amount === null || amount > ADVISOR_LIMIT) {
      setError(
          'El monto de apertura debe estar entre S/ 0.00 y S/ 50,000.00.'
      );
      return;
    }

    const success = await runAction(
        '/cash/open',
        { amount },
        'Caja abierta correctamente en la agencia.'
    );

    if (success) {
      setOpeningAmount('0.00');
    }
  }

  async function registerMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = movementType === 'INCIDENT'
        ? 0
        : parseAmount(movementAmount);

    const description = movementDescription.trim();

    if (
        amount === null ||
        (movementType !== 'INCIDENT' && amount <= 0)
    ) {
      setError('Ingresa un monto válido mayor que cero.');
      return;
    }

    if (!description || description.length > 500) {
      setError('Ingresa una descripción de hasta 500 caracteres.');
      return;
    }

    if (
        movementType === 'EXPENSE' &&
        amount > Number(cash?.balance ?? 0)
    ) {
      setError('La salida supera el saldo disponible de la caja.');
      return;
    }

    const requestKey =
        `cash_${crypto.randomUUID().replaceAll('-', '')}`;

    const success = await runAction(
        '/cash/movement',
        {
          type: movementType,
          amount,
          description,
          requestKey
        },
        'Movimiento registrado correctamente.'
    );

    if (success) {
      setMovementAmount('');
      setMovementDescription('');
      setShowMovement(false);
    }
  }

  async function closeCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const counted = parseAmount(countedAmount);

    if (counted === null) {
      setError('Ingresa el dinero contado al cerrar la caja.');
      return;
    }

    if (closingNote.length > 500) {
      setError('La observación no debe superar 500 caracteres.');
      return;
    }

    const success = await runAction(
        '/cash/close',
        {
          countedAmount: counted,
          note: closingNote.trim()
        },
        'La caja se cerró correctamente.'
    );

    if (success) {
      setCountedAmount('');
      setClosingNote('');
      setShowClose(false);
      setShowMovement(false);
    }
  }

  if (!isAdvisor) {
    return (
        <div className="caja-real">
          <section className="caja-real-panel">
            <h3>Control de caja</h3>
            <p>
              La caja está administrada por los asesores de cada agencia.
              Tu usuario no tiene acceso a operaciones de caja.
            </p>
          </section>
        </div>
    );
  }

  return (
      <div className="caja-real">
        <section className="caja-real-heading">
          <div>
            <h3>Control de caja</h3>
            <p>{me.agency} · Gestión de caja de la sucursal</p>
          </div>

          <button
              className="caja-real-outline"
              type="button"
              disabled={busy || loading}
              onClick={() => void refresh()}
          >
            Actualizar
          </button>
        </section>

        {error && (
            <div className="caja-real-error" role="alert">
              {error}
            </div>
        )}

        {message && (
            <div className="caja-real-message" role="status">
              {message}
            </div>
        )}

        {loading ? (
            <section className="caja-real-panel">
              Cargando información de caja…
            </section>
        ) : cash ? (
            <>
              <section className="caja-real-cards">
                <article className="caja-real-card">
                  <small>Estado de caja</small>

                  <strong className={
                            cash.open ? 'open' : 'closed'
                          }>
                    {cash.open ? 'Abierta' : 'Cerrada'}
                  </strong>

                  <p>
                    {cash.open
                        ? `Abierta el ${formatDate(cash.openedAt)}`
                        : 'Sin sesión activa'}
                  </p>
                </article>

                <article className="caja-real-card">
                  <small>Saldo actual</small>

                  <strong>
                    {moneyValue(cash.balance)}
                  </strong>

                  <p>
                    {cash.open
                        ? 'Saldo registrado por el sistema'
                        : 'Sin caja abierta'}
                  </p>
                </article>

                <article className="caja-real-card">
                  <small>Monto de apertura</small>

                  <strong>
                    {moneyValue(cash.openingAmount)}
                  </strong>

                  <p>
                    {cash.open
                        ? `Sesión N.° ${cash.sessionId}`
                        : 'Sin apertura actual'}
                  </p>
                </article>
              </section>

              {!cash.open ? (
                  <section className="caja-real-panel">
                    <div className="caja-real-panel-head">
                      <div>
                        <h3>Apertura de caja</h3>
                        <p>Registra el dinero inicial de tu agencia.</p>
                      </div>
                    </div>

                    <form className="caja-real-form" onSubmit={openCash}>
                      <div className="caja-real-facts">
                        <div>
                          <small>Agencia</small>
                          <strong>{me.agency}</strong>
                        </div>

                        <div>
                          <small>Asesor</small>
                          <strong>{me.username}</strong>
                        </div>
                      </div>

                      <label>
                        Monto inicial (S/)
                        <input
                            type="number"
                            required
                            min="0"
                            max={ADVISOR_LIMIT}
                            step="0.01"
                            value={openingAmount}
                            disabled={busy}
                            onChange={event =>
                                setOpeningAmount(event.target.value)
                            }
                        />
                      </label>

                      <p className="caja-real-help">
                        Límite de apertura en la interfaz: S/ 50,000.
                        La apertura queda registrada en la base de datos.
                      </p>

                      <div className="caja-real-actions">
                        <button className="caja-real-primary" disabled={busy}>
                          {busy ? 'Procesando…' : 'Abrir caja'}
                        </button>
                      </div>
                    </form>
                  </section>
              ) : (
                  <>
                    <section className="caja-real-panel">
                      <div className="caja-real-panel-head">
                        <div>
                          <h3>Caja de la agencia</h3>
                          <p>
                            Sesión N.° {cash.sessionId} ·
                            Apertura: {formatDate(cash.openedAt)}
                          </p>
                        </div>

                        <div className="caja-real-toolbar">
                          <button
                              type="button"
                              className="caja-real-outline"
                              disabled={busy}
                              onClick={() => {
                                setShowMovement(value => !value);
                                setShowClose(false);
                              }}
                          >
                            {showMovement
                                ? 'Cancelar movimiento'
                                : '+ Registrar movimiento'}
                          </button>

                          <button
                              type="button"
                              className="caja-real-danger"
                              disabled={busy}
                              onClick={() => {
                                setShowClose(value => !value);
                                setShowMovement(false);
                                setCountedAmount(
                                    Number(cash.balance).toFixed(2)
                                );
                              }}
                          >
                            Cerrar caja
                          </button>
                        </div>
                      </div>

                      {showMovement && (
                          <form
                              className="caja-real-form caja-real-subform"
                              onSubmit={registerMovement}
                          >
                            <h4>Registrar movimiento</h4>

                            <div className="caja-real-form-grid">
                              <label>
                                Tipo de movimiento
                                <select
                                    value={movementType}
                                    disabled={busy}
                                    onChange={event =>
                                        setMovementType(
                                            event.target.value as MovementType
                                        )
                                    }
                                >
                                  <option value="INCOME">Ingreso</option>
                                  <option value="EXPENSE">Salida</option>
                                  <option value="REPLENISHMENT">Reposición</option>
                                  <option value="INCIDENT">Incidencia</option>
                                </select>
                              </label>

                              {movementType !== 'INCIDENT' && (
                                  <label>
                                    Monto (S/)
                                    <input
                                        type="number"
                                        required
                                        min="0.01"
                                        step="0.01"
                                        value={movementAmount}
                                        disabled={busy}
                                        onChange={event =>
                                            setMovementAmount(event.target.value)
                                        }
                                    />
                                  </label>
                              )}
                            </div>

                            <label>
                              Descripción
                              <textarea
                                  required
                                  maxLength={500}
                                  rows={3}
                                  value={movementDescription}
                                  disabled={busy}
                                  onChange={event =>
                                      setMovementDescription(event.target.value)
                                  }
                                  placeholder="Motivo del movimiento"
                              />
                            </label>

                            <div className="caja-real-actions">
                              <button
                                  className="caja-real-primary"
                                  disabled={busy}
                              >
                                {busy ? 'Registrando…' : 'Guardar movimiento'}
                              </button>
                            </div>
                          </form>
                      )}

                      {showClose && (
                          <form
                              className="caja-real-form caja-real-subform"
                              onSubmit={closeCash}
                          >
                            <h4>Cierre de caja</h4>

                            <div className="caja-real-facts">
                              <div>
                                <small>Saldo esperado</small>
                                <strong>
                                  {moneyValue(cash.balance)}
                                </strong>
                              </div>

                              <div>
                                <small>Diferencia estimada</small>
                                <strong>
                                  {parseAmount(countedAmount) === null
                                      ? '—'
                                      : moneyValue(
                                          Number(countedAmount) -
                                          Number(cash.balance)
                                      )}
                                </strong>
                              </div>
                            </div>

                            <label>
                              Dinero contado al cierre (S/)
                              <input
                                  type="number"
                                  required
                                  min="0"
                                  step="0.01"
                                  value={countedAmount}
                                  disabled={busy}
                                  onChange={event =>
                                      setCountedAmount(event.target.value)
                                  }
                              />
                            </label>

                            <label>
                              Observación (opcional)
                              <textarea
                                  rows={3}
                                  maxLength={500}
                                  value={closingNote}
                                  disabled={busy}
                                  onChange={event =>
                                      setClosingNote(event.target.value)
                                  }
                              />
                            </label>

                            <div className="caja-real-actions">
                              <button
                                  className="caja-real-danger"
                                  disabled={busy}
                              >
                                {busy ? 'Cerrando…' : 'Confirmar cierre'}
                              </button>
                            </div>
                          </form>
                      )}
                    </section>

                    <section className="caja-real-panel">
                      <div className="caja-real-panel-head">
                        <div>
                          <h3>Movimientos de caja</h3>
                          <p>
                            Operaciones registradas en la sesión actual.
                          </p>
                        </div>
                        <span className="caja-real-count">
                    {cash.movements.length} movimientos
                  </span>
                      </div>

                      <div className="caja-real-table-wrap">
                        <table className="caja-real-table">
                          <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Descripción</th>
                            <th>Monto</th>
                          </tr>
                          </thead>

                          <tbody>
                          {cash.movements.length ? (
                              cash.movements.map(movement => (
                                  <tr key={movement.id}>
                                    <td>
                                      {formatDate(movement.createdAt)}
                                    </td>

                                    <td>
                              <span
                                  className={`caja-real-type ${movement.type.toLowerCase()}`}
                              >
                                {movementName(movement.type)}
                              </span>
                                    </td>

                                    <td>{movement.description}</td>

                                    <td>
                                      {moneyValue(movement.amount)}
                                    </td>
                                  </tr>
                              ))
                          ) : (
                              <tr>
                                <td colSpan={4} className="caja-real-empty">
                                  Todavía no se han registrado movimientos.
                                </td>
                              </tr>
                          )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
              )}

              <section className="caja-real-panel">
                <div className="caja-real-panel-head">
                  <div>
                    <h3>Historial de caja</h3>
                    <p>Últimas aperturas y cierres de la agencia.</p>
                  </div>

                  <button
                      className="caja-real-outline"
                      type="button"
                      onClick={() => setShowHistory(value => !value)}
                  >
                    {showHistory ? 'Ocultar historial' : 'Ver historial'}
                  </button>
                </div>

                {showHistory && (
                    <div className="caja-real-table-wrap">
                      <table className="caja-real-table">
                        <thead>
                        <tr>
                          <th>N.°</th>
                          <th>Apertura</th>
                          <th>Cierre</th>
                          <th>Monto inicial</th>
                          <th>Saldo esperado</th>
                          <th>Diferencia</th>
                          <th>Estado</th>
                        </tr>
                        </thead>

                        <tbody>
                        {history.length ? (
                            history.map(session => (
                                <tr key={session.id}>
                                  <td>{session.id}</td>
                                  <td>{formatDate(session.openedAt)}</td>
                                  <td>{formatDate(session.closedAt)}</td>
                                  <td>
                                    {moneyValue(session.openingAmount)}
                                  </td>
                                  <td>
                                    {session.expectedAmount == null
                                        ? '—'
                                        : moneyValue(session.expectedAmount)}
                                  </td>
                                  <td>
                                    {session.differenceAmount == null
                                        ? '—'
                                        : moneyValue(session.differenceAmount)}
                                  </td>
                                  <td>
                            <span className={`caja-real-state ${
                                session.status === 'OPEN' ? 'open' : 'closed'
                            }`}>
                              {session.status === 'OPEN'
                                  ? 'Abierta'
                                  : 'Cerrada'}
                            </span>
                                  </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                              <td colSpan={7} className="caja-real-empty">
                                No hay sesiones registradas.
                              </td>
                            </tr>
                        )}
                        </tbody>
                      </table>
                    </div>
                )}
              </section>
            </>
        ) : (
            <section className="caja-real-panel">
              No se pudo obtener el estado de Caja.
              Comprueba la conexión con el backend y pulsa Actualizar.
            </section>
        )}
      </div>
  );
}
