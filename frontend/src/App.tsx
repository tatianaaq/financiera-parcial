
import { useCallback, useState } from 'react';

import { useAuth } from './auth/useAuth';
import { Login } from './components/Login';

import { Dashboard } from './pages/dashboard/Dashboard';
import { Clientes } from './pages/clientes/Clientes';
import { Prestamos } from './pages/prestamos/Prestamos';
import { Caja } from './pages/caja/Caja';

import type { LinkedDocument } from './pages/clientes/RucLookup';

type Page =
    | 'dashboard'
    | 'clients'
    | 'loans'
    | 'cash';

const titles: Record<Page, string> = {
    dashboard: 'Resumen',
    clients: 'Clientes',
    loans: 'Préstamos',
    cash: 'Caja'
};

const today = new Date().toLocaleDateString('es-PE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});

export default function App() {
    const { me, login, logout } = useAuth();

    const [page, setPage] = useState<Page>('dashboard');

    const [notice, setNotice] = useState<{
        message: string;
        error: boolean;
    }>();

    const [loanDocument, setLoanDocument] =
        useState<LinkedDocument>();

    const [loanDni, setLoanDni] = useState<string>();

    const [loanClientId, setLoanClientId] =
        useState<number>();

    const [clientToOpen, setClientToOpen] =
        useState<number>();

    const [agencyFilter, setAgencyFilter] =
        useState<string>();

    const notify = useCallback(
        (message: string, error = false) => {
            if (document.querySelector('#modal[open]')) {
                window.dispatchEvent(
                    new CustomEvent('loan-notice', {
                        detail: {
                            message,
                            error
                        }
                    })
                );

                return;
            }

            setNotice({
                message,
                error
            });

            window.setTimeout(() => {
                setNotice(undefined);
            }, 5500);
        },
        []
    );

    // NAVEGACIÓN SEGÚN ROL
    function navigate(target: string) {
        if (
            target !== 'dashboard' &&
            target !== 'clients' &&
            target !== 'loans' &&
            target !== 'cash'
        ) {
            return;
        }

        // Caja es exclusiva del asesor.
        if (target === 'cash' && me?.role !== 'ADVISOR') {
            return;
        }

        if (target === 'loans') {
            setLoanDni(undefined);
            setLoanClientId(undefined);
            setLoanDocument(undefined);
        }

        setPage(target);
        setNotice(undefined);
    }

    const openAgency = useCallback(
        (agencyId: number, target: string) => {
            setAgencyFilter(String(agencyId));

            if (
                target === 'clients' ||
                target === 'loans'
            ) {
                setPage(target);
            }
        },
        []
    );

    const openClient = useCallback(
        (clientId: number) => {
            setClientToOpen(clientId);
            setPage('clients');
        },
        []
    );

    const clientOpened = useCallback(() => {
        setClientToOpen(undefined);
    }, []);

    // NUEVO PRÉSTAMO
    const createLoan = useCallback(
        (clientId: number, dni: string) => {
            setLoanDocument(undefined);
            setLoanDni(dni);
            setLoanClientId(clientId);
            setPage('loans');
        },
        []
    );

    // PRÉSTAMO VINCULADO A RUC
    const linkLoan = useCallback(
        (linked: LinkedDocument) => {
            setLoanDocument(linked);
            setLoanDni(linked.responsibleDni);
            setLoanClientId(linked.clientId);
            setPage('loans');
        },
        []
    );

    // IR AL LISTADO DE PRÉSTAMOS
    const goToLoans = useCallback(() => {
        setLoanDocument(undefined);
        setLoanDni(undefined);
        setLoanClientId(undefined);
        setPage('loans');
    }, []);

    function onLogout() {
        logout();

        setNotice(undefined);
        setPage('dashboard');

        setLoanDocument(undefined);
        setLoanDni(undefined);
        setLoanClientId(undefined);
        setClientToOpen(undefined);
        setAgencyFilter(undefined);
    }

    // LOGIN
    if (!me) {
        return (
            <Login
                onLogin={(user, auth) => {
                    login(user, auth);
                    setPage('dashboard');
                }}
            />
        );
    }

    const isAdmin = me.role === 'ADMIN';
    const isAdvisor = me.role === 'ADVISOR';

    // Evita mostrar Caja cuando cambia la sesión
    // desde un asesor hacia un administrador.
    const currentPage: Page =
        isAdmin && page === 'cash'
            ? 'dashboard'
            : page;

    // MENÚ PRINCIPAL
    // Admin: Resumen, Clientes, Préstamos
    // Asesor: Resumen, Clientes, Préstamos, Caja
    const navigation: Array<{
        key: Page;
        symbol: string;
        label: string;
    }> = [
        {
            key: 'dashboard',
            symbol: '▦',
            label: 'Resumen'
        },
        {
            key: 'clients',
            symbol: '♙',
            label: 'Clientes'
        },
        {
            key: 'loans',
            symbol: '▤',
            label: 'Préstamos'
        },
        ...(isAdvisor
            ? [
                {
                    key: 'cash' as Page,
                    symbol: '▣',
                    label: 'Caja'
                }
            ]
            : [])
    ];

    // CONTENIDO DE LA PÁGINA
    let pageNode;

    if (currentPage === 'dashboard') {
        pageNode = (
            <Dashboard
                me={me}
                go={navigate}
                goAgency={openAgency}
                openClient={openClient}
                notify={notify}
            />
        );
    } else if (currentPage === 'clients') {
        pageNode = (
            <Clientes
                key={`${me.id}:${me.agencyId}`}
                me={me}
                notify={notify}
                initialAgencyId={agencyFilter}
                selectedClientId={clientToOpen}
                clientOpened={clientOpened}
                createLoan={createLoan}
                linkLoan={linkLoan}
                goToLoans={goToLoans}
            />
        );
    } else if (currentPage === 'loans') {
        pageNode = (
            <Prestamos
                key={`${me.id}:${me.agencyId}`}
                me={me}
                notify={notify}
                initialAgencyId={agencyFilter}
                selectedClientId={loanClientId}
                loanDocument={loanDocument}
                clearSelectedClient={() => {
                    setLoanClientId(undefined);
                    setLoanDocument(undefined);
                }}
                openClient={openClient}
                goToClients={() => {
                    setPage('clients');
                }}
                initialDni={loanDni}
            />
        );
    } else if (
        currentPage === 'cash' &&
        isAdvisor
    ) {
        pageNode = (
            <Caja
                key={`${me.id}:${me.agencyId}`}
                me={me}
            />
        );
    } else {
        pageNode = (
            <Dashboard
                me={me}
                go={navigate}
                goAgency={openAgency}
                openClient={openClient}
                notify={notify}
            />
        );
    }

    return (
        <div className="shell">
            {/* MENÚ LATERAL */}
            <aside className="sidebar">
                <div className="brand">
          <span className="brand-mark brand-mark-castillo">
            PC
          </span>

                    <span>
            <b>Préstamo Castillo</b>
            <small>Administración de créditos</small>
          </span>
                </div>

                <nav className="nav-list">
                    <div className="nav-label">
                        OPERACIONES
                    </div>

                    {navigation.map(item => (
                        <button
                            key={item.key}
                            type="button"
                            className={`nav ${
                                currentPage === item.key
                                    ? 'active'
                                    : ''
                            }`}
                            onClick={() => navigate(item.key)}
                        >
                            {item.symbol}

                            <span>
                {item.label}
              </span>
                        </button>
                    ))}
                </nav>

                {/* INFORMACIÓN DEL USUARIO */}
                <div className="side-bottom">
                    <div className="user-badge">
                        <div className="avatar">
                            ●
                        </div>

                        <div>
                            <b>{me.username}</b>
                            <small>{me.agency}</small>
                        </div>
                    </div>

                    <button
                        className="logout"
                        type="button"
                        onClick={onLogout}
                    >
                        Cerrar sesión
                    </button>
                </div>
            </aside>

            {/* CONTENIDO PRINCIPAL */}
            <section className="content">
                <header className="topbar">
                    <div>
                        <div className="eyebrow">
                            PRÉSTAMO CASTILLO · {isAdmin
                                ? 'ADMINISTRACIÓN GENERAL'
                                : me.agency.toUpperCase()}
                        </div>

                        <h2>
                            {titles[currentPage]}
                        </h2>
                    </div>

                    <span className="today">
            {today}
          </span>
                </header>

                {/* NOTIFICACIONES */}
                {notice && (
                    <div
                        className={`notice${
                            notice.error ? ' error' : ''
                        }`}
                        role="alert"
                    >
                        {notice.message}
                    </div>
                )}

                {pageNode}
            </section>
        </div>
    );
}
