
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react';

import { api, money } from '../../api/api';

import type {
  Agency,
  Client,
  Installment,
  Loan,
  Me
} from '../../types/models';

import { Modal } from '../../components/Modal';
import { SkeletonRows } from '../../components/SkeletonRows';

import {
  NationalClientSearch,
  type NationalClient
} from '../clientes/NationalClientSearch';

import type { LinkedDocument } from '../clientes/RucLookup';
import { loanIdentity } from '../../utils/loanIdentity';
import { CronogramaImprimible } from './CronogramaImprimible';
import { ContratoPrestamo } from './ContratoPrestamo';
import './Prestamos.css';

type ProposedInstallment = {
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
};

type LoanEvaluation = {
  quoteDate: string;
  schedulePreview: ProposedInstallment[];
  borrowerName: string;
  borrowerDocument: string;
  documentType: string;
  responsibleDni: string;
  client: string;
  dni: string;
  agency: string;
  principal: number;
  installments: number;
  monthlyPaymentEstimate: number;
  totalPaymentEstimate: number;
  availableOriginalCapital: number;
  annualRate: number;
};

type EvaluationBody = {
  clientId: number;
  amount: string;
  installments: string;
  documentType: string;
  documentNumber: string;
};

type DocumentFilter = 'all' | 'DNI' | 'RUC10' | 'RUC20';
type LoanStatusFilter = 'all' | 'ACTIVO' | 'FINALIZADO';
type View = 'list' | 'detail' | 'schedule';

function loanCode(id: number): string {
  return `PR-${String(id).padStart(6, '0')}`;
}

function formatDate(value: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match
      ? `${match[3]}/${match[2]}/${match[1]}`
      : value || '—';
}

function formatRate(value?: number): string {
  return value == null
      ? 'No registrada'
      : `${(value * 100).toLocaleString('es-PE', {
        maximumFractionDigits: 2
      })}%`;
}

function todayInLimaIso(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const part = (type: string) =>
      parts.find(value => value.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function getLoanType(
    loan: Loan
): 'DNI' | 'RUC10' | 'RUC20' {
  const document = String(
      loan.borrowerDocument || loan.dni || ''
  ).trim();

  const explicit = loan.documentType;

  if (
      explicit === 'DNI' ||
      explicit === 'RUC10' ||
      explicit === 'RUC20'
  ) {
    return explicit;
  }

  if (document.length === 8) return 'DNI';
  if (document.startsWith('10')) return 'RUC10';
  return 'RUC20';
}

function loanStatusText(status: string): string {
  if (status === 'ACTIVO') return 'Activo';
  if (status === 'FINALIZADO') return 'Finalizado';
  return status;
}

function installmentStatusText(status: string): string {
  if (status === 'PAGADA') return 'Pagada';
  if (status === 'VENCIDA') return 'Vencida';
  if (status === 'PENDIENTE') return 'Pendiente';
  return status;
}

function ScheduleTable({
                         rows
                       }: {
  rows: Installment[];
}) {
  return (
      <div className="prestamos-table-scroll">
        <table className="prestamos-table">
          <thead>
          <tr>
            <th>N.°</th>
            <th>Vencimiento</th>
            <th>Cuota</th>
            <th>Capital</th>
            <th>Interés</th>
            <th>Pagado</th>
            <th>Saldo de cuota</th>
            <th>Estado</th>
          </tr>
          </thead>

          <tbody>
          {rows.map(row => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{formatDate(row.dueDate)}</td>
                <td>
                  {money(
                      Number(row.principal) +
                      Number(row.interest)
                  )}
                </td>
                <td>{money(row.principal)}</td>
                <td>{money(row.interest)}</td>
                <td>{money(row.paid)}</td>
                <td>{money(row.outstanding)}</td>
                <td>
                <span
                    className={`prestamos-cuota-estado ${
                        row.status === 'PAGADA'
                            ? 'pagada'
                            : row.status === 'VENCIDA'
                                ? 'vencida'
                                : 'pendiente'
                    }`}
                >
                  {installmentStatusText(row.status)}
                </span>
                </td>
              </tr>
          ))}
          </tbody>
        </table>
      </div>
  );
}

export function Prestamos({
                            me,
                            notify,
                            selectedClientId,
                            clearSelectedClient,
                            initialAgencyId,
                            goToClients,
                            initialDni,
                            loanDocument
                          }: {
  me: Me;
  notify: (message: string, error?: boolean) => void;
  selectedClientId?: number;
  clearSelectedClient: () => void;
  initialAgencyId?: string;
  openClient: (clientId: number) => void;
  goToClients: () => void;
  initialDni?: string;
  loanDocument?: LinkedDocument;
}) {
  const isAdmin = me.role === 'ADMIN';
  const isAdvisor = me.role === 'ADVISOR';

  // Datos de la cartera
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [loanLoading, setLoanLoading] = useState(false);

  // Filtros
  const [nameQuery, setNameQuery] = useState('');
  const [documentQuery, setDocumentQuery] = useState('');

  const [documentFilter, setDocumentFilter] =
      useState<DocumentFilter>('all');

  const [statusFilter, setStatusFilter] =
      useState<LoanStatusFilter>('all');

  const [agencyId, setAgencyId] =
      useState(initialAgencyId ?? '');

  // Consulta de clientes
  const [showNationalSearch, setShowNationalSearch] =
      useState(false);

  // Otorgamiento
  const [create, setCreate] = useState(false);

  const [prefilledClientId, setPrefilledClientId] =
      useState<number>();

  const [amountInput, setAmountInput] = useState('');
  const [installmentsInput, setInstallmentsInput] =
      useState('6');

  const [amountError, setAmountError] = useState('');
  const [installmentsError, setInstallmentsError] =
      useState('');

  const [evaluation, setEvaluation] = useState<{
    body: EvaluationBody;
    result: LoanEvaluation;
  }>();

  const [clientAccepted, setClientAccepted] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmationLock = useRef(false);

  // Cronograma y contrato
  const [view, setView] = useState<View>('list');
  const [selectedLoan, setSelectedLoan] = useState<Loan>();
  const [schedule, setSchedule] = useState<Installment[]>([]);
  const [contractOpen, setContractOpen] = useState(false);

  // Obtener préstamos desde el backend
  const load = useCallback(async () => {
    setLoading(true);

    try {
      const query =
          isAdmin && agencyId
              ? `?agencyId=${encodeURIComponent(agencyId)}`
              : '';

      const records = await api<Loan[]>(`/loans${query}`);
      setLoans(records);
    } catch (error) {
      notify(
          error instanceof Error
              ? error.message
              : 'No se pudieron cargar los préstamos.',
          true
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin, agencyId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Agencias disponibles para el administrador
  useEffect(() => {
    if (!isAdmin) return;

    api<Agency[]>('/admin/agencies')
        .then(setAgencies)
        .catch(error =>
            notify(
                error instanceof Error
                    ? error.message
                    : 'No se pudieron cargar las agencias.',
                true
            )
        );
  }, [isAdmin, notify]);

  // Cliente recibido desde el módulo Clientes
  useEffect(() => {
    if (selectedClientId === undefined || !isAdvisor) {
      return;
    }

    let active = true;

    async function loadSelectedClient() {
      const records = await api<Client[]>('/clients');

      if (
          records.some(
              client => client.id === selectedClientId
          )
      ) {
        return records;
      }

      if (!initialDni || !/^\d{8}$/.test(initialDni)) {
        throw new Error(
            'No se recibió un DNI válido del cliente.'
        );
      }

      const national = await api<NationalClient>(
          `/clients/national?dni=${encodeURIComponent(initialDni)}`
      );

      if (
          national.id !== selectedClientId ||
          !national.active
      ) {
        throw new Error(
            'El cliente no está disponible para solicitar un préstamo.'
        );
      }

      return [
        {
          id: national.id,
          dni: national.dni,
          names: national.names,
          surnames: national.surnames,
          agency: national.agency,
          agencyId: national.agencyId,
          registeredAt: '',
          active: national.active
        },
        ...records
      ];
    }

    void loadSelectedClient()
        .then(records => {
          if (!active) return;

          setClients(records);
          setPrefilledClientId(selectedClientId);
          setAmountInput('');
          setInstallmentsInput('6');
          setEvaluation(undefined);
          setClientAccepted(false);
          setCreate(true);
        })
        .catch(error => {
          if (!active) return;

          notify(
              error instanceof Error
                  ? error.message
                  : 'No se pudo cargar el cliente.',
              true
          );
        });

    return () => {
      active = false;
    };
  }, [
    selectedClientId,
    initialDni,
    isAdvisor,
    notify
  ]);

  // FILTROS AUTOMÁTICOS
  const visible = loans
      .filter(loan => {
        const identity = loanIdentity(loan);

        const nameText = [
          identity.name,
          loan.client,
          loan.companyName,
          loan.representativeName
        ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('es');

        const document = String(
            identity.document ||
            loan.borrowerDocument ||
            loan.dni ||
            ''
        );

        const normalizedName = nameQuery
            .trim()
            .toLocaleLowerCase('es');

        const nameMatches =
            nameText.includes(normalizedName);

        const documentMatches =
            document.includes(documentQuery.trim());

        const typeMatches =
            documentFilter === 'all' ||
            getLoanType(loan) === documentFilter;

        const statusMatches =
            statusFilter === 'all' ||
            loan.status === statusFilter;

        return (
            nameMatches &&
            documentMatches &&
            typeMatches &&
            statusMatches
        );
      })
      .sort((a, b) => b.id - a.id);

  function clearFilters() {
    setNameQuery('');
    setDocumentQuery('');
    setDocumentFilter('all');
    setStatusFilter('all');
    setAgencyId('');
  }

  // Abrir evaluación de préstamo
  async function newLoan(clientId?: number) {
    if (!isAdvisor) return;

    try {
      const records = await api<Client[]>('/clients');

      if (!records.length) {
        notify(
            'Primero registra un cliente en el módulo Clientes.',
            true
        );
        return;
      }

      if (
          clientId !== undefined &&
          !records.some(client => client.id === clientId)
      ) {
        notify(
            'El cliente no está disponible en esta sede.',
            true
        );
        return;
      }

      const ordered = clientId === undefined
          ? records
          : [
            ...records.filter(
                client => client.id === clientId
            ),
            ...records.filter(
                client => client.id !== clientId
            )
          ];

      setClients(ordered);
      setPrefilledClientId(clientId);
      setAmountInput('');
      setInstallmentsInput('6');
      setAmountError('');
      setInstallmentsError('');
      setEvaluation(undefined);
      setClientAccepted(false);
      setCreate(true);
    } catch (error) {
      notify(
          error instanceof Error
              ? error.message
              : 'No se pudo abrir el formulario.',
          true
      );
    }
  }

  // Evaluación desde consulta nacional
  function requestLoanFromNational(
      client: NationalClient
  ) {
    if (
        !isAdvisor ||
        !client.active ||
        client.hasOverdueInstallments ||
        client.availableOriginalCapital < 1
    ) {
      return;
    }

    setClients([
      {
        id: client.id,
        dni: client.dni,
        names: client.names,
        surnames: client.surnames,
        agency: client.agency,
        agencyId: client.agencyId,
        registeredAt: '',
        active: client.active
      }
    ]);

    setPrefilledClientId(client.id);
    setAmountInput('');
    setInstallmentsInput('6');
    setAmountError('');
    setInstallmentsError('');
    setEvaluation(undefined);
    setClientAccepted(false);
    setShowNationalSearch(false);
    setCreate(true);
  }

  // Enviar evaluación al backend
  async function evaluate(
      event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const clientId = loanDocument
        ? loanDocument.clientId
        : Number(form.get('clientId'));

    if (
        !/^\d+$/.test(amountInput) ||
        Number(amountInput) < 1 ||
        Number(amountInput) > 10000
    ) {
      setAmountError(
          'El monto debe ser un entero entre S/ 1 y S/ 10,000.'
      );
      return;
    }

    if (
        !/^\d+$/.test(installmentsInput) ||
        Number(installmentsInput) < 1 ||
        Number(installmentsInput) > 36
    ) {
      setInstallmentsError(
          'El número de cuotas debe estar entre 1 y 36.'
      );
      return;
    }

    setAmountError('');
    setInstallmentsError('');

    const body: EvaluationBody = {
      clientId,
      amount: amountInput,
      installments: installmentsInput,
      documentType:
          loanDocument?.documentType ?? 'DNI',
      documentNumber:
          loanDocument?.documentNumber ??
          clients.find(
              client => client.id === clientId
          )?.dni ??
          initialDni ??
          ''
    };

    try {
      const result = await api<LoanEvaluation>(
          '/loans/evaluation',
          {
            method: 'POST',
            body: JSON.stringify(body)
          }
      );

      setEvaluation({ body, result });
      setClientAccepted(false);
    } catch (error) {
      notify(
          error instanceof Error
              ? error.message
              : 'No se pudo evaluar el préstamo.',
          true
      );
    }
  }

  // Registrar préstamo aceptado
  async function confirmLoan() {
    if (
        !evaluation ||
        !clientAccepted ||
        confirmationLock.current
    ) {
      return;
    }

    confirmationLock.current = true;
    setConfirmBusy(true);

    try {
      const created = await api<Loan>('/loans', {
        method: 'POST',
        body: JSON.stringify({
          ...evaluation.body,
          quoteDate: evaluation.result.quoteDate,
          customerAccepted: true
        })
      });

      setCreate(false);
      setEvaluation(undefined);
      setClientAccepted(false);
      setPrefilledClientId(undefined);
      clearSelectedClient();

      await load();

      await openLoan(created, 'schedule');

      notify(
          `Préstamo ${loanCode(created.id)} registrado correctamente.`
      );
    } catch (error) {
      notify(
          error instanceof Error
              ? error.message
              : 'No se pudo registrar el préstamo.',
          true
      );
    } finally {
      confirmationLock.current = false;
      setConfirmBusy(false);
    }
  }

  function closeLoanForm() {
    if (confirmBusy) return;

    setCreate(false);
    setEvaluation(undefined);
    setClientAccepted(false);
    setPrefilledClientId(undefined);
    setAmountInput('');
    setInstallmentsInput('6');
    setAmountError('');
    setInstallmentsError('');
    clearSelectedClient();
  }

  function rejectProposal() {
    if (confirmBusy) return;

    closeLoanForm();

    notify(
        'El cliente no aceptó la propuesta. No se registró el préstamo.'
    );
  }

  // Cargar cronograma real
  async function openLoan(
      loan: Loan,
      next: 'detail' | 'schedule'
  ) {
    if (loanLoading) return;

    setLoanLoading(true);

    try {
      const rows = await api<Installment[]>(
          `/loans/${loan.id}/schedule`
      );

      setContractOpen(false);
      setSelectedLoan(loan);
      setSchedule(rows);
      setView(next);
    } catch (error) {
      notify(
          error instanceof Error
              ? error.message
              : 'No se pudo cargar el cronograma.',
          true
      );
    } finally {
      setLoanLoading(false);
    }
  }

  function backToLoans() {
    setView('list');
    setSelectedLoan(undefined);
    setSchedule([]);
    setContractOpen(false);
  }

  // PANTALLA DE CRONOGRAMA
  if (view !== 'list' && selectedLoan) {
    const identity = loanIdentity(selectedLoan);

    const paidRows = schedule.filter(
        row => Number(row.outstanding) <= 0
    );

    const pendingRows = schedule.filter(
        row => Number(row.outstanding) > 0
    );

    const overdueRows = pendingRows.filter(
        row => row.dueDate < todayInLimaIso()
    );

    const totalScheduled = schedule.reduce(
        (sum, row) =>
            sum +
            Number(row.principal) +
            Number(row.interest),
        0
    );

    return (
        <div className="loan-workspace prestamos-nuevo">
          <section className="panel prestamos-crono-header">
            <div className="prestamos-crono-persona">
            <span className="prestamos-label">
              {view === 'schedule'
                  ? 'CRONOGRAMA DE PAGOS'
                  : 'DETALLE DEL PRÉSTAMO'}
            </span>

              <h3>
                Préstamo N.°{' '}
                {String(selectedLoan.id).padStart(6, '0')}
              </h3>

              <p>{identity.name}</p>

              <p>
                {identity.document}

                {identity.isRuc && (
                    <>
                      {' · '}DNI responsable:{' '}
                      {identity.responsibleDni}
                    </>
                )}
              </p>
            </div>

            <div className="prestamos-crono-resumen-datos">
              <div>
                <small>Capital</small>
                <strong>
                  {money(selectedLoan.principal)}
                </strong>
              </div>

              <div>
                <small>Cuotas</small>
                <strong>{selectedLoan.installments}</strong>
              </div>

              <div>
                <small>Estado</small>

                <span
                    className={`prestamos-estado ${
                        selectedLoan.status === 'ACTIVO'
                            ? 'activo'
                            : 'finalizado'
                    }`}
                >
                {loanStatusText(selectedLoan.status)}
              </span>
              </div>
            </div>

            <div className="prestamos-crono-botones">
              <button
                  type="button"
                  className="prestamos-btn-outline"
                  onClick={backToLoans}
              >
                ← Volver
              </button>

              {view === 'detail' && (
                  <button
                      type="button"
                      className="prestamos-btn-outline"
                      onClick={() => setView('schedule')}
                  >
                    Ver cronograma
                  </button>
              )}

              <button
                  type="button"
                  className="prestamos-btn-primary"
                  disabled={!schedule.length}
                  onClick={() => window.print()}
              >
                Imprimir cronograma
              </button>

              <button
                  type="button"
                  className="prestamos-btn-outline"
                  disabled={!schedule.length}
                  onClick={() => setContractOpen(true)}
              >
                Ver contrato / PDF
              </button>
            </div>
          </section>

          <section className="panel prestamos-crono-indicadores">
            <article>
              <span className="prestamos-kpi-icon verde">✓</span>
              <div>
                <small>Pagadas</small>
                <strong>
                  {paidRows.length} de {schedule.length}
                </strong>
              </div>
            </article>

            <article>
              <span className="prestamos-kpi-icon naranja">◷</span>
              <div>
                <small>Pendientes</small>
                <strong>
                  {pendingRows.length} de {schedule.length}
                </strong>
              </div>
            </article>

            <article>
              <span className="prestamos-kpi-icon azul">▥</span>
              <div>
                <small>Capital pendiente</small>
                <strong>
                  {money(selectedLoan.outstandingPrincipal)}
                </strong>
              </div>
            </article>
          </section>

          {view === 'detail' && (
              <section className="panel prestamos-detalle">
                <h3>Información registrada</h3>

                <div className="prestamos-detalle-grid">
                  <div>
                    <small>Prestatario</small>
                    <strong>{identity.name}</strong>
                  </div>

                  <div>
                    <small>Documento</small>
                    <strong>{identity.document}</strong>
                  </div>

                  {identity.isRuc && (
                      <div>
                        <small>DNI responsable</small>
                        <strong>{identity.responsibleDni}</strong>
                      </div>
                  )}

                  {identity.representative && (
                      <div>
                        <small>Representante</small>
                        <strong>{identity.representative}</strong>
                      </div>
                  )}

                  <div>
                    <small>Agencia</small>
                    <strong>{selectedLoan.agency}</strong>
                  </div>

                  <div>
                    <small>Desembolso</small>
                    <strong>
                      {formatDate(selectedLoan.disbursedAt)}
                    </strong>
                  </div>

                  <div>
                    <small>TEA</small>
                    <strong>
                      {formatRate(selectedLoan.annualRate)}
                    </strong>
                  </div>

                  <div>
                    <small>Cuotas vencidas</small>
                    <strong>{overdueRows.length}</strong>
                  </div>
                </div>
              </section>
          )}

          <section className="panel prestamos-crono-tabla">
            <div className="prestamos-tabla-encabezado">
              <h3>
                {view === 'schedule'
                    ? 'Detalle de cuotas'
                    : 'Primeras cuotas'}
              </h3>

              <span>
              TEA {formatRate(selectedLoan.annualRate)}
            </span>
            </div>

            <ScheduleTable
                rows={
                  view === 'schedule'
                      ? schedule
                      : schedule.slice(0, 5)
                }
            />

            <div className="prestamos-crono-pie">
            <span>
              Mostrando{' '}
              {view === 'schedule'
                  ? schedule.length
                  : Math.min(schedule.length, 5)}
              {' '}de {schedule.length} cuotas
            </span>

              <span>
              Total programado:{' '}
                <strong>{money(totalScheduled)}</strong>
            </span>
            </div>

            {view === 'detail' && (
                <div className="prestamos-crono-ver-todo">
                  <button
                      type="button"
                      className="prestamos-btn-outline"
                      onClick={() => setView('schedule')}
                  >
                    Ver cronograma completo →
                  </button>
                </div>
            )}
          </section>

          <CronogramaImprimible
              loan={selectedLoan}
              rows={schedule}
          />

          {contractOpen && (
              <ContratoPrestamo
                  key={selectedLoan.id}
                  loan={selectedLoan}
                  rows={schedule}
                  onClose={() => setContractOpen(false)}
              />
          )}
        </div>
    );
  }

  // PANTALLA PRINCIPAL
  return (
      <div className="page-loans prestamos-nuevo">
        <section className="panel prestamos-panel-principal">
          <header className="prestamos-main-header">
            <div className="prestamos-main-title">
            <span
                className="prestamos-main-icon"
                aria-hidden="true"
            >
              ▤
            </span>

              <div>
                <h3>Préstamos registrados</h3>

                <p>
                  {isAdmin
                      ? 'Todas las agencias'
                      : me.agency}
                </p>
              </div>
            </div>

            <div className="prestamos-main-actions">
              <button
                  type="button"
                  className="prestamos-btn-outline"
                  onClick={() => setShowNationalSearch(true)}
              >
                Consultar DNI
              </button>
              <button
                  type="button"
                  className="prestamos-btn-outline"
                  onClick={goToClients}
              >
                Registrar RUC 10 / 20 →
              </button>

              {isAdvisor && (
                  <button
                      type="button"
                      className="prestamos-btn-primary"
                      onClick={() => void newLoan()}
                  >
                    + Otorgar préstamo
                  </button>
              )}
            </div>
          </header>

          {/* FILTROS CON EL MISMO DISEÑO DE CLIENTES */}
          <div className="prestamos-simple-filters">
            <label className="prestamos-field prestamos-field-name">
              Nombre o razón social

              <input
                  type="text"
                  value={nameQuery}
                  placeholder="Nombre del cliente o empresa"
                  onChange={event =>
                      setNameQuery(event.target.value)
                  }
              />
            </label>

            <label className="prestamos-field">
              DNI o RUC

              <input
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  value={documentQuery}
                  placeholder="8 u 11 dígitos"
                  onChange={event => {
                    const value = event.target.value;

                    if (/^\d{0,11}$/.test(value)) {
                      setDocumentQuery(value);
                    }
                  }}
              />
            </label>

            <label className="prestamos-field">
              Tipo de documento

              <select
                  value={documentFilter}
                  onChange={event =>
                      setDocumentFilter(
                          event.target.value as DocumentFilter
                      )
                  }
              >
                <option value="all">Todos</option>
                <option value="DNI">DNI</option>
                <option value="RUC10">RUC 10</option>
                <option value="RUC20">RUC 20</option>
              </select>
            </label>

            <label className="prestamos-field">
              Préstamos

              <select
                  value={statusFilter}
                  onChange={event =>
                      setStatusFilter(
                          event.target.value as LoanStatusFilter
                      )
                  }
              >
                <option value="all">Todos</option>
                <option value="ACTIVO">Activos</option>
                <option value="FINALIZADO">Finalizados</option>
              </select>
            </label>

            {isAdmin && (
                <label className="prestamos-field">
                  Agencia

                  <select
                      value={agencyId}
                      onChange={event =>
                          setAgencyId(event.target.value)
                      }
                  >
                    <option value="">
                      Todas las agencias
                    </option>

                    {agencies.map(agency => (
                        <option
                            key={agency.id}
                            value={agency.id}
                        >
                          {agency.name}
                        </option>
                    ))}
                  </select>
                </label>
            )}

            <div className="prestamos-filter-action">
              <button
                  type="button"
                  className="prestamos-clear"
                  onClick={clearFilters}
              >
                Limpiar filtros
              </button>
            </div>
          </div>

          <div className="prestamos-list-heading">
            <h4>Listado de préstamos</h4>

            <span className="prestamos-counter">
            {loading
                ? 'Cargando…'
                : `${visible.length} ${
                    visible.length === 1
                        ? 'préstamo'
                        : 'préstamos'
                }`}
          </span>
          </div>

          <div className="prestamos-table-scroll">
            <table className="prestamos-table">
              <thead>
              <tr>
                <th>N.° Préstamo</th>
                <th>Cliente</th>
                <th>Documento</th>
                {isAdmin && <th>Sede</th>}
                <th>Capital original</th>
                <th>Capital pendiente</th>
                <th>Cuotas</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
              </thead>

              <tbody>
              {loading ? (
                  <SkeletonRows
                      columns={isAdmin ? 9 : 8}
                      rows={4}
                  />
              ) : visible.length ? (
                  visible.map(loan => {
                    const identity = loanIdentity(loan);

                    return (
                        <tr key={loan.id}>
                          <td className="prestamos-code">
                            {loanCode(loan.id)}
                          </td>

                          <td className="prestamos-client">
                            {identity.name}
                          </td>

                          <td>
                            <strong className="prestamos-document">
                              {identity.document}
                            </strong>

                            {identity.isRuc && (
                                <small className="prestamos-document-extra">
                                  DNI responsable:{' '}
                                  {identity.responsibleDni}
                                </small>
                            )}
                          </td>

                          {isAdmin && (
                              <td>{loan.agency}</td>
                          )}

                          <td>{money(loan.principal)}</td>

                          <td>
                            {money(loan.outstandingPrincipal)}
                          </td>

                          <td>{loan.installments}</td>

                          <td>
                        <span
                            className={`prestamos-estado ${
                                loan.status === 'ACTIVO'
                                    ? 'activo'
                                    : 'finalizado'
                            }`}
                        >
                          {loanStatusText(loan.status)}
                        </span>
                          </td>

                          <td>
                            <button
                                type="button"
                                className="prestamos-cronograma-btn"
                                disabled={loanLoading}
                                onClick={() =>
                                    void openLoan(loan, 'schedule')
                                }
                            >
                              Cronograma
                            </button>
                          </td>
                        </tr>
                    );
                  })
              ) : (
                  <tr>
                    <td
                        colSpan={isAdmin ? 9 : 8}
                        className="prestamos-empty"
                    >
                      No se encontraron préstamos con
                      los filtros seleccionados.
                    </td>
                  </tr>
              )}
              </tbody>
            </table>
          </div>

          <div className="prestamos-list-footer">
            Mostrando {visible.length} de{' '}
            {loans.length} préstamos
          </div>
        </section>

        {/* CONSULTA NACIONAL */}
        {showNationalSearch && (
            <Modal
                title="Consultar cliente"
                modalClassName="prestamos-consulta-modal"
                close={() =>
                    setShowNationalSearch(false)
                }
            >
              <div className="prestamos-consulta-content">
                <NationalClientSearch
                    initialDni={initialDni}
                    canGrantLoans={isAdvisor}
                    onRequestLoan={requestLoanFromNational}
                    onRegisterNew={() => {
                      setShowNationalSearch(false);
                      goToClients();
                    }}
                />
              </div>
            </Modal>
        )}

        {/* OTORGAR PRÉSTAMO */}
        {create && (
            <Modal
                title={
                  evaluation
                      ? 'Propuesta de préstamo'
                      : 'Evaluar préstamo'
                }
                modalClassName={
                  evaluation
                      ? 'loan-offer-modal'
                      : undefined
                }
                close={closeLoanForm}
            >
              {evaluation ? (
                  <div className="loan-offer-layout">
                    <div className="loan-offer-scroll">
                      <div className="loan-offer-intro">
                  <span className="confirmation-step">
                    PASO 2 DE 2 · PROPUESTA
                  </span>

                        <p>
                          Revisa las condiciones y explica
                          el cronograma al cliente antes de
                          registrar el préstamo.
                        </p>
                      </div>

                      <section className="loan-offer-borrower">
                        <span>PRESTATARIO</span>

                        <strong>
                          {evaluation.result.borrowerName}
                        </strong>

                        <div className="loan-offer-borrower-facts">
                    <span>
                      {evaluation.result.documentType}
                      {' '}
                      {evaluation.result.borrowerDocument}
                    </span>

                          <span>
                      DNI responsable:{' '}
                            {evaluation.result.responsibleDni}
                    </span>
                        </div>
                      </section>

                      <div className="loan-offer-highlights">
                        <div>
                          <small>Capital solicitado</small>
                          <strong>
                            {money(evaluation.result.principal)}
                          </strong>
                        </div>

                        <div>
                          <small>Primera cuota</small>
                          <strong>
                            {money(
                                evaluation.result.monthlyPaymentEstimate
                            )}
                          </strong>
                        </div>

                        <div className="loan-offer-total">
                          <small>Total a pagar</small>
                          <strong>
                            {money(
                                evaluation.result.totalPaymentEstimate
                            )}
                          </strong>
                        </div>
                      </div>

                      <div className="loan-offer-meta">
                  <span>
                    {evaluation.result.installments}
                    {' '}cuotas de 30 días
                  </span>

                        <span>
                    TEA{' '}
                          {formatRate(
                              evaluation.result.annualRate
                          )}
                  </span>

                        <span>
                    Sede: {evaluation.result.agency}
                  </span>
                      </div>

                      <section className="loan-offer-schedule">
                        <div className="loan-proposal-heading">
                          <b>Cronograma propuesto</b>

                          <small>
                            Fecha de evaluación:{' '}
                            {evaluation.result.quoteDate}
                          </small>
                        </div>

                        <div className="prestamos-table-scroll">
                          <table className="loan-proposal-table">
                            <thead>
                            <tr>
                              <th>Cuota</th>
                              <th>Vencimiento</th>
                              <th>Capital</th>
                              <th>Interés</th>
                              <th>Total</th>
                            </tr>
                            </thead>

                            <tbody>
                            {evaluation.result.schedulePreview.map(
                                row => (
                                    <tr key={row.number}>
                                      <td>{row.number}</td>
                                      <td>{formatDate(row.dueDate)}</td>
                                      <td>{money(row.principal)}</td>
                                      <td>{money(row.interest)}</td>
                                      <td>
                                        <b>{money(row.total)}</b>
                                      </td>
                                    </tr>
                                )
                            )}
                            </tbody>
                          </table>
                        </div>

                        <div className="loan-proposal-mobile-cards">
                          {evaluation.result.schedulePreview.map(
                              row => (
                                  <article
                                      key={row.number}
                                      className="loan-proposal-installment"
                                  >
                                    <div className="loan-proposal-installment-title">
                                      <strong>
                                        Cuota {row.number}
                                      </strong>

                                      <span>
                              Vence {formatDate(row.dueDate)}
                            </span>
                                    </div>

                                    <div className="loan-proposal-installment-values">
                            <span>
                              Capital
                              <b>{money(row.principal)}</b>
                            </span>

                                      <span>
                              Interés
                              <b>{money(row.interest)}</b>
                            </span>

                                      <span className="loan-proposal-installment-total">
                              Total
                              <b>{money(row.total)}</b>
                            </span>
                                    </div>
                                  </article>
                              )
                          )}
                        </div>
                      </section>

                      <p className="loan-offer-note">
                        Esta es una propuesta y todavía no es
                        un préstamo registrado. La aceptación
                        del cliente no sustituye la firma
                        del contrato.
                      </p>
                    </div>

                    <div className="loan-offer-footer">
                      <label className="loan-client-acceptance">
                        <input
                            type="checkbox"
                            checked={clientAccepted}
                            disabled={confirmBusy}
                            onChange={event =>
                                setClientAccepted(
                                    event.target.checked
                                )
                            }
                        />

                        <span>
                    Confirmo que expliqué las cuotas,
                    el plazo y el total a pagar,
                    y que el cliente{' '}
                          <b>aceptó expresamente</b>{' '}
                          la propuesta.
                  </span>
                      </label>

                      <div className="loan-proposal-actions">
                        <button
                            type="button"
                            className="secondary"
                            disabled={confirmBusy}
                            onClick={() => {
                              setEvaluation(undefined);
                              setClientAccepted(false);
                            }}
                        >
                          Modificar
                        </button>

                        <button
                            type="button"
                            className="secondary loan-decline"
                            disabled={confirmBusy}
                            onClick={rejectProposal}
                        >
                          No acepta
                        </button>

                        <button
                            type="button"
                            className="primary"
                            disabled={
                                confirmBusy ||
                                !clientAccepted
                            }
                            onClick={() =>
                                void confirmLoan()
                            }
                        >
                          {confirmBusy
                              ? 'Registrando…'
                              : 'Aceptar y otorgar'}
                        </button>
                      </div>
                    </div>
                  </div>
              ) : (
                  <form
                      className="form-grid"
                      onSubmit={evaluate}
                  >
                    <div className="confirmation-step span">
                      PASO 1 DE 2 · EVALUACIÓN
                    </div>

                    {loanDocument && (
                        <div className="document-result span">
                  <span className="tag">
                    Documento verificado
                  </span>

                          <h4>
                            {loanDocument.borrowerName}
                          </h4>

                          <p>
                            {loanDocument.documentType}
                            {' '}
                            {loanDocument.documentNumber}
                            {' · '}
                            DNI responsable:{' '}
                            {loanDocument.responsibleDni}
                          </p>

                          {loanDocument.representativeName && (
                              <p>
                                Representante:{' '}
                                {loanDocument.representativeName}
                              </p>
                          )}
                        </div>
                    )}

                    <label className="span">
                      {loanDocument
                          ? 'DNI responsable'
                          : 'Cliente'}

                      <select
                          name="clientId"
                          disabled={Boolean(loanDocument)}
                          defaultValue={
                              prefilledClientId ??
                              selectedClientId ??
                              clients[0]?.id ??
                              ''
                          }
                          required
                      >
                        {clients.map(client => (
                            <option
                                key={client.id}
                                value={client.id}
                            >
                              {client.dni} · {client.names}
                              {' '}{client.surnames}
                            </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Monto (S/)

                      <input
                          name="amount"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          pattern="[0-9]+"
                          required
                          value={amountInput}
                          aria-invalid={Boolean(amountError)}
                          onChange={event => {
                            const value = event.target.value;

                            if (/^\d*$/.test(value)) {
                              setAmountInput(value);
                              setAmountError(
                                  value &&
                                  (
                                      Number(value) < 1 ||
                                      Number(value) > 10000
                                  )
                                      ? 'Monto entre S/ 1 y S/ 10,000.'
                                      : ''
                              );
                            }
                          }}
                      />

                      {amountError && (
                          <small
                              className="loan-amount-error"
                              role="alert"
                          >
                            {amountError}
                          </small>
                      )}
                    </label>

                    <label>
                      Número de cuotas

                      <input
                          name="installments"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          pattern="[0-9]+"
                          required
                          value={installmentsInput}
                          aria-invalid={
                            Boolean(installmentsError)
                          }
                          onChange={event => {
                            const value = event.target.value;

                            if (/^\d*$/.test(value)) {
                              setInstallmentsInput(value);
                              setInstallmentsError(
                                  value &&
                                  (
                                      Number(value) < 1 ||
                                      Number(value) > 36
                                  )
                                      ? 'Entre 1 y 36 cuotas.'
                                      : ''
                              );
                            }
                          }}
                      />

                      {installmentsError && (
                          <small
                              className="loan-amount-error"
                              role="alert"
                          >
                            {installmentsError}
                          </small>
                      )}
                    </label>

                    <div className="form-actions span">
                      <button
                          type="button"
                          className="secondary"
                          onClick={closeLoanForm}
                      >
                        Cancelar
                      </button>

                      <button className="primary">
                        Evaluar solicitud
                      </button>
                    </div>
                  </form>
              )}
            </Modal>
        )}
      </div>
  );
}
