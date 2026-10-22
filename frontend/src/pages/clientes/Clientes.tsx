import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, money, ApiError } from '../../api/api';
import type { Agency, Client, ClientCreditSummary, Installment, Loan, Me, Ubigeo } from '../../types/models';
import { Modal } from '../../components/Modal';
import './Clientes.css';
import { RucLookup, type LinkedDocument } from './RucLookup';
import { loanIdentity } from '../../utils/loanIdentity';

type DniLookup = { dni: string; names: string; paternalSurname: string; maternalSurname: string; surnames: string; verificationId: string };
type View = 'directory' | 'detail' | 'credits' | 'loanDetail' | 'schedule';
type DomicileForm = { department: string; province: string; district: string; ubigeo: string; address: string; addressReference: string };

// El backend devuelve fieldErrors para validaciones Bean Validation; no ocultarlos al asesor.
function registrationFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors ?? {};
    const outdated = ['phone', 'address', 'department', 'province', 'district', 'ubigeo'];
    if (outdated.some(field => Object.prototype.hasOwnProperty.call(fields, field))) {
      return 'El backend sigue exigiendo celular o domicilio de una versión anterior. Reinicia Spring Boot con el código 02G y verifica la conexión al PostgreSQL de laboratorio.';
    }
    const details = [...new Set(Object.values(fields).filter(Boolean))];
    if (details.length) return details.join(' ');
  }
  return error instanceof Error ? error.message : 'No se pudo guardar el cliente.';
}

const sameLocationName = (first?: string, second?: string) => (first ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('es') === (second ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('es');
const validDirectorySearch = (value: string) => /^[\p{L}\p{M} ]*$/u.test(value) || /^\d{0,8}$/.test(value);

function LocationFields({ catalog, values, onChange, idPrefix }: { catalog: Ubigeo[]; values: DomicileForm; onChange: (next: DomicileForm) => void; idPrefix: string }) {
  const departments = [...new Set(catalog.map(item => item.department))].sort((a, b) => a.localeCompare(b, 'es'));
  const provinces = [...new Set(catalog.filter(item => item.department === values.department).map(item => item.province))].sort((a, b) => a.localeCompare(b, 'es'));
  const districts = catalog.filter(item => item.department === values.department && item.province === values.province).sort((a, b) => a.district.localeCompare(b.district, 'es'));
  return <>
    <label htmlFor={`${idPrefix}-department`}>Departamento<select id={`${idPrefix}-department`} required value={values.department} onChange={event => onChange({ ...values, department: event.target.value, province: '', district: '', ubigeo: '' })}><option value="">Selecciona departamento</option>{departments.map(item => <option key={item}>{item}</option>)}</select></label>
    <label htmlFor={`${idPrefix}-province`}>Provincia<select id={`${idPrefix}-province`} required disabled={!values.department} value={values.province} onChange={event => onChange({ ...values, province: event.target.value, district: '', ubigeo: '' })}><option value="">Selecciona provincia</option>{provinces.map(item => <option key={item}>{item}</option>)}</select></label>
    <label htmlFor={`${idPrefix}-district`}>Distrito<select id={`${idPrefix}-district`} required disabled={!values.province} value={values.district} onChange={event => { const district = event.target.value; const row = districts.find(item => item.district === district); onChange({ ...values, district, ubigeo: row?.ubigeo ?? '' }); }}><option value="">Selecciona distrito</option>{districts.map(item => <option key={item.ubigeo} value={item.district}>{item.district}</option>)}</select></label>
    <label className="span" htmlFor={`${idPrefix}-address`}>Dirección exacta (obligatoria)<input id={`${idPrefix}-address`} required maxLength={200} value={values.address} onChange={event => onChange({ ...values, address: event.target.value })} placeholder="Calle, avenida, jirón, urbanización y número" /></label>
    <label className="span" htmlFor={`${idPrefix}-reference`}>Referencia (opcional)<input id={`${idPrefix}-reference`} maxLength={200} value={values.addressReference} onChange={event => onChange({ ...values, addressReference: event.target.value })} placeholder="Frente al parque, interior, piso…" /></label>
    {values.ubigeo && <small className="field-hint span">UBIGEO del distrito: {values.ubigeo}</small>}
  </>;
}

export function Clientes({ me, notify, createLoan, linkLoan, initialAgencyId, selectedClientId, clientOpened }: { me: Me; notify: (message: string, error?: boolean) => void; createLoan: (clientId: number, dni: string) => void; linkLoan: (link: LinkedDocument) => void; initialAgencyId?: string; selectedClientId?: number; clientOpened: () => void }) {
  const [rows, setRows] = useState<Client[]>([]); const [loans, setLoans] = useState<Loan[]>([]); const [summaries, setSummaries] = useState<ClientCreditSummary[]>([]); const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyId, setAgencyId] = useState(initialAgencyId ?? ''); const [query, setQuery] = useState(''); const [creditFilter, setCreditFilter] = useState('all'); const [situationFilter, setSituationFilter] = useState('all');
  const [open, setOpen] = useState(false); const [view, setView] = useState<View>('directory'); const [selectedClient, setSelectedClient] = useState<Client>();
  const [clientLoans, setClientLoans] = useState<Loan[]>([]); const [schedule, setSchedule] = useState<{ loan: Loan; rows: Installment[] }>();
  const [existingClient, setExistingClient] = useState<{ id: number; dni: string; names: string; surnames: string; agency: string }>(); const [dni, setDni] = useState(''); const [identity, setIdentity] = useState<DniLookup>();
  const [dniInputError, setDniInputError] = useState('');
  const [ubigeos, setUbigeos] = useState<Ubigeo[]>([]);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false); const [addressEdit, setAddressEdit] = useState<DomicileForm>(); const [addressEditBusy, setAddressEditBusy] = useState(false); const [addressEditError, setAddressEditError] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false); const [saveBusy, setSaveBusy] = useState(false); const [formError, setFormError] = useState(''); const [formMessage, setFormMessage] = useState('');
  const requestVersion = useRef(0); const currentDni = useRef(''); const lookupController = useRef<AbortController | undefined>(undefined);
  // Load the official location catalog once for dependent selects and manual corrections.
  useEffect(() => { api<Ubigeo[]>('/locations/ubigeos').then(setUbigeos).catch(error => notify((error as Error).message, true)); }, [notify]);
  const load = useCallback(async () => {
    try {
      const [clientData, loanData, summaryData] = await Promise.all([
        api<Client[]>(`/clients${me.role === 'ADMIN' && agencyId ? `?agencyId=${agencyId}` : ''}`),
        api<Loan[]>(`/loans${me.role === 'ADMIN' && agencyId ? `?agencyId=${agencyId}` : ''}`),
        api<ClientCreditSummary[]>('/clients/credit-summary'),
      ]);
      setRows(clientData); setLoans(loanData); setSummaries(summaryData);
    } catch (e) { notify((e as Error).message, true); }
  }, [agencyId, me.role, notify]);
  // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the view with API data after mount and filter changes.
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (me.role === 'ADMIN') api<Agency[]>('/admin/agencies').then(setAgencies).catch(e => notify(e.message, true)); }, [me.role, notify]);
  // oxlint-disable-next-line react/set-state-in-effect -- Open the row selected from the dashboard after its scoped directory has loaded.
  useEffect(() => {
    if (selectedClientId === undefined || !rows.some(client => client.id === selectedClientId)) return;
    let active = true;
    Promise.all([api<Client>(`/clients/${selectedClientId}`), api<Loan[]>(`/clients/${selectedClientId}/loans`)]).then(([detail, records]) => {
      if (!active) return; setSelectedClient(detail); setClientLoans(records); setView('detail'); clientOpened();
    }).catch(error => { if (active) { notify((error as Error).message, true); clientOpened(); } });
    return () => { active = false; };
  }, [selectedClientId, rows, clientOpened, notify]);
  const loanCounts = new Map<number, number>();
  const activeCounts = new Map<number, number>();
  for (const loan of loans) { loanCounts.set(loan.clientId, (loanCounts.get(loan.clientId) ?? 0) + 1); if (loan.status === 'ACTIVO') activeCounts.set(loan.clientId, (activeCounts.get(loan.clientId) ?? 0) + 1); }
  const summaryByClient = new Map(summaries.map(summary => [summary.clientId, summary]));
  const visible = rows.filter(c => `${c.dni} ${c.names} ${c.surnames}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .filter(c => creditFilter === 'all' || (creditFilter === 'active' ? (summaryByClient.get(c.id)?.activeLoans ?? 0) > 0 : (summaryByClient.get(c.id)?.activeLoans ?? 0) === 0))
    .filter(c => situationFilter === 'all' || summaryByClient.get(c.id)?.creditStatus === situationFilter);
  // El registro inicial usa solo DNI e identidad verificada; contacto y domicilio son posteriores.
  const validDni = /^\d{8}$/.test(dni);
  const canSave = Boolean(identity && identity.dni === dni && !existingClient && validDni && !dniInputError && !lookupBusy && !saveBusy);
  function beginRegistration(documentNumber: string) {
    resetForm(); currentDni.current = documentNumber; setDni(documentNumber); setOpen(true);
    void lookupDni(documentNumber);
  }
  function resetForm() { requestVersion.current++; lookupController.current?.abort(); currentDni.current = ''; setDni(''); setExistingClient(undefined); setIdentity(undefined); setDniInputError(''); setLookupBusy(false); setSaveBusy(false); setFormError(''); setFormMessage(''); }
  function changeDni(value: string) {
    if (!/^\d{0,8}$/.test(value)) { setDniInputError('El DNI debe contener exactamente 8 dígitos'); return; }
    setDniInputError(value.length > 0 && value.length < 8 ? 'El DNI debe contener exactamente 8 dígitos' : '');
    requestVersion.current++; lookupController.current?.abort(); currentDni.current = value; setDni(value); setExistingClient(undefined); setIdentity(undefined); setFormError(''); setFormMessage(value.length === 8 ? 'Al cambiar el DNI, debes consultarlo nuevamente.' : ''); setLookupBusy(false);
  }
  async function lookupDni(documentNumber = dni) {
    if (!/^\d{8}$/.test(documentNumber) || lookupBusy || saveBusy) return;
    lookupController.current?.abort(); const controller = new AbortController(); lookupController.current = controller;
    const version = ++requestVersion.current; const requestedDni = documentNumber; setLookupBusy(true); setIdentity(undefined); setFormError(''); setFormMessage('Consultando DNI…');
    try {
      // Primero busca localmente en la base nacional. Esto NO gasta una consulta de JSON.pe.
      try {
        const existing = await api<{id:number; dni:string; names:string; surnames:string; agency:string}>(`/clients/national?dni=${requestedDni}`, { signal: controller.signal });
        if (version !== requestVersion.current || currentDni.current !== requestedDni) return;
        setExistingClient(existing);
        setFormMessage('Cliente existente: no necesitas volver a registrarlo.');
        return;
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      const result = await api<DniLookup>('/clients/dni-lookup', { method: 'POST', body: JSON.stringify({ dni: requestedDni }), signal: controller.signal });
      if (version !== requestVersion.current || currentDni.current !== requestedDni) return;
      if (result.dni !== requestedDni || !result.verificationId) throw new Error('La respuesta no corresponde al DNI consultado.');
      setIdentity(result); setFormMessage('DNI disponible para registrar. Datos verificados.');
    } catch (error) { if (controller.signal.aborted || version !== requestVersion.current) return; setIdentity(undefined); setFormMessage(''); setFormError(error instanceof Error ? error.message : 'No se pudo consultar el DNI.'); }
    finally { if (version === requestVersion.current) setLookupBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canSave || !identity) { setFormError('Consulta un DNI válido para verificar la identidad antes de guardar.'); return; } setSaveBusy(true); setFormError('');
    try { await api('/clients', { method: 'POST', body: JSON.stringify({ dni, names: identity.names, surnames: identity.surnames, verificationId: identity.verificationId }) });
      setOpen(false); resetForm(); notify('Cliente registrado correctamente.'); await load();
    } catch (error) { setFormError(registrationFailureMessage(error)); } finally { setSaveBusy(false); }
  }
  function openAddressEditor() {
    if (!selectedClient) return;
    const byCode = ubigeos.find(item => item.ubigeo === selectedClient.ubigeo);
    const byNames = ubigeos.find(item => sameLocationName(item.department, selectedClient.department) && sameLocationName(item.province, selectedClient.province) && sameLocationName(item.district, selectedClient.district));
    const location = byCode ?? byNames;
    setAddressEdit({ department: location?.department ?? '', province: location?.province ?? '', district: location?.district ?? '', ubigeo: location?.ubigeo ?? '', address: selectedClient.address ?? '', addressReference: selectedClient.addressReference ?? '' });
    setAddressEditError(''); setAddressEditorOpen(true);
  }
  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedClient || !addressEdit || addressEditBusy) return;
    setAddressEditBusy(true); setAddressEditError('');
    try {
      const saved = await api<Client>(`/clients/${selectedClient.id}/address`, { method: 'PUT', body: JSON.stringify(addressEdit) });
      setSelectedClient(saved); setAddressEditorOpen(false); setAddressEdit(undefined); notify('Dirección actualizada correctamente.');
    } catch (error) { setAddressEditError(error instanceof Error ? error.message : 'No se pudo actualizar la dirección.'); }
    finally { setAddressEditBusy(false); }
  }
  async function openClient(client: Client, next: 'detail' | 'credits') {
    try { const [detail, records] = await Promise.all([api<Client>(`/clients/${client.id}`), api<Loan[]>(`/clients/${client.id}/loans`)]); setSelectedClient(detail); setClientLoans(records); setView(next); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function openLoanView(loan: Loan, next: 'loanDetail' | 'schedule') { try { setSchedule({ loan, rows: await api<Installment[]>(`/loans/${loan.id}/schedule`) }); setView(next); } catch (error) { notify((error as Error).message, true); } }
  async function openLoanDetail(loan: Loan) { await openLoanView(loan, 'loanDetail'); }
  async function openSchedule(loan: Loan) { await openLoanView(loan, 'schedule'); }
  function backFromLoanDetail() { setView('credits'); setSchedule(undefined); }
  function backFromSchedule() { setView('credits'); setSchedule(undefined); }
  const activeLoans = clientLoans.filter(l => l.status === 'ACTIVO');
  const activePrincipal = activeLoans.reduce((sum, l) => sum + l.outstandingPrincipal, 0);

  if (view === 'loanDetail' && schedule) return <div className="client-workspace">
    <section className="panel workspace-heading"><div><span className="eyebrow">CLIENTES / CRÉDITOS / DETALLE</span><h3>Detalle del préstamo</h3><p>PR-{String(schedule.loan.id).padStart(6,'0')} · {loanIdentity(schedule.loan).name} · {loanIdentity(schedule.loan).document}{loanIdentity(schedule.loan).isRuc && <> · DNI responsable: {loanIdentity(schedule.loan).responsibleDni}</>}</p></div><div className="actions"><button className="secondary" onClick={backFromLoanDetail}>← Volver a créditos</button><button className="primary" onClick={() => setView('schedule')}>Ver cronograma →</button></div></section>
    <section className="cards schedule-summary"><article className="card"><small>Capital original</small><b>{money(schedule.loan.principal)}</b></article><article className="card"><small>Capital pendiente</small><b>{money(schedule.loan.outstandingPrincipal)}</b></article><article className="card"><small>Cuotas</small><b>{schedule.loan.installments}</b></article><article className="card"><small>Desembolso</small><b>{schedule.loan.disbursedAt}</b></article></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">CONDICIONES DEL PRÉSTAMO</span><h3>Información registrada</h3></div><span className={`tag ${schedule.loan.status === 'FINALIZADO' ? '' : 'warn'}`}>{schedule.loan.status}</span></div><div className="client-facts client-facts-wide"><div><small>{loanIdentity(schedule.loan).isRuc20 ? 'Empresa prestataria' : 'Prestatario'}</small><b>{loanIdentity(schedule.loan).name}</b></div><div><small>Documento utilizado</small><b>{loanIdentity(schedule.loan).document}</b></div>{loanIdentity(schedule.loan).isRuc && <div><small>DNI responsable</small><b>{loanIdentity(schedule.loan).responsibleDni}</b></div>}{loanIdentity(schedule.loan).representative && <div><small>Representante</small><b>{loanIdentity(schedule.loan).representative}</b></div>}<div><small>Agencia</small><b>{schedule.loan.agency}</b></div><div><small>TEA</small><b>{schedule.loan.annualRate == null ? 'No registrada' : `${(schedule.loan.annualRate * 100).toLocaleString('es-PE',{maximumFractionDigits:2})}%`}</b></div><div><small>Cuotas programadas</small><b>{schedule.loan.installments}</b></div><div><small>Cuotas registradas</small><b>{schedule.rows.length}</b></div></div></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">VISTA PREVIA</span><h3>Primeras cuotas</h3></div><button className="link" onClick={() => setView('schedule')}>Ver cronograma completo →</button></div><div className="table-scroll"><table><thead><tr><th>N.°</th><th>Vencimiento</th><th>Capital</th><th>Interés</th><th>Pagado</th><th>Saldo de cuota</th><th>Estado</th></tr></thead><tbody>{schedule.rows.slice(0,5).map(row => <tr key={row.id}><td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal)}</td><td>{money(row.interest)}</td><td>{money(row.paid)}</td><td>{money(row.outstanding)}</td><td><span className={`tag ${row.status === 'PAGADA' ? '' : row.status === 'VENCIDA' ? 'red' : 'warn'}`}>{row.status}</span></td></tr>)}</tbody></table></div></section>
  </div>;

  if (view === 'schedule' && schedule) return <div className="client-workspace">
    <section className="panel workspace-heading"><div><span className="eyebrow">CLIENTES / CRÉDITOS / CRONOGRAMA</span><h3>Cronograma del préstamo</h3><p>{loanIdentity(schedule.loan).name} · {loanIdentity(schedule.loan).document}{loanIdentity(schedule.loan).isRuc && <> · DNI responsable: {loanIdentity(schedule.loan).responsibleDni}</>} · {schedule.loan.agency}</p></div><button className="secondary" onClick={backFromSchedule}>← Volver a créditos</button></section>
    <section className="cards schedule-summary"><article className="card"><small>Capital original</small><b>{money(schedule.loan.principal)}</b></article><article className="card"><small>Capital pendiente</small><b>{money(schedule.loan.outstandingPrincipal)}</b></article><article className="card"><small>Cuotas</small><b>{schedule.loan.installments}</b></article><article className="card"><small>Desembolso</small><b>{schedule.loan.disbursedAt}</b></article></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">DETALLE DEL CRONOGRAMA</span><h3>Cuotas programadas</h3></div><span className="tag">{schedule.rows.length} cuotas</span></div><div className="table-scroll"><table><thead><tr><th>N.°</th><th>Vencimiento</th><th>Capital</th><th>Interés</th><th>Pagado</th><th>Saldo de cuota</th><th>Estado</th></tr></thead><tbody>{schedule.rows.map(row => <tr key={row.id}><td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal)}</td><td>{money(row.interest)}</td><td>{money(row.paid)}</td><td>{money(row.outstanding)}</td><td><span className={`tag ${row.status === 'PAGADA' ? '' : row.status === 'VENCIDA' ? 'red' : 'warn'}`}>{row.status}</span></td></tr>)}</tbody></table></div></section>
  </div>;

  if ((view === 'detail' || view === 'credits') && selectedClient) return <div className="client-workspace">
    <section className="panel workspace-heading"><div><span className="eyebrow">CLIENTES / {view === 'detail' ? 'DETALLE' : 'CRÉDITOS'}</span><h3>{view === 'detail' ? 'Detalle del cliente' : 'Créditos del cliente'}</h3><p>Información y actividad de la cartera{selectedClient.agency ? ` · ${selectedClient.agency}` : ''}</p></div><div className="actions"><button className="secondary" onClick={() => setView('directory')}>← Volver al directorio</button>{view === 'detail' ? <button className="primary" onClick={() => setView('credits')}>Ver créditos →</button> : <button className="secondary" onClick={() => setView('detail')}>Ver detalle</button>}</div></section>
    <section className="client-profile panel"><div className="client-detail-head"><div className="client-avatar">{selectedClient.names.slice(0,1)}{selectedClient.surnames.slice(0,1)}</div><div><h3>{selectedClient.names} {selectedClient.surnames}</h3><span>DNI {selectedClient.dni}</span></div><span className={`tag ${selectedClient.active ? '' : 'warn'}`}>{selectedClient.active ? 'Cliente activo' : 'Inactivo'}</span></div></section>
    <section className="cards client-summary"><article className="card"><small>Créditos activos</small><b>{activeLoans.length}</b></article><article className="card"><small>Capital pendiente</small><b>{money(activePrincipal)}</b></article><article className="card"><small>Préstamos registrados</small><b>{clientLoans.length}</b></article></section>
    {view === 'detail' ? <>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">INFORMACIÓN DEL CLIENTE</span><h3>Datos registrados</h3></div></div><div className="client-facts client-facts-wide"><div><small>Nombres completos</small><b>{selectedClient.names} {selectedClient.surnames}</b></div><div><small>DNI</small><b>{selectedClient.dni}</b></div><div><small>Celular</small><b>{selectedClient.phone || 'Sin registrar'}</b></div><div><small>Agencia</small><b>{selectedClient.agency || me.agency}</b></div><div><small>Fecha de registro</small><b>{selectedClient.registeredAt}</b></div><div><small>Situación de cuenta</small><b>{selectedClient.active ? 'Activa' : 'Inactiva'}</b></div></div></section>
      <section className="panel domicile-card"><div className="panel-head"><div><span className="eyebrow">DOMICILIO</span><h3>Domicilio actual del cliente</h3></div>{me.role === 'ADVISOR' && <button className="secondary" disabled={!ubigeos.length} onClick={openAddressEditor}>Editar dirección</button>}</div><div className="client-facts client-facts-wide"><div><small>Departamento</small><b>{selectedClient.department || 'Dirección no registrada'}</b></div><div><small>Provincia</small><b>{selectedClient.province || 'Dirección no registrada'}</b></div><div><small>Distrito</small><b>{selectedClient.district || 'Dirección no registrada'}</b></div><div><small>UBIGEO</small><b>{selectedClient.ubigeo || '—'}</b></div><div className="domicile-address"><small>Dirección exacta</small><b>{selectedClient.address || 'Dirección no registrada'}</b></div><div className="domicile-address"><small>Referencia</small><b>{selectedClient.addressReference || '—'}</b></div></div></section>
    </> : <section className="panel"><div className="panel-head"><div><span className="eyebrow">HISTORIAL CREDITICIO</span><h3>Préstamos del cliente</h3></div><span className="tag">{clientLoans.length} registros</span></div>{clientLoans.length ? <div className="table-scroll"><table><thead><tr><th>Préstamo</th><th>Documento utilizado</th><th>Agencia</th><th>Desembolso</th><th>Capital original</th><th>Capital pendiente</th><th>Cuotas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{clientLoans.map(loan => <tr key={loan.id}><td>PR-{String(loan.id).padStart(6,'0')}</td><td><b>{loanIdentity(loan).document}</b>{loanIdentity(loan).isRuc && <small className="client-document-secondary">DNI responsable: {loanIdentity(loan).responsibleDni}</small>}</td><td>{loan.agency}</td><td>{loan.disbursedAt}</td><td>{money(loan.principal)}</td><td>{money(loan.outstandingPrincipal)}</td><td>{loan.installments}</td><td><span className={`tag ${loan.status === 'FINALIZADO' ? '' : 'warn'}`}>{loan.status}</span></td><td className="actions-cell"><button className="link" onClick={() => void openLoanDetail(loan)}>Ver detalle</button><button className="link" onClick={() => void openSchedule(loan)}>Ver cronograma</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span>▤</span><b>Sin créditos registrados</b><p>Este cliente aún no tiene préstamos en su historial.</p></div>}{me.role === 'ADVISOR' && selectedClient.active && <div className="client-credit-action"><span>¿Necesitas evaluar una nueva solicitud?</span><button className="primary" onClick={() => createLoan(selectedClient.id, selectedClient.dni)}>Evaluar nuevo préstamo →</button></div>}</section>}
    {addressEditorOpen && addressEdit && <Modal title="Editar dirección" close={() => { if (!addressEditBusy) { setAddressEditorOpen(false); setAddressEdit(undefined); setAddressEditError(''); } }}><form className="form-grid domicile-editor" onSubmit={saveAddress}>
      <fieldset className="domicile-fields span"><legend>Domicilio actual del cliente</legend><LocationFields idPrefix="edit" catalog={ubigeos} values={addressEdit} onChange={setAddressEdit} /></fieldset>
      {addressEditError && <p className="dni-status error span" role="alert">{addressEditError}</p>}
      <div className="form-actions span"><button className="secondary" type="button" disabled={addressEditBusy} onClick={() => { setAddressEditorOpen(false); setAddressEdit(undefined); setAddressEditError(''); }}>Cancelar</button><button className="primary" disabled={addressEditBusy}>{addressEditBusy ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form></Modal>}
  </div>;

  return <div className="page-clients">
    <RucLookup canRegister={me.role === 'ADVISOR'} onNewDni={beginRegistration} onExistingDni={client => createLoan(client.id, client.dni)} onLinked={linkLoan} />
    <section className="panel client-filters"><div className="panel-head"><div><span className="eyebrow">{me.role === 'ADMIN' ? 'DIRECTORIO NACIONAL' : `CARTERA DE ${me.agency.toUpperCase()}`}</span><h3>Directorio de clientes</h3><p className="muted">{me.role === 'ADMIN' ? 'Consulta clientes y sus créditos en todas las sedes.' : `Clientes registrados en la agencia ${me.agency}.`}</p></div>{me.role === 'ADVISOR' && <button className="primary" onClick={() => { resetForm(); setOpen(true); }}>+ Nuevo cliente</button>}</div><div className="filter-row"><label className="filter-search"><span>Buscar por DNI o nombre</span><input className="search" placeholder="Ingresa DNI o nombre del cliente" value={query} onChange={e => { if (validDirectorySearch(e.target.value)) setQuery(e.target.value); }} onPaste={e => { if (!validDirectorySearch(e.clipboardData.getData('text'))) e.preventDefault(); }} /></label>{me.role === 'ADMIN' && <label><span>Agencia</span><select className="search" value={agencyId} onChange={e => setAgencyId(e.target.value)}><option value="">Todas las agencias</option>{agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}<label><span>Créditos</span><select className="search" value={creditFilter} onChange={e => setCreditFilter(e.target.value)}><option value="all">Todos</option><option value="active">Con créditos activos</option><option value="none">Sin créditos activos</option></select></label><label><span>Situación crediticia</span><select className="search" value={situationFilter} onChange={e => setSituationFilter(e.target.value)}><option value="all">Todas</option><option value="AL_DIA">Al día</option><option value="MOROSO">Moroso</option><option value="SIN_CREDITOS">Sin créditos</option></select></label></div></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">{me.role === 'ADMIN' ? 'VISTA CONSOLIDADA' : 'DIRECTORIO'}</span><h3>Listado de clientes</h3></div><span className="tag">{visible.length} clientes</span></div><div className="table-scroll"><table><thead><tr><th>DNI</th><th>Cliente</th>{me.role === 'ADMIN' && <th>Agencia</th>}<th>Celular</th><th>Créditos activos</th><th>Situación crediticia</th><th>Acciones</th></tr></thead><tbody>{visible.length ? visible.map(client => { const summary = summaryByClient.get(client.id); const active = summary?.activeLoans ?? activeCounts.get(client.id) ?? 0; const status = client.active ? (summary?.creditStatus ?? 'SIN_CREDITOS') : 'INACTIVO'; return <tr key={client.id}><td>{client.dni}</td><td><b>{client.names} {client.surnames}</b></td>{me.role === 'ADMIN' && <td>{client.agency || '—'}</td>}<td>{client.phone || '—'}</td><td>{active}</td><td><span className={`tag ${status === 'MOROSO' || status === 'INACTIVO' ? 'red' : status === 'SIN_CREDITOS' ? 'neutral' : ''}`}>{status === 'MOROSO' ? 'Moroso' : status === 'AL_DIA' ? 'Al día' : status === 'INACTIVO' ? 'Inactivo' : 'Sin créditos'}</span></td><td className="actions-cell"><button className="secondary compact" onClick={() => void openClient(client, 'detail')}>Ver detalle</button><button className="secondary compact" onClick={() => void openClient(client, 'credits')}>Ver créditos <span className="count-pill">{loanCounts.get(client.id) ?? 0}</span></button></td></tr>; }) : <tr><td colSpan={me.role === 'ADMIN' ? 7 : 6} className="empty">No hay clientes que coincidan con estos filtros.</td></tr>}</tbody></table></div></section>
    {open && <Modal title="Registrar cliente" close={() => { setOpen(false); resetForm(); }}><form className="form-grid dni-registration" onSubmit={save}>
      <label className="span">DNI<div className="input-action"><input type="text" aria-label="DNI" required inputMode="numeric" autoComplete="off" pattern="[0-9]{8}" value={dni} onChange={event => changeDni(event.target.value)} onPaste={event => { const input = event.currentTarget; const pasted = event.clipboardData.getData('text'); const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start; const candidate = input.value.slice(0, start) + pasted + input.value.slice(end); if (!/^\d+$/.test(pasted) || candidate.length > 8) { event.preventDefault(); setDniInputError('El DNI debe contener exactamente 8 dígitos'); } }} aria-invalid={Boolean(dniInputError || (dni.length > 0 && !validDni))} /><button className="secondary" type="button" disabled={!validDni || lookupBusy || saveBusy} onClick={() => void lookupDni()}>{lookupBusy ? 'Consultando…' : 'Consultar DNI'}</button></div>{(dniInputError || (dni.length > 0 && !validDni)) ? <small className="field-hint error" role="alert">El DNI debe contener exactamente 8 dígitos</small> : <small className="field-hint">Ingresa ocho dígitos y consulta para cargar la identidad verificada.</small>}</label>
      {existingClient && <div className="existing-national-client span" role="status"><strong>Cliente existente</strong><p>{existingClient.names} {existingClient.surnames} · Registrado en {existingClient.agency}.</p><p>Ya está en la base nacional. Puedes revisar sus préstamos y solicitar uno nuevo sin volver a registrarlo.</p><button type="button" className="primary" onClick={() => { const selectedDni = existingClient.dni; const selectedId = existingClient.id; setOpen(false); resetForm(); createLoan(selectedId, selectedDni); }}>Solicitar nuevo préstamo →</button></div>}
      {formMessage && <p className={`dni-status span${identity ? ' success' : ''}`} role="status">{formMessage}</p>}{formError && <p className="dni-status error span" role="alert">{formError}</p>}
      {!existingClient && <>
      {identity && <div className="dni-status success span" role="status">
        <strong>Identidad verificada</strong>
        <p style={{ margin: '6px 0 3px' }}>{identity.names} {identity.surnames}</p>
        <small>Se registrará el DNI {identity.dni} en la agencia {me.agency}. No necesitas ingresar celular ni domicilio ahora.</small>
      </div>}
      <div className="form-actions span"><button className="secondary" type="button" disabled={saveBusy} onClick={() => { setOpen(false); resetForm(); }}>Cancelar</button><button className="primary" disabled={!canSave}>{saveBusy ? 'Guardando…' : 'Guardar cliente'}</button></div>
      </>}
    </form></Modal>}
  </div>;
}
