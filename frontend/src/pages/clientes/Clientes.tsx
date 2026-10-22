
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FormEvent
} from 'react';

import { api, money, ApiError } from '../../api/api';

import type {
    Agency,
    Client,
    Installment,
    Loan,
    Me
} from '../../types/models';

import { Modal } from '../../components/Modal';
import type { LinkedDocument } from './RucLookup';
import { loanIdentity } from '../../utils/loanIdentity';
import './Clientes.css';

type DniLookup = {
    dni: string;
    names: string;
    paternalSurname: string;
    maternalSurname: string;
    surnames: string;
    verificationId: string;
};

type DocumentType = 'DNI' | 'RUC10' | 'RUC20';
type DocumentFilter = 'all' | DocumentType;
type CreditFilter = 'all' | 'with' | 'without';

type DirectoryEntry = {
    key: string;
    kind: DocumentType;
    document: string;
    name: string;
    phone: string;
    credits: number;
    status: string;
    agency: string;
    client?: Client;
    link?: LinkedDocument;
};

type HistoryData = {
    client: Client;
    loans: Loan[];
    document: string;
    documentType: DocumentType;
    displayName: string;
};

type ScheduleData = {
    loan: Loan;
    rows: Installment[];
};

function errorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        const fields = error.fieldErrors ?? {};
        const details = [
            ...new Set(Object.values(fields).filter(Boolean))
        ];

        if (details.length > 0) {
            return details.join(' ');
        }
    }

    return error instanceof Error
        ? error.message
        : 'No se pudo realizar la operación.';
}

function getLoanDocument(loan: Loan): string {
    return String(
        loan.borrowerDocument || loan.dni || ''
    ).trim();
}

function loanMatchesDocument(
    loan: Loan,
    document: string
): boolean {
    return getLoanDocument(loan) === document.trim();
}

function loanCode(id: number): string {
    return `PR-${String(id).padStart(6, '0')}`;
}

function formatDate(value?: string): string {
    if (!value) return '—';

    const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    return match
        ? `${match[3]}/${match[2]}/${match[1]}`
        : value;
}

function statusName(status: string): string {
    switch (status) {
        case 'AL_DIA':
            return 'Al día';
        case 'SIN_CREDITOS':
            return 'Sin créditos';
        case 'VINCULADO':
            return 'Vinculado';
        case 'INACTIVO':
            return 'Inactivo';
        case 'MOROSO':
            return 'Moroso';
        default:
            return status.replaceAll('_', ' ');
    }
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function printSchedule(
    loan: Loan,
    rows: Installment[]
): boolean {
    const popup = window.open('', '_blank');

    if (!popup) return false;

    const identity = loanIdentity(loan);

    const totalPrincipal = rows.reduce(
        (sum, row) => sum + Number(row.principal),
        0
    );

    const totalInterest = rows.reduce(
        (sum, row) => sum + Number(row.interest),
        0
    );

    const totalPaid = rows.reduce(
        (sum, row) => sum + Number(row.paid),
        0
    );

    const totalOutstanding = rows.reduce(
        (sum, row) => sum + Number(row.outstanding),
        0
    );

    const tableRows = rows.map(row => `
    <tr>
      <td>${row.number}</td>
      <td>${escapeHtml(formatDate(row.dueDate))}</td>
      <td>${escapeHtml(money(row.principal))}</td>
      <td>${escapeHtml(money(row.interest))}</td>
      <td>${escapeHtml(money(row.paid))}</td>
      <td>${escapeHtml(money(row.outstanding))}</td>
      <td>${escapeHtml(row.status)}</td>
    </tr>
  `).join('');

    popup.document.open();

    popup.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Cronograma ${loanCode(loan.id)}</title>

      <style>
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 30px;
          color: #183456;
          background: #ffffff;
          font-family: Arial, sans-serif;
          font-size: 12px;
        }

        .toolbar {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 25px;
        }

        button {
          padding: 11px 20px;
          border: 0;
          border-radius: 8px;
          background: #0968f7;
          color: white;
          font-weight: bold;
          cursor: pointer;
        }

        header {
          padding-bottom: 17px;
          border-bottom: 2px solid #0968f7;
        }

        .brand {
          color: #0968f7;
          font-weight: 800;
          letter-spacing: 1px;
        }

        h1 {
          margin: 12px 0 7px;
          font-size: 24px;
        }

        .subtitle {
          color: #788ca6;
        }

        .facts {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin: 25px 0;
        }

        .fact {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .fact small {
          color: #7d8ea5;
          text-transform: uppercase;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          padding: 11px 8px;
          background: #eef4fd;
          color: #315a86;
          text-align: left;
        }

        td {
          padding: 10px 8px;
          border-bottom: 1px solid #e5edf6;
        }

        tfoot td {
          background: #f5f8fc;
          font-weight: bold;
        }

        @page {
          size: A4 landscape;
          margin: 15mm;
        }

        @media print {
          body {
            padding: 0;
          }

          .toolbar {
            display: none;
          }

          thead {
            display: table-header-group;
          }

          tr {
            break-inside: avoid;
          }

          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
      </style>
    </head>

    <body>
      <div class="toolbar">
        <button onclick="window.print()">
          Imprimir / Guardar PDF
        </button>
      </div>

      <header>
        <div class="brand">PRÉSTAMO CASTILLO</div>
        <h1>Cronograma de pagos</h1>
        <div class="subtitle">
          Préstamo ${loanCode(loan.id)}
        </div>
      </header>

      <section class="facts">
        <div class="fact">
          <small>Prestatario</small>
          <b>${escapeHtml(identity.name)}</b>
        </div>

        <div class="fact">
          <small>Documento</small>
          <b>${escapeHtml(identity.document)}</b>
        </div>

        <div class="fact">
          <small>Agencia</small>
          <b>${escapeHtml(loan.agency)}</b>
        </div>

        <div class="fact">
          <small>Capital original</small>
          <b>${escapeHtml(money(loan.principal))}</b>
        </div>

        <div class="fact">
          <small>Capital pendiente</small>
          <b>${escapeHtml(money(loan.outstandingPrincipal))}</b>
        </div>

        <div class="fact">
          <small>Número de cuotas</small>
          <b>${loan.installments}</b>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>N.°</th>
            <th>Vencimiento</th>
            <th>Capital</th>
            <th>Interés</th>
            <th>Pagado</th>
            <th>Saldo</th>
            <th>Estado</th>
          </tr>
        </thead>

        <tbody>${tableRows}</tbody>

        <tfoot>
          <tr>
            <td colspan="2">TOTAL</td>
            <td>${escapeHtml(money(totalPrincipal))}</td>
            <td>${escapeHtml(money(totalInterest))}</td>
            <td>${escapeHtml(money(totalPaid))}</td>
            <td>${escapeHtml(money(totalOutstanding))}</td>
            <td>—</td>
          </tr>
        </tfoot>
      </table>
    </body>
    </html>
  `);

    popup.document.close();
    popup.focus();

    return true;
}

export function Clientes({
                             me,
                             notify,
                             createLoan,
                             goToLoans,
                             initialAgencyId,
                             selectedClientId,
                             clientOpened
                         }: {
    me: Me;
    notify: (message: string, error?: boolean) => void;
    createLoan: (clientId: number, dni: string) => void;
    linkLoan: (link: LinkedDocument) => void;
    goToLoans?: () => void;
    initialAgencyId?: string;
    selectedClientId?: number;
    clientOpened: () => void;
}) {
    const isAdmin = me.role === 'ADMIN';
    const isAdvisor = me.role === 'ADVISOR';

    // DATOS DEL DIRECTORIO
    const [clients, setClients] = useState<Client[]>([]);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [agencies, setAgencies] = useState<Agency[]>([]);
    const [linkedDocuments, setLinkedDocuments] =
        useState<LinkedDocument[]>([]);

    const [agencyId, setAgencyId] =
        useState(initialAgencyId ?? '');

    const [directoryWarning, setDirectoryWarning] =
        useState('');

    // FILTROS
    const [nameQuery, setNameQuery] = useState('');
    const [documentQuery, setDocumentQuery] = useState('');

    const [documentFilter, setDocumentFilter] =
        useState<DocumentFilter>('all');

    const [creditFilter, setCreditFilter] =
        useState<CreditFilter>('all');

    // REGISTRO
    const [registrationOpen, setRegistrationOpen] =
        useState(false);

    const [dni, setDni] = useState('');
    const [identity, setIdentity] =
        useState<DniLookup>();

    const [existingClient, setExistingClient] =
        useState<{
            id: number;
            dni: string;
            names: string;
            surnames: string;
            agency: string;
        }>();

    const [dniError, setDniError] = useState('');
    const [formError, setFormError] = useState('');
    const [formMessage, setFormMessage] = useState('');

    const [lookupBusy, setLookupBusy] = useState(false);
    const [saveBusy, setSaveBusy] = useState(false);

    const requestVersion = useRef(0);
    const currentDni = useRef('');

    const lookupController =
        useRef<AbortController | undefined>(undefined);

    // HISTORIAL
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyLoading, setHistoryLoading] =
        useState(false);

    const [historyError, setHistoryError] =
        useState('');

    const [history, setHistory] =
        useState<HistoryData>();

    // CRONOGRAMA
    const [scheduleOpen, setScheduleOpen] = useState(false);

    const [scheduleLoading, setScheduleLoading] =
        useState(false);

    const [scheduleError, setScheduleError] =
        useState('');

    const [schedule, setSchedule] =
        useState<ScheduleData>();

    const registrationBlocked =
        !isAdvisor ||
        me.agencyEnabled === false ||
        me.canRegisterClients === false;

    // CARGAR CLIENTES Y PRÉSTAMOS
    const load = useCallback(async () => {
        try {
            const agencyQuery =
                isAdmin && agencyId
                    ? `?agencyId=${encodeURIComponent(agencyId)}`
                    : '';

            const [clientData, loanData] = await Promise.all([
                api<Client[]>(`/clients${agencyQuery}`),
                api<Loan[]>(`/loans${agencyQuery}`)
            ]);

            setClients(clientData);
            setLoans(loanData);

            try {
                const links = await api<LinkedDocument[]>(
                    '/ruc/directory'
                );

                setLinkedDocuments(links);
                setDirectoryWarning('');
            } catch {
                setLinkedDocuments([]);

                setDirectoryWarning(
                    'No se pudo cargar el directorio de RUC.'
                );
            }
        } catch (error) {
            notify(errorMessage(error), true);
        }
    }, [isAdmin, agencyId, notify]);

    useEffect(() => {
        void load();
    }, [load]);

    // CARGAR AGENCIAS PARA ADMIN
    useEffect(() => {
        if (!isAdmin) return;

        api<Agency[]>('/admin/agencies')
            .then(setAgencies)
            .catch(error =>
                notify(errorMessage(error), true)
            );
    }, [isAdmin, notify]);

    // CERRAR HISTORIAL
    const closeHistory = useCallback(() => {
        setHistoryOpen(false);
        setHistory(undefined);
        setHistoryError('');
        setHistoryLoading(false);

        setScheduleOpen(false);
        setSchedule(undefined);
        setScheduleError('');
        setScheduleLoading(false);
    }, []);

    // HISTORIAL SOLICITADO DESDE OTRO MÓDULO
    useEffect(() => {
        if (selectedClientId === undefined) return;

        let active = true;

        setHistoryOpen(true);
        setHistoryLoading(true);
        setHistoryError('');
        setHistory(undefined);

        Promise.all([
            api<Client>(`/clients/${selectedClientId}`),
            api<Loan[]>(
                `/clients/${selectedClientId}/loans`
            )
        ])
            .then(([client, records]) => {
                if (!active) return;

                setHistory({
                    client,
                    loans: records.filter(loan =>
                        loanMatchesDocument(loan, client.dni)
                    ),
                    document: client.dni,
                    documentType: 'DNI',
                    displayName:
                        `${client.names} ${client.surnames}`
                });

                setHistoryLoading(false);
                clientOpened();
            })
            .catch(error => {
                if (!active) return;

                setHistoryError(errorMessage(error));
                setHistoryLoading(false);
                clientOpened();
            });

        return () => {
            active = false;
        };
    }, [selectedClientId, clientOpened]);

    // CONTAR PRÉSTAMOS SEGÚN DOCUMENTO
    const documentCounts = new Map<string, number>();

    for (const loan of loans) {
        const document = getLoanDocument(loan);

        if (!document) continue;

        documentCounts.set(
            document,
            (documentCounts.get(document) ?? 0) + 1
        );
    }

    // PERSONAS Y RUC VINCULADOS
    const entries: DirectoryEntry[] = [
        ...clients.map(client => {
            const credits =
                documentCounts.get(client.dni) ?? 0;

            return {
                key: `dni-${client.id}`,
                kind: 'DNI' as const,
                document: client.dni,
                name:
                    `${client.names} ${client.surnames}`,
                phone: client.phone ?? '',
                credits,
                status: !client.active
                    ? 'INACTIVO'
                    : credits > 0
                        ? 'AL_DIA'
                        : 'SIN_CREDITOS',
                agency: client.agency ?? me.agency,
                client
            };
        }),

        ...linkedDocuments
            .filter(link =>
                isAdmin
                    ? !agencyId ||
                    clients.some(
                        client => client.id === link.clientId
                    )
                    : true
            )
            .map(link => ({
                key:
                    `ruc-${link.id ?? link.documentNumber}`,
                kind: link.documentType,
                document: link.documentNumber,
                name: link.borrowerName,
                phone: '',
                credits:
                    documentCounts.get(link.documentNumber) ?? 0,
                status: 'VINCULADO',
                agency:
                    clients.find(
                        client => client.id === link.clientId
                    )?.agency ?? me.agency,
                link
            }))
    ];

    // FILTRADO AUTOMÁTICO
    const visible = entries
        .filter(item =>
            item.name
                .toLocaleLowerCase('es')
                .includes(
                    nameQuery.trim().toLocaleLowerCase('es')
                )
        )
        .filter(item =>
            item.document.includes(documentQuery.trim())
        )
        .filter(item =>
            documentFilter === 'all' ||
            item.kind === documentFilter
        )
        .filter(item =>
            creditFilter === 'all' ||
            (
                creditFilter === 'with'
                    ? item.credits > 0
                    : item.credits === 0
            )
        )
        .sort((a, b) =>
            a.name.localeCompare(b.name, 'es')
        );

    function clearFilters() {
        setNameQuery('');
        setDocumentQuery('');
        setDocumentFilter('all');
        setCreditFilter('all');
    }

    // REINICIAR FORMULARIO
    function resetForm() {
        requestVersion.current++;
        lookupController.current?.abort();

        currentDni.current = '';

        setDni('');
        setIdentity(undefined);
        setExistingClient(undefined);
        setDniError('');
        setFormError('');
        setFormMessage('');
        setLookupBusy(false);
        setSaveBusy(false);
    }

    function changeDni(value: string) {
        if (!/^\d{0,8}$/.test(value)) {
            setDniError(
                'El DNI debe contener 8 dígitos.'
            );
            return;
        }

        requestVersion.current++;
        lookupController.current?.abort();

        currentDni.current = value;

        setDni(value);
        setIdentity(undefined);
        setExistingClient(undefined);
        setFormError('');
        setLookupBusy(false);

        setDniError(
            value.length > 0 && value.length < 8
                ? 'El DNI debe contener 8 dígitos.'
                : ''
        );

        setFormMessage(
            value.length === 8
                ? 'Consulta el DNI para verificarlo.'
                : ''
        );
    }

    const validDni = /^\d{8}$/.test(dni);

    const canSave = Boolean(
        !registrationBlocked &&
        identity &&
        identity.dni === dni &&
        !existingClient &&
        validDni &&
        !dniError &&
        !lookupBusy &&
        !saveBusy
    );

    // CONSULTAR DNI DENTRO DE NUEVO CLIENTE
    async function lookupDni() {
        if (
            registrationBlocked ||
            !validDni ||
            lookupBusy ||
            saveBusy
        ) return;

        lookupController.current?.abort();

        const controller = new AbortController();
        lookupController.current = controller;

        const version = ++requestVersion.current;
        const requestedDni = dni;

        setLookupBusy(true);
        setIdentity(undefined);
        setExistingClient(undefined);
        setFormError('');
        setFormMessage('Consultando DNI…');

        try {
            const status = await api<{
                exists: boolean;
                id?: number;
                dni?: string;
                names?: string;
                surnames?: string;
                agency?: string;
            }>(
                `/clients/registration-status?dni=${requestedDni}`,
                {
                    signal: controller.signal
                }
            );

            if (
                version !== requestVersion.current ||
                currentDni.current !== requestedDni
            ) return;

            if (
                status.exists &&
                status.id &&
                status.dni &&
                status.names &&
                status.surnames &&
                status.agency
            ) {
                setExistingClient({
                    id: status.id,
                    dni: status.dni,
                    names: status.names,
                    surnames: status.surnames,
                    agency: status.agency
                });

                setFormMessage(
                    'El cliente ya está registrado.'
                );

                return;
            }

            const result = await api<DniLookup>(
                '/clients/dni-lookup',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        dni: requestedDni
                    }),
                    signal: controller.signal
                }
            );

            if (
                version !== requestVersion.current ||
                currentDni.current !== requestedDni
            ) return;

            if (
                result.dni !== requestedDni ||
                !result.verificationId
            ) {
                throw new Error(
                    'La respuesta no corresponde al DNI consultado.'
                );
            }

            setIdentity(result);
            setFormMessage(
                'Identidad verificada correctamente.'
            );
        } catch (error) {
            if (
                controller.signal.aborted ||
                version !== requestVersion.current
            ) return;

            setIdentity(undefined);
            setFormMessage('');
            setFormError(errorMessage(error));
        } finally {
            if (version === requestVersion.current) {
                setLookupBusy(false);
            }
        }
    }

    // GUARDAR CLIENTE
    async function save(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        if (!canSave || !identity) {
            setFormError(
                'Debes verificar el DNI antes de registrar.'
            );
            return;
        }

        setSaveBusy(true);
        setFormError('');

        try {
            await api('/clients', {
                method: 'POST',
                body: JSON.stringify({
                    dni,
                    names: identity.names,
                    surnames: identity.surnames,
                    verificationId: identity.verificationId
                })
            });

            setRegistrationOpen(false);
            resetForm();

            notify('Cliente registrado correctamente.');
            await load();
        } catch (error) {
            setFormError(errorMessage(error));
        } finally {
            setSaveBusy(false);
        }
    }

    // HISTORIAL POR DNI
    async function openHistory(client: Client) {
        setHistoryOpen(true);
        setHistoryLoading(true);
        setHistoryError('');
        setHistory(undefined);

        setScheduleOpen(false);
        setSchedule(undefined);

        try {
            const [detail, records] = await Promise.all([
                api<Client>(`/clients/${client.id}`),
                api<Loan[]>(
                    `/clients/${client.id}/loans`
                )
            ]);

            setHistory({
                client: detail,
                loans: records.filter(loan =>
                    loanMatchesDocument(loan, detail.dni)
                ),
                document: detail.dni,
                documentType: 'DNI',
                displayName:
                    `${detail.names} ${detail.surnames}`
            });
        } catch (error) {
            setHistoryError(errorMessage(error));
        } finally {
            setHistoryLoading(false);
        }
    }

    // HISTORIAL POR RUC
    async function openRucHistory(
        link: LinkedDocument
    ) {
        setHistoryOpen(true);
        setHistoryLoading(true);
        setHistoryError('');
        setHistory(undefined);

        setScheduleOpen(false);
        setSchedule(undefined);

        try {
            const [client, records] = await Promise.all([
                api<Client>(
                    `/clients/${link.clientId}`
                ),
                api<Loan[]>(
                    `/clients/${link.clientId}/loans`
                )
            ]);

            setHistory({
                client,
                loans: records.filter(loan =>
                    loanMatchesDocument(
                        loan,
                        link.documentNumber
                    )
                ),
                document: link.documentNumber,
                documentType: link.documentType,
                displayName: link.borrowerName
            });
        } catch (error) {
            setHistoryError(errorMessage(error));
        } finally {
            setHistoryLoading(false);
        }
    }

    // CONSULTAR CRONOGRAMA
    async function openSchedule(loan: Loan) {
        setScheduleOpen(true);
        setScheduleLoading(true);
        setScheduleError('');
        setSchedule(undefined);

        try {
            const records = await api<Installment[]>(
                `/loans/${loan.id}/schedule`
            );

            setSchedule({
                loan,
                rows: records
            });
        } catch (error) {
            setScheduleError(errorMessage(error));
        } finally {
            setScheduleLoading(false);
        }
    }

    const activeHistoryLoans = (
        history?.loans ?? []
    ).filter(loan => loan.status === 'ACTIVO');

    const outstandingCapital = activeHistoryLoans.reduce(
        (sum, loan) =>
            sum + Number(loan.outstandingPrincipal),
        0
    );

    function navigateToLoans() {
        closeHistory();

        if (goToLoans) {
            goToLoans();
        } else {
            notify(
                'La navegación a Préstamos no está conectada.',
                true
            );
        }
    }

    return (
        <div className="page-clients client-directory-v2">
            {registrationBlocked && isAdvisor && (
                <p className="dni-status error" role="alert">
                    La agencia {me.agency} no está habilitada
                    para registrar clientes.
                </p>
            )}

            {/* PANEL ÚNICO: CLIENTES */}
            <section className="panel clientes-panel-unificado">
                <header className="clientes-unificado-header">
                    <div className="clientes-unificado-titulo">
            <span
                className="clientes-unificado-icono"
                aria-hidden="true"
            >
              ▦
            </span>

                        <div>
                            <h2>
                                {isAdmin
                                    ? 'Directorio nacional'
                                    : 'Clientes de la agencia'}
                            </h2>

                            <span className="clientes-unificado-sede">
                {isAdmin
                    ? 'Gestión nacional'
                    : me.agency}
              </span>
                        </div>
                    </div>

                    {/* SOLO NUEVO CLIENTE PARA ASESORES */}
                    <div className="clientes-acciones">
                        {isAdvisor && (
                            <button
                                type="button"
                                className="clientes-nuevo"
                                disabled={registrationBlocked}
                                onClick={() => {
                                    resetForm();
                                    setRegistrationOpen(true);
                                }}
                            >
                                + Nuevo cliente
                            </button>
                        )}
                    </div>
                </header>

                {/* FILTROS */}
                <div className="clientes-unificado-filtros">
                    <div className="clientes-filtros">
                        <label className="clientes-campo">
                            Nombre o razón social

                            <input
                                type="text"
                                value={nameQuery}
                                placeholder="Nombre del cliente o empresa"
                                onChange={event => {
                                    const value = event.target.value;

                                    if (
                                        /^[\p{L}\p{M} .'-]*$/u.test(value)
                                    ) {
                                        setNameQuery(value);
                                    }
                                }}
                            />
                        </label>

                        <label className="clientes-campo">
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

                        <label className="clientes-campo">
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

                        <label className="clientes-campo">
                            Préstamos

                            <select
                                value={creditFilter}
                                onChange={event =>
                                    setCreditFilter(
                                        event.target.value as CreditFilter
                                    )
                                }
                            >
                                <option value="all">Todos</option>
                                <option value="with">
                                    Con préstamos
                                </option>
                                <option value="without">
                                    Sin préstamos
                                </option>
                            </select>
                        </label>

                        {isAdmin && (
                            <label className="clientes-campo">
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

                        <div className="clientes-filtros-acciones">
                            <button
                                type="button"
                                className="clientes-limpiar"
                                onClick={clearFilters}
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    </div>
                </div>

                {/* LISTADO DE CLIENTES */}
                <div className="clientes-unificado-listado">
                    {directoryWarning && (
                        <div
                            className="directory-notice"
                            role="status"
                        >
                            {directoryWarning}
                        </div>
                    )}

                    <div className="clientes-tabla-contenedor">
                        <table className="clientes-tabla">
                            <thead>
                            <tr>
                                <th>Tipo</th>
                                <th>Identificación</th>
                                <th>Nombre / Razón social</th>

                                {isAdmin && (
                                    <th>Agencia</th>
                                )}

                                <th>Celular</th>
                                <th>Créditos</th>
                                <th>Estado</th>
                                <th>Historial</th>
                            </tr>
                            </thead>

                            <tbody>
                            {visible.length > 0 ? (
                                visible.map(item => (
                                    <tr key={item.key}>
                                        <td>
                        <span
                            className={`clientes-tipo ${
                                item.kind === 'RUC20'
                                    ? 'empresa'
                                    : 'persona'
                            }`}
                        >
                          <span aria-hidden="true">
                            {item.kind === 'RUC20'
                                ? '▦'
                                : '●'}
                          </span>

                            {item.kind === 'DNI'
                                ? 'Persona'
                                : item.kind === 'RUC10'
                                    ? 'RUC 10'
                                    : 'Empresa'}
                        </span>
                                        </td>

                                        <td className="clientes-documento">
                                            {item.document}
                                        </td>

                                        <td className="clientes-nombre">
                                            {item.name}
                                        </td>

                                        {isAdmin && (
                                            <td>{item.agency}</td>
                                        )}

                                        <td className="clientes-celular">
                                            {item.phone || '—'}
                                        </td>

                                        <td>
                        <span className="clientes-creditos">
                          {item.credits}
                        </span>
                                        </td>

                                        <td>
                        <span
                            className={`clientes-estado ${
                                item.status === 'MOROSO'
                                    ? 'moroso'
                                    : item.status === 'INACTIVO'
                                        ? 'inactivo'
                                        : item.status === 'SIN_CREDITOS'
                                            ? 'sin-creditos'
                                            : item.status === 'VINCULADO'
                                                ? 'vinculado'
                                                : 'al-dia'
                            }`}
                        >
                          {statusName(item.status)}
                        </span>
                                        </td>

                                        <td>
                                            <button
                                                type="button"
                                                className="clientes-historial-btn"
                                                onClick={() => {
                                                    if (item.client) {
                                                        void openHistory(item.client);
                                                    } else if (item.link) {
                                                        void openRucHistory(item.link);
                                                    }
                                                }}
                                            >
                          <span aria-hidden="true">
                            ▤
                          </span>
                                                Historial
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan={isAdmin ? 8 : 7}
                                        className="clientes-sin-resultados"
                                    >
                                        <strong>
                                            No se encontraron clientes
                                        </strong>

                                        <p>
                                            Modifica los filtros para
                                            buscar otro registro.
                                        </p>
                                    </td>
                                </tr>
                            )}
                            </tbody>
                        </table>
                    </div>

                    <div
                        className="clientes-pie"
                        aria-live="polite"
                    >
            <span>
              Mostrando{' '}
                <strong>{visible.length}</strong>
                {' '}de{' '}
                <strong>{entries.length}</strong>
                {' '}registros
            </span>

                        <span>DNI y RUC vinculados</span>
                    </div>
                </div>
            </section>

            {/* HISTORIAL DE PRÉSTAMOS */}
            {historyOpen && !scheduleOpen && (
                <Modal
                    title="Historial de préstamos"
                    modalClassName="clientes-history-modal"
                    close={closeHistory}
                >
                    <div className="clientes-history-content">
                        {historyLoading && (
                            <p className="clientes-loading">
                                Cargando préstamos…
                            </p>
                        )}

                        {historyError && (
                            <p
                                className="dni-status error"
                                role="alert"
                            >
                                {historyError}
                            </p>
                        )}

                        {history && !historyLoading && (
                            <>
                                <div className="clientes-history-persona">
                                    <div className="clientes-history-avatar">
                                        {history.displayName.slice(0, 1)}
                                    </div>

                                    <div>
                                        <h3>{history.displayName}</h3>

                                        <p>
                                            {history.documentType}{' '}
                                            {history.document}
                                            {' · '}
                                            {history.client.agency || me.agency}
                                        </p>
                                    </div>
                                </div>

                                <div className="clientes-history-stats">
                                    <article>
                    <span>
                      Préstamos registrados
                    </span>

                                        <strong>
                                            {history.loans.length}
                                        </strong>
                                    </article>

                                    <article>
                                        <span>Préstamos activos</span>

                                        <strong>
                                            {activeHistoryLoans.length}
                                        </strong>
                                    </article>

                                    <article>
                                        <span>Capital pendiente</span>

                                        <strong>
                                            {money(outstandingCapital)}
                                        </strong>
                                    </article>
                                </div>

                                <div className="clientes-history-section-title">
                                    <h4>Préstamos del documento</h4>

                                    <span>
                    {history.loans.length} registros
                  </span>
                                </div>

                                {history.loans.length > 0 ? (
                                    <div className="clientes-history-table-wrap">
                                        <table className="clientes-history-table">
                                            <thead>
                                            <tr>
                                                <th>Préstamo</th>
                                                <th>Desembolso</th>
                                                <th>Capital</th>
                                                <th>Pendiente</th>
                                                <th>Cuotas</th>
                                                <th>Estado</th>
                                                <th>Cronograma</th>
                                            </tr>
                                            </thead>

                                            <tbody>
                                            {history.loans.map(loan => (
                                                <tr key={loan.id}>
                                                    <td className="clientes-loan-code">
                                                        {loanCode(loan.id)}
                                                    </td>

                                                    <td>
                                                        {formatDate(loan.disbursedAt)}
                                                    </td>

                                                    <td>
                                                        {money(loan.principal)}
                                                    </td>

                                                    <td>
                                                        {money(
                                                            loan.outstandingPrincipal
                                                        )}
                                                    </td>

                                                    <td>
                                                        {loan.installments}
                                                    </td>

                                                    <td>
                              <span
                                  className={`clientes-loan-state ${
                                      loan.status === 'ACTIVO'
                                          ? 'activo'
                                          : 'finalizado'
                                  }`}
                              >
                                {loan.status}
                              </span>
                                                    </td>

                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="clientes-schedule-btn"
                                                            onClick={() =>
                                                                void openSchedule(loan)
                                                            }
                                                        >
                                                            Ver cronograma
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="clientes-history-empty">
                                        <span aria-hidden="true">▤</span>

                                        <strong>
                                            Sin préstamos registrados
                                        </strong>

                                        <p>
                                            No hay préstamos otorgados
                                            con este documento.
                                        </p>
                                    </div>
                                )}

                                <div className="clientes-history-footer">
                                    <button
                                        type="button"
                                        className="clientes-history-secondary"
                                        onClick={closeHistory}
                                    >
                                        Cerrar
                                    </button>

                                    {goToLoans && (
                                        <button
                                            type="button"
                                            className="clientes-history-primary"
                                            onClick={navigateToLoans}
                                        >
                                            Ir a Préstamos →
                                        </button>
                                    )}
                                </div>
                            </>
                        )}

                        {historyError && !historyLoading && (
                            <div className="clientes-history-footer">
                                <button
                                    type="button"
                                    className="clientes-history-secondary"
                                    onClick={closeHistory}
                                >
                                    Cerrar
                                </button>
                            </div>
                        )}
                    </div>
                </Modal>
            )}

            {/* CRONOGRAMA DE PAGOS */}
            {historyOpen && scheduleOpen && (
                <Modal
                    title="Cronograma de pagos"
                    modalClassName="clientes-schedule-modal"
                    close={() => {
                        setScheduleOpen(false);
                        setSchedule(undefined);
                        setScheduleError('');
                    }}
                >
                    <div className="clientes-schedule-content">
                        {scheduleLoading && (
                            <p className="clientes-loading">
                                Cargando cronograma…
                            </p>
                        )}

                        {scheduleError && (
                            <p
                                className="dni-status error"
                                role="alert"
                            >
                                {scheduleError}
                            </p>
                        )}

                        {schedule && !scheduleLoading && (
                            <>
                                <div className="clientes-schedule-intro">
                                    <div>
                    <span className="clientes-schedule-eyebrow">
                      PRÉSTAMO
                    </span>

                                        <h3>
                                            {loanCode(schedule.loan.id)}
                                        </h3>

                                        <p>
                                            {loanIdentity(schedule.loan).name}
                                            {' · '}
                                            {loanIdentity(schedule.loan).document}
                                        </p>
                                    </div>

                                    <span
                                        className={`clientes-loan-state ${
                                            schedule.loan.status === 'ACTIVO'
                                                ? 'activo'
                                                : 'finalizado'
                                        }`}
                                    >
                    {schedule.loan.status}
                  </span>
                                </div>

                                <div className="clientes-schedule-stats">
                                    <div>
                                        <span>Capital original</span>

                                        <strong>
                                            {money(schedule.loan.principal)}
                                        </strong>
                                    </div>

                                    <div>
                                        <span>Capital pendiente</span>

                                        <strong>
                                            {money(
                                                schedule.loan.outstandingPrincipal
                                            )}
                                        </strong>
                                    </div>

                                    <div>
                                        <span>Cuotas</span>

                                        <strong>
                                            {schedule.loan.installments}
                                        </strong>
                                    </div>

                                    <div>
                                        <span>Desembolso</span>

                                        <strong>
                                            {formatDate(
                                                schedule.loan.disbursedAt
                                            )}
                                        </strong>
                                    </div>
                                </div>

                                <div className="clientes-history-section-title">
                                    <h4>Detalle de cuotas</h4>

                                    <span>
                    {schedule.rows.length} cuotas
                  </span>
                                </div>

                                <div className="clientes-history-table-wrap">
                                    <table className="clientes-history-table">
                                        <thead>
                                        <tr>
                                            <th>N.°</th>
                                            <th>Vencimiento</th>
                                            <th>Capital</th>
                                            <th>Interés</th>
                                            <th>Pagado</th>
                                            <th>Saldo</th>
                                            <th>Estado</th>
                                        </tr>
                                        </thead>

                                        <tbody>
                                        {schedule.rows.map(row => (
                                            <tr key={row.id}>
                                                <td>{row.number}</td>

                                                <td>
                                                    {formatDate(row.dueDate)}
                                                </td>

                                                <td>
                                                    {money(row.principal)}
                                                </td>

                                                <td>
                                                    {money(row.interest)}
                                                </td>

                                                <td>
                                                    {money(row.paid)}
                                                </td>

                                                <td>
                                                    {money(row.outstanding)}
                                                </td>

                                                <td>
                            <span
                                className={`clientes-installment-state ${
                                    row.status === 'PAGADA'
                                        ? 'pagada'
                                        : row.status === 'VENCIDA'
                                            ? 'vencida'
                                            : 'pendiente'
                                }`}
                            >
                              {row.status}
                            </span>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="clientes-history-footer">
                                    <button
                                        type="button"
                                        className="clientes-history-secondary"
                                        onClick={() => {
                                            setScheduleOpen(false);
                                            setSchedule(undefined);
                                            setScheduleError('');
                                        }}
                                    >
                                        ← Volver al historial
                                    </button>

                                    <button
                                        type="button"
                                        className="clientes-history-primary"
                                        onClick={() => {
                                            const opened = printSchedule(
                                                schedule.loan,
                                                schedule.rows
                                            );

                                            if (!opened) {
                                                notify(
                                                    'El navegador bloqueó la ventana de impresión.',
                                                    true
                                                );
                                            }
                                        }}
                                    >
                                        Imprimir cronograma
                                    </button>
                                </div>
                            </>
                        )}

                        {scheduleError && !scheduleLoading && (
                            <div className="clientes-history-footer">
                                <button
                                    type="button"
                                    className="clientes-history-secondary"
                                    onClick={() => {
                                        setScheduleOpen(false);
                                        setScheduleError('');
                                    }}
                                >
                                    ← Volver al historial
                                </button>
                            </div>
                        )}
                    </div>
                </Modal>
            )}

            {/* NUEVO CLIENTE, EXCLUSIVO DEL ASESOR */}
            {isAdvisor && registrationOpen && (
                <Modal
                    title="Registrar cliente"
                    close={() => {
                        setRegistrationOpen(false);
                        resetForm();
                    }}
                >
                    <form
                        className="form-grid dni-registration"
                        onSubmit={save}
                    >
                        <label className="span">
                            DNI del cliente

                            <div className="input-action">
                                <input
                                    type="text"
                                    aria-label="DNI"
                                    required
                                    inputMode="numeric"
                                    autoComplete="off"
                                    pattern="[0-9]{8}"
                                    maxLength={8}
                                    value={dni}
                                    onChange={event =>
                                        changeDni(event.target.value)
                                    }
                                    onPaste={event => {
                                        const input = event.currentTarget;
                                        const pasted =
                                            event.clipboardData.getData('text');

                                        const start =
                                            input.selectionStart ??
                                            input.value.length;

                                        const end =
                                            input.selectionEnd ?? start;

                                        const candidate =
                                            input.value.slice(0, start) +
                                            pasted +
                                            input.value.slice(end);

                                        if (
                                            !/^\d+$/.test(pasted) ||
                                            candidate.length > 8
                                        ) {
                                            event.preventDefault();

                                            setDniError(
                                                'El DNI debe contener 8 dígitos.'
                                            );
                                        }
                                    }}
                                    aria-invalid={Boolean(
                                        dniError ||
                                        (dni.length > 0 && !validDni)
                                    )}
                                />

                                <button
                                    type="button"
                                    className="secondary"
                                    disabled={
                                        !validDni ||
                                        lookupBusy ||
                                        saveBusy
                                    }
                                    onClick={() =>
                                        void lookupDni()
                                    }
                                >
                                    {lookupBusy
                                        ? 'Consultando…'
                                        : 'Consultar DNI'}
                                </button>
                            </div>

                            {dniError ||
                            (dni.length > 0 && !validDni) ? (
                                <small
                                    className="field-hint error"
                                    role="alert"
                                >
                                    El DNI debe contener 8 dígitos.
                                </small>
                            ) : (
                                <small className="field-hint">
                                    Verifica la identidad antes
                                    de guardar el cliente.
                                </small>
                            )}
                        </label>

                        {existingClient && (
                            <div
                                className="existing-national-client span"
                                role="status"
                            >
                                <strong>
                                    Cliente existente
                                </strong>

                                <p>
                                    {existingClient.names}{' '}
                                    {existingClient.surnames}
                                    {' · '}
                                    Agencia: {existingClient.agency}
                                </p>

                                <p>
                                    Este cliente ya está registrado
                                    en el sistema.
                                </p>

                                <button
                                    type="button"
                                    className="primary"
                                    onClick={() => {
                                        const clientId =
                                            existingClient.id;

                                        const clientDni =
                                            existingClient.dni;

                                        setRegistrationOpen(false);
                                        resetForm();

                                        createLoan(
                                            clientId,
                                            clientDni
                                        );
                                    }}
                                >
                                    Solicitar nuevo préstamo →
                                </button>
                            </div>
                        )}

                        {formMessage && (
                            <p
                                className={`dni-status span${
                                    identity ? ' success' : ''
                                }`}
                                role="status"
                            >
                                {formMessage}
                            </p>
                        )}

                        {formError && (
                            <p
                                className="dni-status error span"
                                role="alert"
                            >
                                {formError}
                            </p>
                        )}

                        {!existingClient && (
                            <>
                                {identity && (
                                    <div
                                        className="dni-status success span"
                                        role="status"
                                    >
                                        <strong>
                                            Identidad verificada
                                        </strong>

                                        <p>
                                            {identity.names}{' '}
                                            {identity.surnames}
                                        </p>

                                        <small>
                                            DNI: {identity.dni}
                                            {' · '}
                                            Agencia: {me.agency}
                                        </small>
                                    </div>
                                )}

                                <div className="form-actions span">
                                    <button
                                        type="button"
                                        className="secondary"
                                        disabled={saveBusy}
                                        onClick={() => {
                                            setRegistrationOpen(false);
                                            resetForm();
                                        }}
                                    >
                                        Cancelar
                                    </button>

                                    <button
                                        className="primary"
                                        disabled={!canSave}
                                    >
                                        {saveBusy
                                            ? 'Guardando…'
                                            : 'Guardar cliente'}
                                    </button>
                                </div>
                            </>
                        )}
                    </form>
                </Modal>
            )}
        </div>
    );
}
