import { useCallback, useState } from 'react';
import { useAuth } from './auth/useAuth';
import { Login } from './components/Login';
import { Dashboard } from './pages/dashboard/Dashboard';
import { Clientes } from './pages/clientes/Clientes';
import { Prestamos } from './pages/prestamos/Prestamos';
import type { LinkedDocument } from './pages/clientes/RucLookup';
import { Usuarios } from './pages/admin/Usuarios';

const titles: Record<string, string> = { dashboard: 'Resumen', clients: 'Clientes', loans: 'Préstamos', users: 'Usuarios y sedes' };
const today = new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
export default function App() {
  const { me, login, logout } = useAuth();
  const [page, setPage] = useState('dashboard'); const [notice, setNotice] = useState<{ message: string; error: boolean }>();
  const [loanDocument, setLoanDocument] = useState<LinkedDocument>(); const [loanDni, setLoanDni] = useState<string>(); const [loanClientId, setLoanClientId] = useState<number>(); const [clientToOpen, setClientToOpen] = useState<number>(); const [agencyFilter, setAgencyFilter] = useState<string>();
  const notify = useCallback((message: string, error = false) => {
    if (document.querySelector('#modal[open]')) window.dispatchEvent(new CustomEvent('loan-notice', { detail: { message, error } }));
    else { setNotice({ message, error }); window.setTimeout(() => setNotice(undefined), 5500); }
  }, []);
  const openAgency = useCallback((agencyId: number, target: string) => { setAgencyFilter(String(agencyId)); setPage(target); }, []);
  const openClient = useCallback((id: number) => { setClientToOpen(id); setPage('clients'); }, []);
  const clientOpened = useCallback(() => setClientToOpen(undefined), []);
  function onLogout() { logout(); setNotice(undefined); }
  if (!me) return <Login onLogin={(user, auth) => { login(user, auth); setPage('dashboard'); }} />;
  const pageNode = page === 'dashboard' ? <Dashboard me={me} go={setPage} goAgency={openAgency} openClient={openClient} notify={notify} /> : page === 'clients' ? <Clientes key={`${me.id}:${me.agencyId}`} me={me} notify={notify} initialAgencyId={agencyFilter} selectedClientId={clientToOpen} clientOpened={clientOpened} createLoan={(clientId, dni) => { setLoanDocument(undefined); setLoanDni(dni); setLoanClientId(clientId); setPage('loans'); }} linkLoan={(linked) => {setLoanDocument(linked);setLoanDni(linked.responsibleDni);setLoanClientId(linked.clientId);setPage('loans');}} /> : page === 'loans' ? <Prestamos key={`${me.id}:${me.agencyId}`} me={me} notify={notify} initialAgencyId={agencyFilter} selectedClientId={loanClientId} loanDocument={loanDocument} clearSelectedClient={() => {setLoanClientId(undefined);setLoanDocument(undefined);}} openClient={openClient} goToClients={() => setPage('clients')} initialDni={loanDni} /> : page === 'users' && me.role === 'ADMIN' ? <Usuarios notify={notify} /> : <Dashboard me={me} go={setPage} goAgency={openAgency} openClient={openClient} notify={notify} />;
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">F</span><span><b>Financiera</b><small>Gestión de créditos</small></span></div><nav className="nav-list"><div className="nav-label">OPERACIONES</div>{[['dashboard', '▦', 'Resumen'], ['clients', '♙', 'Clientes'], ['loans', '▤', 'Préstamos']].map(([key, icon, label]) => <button key={key} className={`nav ${page === key ? 'active' : ''}`} onClick={() => { if (key === 'loans') {setLoanDni(undefined);setLoanClientId(undefined);setLoanDocument(undefined);} setPage(key); setNotice(undefined); }}>{icon}<span>{label}</span></button>)}{me.role === 'ADMIN' && <div id="admin-nav"><div className="nav-label">ADMINISTRACIÓN</div><button className={`nav ${page === 'users' ? 'active' : ''}`} onClick={() => setPage('users')}>⚙ <span>Usuarios y sedes</span></button></div>}</nav><div className="side-bottom"><div className="user-badge"><div className="avatar">●</div><div><b>{me.username}</b><small>{me.agency}</small></div></div><button className="logout" onClick={onLogout}>Cerrar sesión</button></div></aside><section className="content"><header className="topbar"><div><div className="eyebrow">{me.role === 'ADMIN' ? 'ADMINISTRACIÓN GENERAL' : me.agency.toUpperCase()}</div><h2>{titles[page]}</h2></div><span className="today">{today}</span></header>{notice && <div className={`notice${notice.error ? ' error' : ''}`} role="alert">{notice.message}</div>}{pageNode}</section></div>;
}
