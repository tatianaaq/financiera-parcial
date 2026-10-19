import { useEffect, useState } from 'react';
import { api, money } from '../../api/api';
import { SkeletonRows } from '../../components/SkeletonRows';
import type { AgencyDashboard, AppUser, Client, ClientCreditSummary, Loan, Me } from '../../types/models';
import './Dashboard.css';

type AgencyDetails = {
  agencyId: number;
  clients: Client[];
  loans: Loan[];
  creditSummary: ClientCreditSummary[];
  users: AppUser[];
};

export function Dashboard({ me, go, goAgency, openClient, notify }: { me: Me; go: (page: string) => void; goAgency: (agencyId: number, page: string) => void; openClient: (clientId: number) => void; notify: (message: string, error?: boolean) => void }) {
  const [branches, setBranches] = useState<AgencyDashboard[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [creditSummary, setCreditSummary] = useState<ClientCreditSummary[]>([]);
  const [agencyDetails, setAgencyDetails] = useState<AgencyDetails>();
  const [isLoading, setIsLoading] = useState(true);
  const [isAgencyDetailLoading, setIsAgencyDetailLoading] = useState(false);
  const [agencyViewId, setAgencyViewId] = useState<number>();

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        if (me.role === 'ADMIN') {
          const [branchData, loanData] = await Promise.all([
            api<AgencyDashboard[]>('/dashboard/agencies'),
            api<Loan[]>('/loans'),
          ]);
          if (active) { setBranches(branchData); setLoans(loanData); }
        } else {
          const [clientData, creditData] = await Promise.all([
            api<Client[]>('/clients'),
            api<ClientCreditSummary[]>('/clients/credit-summary'),
          ]);
          if (active) { setClients(clientData); setCreditSummary(creditData); }
        }
      } catch (error) {
        if (active) notify((error as Error).message, true);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [me.role, notify]);

  useEffect(() => {
    if (me.role !== 'ADMIN' || agencyViewId === undefined) return;
    let active = true;
    setIsAgencyDetailLoading(true);
    const agencyQuery = `?agencyId=${agencyViewId}`;
    void Promise.all([
      api<Client[]>(`/clients${agencyQuery}`),
      api<Loan[]>(`/loans${agencyQuery}`),
      api<ClientCreditSummary[]>('/clients/credit-summary'),
      api<AppUser[]>('/admin/users'),
    ]).then(([agencyClients, agencyLoans, agencyCreditSummary, users]) => {
      if (active) setAgencyDetails({ agencyId: agencyViewId, clients: agencyClients, loans: agencyLoans, creditSummary: agencyCreditSummary, users });
    }).catch(error => {
      if (active) notify((error as Error).message, true);
    }).finally(() => {
      if (active) setIsAgencyDetailLoading(false);
    });
    return () => { active = false; };
  }, [agencyViewId, me.role, notify]);

  const selectedAgency = branches.find(branch => branch.id === agencyViewId);
  const details = selectedAgency && agencyDetails?.agencyId === selectedAgency.id ? agencyDetails : undefined;
  const agencyClients = details?.clients ?? [];
  const agencyLoans = details?.loans ?? [];
  const agencyCreditById = new Map((details?.creditSummary ?? []).map(summary => [summary.clientId, summary]));
  const advisorByAgency = details?.users.find(user => user.agencyId === selectedAgency?.id && user.role === 'ADVISOR');
  const agencyActiveClients = agencyClients.filter(client => (agencyCreditById.get(client.id)?.activeLoans ?? 0) > 0);
  const agencyOverdueClients = agencyClients.filter(client => agencyCreditById.get(client.id)?.creditStatus === 'MOROSO');
  const advisorCreditById = new Map(creditSummary.map(summary => [summary.clientId, summary]));
  const allActiveClients = clients.filter(client => (advisorCreditById.get(client.id)?.activeLoans ?? 0) > 0);
  const activeClients = allActiveClients.slice(0, 6);
  const totalPrincipal = loans.reduce((total, loan) => total + loan.principal, 0);

  if (me.role === 'ADMIN' && selectedAgency) return <div className="page-dashboard agency-detail-view">
    <section className="dashboard-welcome"><div><span className="eyebrow">RESUMEN NACIONAL / {selectedAgency.name.toUpperCase()}</span><h1>Resumen de sede</h1><p>Seguimiento de la agencia {selectedAgency.name}.</p></div><button className="secondary" onClick={() => setAgencyViewId(undefined)}>← Volver al resumen nacional</button></section>
    {isAgencyDetailLoading && <div className="loading-caption" role="status"><span className="loading-spinner" aria-hidden="true" />Cargando datos de la sede…</div>}
    <section className="agency-identity panel"><span className="agency-icon">⌂</span><div><small>Sede</small><b>{selectedAgency.name}</b></div><div><small>Asesor asignado</small><b>{advisorByAgency?.username ?? (isAgencyDetailLoading ? 'Cargando…' : 'Sin asesor asignado')}</b></div><span className={`tag ${selectedAgency.enabled ? '' : 'red'}`}>{selectedAgency.enabled ? 'Operativa' : 'Inactiva'}</span></section>
    <section className="cards agency-detail-metrics"><article className="card"><small>Clientes registrados</small><b>{selectedAgency.clients}</b></article><article className="card"><small>Préstamos activos</small><b>{selectedAgency.activeLoans}</b></article><article className="card"><small>Capital pendiente</small><b>{money(selectedAgency.portfolio)}</b></article><article className="card"><small>Importe recuperado</small><b>{money(selectedAgency.recovered)}</b></article></section>
    <section className="cards agency-risk-metrics"><article className="card"><small>Saldo en morosidad</small><b className={selectedAgency.overdueBalance ? 'overdue-text' : ''}>{money(selectedAgency.overdueBalance)}</b></article><article className="card"><small>Cuotas vencidas</small><b className={selectedAgency.overdueInstallments ? 'overdue-text' : ''}>{selectedAgency.overdueInstallments}</b></article><article className="card"><small>Clientes con crédito activo</small><b>{selectedAgency.activeLoans ? agencyActiveClients.length : 0}</b></article><article className="card"><small>Clientes morosos</small><b className={agencyOverdueClients.length ? 'overdue-text' : ''}>{agencyOverdueClients.length}</b></article></section>
    <section className="dashboard-shortcuts"><button className="shortcut-card" onClick={() => goAgency(selectedAgency.id,'clients')}><span className="shortcut-icon">♙</span><span><b>Ver clientes de {selectedAgency.name}</b><small>Consulta clientes y su situación crediticia.</small></span><strong>→</strong></button><button className="shortcut-card" onClick={() => goAgency(selectedAgency.id,'loans')}><span className="shortcut-icon">▤</span><span><b>Ver préstamos de {selectedAgency.name}</b><small>Filtra la cartera y abre detalles o cronogramas.</small></span><strong>→</strong></button></section>
    <section className="panel agency-quick-summary"><div className="panel-head"><div><span className="eyebrow">RESUMEN RÁPIDO</span><h3>Indicadores de la agencia</h3></div><span className="tag">{isAgencyDetailLoading ? 'Cargando…' : `${agencyLoans.length} préstamos registrados`}</span></div><div className="table-scroll"><table><thead><tr><th>Indicador</th><th>Valor</th></tr></thead><tbody>{isAgencyDetailLoading ? <SkeletonRows columns={2} rows={4} /> : <><tr><td>Clientes registrados</td><td>{agencyClients.length}</td></tr><tr><td>Clientes con créditos activos</td><td>{agencyActiveClients.length}</td></tr><tr><td>Clientes sin créditos activos</td><td>{agencyClients.length-agencyActiveClients.length}</td></tr><tr><td>Clientes con cuotas vencidas</td><td>{agencyOverdueClients.length}</td></tr><tr><td>Préstamos finalizados</td><td>{agencyLoans.filter(loan => loan.status === 'FINALIZADO').length}</td></tr></>}</tbody></table></div></section>
  </div>;

  return <div className="page-dashboard">
    <section className="dashboard-welcome"><div><span className="eyebrow">{me.role === 'ADMIN' ? 'VISTA NACIONAL' : `AGENCIA ${me.agency.toUpperCase()}`}</span><h1>{me.role === 'ADMIN' ? 'Resumen nacional' : 'Resumen de cartera'}</h1><p>{me.role === 'ADMIN' ? 'Seguimiento consolidado de clientes, créditos y agencias.' : `Bienvenido, ${me.username}. Este es el panorama de ${me.agency}.`}</p></div><button className="primary" onClick={() => go(me.role === 'ADMIN' ? 'loans' : 'clients')}>{me.role === 'ADMIN' ? 'Ver cartera consolidada' : 'Ver directorio de clientes'} <span aria-hidden="true">→</span></button></section>

    {me.role === 'ADMIN' && isLoading && <section className="cards dashboard-metrics"><div className="skeleton-metric" role="status" aria-label="Cargando resumen"><span className="skeleton-line" /><span className="skeleton-line" /></div></section>}
    {me.role === 'ADMIN' && !isLoading && <section className="cards dashboard-metrics"><article className="card dashboard-metric-purple"><span className="metric-symbol">♙</span><div><div className="metric-label">Clientes registrados</div><div className="metric">{branches.reduce((total, branch) => total + branch.clients, 0)}</div><div className="metric-foot">Total de las agencias</div></div></article></section>}
    {me.role === 'ADMIN' && !isLoading && <section className="cards dashboard-money-metrics"><article className="card"><div className="metric-label">Capital original prestado</div><div className="metric">{money(totalPrincipal)}</div><small>Suma del capital en todos los préstamos registrados</small></article><article className="card"><div className="metric-label">Préstamos registrados</div><div className="metric">{loans.length}</div><small>En todas las sedes</small></article></section>}

    {me.role === 'ADMIN' ? <section className="panel agency-overview"><div className="panel-head"><div><span className="eyebrow">SEGUIMIENTO POR SEDE</span><h3>Desempeño de agencias</h3></div><button className="link" onClick={() => go('users')}>Ver usuarios y sedes →</button></div><div className="table-scroll"><table><thead><tr><th>Sede</th><th>Clientes</th><th>Préstamos activos</th><th>Capital pendiente</th><th>Recuperado</th><th>Monto vencido</th><th>Cuotas vencidas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{isLoading ? <SkeletonRows columns={9} rows={4} /> : branches.map(branch => <tr key={branch.id}><td><b>{branch.name}</b></td><td>{branch.clients}</td><td>{branch.activeLoans}</td><td>{money(branch.portfolio)}</td><td>{money(branch.recovered)}</td><td>{money(branch.overdueBalance)}</td><td><span className={branch.overdueInstallments ? 'overdue-text' : ''}>{branch.overdueInstallments}</span></td><td><span className={`tag ${branch.enabled ? '' : 'red'}`}>{branch.enabled ? 'Operativa' : 'Inactiva'}</span></td><td><button className="secondary compact" onClick={() => setAgencyViewId(branch.id)}>Ver sede</button><button className="link" onClick={() => goAgency(branch.id,'loans')}>Ver préstamos</button></td></tr>)}</tbody></table></div></section> : <><section className="panel advisor-portfolio"><div className="panel-head"><div><span className="eyebrow">RESUMEN DE CARTERA</span><h3>Clientes con préstamos activos</h3></div><button className="link" onClick={() => go('clients')}>Ver todos los clientes →</button></div>{isLoading && <div className="loading-caption" role="status"><span className="loading-spinner" aria-hidden="true" />Cargando clientes y cartera…</div>}<div className="table-scroll"><table><thead><tr><th>Cliente</th><th>DNI</th><th>Préstamos activos</th><th>Capital pendiente</th><th>Situación</th><th>Acción</th></tr></thead><tbody>{isLoading ? <SkeletonRows columns={6} rows={4} /> : <>{activeClients.map(client => { const summary = advisorCreditById.get(client.id); return <tr key={client.id}><td><b>{client.names} {client.surnames}</b></td><td>{client.dni}</td><td>{summary?.activeLoans ?? 0}</td><td>{money(summary?.outstandingPrincipal ?? 0)}</td><td><span className={`tag ${summary?.creditStatus === 'MOROSO' ? 'red' : ''}`}>{summary?.creditStatus === 'MOROSO' ? `Moroso · ${summary.overdueInstallments}` : 'Al día'}</span></td><td><button className="link" onClick={() => openClient(client.id)}>Ver detalle →</button></td></tr>; })}{activeClients.length === 0 && <tr><td colSpan={6} className="empty">Aún no hay clientes con préstamos activos.</td></tr>}</>}</tbody></table></div></section><div className="dashboard-shortcuts"><button className="shortcut-card" onClick={() => go('clients')}><span className="shortcut-icon">♙</span><span><b>Registrar o buscar cliente</b><small>Revisa la identidad y el historial crediticio por DNI.</small></span><strong>→</strong></button><button className="shortcut-card" onClick={() => go('loans')}><span className="shortcut-icon">▤</span><span><b>Evaluar préstamo</b><small>Consulta la cartera y el cronograma de cuotas.</small></span><strong>→</strong></button></div></>}
    <section className="dashboard-rule"><div><span className="eyebrow">ORIGINACIÓN DE CRÉDITOS</span><h3>Evaluación uniforme</h3><p>El límite de capital original activo y las cuotas vencidas se verifican globalmente por DNI. La autorización para originar préstamos corresponde únicamente al asesor de la sede.</p></div><div className="rule-chips"><span>TEA 30%</span><span>Método francés</span><span>Periodos de 30 días</span><span>Sin seguro en nuevos créditos</span></div></section>
  </div>;
}
