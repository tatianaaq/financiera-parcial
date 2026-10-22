import { createPortal } from 'react-dom';
import type { Installment, Loan } from '../../types/models';
import { money } from '../../api/api';
import { loanIdentity } from '../../utils/loanIdentity';
import './CronogramaImprimible.css';

/**
 * Se imprime desde la información definitiva consultada en GET /api/loans/:id/schedule.
 * La vista permanece oculta en pantalla y se muestra únicamente en @media print.
 * No altera datos, no requiere servicios externos ni crea contratos.
 */
export function CronogramaImprimible({ loan, rows }: { loan: Loan; rows: Installment[] }) {
  const identity = loanIdentity(loan);
  const principalProgramado = rows.reduce((sum, row) => sum + Number(row.principal || 0), 0);
  const interesesProgramados = rows.reduce((sum, row) => sum + Number(row.interest || 0), 0);
  const pagado = rows.reduce((sum, row) => sum + Number(row.paid || 0), 0);
  const pendiente = rows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0);
  const generatedAt = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

  return createPortal(
    <section className="cronograma-impresion" aria-label="Cronograma de préstamo listo para imprimir">
      <header className="cronograma-impresion-encabezado">
        <div>
          <p className="cronograma-impresion-marca">PRÉSTAMO CASTILLO · GESTIÓN DE CRÉDITOS</p>
          <h1>Cronograma de pagos</h1>
          <p className="cronograma-impresion-subtitulo">Préstamo PR-{String(loan.id).padStart(6, '0')} · Estado: {loan.status}</p>
        </div>
        <div className="cronograma-impresion-agencia">
          <b>{loan.agency}</b>
          <span>Emitido: {generatedAt}</span>
        </div>
      </header>

      <div className="cronograma-impresion-datos">
        <div><span>Prestatario</span><strong>{identity.name}</strong></div>
        <div><span>Documento del crédito</span><strong>{identity.document}</strong></div>
        {identity.isRuc && <div><span>DNI del responsable</span><strong>{identity.responsibleDni}</strong></div>}
        {identity.representative && <div><span>Representante</span><strong>{identity.representative}</strong></div>}
        <div><span>Fecha de desembolso</span><strong>{loan.disbursedAt}</strong></div>
        <div><span>Capital otorgado</span><strong>{money(loan.principal)}</strong></div>
        <div><span>TEA registrada</span><strong>{loan.annualRate == null ? 'No registrada' : `${(loan.annualRate * 100).toLocaleString('es-PE', { maximumFractionDigits: 2 })}%`}</strong></div>
        <div><span>Número de cuotas</span><strong>{loan.installments}</strong></div>
      </div>

      <table className="cronograma-impresion-tabla">
        <thead>
          <tr>
            <th scope="col">N.º</th><th scope="col">Vencimiento</th>
            <th scope="col">Capital</th><th scope="col">Interés</th>
            <th scope="col">Cuota</th><th scope="col">Pagado</th>
            <th scope="col">Pendiente</th><th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.number}</td><td>{row.dueDate}</td><td>{money(row.principal)}</td>
              <td>{money(row.interest)}</td><td>{money(Number(row.principal) + Number(row.interest))}</td>
              <td>{money(row.paid)}</td><td>{money(row.outstanding)}</td><td>{row.status}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2} scope="row">Totales</th>
            <td>{money(principalProgramado)}</td><td>{money(interesesProgramados)}</td>
            <td>{money(principalProgramado + interesesProgramados)}</td>
            <td>{money(pagado)}</td><td>{money(pendiente)}</td><td>—</td>
          </tr>
        </tfoot>
      </table>

      <footer className="cronograma-impresion-pie">
        <p>Información generada a partir del estado registrado del préstamo al momento de la impresión. Los pagos posteriores pueden modificar los saldos y estados.</p>
        <p>Documento informativo. No constituye comprobante de pago ni reemplaza el contrato de préstamo.</p>
      </footer>
    </section>,
    document.body,
  );
}
