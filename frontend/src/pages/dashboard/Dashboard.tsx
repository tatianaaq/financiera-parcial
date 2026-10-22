
import { useEffect, useState } from 'react';
import { api, money } from '../../api/api';
import type {
  AgencyDashboard,
  Client,
  Loan,
  Me
} from '../../types/models';
import './Dashboard.css';

type Props = {
  me: Me;
  go: (page: string) => void;
  goAgency: (agencyId: number, page: string) => void;
  openClient: (clientId: number) => void;
  notify: (message: string, error?: boolean) => void;
};

const loanNumber = (id: number) =>
    `PR-${String(id).padStart(6, '0')}`;

function dateLabel(value: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match
      ? `${match[3]}/${match[2]}/${match[1]}`
      : value || '—';
}

export function Dashboard({
                            me,
                            go,
                            notify
                          }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [branches, setBranches] = useState<AgencyDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError('');

      try {
        const [clientData, loanData] = await Promise.all([
          api<Client[]>('/clients'),
          api<Loan[]>('/loans')
        ]);

        if (!active) return;
        setClients(clientData);
        setLoans(loanData);

        if (me.role === 'ADMIN') {
          try {
            const agencies = await api<AgencyDashboard[]>(
                '/dashboard/agencies'
            );

            if (active) setBranches(agencies);
          } catch (error) {
            if (active) {
              notify(
                  error instanceof Error
                      ? error.message
                      : 'No se pudo cargar el resumen por agencias.',
                  true
              );
            }
          }
        }
      } catch (error) {
        if (!active) return;

        setLoadError(
            error instanceof Error
                ? error.message
                : 'No se pudo cargar el resumen.'
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [me.role, notify]);

  const totalClients = clients.length;
  const totalLoans = loans.length;
  const originalCapital = loans.reduce(
      (total, loan) => total + Number(loan.principal || 0),
      0
  );

  const recentLoans = [...loans]
      .sort((a, b) => b.id - a.id)
      .slice(0, 5);

  const isAdmin = me.role === 'ADMIN';

  return (
      <div className="page-dashboard resumen-simple">
        <section className="resumen-kpis">
          <article className="resumen-kpi">
            <div className="resumen-kpi-top">
              <span className="resumen-icon purple">♙</span>
              <h3>Clientes registrados</h3>
            </div>

            <strong>
              {loading ? '—' : totalClients}
            </strong>

            <p>
              {isAdmin
                  ? 'Total nacional'
                  : `Total de la sede ${me.agency}`}
            </p>
          </article>

          <article className="resumen-kpi">
            <div className="resumen-kpi-top">
              <span className="resumen-icon green">▤</span>
              <h3>Préstamos registrados</h3>
            </div>

            <strong>
              {loading ? '—' : totalLoans}
            </strong>

            <p>Préstamos otorgados</p>
          </article>

          <article className="resumen-kpi">
            <div className="resumen-kpi-top">
              <span className="resumen-icon blue">◉</span>
              <h3>Capital original prestado</h3>
            </div>

            <strong className="resumen-money">
              {loading ? '—' : money(originalCapital)}
            </strong>

            <p>Capital total desembolsado</p>
          </article>
        </section>

        {loadError && (
            <div className="resumen-error" role="alert">
              {loadError}
            </div>
        )}

        <section className="resumen-table-panel">
          <header className="resumen-section-head">
            <div className="resumen-section-title">
            <span className="resumen-icon blue small">
              ▤
            </span>
              <h3>Últimos préstamos registrados</h3>
            </div>

            <button
                type="button"
                className="resumen-view-all"
                onClick={() => go('loans')}
            >
              Ver todos →
            </button>
          </header>

          <div className="resumen-table-scroll">
            <table className="resumen-table">
              <thead>
              <tr>
                <th>N.° Préstamo</th>
                <th>Cliente</th>
                <th>Capital</th>
                <th>Cuotas</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
              </thead>

              <tbody>
              {loading ? (
                  <tr>
                    <td
                        colSpan={6}
                        className="resumen-empty"
                    >
                      Cargando préstamos…
                    </td>
                  </tr>
              ) : recentLoans.length ? (
                  recentLoans.map(loan => (
                      <tr key={loan.id}>
                        <td className="resumen-code">
                          {loanNumber(loan.id)}
                        </td>

                        <td className="resumen-client-name">
                          {loan.companyName || loan.client}
                        </td>

                        <td>
                          {money(loan.principal)}
                        </td>

                        <td>{loan.installments}</td>

                        <td>
                      <span
                          className={`resumen-status ${
                              loan.status === 'FINALIZADO'
                                  ? 'finished'
                                  : 'active'
                          }`}
                      >
                        {loan.status}
                      </span>
                        </td>

                        <td>
                          {dateLabel(loan.disbursedAt)}
                        </td>
                      </tr>
                  ))
              ) : (
                  <tr>
                    <td
                        colSpan={6}
                        className="resumen-empty"
                    >
                      Todavía no hay préstamos registrados.
                    </td>
                  </tr>
              )}
              </tbody>
            </table>
          </div>
        </section>

        {isAdmin && (
            <section className="resumen-table-panel">
              <header className="resumen-section-head">
                <h3>Resumen por agencias</h3>
              </header>

              <div className="resumen-table-scroll">
                <table className="resumen-table">
                  <thead>
                  <tr>
                    <th>Agencia</th>
                    <th>Clientes</th>
                    <th>Préstamos</th>
                    <th>Estado</th>
                  </tr>
                  </thead>

                  <tbody>
                  {branches.length ? (
                      branches.map(branch => (
                          <tr key={branch.id}>
                            <td className="resumen-client-name">
                              {branch.name}
                            </td>
                            <td>{branch.clients}</td>
                            <td>{branch.totalLoans}</td>
                            <td>
                        <span
                            className={`resumen-status ${
                                branch.enabled
                                    ? 'enabled'
                                    : 'finished'
                            }`}
                        >
                          {branch.enabled
                              ? 'Habilitada'
                              : 'Inactiva'}
                        </span>
                            </td>
                          </tr>
                      ))
                  ) : (
                      <tr>
                        <td
                            colSpan={4}
                            className="resumen-empty"
                        >
                          {loading
                              ? 'Cargando agencias…'
                              : 'Sin información disponible.'}
                        </td>
                      </tr>
                  )}
                  </tbody>
                </table>
              </div>
            </section>
        )}
      </div>
  );
}
