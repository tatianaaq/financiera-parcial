import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, money } from '../../api/api';
import type { Agency, Client, ClientCreditSummary, Installment, Loan, Me } from '../../types/models';
import { Modal } from '../../components/Modal';
import { SkeletonRows } from '../../components/SkeletonRows';
import './Prestamos.css';
import { NationalClientSearch, type NationalClient } from '../clientes/NationalClientSearch';
import type { LinkedDocument } from '../clientes/RucLookup';
import { loanIdentity } from '../../utils/loanIdentity';

type ProposedInstallment = { number: number; dueDate: string; principal: number; interest: number; total: number };
type LoanEvaluation = { quoteDate: string; schedulePreview: ProposedInstallment[]; borrowerName: string; borrowerDocument: string; documentType: string; responsibleDni: string; client: string; dni: string; agency: string; principal: number; installments: number; monthlyPaymentEstimate: number; totalPaymentEstimate: number; availableOriginalCapital: number; annualRate: number };
type LoanView = 'list' | 'detail' | 'schedule';
// Fecha civil del negocio: no usar toISOString(), que usa UTC y puede adelantar el día en Perú.
function todayInLimaIso(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: 'year' | 'month' | 'day') => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const formatRate = (rate?: number) => rate == null ? 'No registrado' : `${(rate * 100).toLocaleString('es-PE',{maximumFractionDigits:2})}%`;
const validLoanSearch = (value: string) => /^[\p{L}\p{M} ]*$/u.test(value) || /^\d{0,11}$/.test(value) || /^(?:P(?:R(?:-\d{0,19})?)?)?$/i.test(value);
const validClientSearch = (value: string) => /^[\p{L}\p{M} ]*$/u.test(value) || /^\d{0,8}$/.test(value);

export function Prestamos({ me, notify, selectedClientId, clearSelectedClient, initialAgencyId, openClient, goToClients, initialDni, loanDocument }: { me: Me; notify: (message: string, error?: boolean) => void; selectedClientId?: number; clearSelectedClient: () => void; initialAgencyId?: string; openClient: (clientId: number) => void; goToClients: () => void; initialDni?: string; loanDocument?: LinkedDocument }) {
  const [loans, setLoans] = useState<Loan[]>([]); const [clients, setClients] = useState<Client[]>([]); const [noActiveClients, setNoActiveClients] = useState<Client[]>([]); const [agencies, setAgencies] = useState<Agency[]>([]); const [creditSummary, setCreditSummary] = useState<ClientCreditSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [agencyId, setAgencyId] = useState(initialAgencyId ?? ''); const [query, setQuery] = useState(''); const [statusFilter, setStatusFilter] = useState('all'); const [situationFilter, setSituationFilter] = useState('all');
  const [create, setCreate] = useState(false); const [prefilledClientId, setPrefilledClientId] = useState<number | undefined>(); const [evaluation, setEvaluation] = useState<{ body: { clientId: number; amount: string; installments: string; documentType: string; documentNumber: string }; result: LoanEvaluation }>();
  const [confirmBusy, setConfirmBusy] = useState(false); const [clientAccepted, setClientAccepted] = useState(false); const [amountError, setAmountError] = useState(''); const [installmentsError, setInstallmentsError] = useState(''); const [amountInput, setAmountInput] = useState(''); const [installmentsInput, setInstallmentsInput] = useState('6'); const confirmationLock = useRef(false);
  const [view, setView] = useState<LoanView>('list'); const [selectedLoan, setSelectedLoan] = useState<Loan>(); const [schedule, setSchedule] = useState<Installment[]>([]);
  const load = useCallback(async () => { setIsLoading(true); try { const agencyQuery = me.role === 'ADMIN' && agencyId ? `?agencyId=${agencyId}` : ''; const [loanData, summary, clientsWithoutActiveLoans] = await Promise.all([api<Loan[]>(`/loans${agencyQuery}`), api<ClientCreditSummary[]>('/clients/credit-summary'), api<Client[]>(`/clients/without-active-loans${agencyQuery}`)]); setLoans(loanData); setCreditSummary(summary); setNoActiveClients(clientsWithoutActiveLoans); } catch (e) { notify((e as Error).message, true); } finally { setIsLoading(false); } }, [agencyId, me.role, notify]);
  // oxlint-disable-next-line react/set-state-in-effect -- Refresh the agency-scoped portfolio from the API after mount and filter changes.
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (me.role === 'ADMIN') api<Agency[]>('/admin/agencies').then(setAgencies).catch(e => notify(e.message, true)); }, [me.role, notify]);
  useEffect(() => {
    if (selectedClientId === undefined) return;
    let active = true;
    async function loadSelectedClient() {
      const list = await api<Client[]>('/clients');
      if (list.some(c => c.id === selectedClientId)) return list;
      if (!initialDni || !/^\d{8}$/.test(initialDni)) throw new Error('No se recibió un DNI válido para recuperar al cliente nacional.');
      const national = await api<NationalClient>(`/clients/national?dni=${encodeURIComponent(initialDni)}`);
      if (national.id !== selectedClientId || !national.active) throw new Error('La selección no coincide con un cliente nacional activo.');
      return [{ id: national.id, dni: national.dni, names: national.names, surnames: national.surnames, agency: national.agency,
        agencyId: national.agencyId, registeredAt: '', active: national.active }, ...list];
    }
    void loadSelectedClient().then(list => {
      if (!active) return;
      setClients(list); setPrefilledClientId(selectedClientId); setCreate(true);
    }).catch(error => { if (active) notify((error as Error).message, true); });
    return () => { active = false; };
  }, [selectedClientId, initialDni, notify]);
  const situationByClient = new Map(creditSummary.map(summary => [summary.clientId, summary.creditStatus]));
  const noCreditsMode = situationFilter === 'SIN_CREDITOS';
  const visible = loans.filter(l => {
    const term = query.toLocaleLowerCase('es');
    const loanCode = `PR-${String(l.id).padStart(6, '0')}`.toLocaleLowerCase('es');
    return `${l.client} ${l.dni} ${l.borrowerDocument ?? ''}`.toLocaleLowerCase('es').includes(term) || loanCode.includes(term);
  })
    .filter(l => statusFilter === 'all' || l.status === statusFilter)
    .filter(l => situationFilter === 'all' || noCreditsMode || situationByClient.get(l.clientId) === situationFilter);
  const visibleNoActiveClients = noActiveClients.filter(client => `${client.dni} ${client.names} ${client.surnames}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  async function newLoan(clientId?: number) { try { const list = await api<Client[]>('/clients'); if (!list.length) { notify('Primero agrega un cliente al directorio de tu sede.', true); return; } if (clientId !== undefined && !list.some(client => client.id === clientId)) { notify('El cliente ya no está disponible en tu sede.', true); return; } setClients(clientId === undefined ? list : [...list.filter(client => client.id === clientId), ...list.filter(client => client.id !== clientId)]); setPrefilledClientId(clientId); setCreate(true); } catch (e) { notify((e as Error).message, true); } }
  function requestLoanFromNational(client: NationalClient) {
    if (me.role !== 'ADVISOR' || !client.active || client.hasOverdueInstallments || client.availableOriginalCapital < 1) return;
    // Se reutiliza el mismo cliente nacional; la agencia del credito sera la del asesor autenticado.
    setClients([{ id: client.id, dni: client.dni, names: client.names, surnames: client.surnames,
      agency: client.agency, agencyId: client.agencyId, registeredAt: '', active: client.active }]);
    setPrefilledClientId(client.id);
    setAmountInput('');
    setInstallmentsInput('6');
    setEvaluation(undefined);
    setClientAccepted(false);
    setCreate(true);
  }
  async function evaluate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); const clientId = loanDocument ? loanDocument.clientId : Number(form.get('clientId'));
    if (!/^\d+$/.test(amountInput) || Number(amountInput) < 1 || Number(amountInput) > 10000) { setAmountError('El monto debe ser un número entero entre S/ 1 y S/ 10,000.'); return; }
    if (!/^\d+$/.test(installmentsInput) || Number(installmentsInput) < 1 || Number(installmentsInput) > 36) { setInstallmentsError('El número de cuotas debe ser un entero entre 1 y 36.'); return; }
    setAmountError(''); setInstallmentsError(''); const body = { clientId, amount: amountInput, installments: installmentsInput, documentType: loanDocument?.documentType ?? 'DNI', documentNumber: loanDocument?.documentNumber ?? (clients.find(c=>c.id===clientId)?.dni || initialDni || '') };
    try { const result = await api<LoanEvaluation>('/loans/evaluation', { method: 'POST', body: JSON.stringify(body) }); setClientAccepted(false); setEvaluation({ body, result }); } catch (err) { notify((err as Error).message, true); }
  }
  async function confirmLoan() {
    if (!evaluation || !clientAccepted || confirmationLock.current) return;
    confirmationLock.current = true; setConfirmBusy(true);
    try {
      const created = await api<Loan>('/loans', {
        method: 'POST',
        body: JSON.stringify({ ...evaluation.body, quoteDate: evaluation.result.quoteDate, customerAccepted: true }),
      });
      setCreate(false); setEvaluation(undefined); setClientAccepted(false);
      setPrefilledClientId(undefined); clearSelectedClient();
      await load();
      await openLoan(created, 'schedule');
      notify(`Préstamo PR-${String(created.id).padStart(6, '0')} registrado con aceptación comunicada por el asesor. Revisa su cronograma definitivo.`);
    } catch (err) { notify((err as Error).message, true); }
    finally { confirmationLock.current = false; setConfirmBusy(false); }
  }
  function rejectProposal() {
    if (confirmBusy) return;
    setCreate(false); setEvaluation(undefined); setClientAccepted(false);
    setPrefilledClientId(undefined); clearSelectedClient();
    notify('El cliente no aceptó la propuesta. No se registró ningún préstamo.');
  }
  async function openLoan(loan: Loan, next: 'detail' | 'schedule') { try { const rows = await api<Installment[]>(`/loans/${loan.id}/schedule`); setSelectedLoan(loan); setSchedule(rows); setView(next); } catch (e) { notify((e as Error).message, true); } }
  const openInstallments = schedule.filter(row => row.outstanding > 0);
  const todayIso = todayInLimaIso();
  const overdueRows = schedule.filter(row => row.outstanding > 0 && row.dueDate < todayIso);
  const paidRows = schedule.filter(row => row.outstanding <= 0);
  if (view !== 'list' && selectedLoan) {
    const identity = loanIdentity(selectedLoan);
    return <div className="loan-workspace">
    <section className="panel workspace-heading"><div><span className="eyebrow">PRÉSTAMOS / {view === 'detail' ? 'DETALLE' : 'CRONOGRAMA'}</span><h3>{view === 'detail' ? 'Detalle del préstamo' : 'Cronograma de cuotas'}</h3><p>PR-{String(selectedLoan.id).padStart(6,'0')} · {identity.name} · {identity.document}{identity.isRuc && <> · DNI responsable: {identity.responsibleDni}</>}</p></div><div className="actions"><button className="secondary" onClick={() => { setView('list'); setSelectedLoan(undefined); }}>← Volver a préstamos</button>{view === 'detail' && <button className="primary" onClick={() => setView('schedule')}>Ver cronograma →</button>}</div></section>
    <section className="loan-identity panel"><div className="loan-identity-title"><div className="loan-icon">▤</div><div><small>N.° de préstamo</small><b>PR-{String(selectedLoan.id).padStart(6,'0')}</b></div><span className={`tag ${selectedLoan.status === 'FINALIZADO' ? '' : 'warn'}`}>{selectedLoan.status}</span></div><div className="loan-identity-facts"><div><small>{identity.isRuc20 ? 'Empresa prestataria' : 'Prestatario'}</small><b>{identity.name}</b></div><div><small>Documento utilizado</small><b>{identity.document}</b></div>{identity.isRuc && <div><small>DNI responsable</small><b>{identity.responsibleDni}</b></div>}<div><small>Agencia</small><b>{selectedLoan.agency}</b></div><div><small>Desembolso</small><b>{selectedLoan.disbursedAt}</b></div></div></section>
    <section className="cards loan-summary-cards"><article className="card"><small>Capital original</small><b>{money(selectedLoan.principal)}</b></article><article className="card"><small>Capital pendiente</small><b>{money(selectedLoan.outstandingPrincipal)}</b></article><article className="card"><small>Cuotas pagadas</small><b>{paidRows.length}</b></article><article className="card"><small>Cuotas pendientes</small><b>{openInstallments.length}</b></article><article className="card"><small>Cuotas vencidas</small><b className={overdueRows.length ? 'overdue-text' : ''}>{overdueRows.length}</b></article></section>
    {view === 'detail' ? <><section className="loan-facts-grid"><article className="panel"><div className="panel-head"><h3>Información del prestatario</h3></div><dl><div><dt>{identity.isRuc20 ? 'Empresa' : 'Prestatario'}</dt><dd>{identity.name}</dd></div><div><dt>Documento del préstamo</dt><dd>{identity.document}</dd></div>{identity.isRuc && <div><dt>DNI responsable</dt><dd>{identity.responsibleDni}</dd></div>}{identity.representative && <div><dt>Representante</dt><dd>{identity.representative}</dd></div>}<div><dt>Agencia de atención</dt><dd>{selectedLoan.agency}</dd></div></dl></article><article className="panel"><div className="panel-head"><h3>Condiciones del préstamo</h3></div><dl><div><dt>Capital original</dt><dd>{money(selectedLoan.principal)}</dd></div><div><dt>TEA</dt><dd>{formatRate(selectedLoan.annualRate)}</dd></div><div><dt>Periodo de cuota</dt><dd>30 días</dd></div><div><dt>Número de cuotas</dt><dd>{selectedLoan.installments}</dd></div><div><dt>Estado</dt><dd>{selectedLoan.status}</dd></div></dl></article><article className="panel"><div className="panel-head"><h3>Resumen de seguimiento</h3></div><dl><div><dt>Capital pendiente</dt><dd>{money(selectedLoan.outstandingPrincipal)}</dd></div><div><dt>Saldo de cuotas</dt><dd>{money(schedule.reduce((total, row) => total + row.outstanding, 0))}</dd></div><div><dt>Cuotas pagadas</dt><dd>{paidRows.length}</dd></div><div><dt>Cuotas pendientes</dt><dd>{openInstallments.length}</dd></div><div><dt>Cuotas vencidas</dt><dd>{overdueRows.length}</dd></div></dl></article></section><section className="panel schedule-preview"><div className="panel-head"><div><span className="eyebrow">VISTA PREVIA</span><h3>Primeras cuotas</h3></div><button className="link" onClick={() => setView('schedule')}>Ver cronograma completo →</button></div><ScheduleTable rows={schedule.slice(0,5)} /></section></> : <section className="panel"><div className="panel-head"><div><span className="eyebrow">PLAN DE PAGOS</span><h3>Detalle del cronograma · TEA {formatRate(selectedLoan.annualRate)}</h3></div><span className="tag">{schedule.length} cuotas</span></div><ScheduleTable rows={schedule} /></section>}
  </div>;
  }
  return <div className="page-loans">
    <NationalClientSearch initialDni={initialDni} canGrantLoans={me.role === 'ADVISOR'} onRequestLoan={requestLoanFromNational} onRegisterNew={goToClients} />
    <section className="panel loan-filters"><div className="panel-head"><div><span className="eyebrow">{me.role === 'ADMIN' ? 'CARTERA NACIONAL' : `CARTERA · ${me.agency.toUpperCase()}`}</span><h3>{noCreditsMode ? 'Clientes sin créditos activos' : me.role === 'ADMIN' ? 'Préstamos de todas las agencias' : 'Préstamos de la agencia'}</h3><p className="muted">{noCreditsMode ? 'Clientes de la sede seleccionada que no tienen préstamos en estado ACTIVO.' : me.role === 'ADMIN' ? 'Seguimiento consolidado de operaciones por sede.' : 'Consulta la cartera y el cronograma de cada préstamo.'}</p></div>{me.role === 'ADVISOR' && <button className="primary" onClick={() => void newLoan()}>+ Otorgar préstamo</button>}</div><div className="loan-filter-row"><label className="filter-search"><span>{noCreditsMode ? 'Buscar cliente por DNI o nombre' : 'Buscar por cliente, DNI o préstamo'}</span><input className="search" placeholder={noCreditsMode ? 'DNI o nombre del cliente' : 'Nombre, DNI o PR-000035'} value={query} onChange={e => { if (noCreditsMode ? validClientSearch(e.target.value) : validLoanSearch(e.target.value)) setQuery(e.target.value); }} onPaste={e => { if (!(noCreditsMode ? validClientSearch(e.clipboardData.getData('text')) : validLoanSearch(e.clipboardData.getData('text')))) e.preventDefault(); }} aria-label={noCreditsMode ? 'Buscar clientes por DNI o nombre' : 'Buscar por nombre, DNI o código de préstamo'} /></label>{me.role === 'ADMIN' && <label><span>Agencia</span><select className="search" aria-label="Filtrar por agencia" value={agencyId} onChange={e => setAgencyId(e.target.value)}><option value="">Todas las agencias</option>{agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}{!noCreditsMode && <label><span>Estado del préstamo</span><select className="search" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="ACTIVO">Activos</option><option value="FINALIZADO">Finalizados</option></select></label>}<label><span>Situación crediticia</span><select className="search" value={situationFilter} onChange={e => setSituationFilter(e.target.value)}><option value="all">Todas</option><option value="AL_DIA">Al día</option><option value="MOROSO">Moroso</option><option value="SIN_CREDITOS">Sin créditos activos</option></select></label></div></section>
    {isLoading && <div className="loading-caption" role="status"><span className="loading-spinner" aria-hidden="true" />Cargando cartera…</div>}
    {noCreditsMode ? <section className="panel"><div className="panel-head"><div><span className="eyebrow">DIRECTORIO</span><h3>Clientes sin créditos activos</h3></div><span className="tag">{isLoading ? 'Cargando…' : `${visibleNoActiveClients.length} clientes`}</span></div><div className="table-scroll"><table><thead><tr><th>DNI</th><th>Cliente</th><th>Agencia</th><th>Celular</th><th>Créditos activos</th><th>Acción</th></tr></thead><tbody>{isLoading ? <SkeletonRows columns={6} rows={4} /> : visibleNoActiveClients.length ? visibleNoActiveClients.map(client => <tr key={client.id}><td>{client.dni}</td><td><b>{client.names} {client.surnames}</b></td><td>{client.agency || '—'}</td><td>{client.phone || '—'}</td><td>0</td><td className="actions-cell"><button className="secondary compact" onClick={() => openClient(client.id)}>Ver cliente</button>{me.role === 'ADVISOR' && client.active && <button className="primary compact" onClick={() => void newLoan(client.id)}>Evaluar préstamo</button>}</td></tr>) : <tr><td colSpan={6} className="empty">No hay clientes sin créditos activos que coincidan con estos filtros.</td></tr>}</tbody></table></div></section> : <section className="panel"><div className="panel-head"><div><span className="eyebrow">CARTERA</span><h3>Listado de préstamos</h3></div><span className="tag">{isLoading ? 'Cargando…' : `${visible.length} préstamos`}</span></div><div className="table-scroll"><table><thead><tr><th>N.° préstamo</th><th>Cliente</th><th>Documento</th><th>Sede</th><th>Capital original</th><th>Capital pendiente</th><th>Cuotas</th><th>Estado</th><th>Situación</th><th>Acciones</th></tr></thead><tbody>{isLoading ? <SkeletonRows columns={10} rows={4} /> : visible.length ? visible.map(l => { const situation = situationByClient.get(l.clientId) ?? 'SIN_CREDITOS'; return <tr key={l.id}><td>PR-{String(l.id).padStart(6,'0')}</td><td><b>{loanIdentity(l).name}</b></td><td><span className="loan-document-main">{loanIdentity(l).document}</span>{loanIdentity(l).isRuc && <small className="loan-document-secondary">DNI responsable: {loanIdentity(l).responsibleDni}</small>}</td><td>{l.agency}</td><td>{money(l.principal)}</td><td>{money(l.outstandingPrincipal)}</td><td>{l.installments}</td><td><span className={`tag ${l.status === 'FINALIZADO' ? '' : 'warn'}`}>{l.status}</span></td><td><span className={`tag ${situation === 'MOROSO' ? 'red' : situation === 'SIN_CREDITOS' ? 'neutral' : ''}`}>{situation === 'MOROSO' ? 'Moroso' : situation === 'AL_DIA' ? 'Al día' : 'Sin créditos activos'}</span></td><td className="actions-cell"><button className="secondary compact" onClick={() => void openLoan(l,'detail')}>Ver detalle</button><button className="link" onClick={() => void openLoan(l,'schedule')}>Cronograma</button></td></tr>; }) : <tr><td colSpan={10} className="empty">No hay préstamos que coincidan con estos filtros.</td></tr>}</tbody></table></div></section>}
    {create && <Modal title={evaluation ? 'Propuesta de préstamo' : 'Evaluar préstamo'} modalClassName={evaluation ? 'loan-offer-modal' : undefined} close={() => { setCreate(false); setPrefilledClientId(undefined); setEvaluation(undefined); setClientAccepted(false); setAmountError(''); setInstallmentsError(''); setAmountInput(''); setInstallmentsInput('6'); clearSelectedClient(); }}>{evaluation ? <div className="loan-offer-layout">
      <div className="loan-offer-scroll">
        <div className="loan-offer-intro">
          <span className="confirmation-step">PASO 2 DE 2 · PROPUESTA PARA EL CLIENTE</span>
          <p>Revisa las condiciones y explica las cuotas antes de registrar el préstamo.</p>
        </div>
        <section className="loan-offer-borrower" aria-label="Datos del prestatario">
          <span>PRESTATARIO</span>
          <strong>{evaluation.result.borrowerName}</strong>
          <div className="loan-offer-borrower-facts">
            <span>{evaluation.result.documentType} {evaluation.result.borrowerDocument}</span>
            <span>DNI responsable: {evaluation.result.responsibleDni}</span>
          </div>
        </section>
        <div className="loan-offer-highlights" aria-label="Resumen de condiciones">
          <div><small>Capital solicitado</small><strong>{money(evaluation.result.principal)}</strong></div>
          <div><small>Primera cuota</small><strong>{money(evaluation.result.monthlyPaymentEstimate)}</strong></div>
          <div className="loan-offer-total"><small>Total a pagar</small><strong>{money(evaluation.result.totalPaymentEstimate)}</strong></div>
        </div>
        <div className="loan-offer-meta">
          <span>{evaluation.result.installments} cuotas de 30 días</span>
          <span>TEA {formatRate(evaluation.result.annualRate)}</span>
          <span>Sede: {evaluation.result.agency}</span>
        </div>
        <section className="loan-offer-schedule" aria-label="Cronograma propuesto">
          <div className="loan-proposal-heading">
            <b>Cronograma de cuotas</b>
            <small>Origen: {evaluation.result.quoteDate} · El día de origen cuenta como día 1</small>
          </div>
          <table className="loan-proposal-table"><thead><tr><th>Cuota</th><th>Vencimiento</th><th>Capital</th><th>Interés</th><th>Total</th></tr></thead>
            <tbody>{evaluation.result.schedulePreview.map(row => <tr key={row.number}><td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal)}</td><td>{money(row.interest)}</td><td><b>{money(row.total)}</b></td></tr>)}</tbody>
          </table>
          <div className="loan-proposal-mobile-cards">
            {evaluation.result.schedulePreview.map(row => <article key={row.number} className="loan-proposal-installment">
              <div className="loan-proposal-installment-title"><strong>Cuota {row.number}</strong><span>Vence {row.dueDate}</span></div>
              <div className="loan-proposal-installment-values"><span>Capital <b>{money(row.principal)}</b></span><span>Interés <b>{money(row.interest)}</b></span><span className="loan-proposal-installment-total">Total <b>{money(row.total)}</b></span></div>
            </article>)}
          </div>
        </section>
        <p className="loan-offer-note">Esta es una propuesta, no un préstamo registrado. Si cambian las condiciones o la fecha, tendrás que volver a evaluar.</p>
      </div>
      <div className="loan-offer-footer">
        <label className="loan-client-acceptance"><input type="checkbox" checked={clientAccepted} disabled={confirmBusy} onChange={event => setClientAccepted(event.target.checked)} />
          <span>Confirmo como asesor que mostré al cliente las cuotas y el total, y que <b>aceptó expresamente</b> la propuesta. No equivale a una firma de contrato.</span>
        </label>
        <div className="loan-proposal-actions">
          <button className="secondary" type="button" disabled={confirmBusy} onClick={() => { setEvaluation(undefined); setClientAccepted(false); }}>Modificar</button>
          <button className="secondary loan-decline" type="button" disabled={confirmBusy} onClick={rejectProposal}>No acepta</button>
          <button className="primary" type="button" onClick={() => void confirmLoan()} disabled={confirmBusy || !clientAccepted}>
            {confirmBusy ? 'Registrando…' : 'Aceptar y otorgar'}
          </button>
        </div>
      </div>
    </div> : <form className="form-grid" onSubmit={evaluate}><div className="confirmation-step span">PASO 1 DE 2 · EVALUACIÓN</div>{loanDocument && <div className="document-result span" role="status"><span className="tag">Documento verificado</span><h4>{loanDocument.borrowerName}</h4><p>{loanDocument.documentType} {loanDocument.documentNumber} · DNI responsable {loanDocument.responsibleDni}</p>{loanDocument.representativeName && <p>Representante: {loanDocument.representativeName}</p>}</div>}<label className="span">{loanDocument ? 'DNI responsable' : 'Cliente'}<select name="clientId" disabled={Boolean(loanDocument)} defaultValue={prefilledClientId ?? selectedClientId ?? clients[0]?.id ?? ''} required>{clients.map(c => <option key={c.id} value={c.id}>{c.dni} · {c.names} {c.surnames}</option>)}</select></label><label>Monto (S/)<input name="amount" type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]+" required value={amountInput} aria-invalid={Boolean(amountError)} aria-describedby={amountError ? 'loan-amount-error' : undefined} onChange={event => { const value = event.target.value; if (/^\d*$/.test(value)) { setAmountInput(value); setAmountError(value && (Number(value) < 1 || Number(value) > 10000) ? 'El monto debe ser un número entero entre S/ 1 y S/ 10,000.' : ''); } }} onPaste={event => { if (!/^\d+$/.test(event.clipboardData.getData('text'))) event.preventDefault(); }} />{amountError && <small id="loan-amount-error" className="loan-amount-error" role="alert">{amountError}</small>}</label><label>Número de cuotas<input name="installments" type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]+" required value={installmentsInput} aria-invalid={Boolean(installmentsError)} aria-describedby={installmentsError ? 'loan-installments-error' : undefined} onChange={event => { const value = event.target.value; if (/^\d*$/.test(value)) { setInstallmentsInput(value); setInstallmentsError(value && (Number(value) < 1 || Number(value) > 36) ? 'El número de cuotas debe ser un entero entre 1 y 36.' : ''); } }} onPaste={event => { if (!/^\d+$/.test(event.clipboardData.getData('text'))) event.preventDefault(); }} />{installmentsError && <small id="loan-installments-error" className="loan-amount-error" role="alert">{installmentsError}</small>}</label><div className="form-actions span"><button className="secondary" type="button" onClick={() => { setCreate(false); setAmountError(''); setInstallmentsError(''); setAmountInput(''); setInstallmentsInput('6'); clearSelectedClient(); }}>Cancelar</button><button className="primary">Evaluar solicitud</button></div></form>}</Modal>}
  </div>;
}

function ScheduleTable({ rows }: { rows: Installment[] }) { return <div className="table-scroll"><table><thead><tr><th>N.°</th><th>Vencimiento</th><th>Capital</th><th>Interés</th><th>Total pagado</th><th>Saldo de cuota</th><th>Estado</th></tr></thead><tbody>{rows.map(i => <tr key={i.id}><td>{i.number}</td><td>{i.dueDate}</td><td>{money(i.principal)}</td><td>{money(i.interest)}</td><td>{money(i.paid)}</td><td>{money(i.outstanding)}</td><td><span className={`tag ${i.status === 'PAGADA' ? '' : i.status === 'VENCIDA' ? 'red' : 'warn'}`}>{i.status}</span></td></tr>)}</tbody></table></div>; }
