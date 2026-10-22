import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Installment, Loan } from '../../types/models';
import { money } from '../../api/api';
import { loanIdentity } from '../../utils/loanIdentity';
import { Modal } from '../../components/Modal';
import './ContratoPrestamo.css';

type Props = { loan: Loan; rows: Installment[]; onClose: () => void };

type DatosFinanciera = {
  razonSocial: string;
  ruc: string;
  domicilio: string;
  representante: string;
  cargo: string;
};

// Datos institucionales: se configuran UNA SOLA VEZ en el frontend desplegado.
// Nunca deben rellenarse con datos inventados ni pedirse al asesor en cada contrato.
const datosFinanciera: DatosFinanciera = {
  razonSocial: (import.meta.env.VITE_CONTRATO_RAZON_SOCIAL || '').trim(),
  ruc: (import.meta.env.VITE_CONTRATO_RUC || '').trim(),
  domicilio: (import.meta.env.VITE_CONTRATO_DOMICILIO || '').trim(),
  representante: (import.meta.env.VITE_CONTRATO_REPRESENTANTE || '').trim(),
  cargo: (import.meta.env.VITE_CONTRATO_CARGO_REPRESENTANTE || '').trim(),
};

// El contrato solo será definitivo si la información institucional y la del préstamo están completas.
// Si algo falta, permitimos imprimir una copia marcada como BORRADOR, nunca un contrato final ficticio.
const campoVerificado = (valor: string) => valor || '____________________________';
const rucVerificado = (ruc: string) => /^\d{11}$/.test(ruc) ? ruc : '____________________________';

const numeroContrato = (id: number) => `PR-${String(id).padStart(6, '0')}`;

function fechaCivil(value?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return 'fecha no registrada';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.getTime())) return 'fecha no registrada';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}
function fechaEmision(): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima',
  }).format(new Date());
}
function tasaAnual(rate?: number): string {
  return rate == null ? 'no registrada' : `${(Number(rate) * 100).toLocaleString('es-PE', { maximumFractionDigits: 4 })} %`;
}

/**
 * Contrato redactado para lectura y firma en papel, inspirado en el PDF de referencia.
 * No contiene formularios ni tablas: los datos proceden del préstamo y de la
 * configuración institucional. Imprimir NO registra firma ni acredita desembolso.
 */
export function ContratoPrestamo({ loan, rows, onClose }: Props) {
  // Aislar las reglas de impresión para no afectar «Imprimir cronograma».
  useEffect(() => {
    document.body.classList.add('contrato-texto-print-active');
    return () => document.body.classList.remove('contrato-texto-print-active');
  }, []);

  const identidad = loanIdentity(loan);
  const numero = numeroContrato(loan.id);
  const cuotas = [...rows].sort((a, b) => a.number - b.number);
  const intereses = cuotas.reduce((sum, cuota) => sum + Number(cuota.interest || 0), 0);
  const total = cuotas.reduce((sum, cuota) => sum + Number(cuota.principal || 0) + Number(cuota.interest || 0), 0);
  const primera = cuotas[0];
  const ultima = cuotas[cuotas.length - 1];
  const tipo = identidad.isRuc20 ? 'CONTRATO DE PRÉSTAMO A EMPRESA' : 'CONTRATO DE PRÉSTAMO PERSONAL';
  const personaQueFirma = identidad.isRuc20 ? identidad.representative?.trim() || '' : identidad.name;
  const documentoFirmante = identidad.isRuc20 ? `DNI N.° ${identidad.responsibleDni}` : identidad.document;
  const ciudad = loan.agency?.trim() || 'sede no registrada';
  const declaracionCompromiso = identidad.isRuc20
    ? <>Yo, <strong>{personaQueFirma || 'REPRESENTANTE NO REGISTRADO'}</strong>, identificado(a) con <strong>{documentoFirmante}</strong>, actuando en representación de <strong>{identidad.name}</strong>, identificada con <strong>{identidad.document}</strong>, declaro conocer las condiciones de este préstamo y, en nombre de la empresa y dentro de mis facultades de representación, <strong>me comprometo a cumplir el pago de las cuotas establecidas en el cronograma adjunto</strong>, en las fechas e importes correspondientes. Esta declaración se refiere a la obligación de la empresa y no constituye, por sí sola, una garantía personal del representante.</>
    : <>Yo, <strong>{identidad.name}</strong>, identificado(a) con <strong>{identidad.document}</strong>, declaro conocer las condiciones del crédito N.° <strong>{numero}</strong> y <strong>me comprometo a devolver el capital prestado y pagar las cuotas en los importes y fechas indicados en el cronograma adjunto</strong>. Reconozco que dicho cronograma forma parte del contrato y que cualquier pago deberá contar con su respectiva constancia.</>;

  const pendientes = [
    !datosFinanciera.razonSocial && 'razón social de la financiera',
    !/^\d{11}$/.test(datosFinanciera.ruc) && 'RUC de la financiera',
    !datosFinanciera.domicilio && 'domicilio de la financiera',
    !datosFinanciera.representante && 'representante de la financiera',
    !datosFinanciera.cargo && 'cargo del representante',
    !identidad.name?.trim() && 'nombre del prestatario',
    identidad.document.includes('no disponible') && 'documento del prestatario',
    identidad.isRuc20 && !identidad.representative?.trim() && 'representante de la empresa prestataria',
    identidad.isRuc20 && !/^\d{8}$/.test(identidad.responsibleDni) && 'DNI del representante de la empresa',
    loan.annualRate == null && 'tasa anual registrada',
    !Number.isFinite(Number(loan.principal)) || Number(loan.principal) <= 0 ? 'capital del préstamo' : '',
    !cuotas.length && 'cronograma de cuotas',
    !loan.disbursedAt && 'fecha del desembolso registrada',
  ].filter(Boolean) as string[];

  const esBorrador = pendientes.length > 0;

  const denominacionPrestatario = identidad.isRuc20
    ? `la empresa ${identidad.name}, identificada con ${identidad.document}, representada para la suscripción por ${personaQueFirma || 'representante pendiente de verificación'}, con DNI N.° ${identidad.responsibleDni}`
    : `${identidad.name}, identificado(a) con ${identidad.document}${identidad.isRuc ? `, cuyo DNI asociado es ${identidad.responsibleDni}` : ''}`;

  const cabecera = (pagina: number) => <header className="contrato-texto-encabezado">
    <div className="contrato-texto-marca"><span className="contrato-texto-monograma">PC</span><span><b>Préstamo Castillo</b><small>Gestión de créditos</small></span></div>
    <span className="contrato-texto-referencia">Contrato N.° {numero}{esBorrador && <small className="contrato-texto-marca-borrador"> · BORRADOR</small>}</span>
    <span className="contrato-texto-pagina">{pagina} / 3</span>
  </header>;

  const clausula = (n: string, titulo: string, contenido: React.ReactNode) => <section className="contrato-texto-clausula">
    <h2>{n}. {titulo}</h2>
    <p>{contenido}</p>
  </section>;

  function imprimirContrato() {
    // El navegador utiliza este nombre al guardar como PDF (sin incluir DNI ni RUC).
    const original = document.title;
    document.title = `Prestamo_Castillo_Contrato_${numero}`;
    const restaurar = () => { document.title = original; };
    window.addEventListener('afterprint', restaurar, { once: true });
    window.print();
  }

  const documento = <article className="contrato-texto-documento" aria-label={`Contrato de préstamo ${numero} listo para impresión`}>
    <section className="contrato-texto-hoja">
      {cabecera(1)}
      <div className="contrato-texto-cuerpo">
        <p className="contrato-texto-nombre-comercial">PRÉSTAMO CASTILLO</p>
        <h1>{tipo}</h1>
        <p className="contrato-texto-centro">N.° {numero} · {ciudad}, {fechaEmision()}</p>
        <h2 className="contrato-texto-subtitulo">COMPARECENCIA DE LAS PARTES</h2>
        <p>Conste por el presente documento el contrato de préstamo que celebran, de una parte, <strong>{campoVerificado(datosFinanciera.razonSocial)}</strong>, identificada con RUC N.° <strong>{rucVerificado(datosFinanciera.ruc)}</strong>, con domicilio en <strong>{campoVerificado(datosFinanciera.domicilio)}</strong>, debidamente representada por <strong>{campoVerificado(datosFinanciera.representante)}</strong>, en su calidad de <strong>{campoVerificado(datosFinanciera.cargo)}</strong>, a quien en adelante se denominará <strong>LA ENTIDAD PRESTAMISTA</strong>; y, de la otra parte, <strong>{denominacionPrestatario}</strong>, a quien en adelante se denominará <strong>EL PRESTATARIO</strong>; en los términos y condiciones siguientes.</p>
        <h2 className="contrato-texto-subtitulo">CONDICIONES PARTICULARES DEL PRÉSTAMO</h2>
        <p>LA ENTIDAD PRESTAMISTA registra a favor de EL PRESTATARIO el préstamo N.° <strong>{numero}</strong> por un capital de <strong>{money(loan.principal)}</strong>, con una tasa efectiva anual (TEA) de <strong>{tasaAnual(loan.annualRate)}</strong>. El crédito se pagará en <strong>{cuotas.length} cuotas</strong> de acuerdo con el cronograma entregado como anexo. La fecha de desembolso registrada es el <strong>{fechaCivil(loan.disbursedAt)}</strong>; el primer vencimiento corresponde al <strong>{fechaCivil(primera?.dueDate)}</strong> y el último al <strong>{fechaCivil(ultima?.dueDate)}</strong>. Los intereses programados ascienden a <strong>{money(intereses)}</strong> y el importe total programado es <strong>{money(total)}</strong>. Los importes exactos de cada cuota constan en el cronograma adjunto.</p>
        {clausula('PRIMERA', 'OBJETO DEL CONTRATO', <>Por el presente contrato, LA ENTIDAD PRESTAMISTA concede a EL PRESTATARIO el préstamo descrito en las condiciones particulares, y EL PRESTATARIO <strong>asume de manera expresa el compromiso de devolver la totalidad del capital y pagar los intereses pactados</strong>, en los importes y vencimientos establecidos. El cronograma de pagos, que se entrega por separado para su impresión y firma o recepción, forma parte integrante de este contrato.</>)}
        {clausula('SEGUNDA', 'DESEMBOLSO Y CONFORMIDAD', <>Las partes toman como referencia la fecha de desembolso registrada en el sistema. La entrega efectiva del dinero deberá sustentarse con el comprobante o constancia correspondiente. Antes de la suscripción, EL PRESTATARIO podrá revisar el monto recibido, la tasa, el número de cuotas, las fechas de pago y el total programado. La impresión de este documento, por sí sola, no acredita desembolso ni firma.</>)}
      </div>
      <footer className="contrato-texto-pie">Préstamo Castillo · Gestión de créditos <span>Contrato N.° {numero}</span><span>Página 1 de 3</span></footer>
    </section>
    <section className="contrato-texto-hoja">
      {cabecera(2)}
      <div className="contrato-texto-cuerpo">
        {clausula('TERCERA', 'DECLARACIÓN DE COMPROMISO DE PAGO', declaracionCompromiso)}
        {clausula('CUARTA', 'PAGOS ADELANTADOS Y ANTICIPADOS', <>EL PRESTATARIO podrá solicitar adelantos de cuotas o pagos anticipados, parciales o totales, de acuerdo con las condiciones y reglas aplicables al crédito. LA ENTIDAD PRESTAMISTA registrará el importe recibido, su aplicación a la deuda y, cuando corresponda, la variación de intereses o del cronograma. EL PRESTATARIO podrá solicitar una constancia del pago efectuado y el saldo actualizado.</>)}
        {clausula('QUINTA', 'NUEVAS OPERACIONES DE CRÉDITO', <>La existencia de este préstamo no garantiza la concesión de otros créditos. Cualquier nueva solicitud estará sujeta a evaluación, verificación de obligaciones vigentes y a los límites internos de financiamiento aplicables al cliente y a la sucursal. Los préstamos otorgados en distintas agencias podrán ser considerados conjuntamente para esta evaluación. Ninguna nueva operación se entenderá aprobada por la sola firma del presente contrato.</>)}
        {clausula('SEXTA', 'INCUMPLIMIENTO DE LAS OBLIGACIONES', <>Si EL PRESTATARIO no cancela una cuota en la fecha prevista, LA ENTIDAD PRESTAMISTA podrá registrar la situación de atraso y realizar las gestiones de comunicación y cobranza que resulten legalmente procedentes. No podrán exigirse intereses moratorios, penalidades, comisiones ni otros cargos que no hayan sido válidamente informados, pactados y permitidos por la normativa aplicable. Los pagos posteriores y cualquier regularización deberán quedar asentados en el historial del crédito.</>)}
        {clausula('SÉPTIMA', 'VERACIDAD DE LA INFORMACIÓN', <>EL PRESTATARIO declara que los datos y documentos presentados para su identificación y evaluación corresponden a información verdadera y actualizada. Cuando el préstamo se contrate a nombre de una persona jurídica, quien suscriba en su representación deberá contar con las facultades suficientes para obligarla. Las partes se comprometen a comunicar las modificaciones relevantes de sus datos de contacto o representación.</>)}
      </div>
      <footer className="contrato-texto-pie">Préstamo Castillo · Gestión de créditos <span>Contrato N.° {numero}</span><span>Página 2 de 3</span></footer>
    </section>
    <section className="contrato-texto-hoja">
      {cabecera(3)}
      <div className="contrato-texto-cuerpo contrato-texto-cuerpo-final">
        {clausula('OCTAVA', 'TRATAMIENTO DE DATOS PERSONALES', <>Los datos personales proporcionados durante la evaluación y ejecución del crédito serán tratados para la gestión contractual, seguimiento de pagos y cumplimiento de las obligaciones que correspondan, de conformidad con la información de privacidad entregada al titular y la normativa aplicable. Las finalidades que requieran consentimiento independiente no se considerarán autorizadas por la sola impresión de este documento.</>)}
        {clausula('NOVENA', 'DOMICILIO Y COMUNICACIONES', <>Las partes podrán cursarse comunicaciones relacionadas con el crédito por los canales y domicilios registrados y válidamente informados. Toda controversia será atendida conforme a las normas imperativas y a las autoridades competentes que resulten aplicables. Ninguna estipulación de este documento limitará derechos que la ley reconozca a EL PRESTATARIO.</>)}
        {clausula('DÉCIMA', 'LECTURA Y ACEPTACIÓN', <>Las partes declaran que han tenido oportunidad de leer el presente contrato, conocer las condiciones económicas de la operación y revisar el cronograma que lo acompaña. <strong>Al suscribirlo, EL PRESTATARIO acepta el compromiso de cumplir puntualmente sus obligaciones de pago</strong>, y LA ENTIDAD PRESTAMISTA se obliga a entregar los comprobantes y documentos que correspondan. La aceptación se perfeccionará mediante la suscripción efectiva por las partes autorizadas.</>)}
        <p className="contrato-texto-conformidad">Se emite el presente documento en <strong>{ciudad}</strong>, el <strong>{fechaEmision()}</strong>, para su lectura y posterior suscripción física por las partes que corresponda.</p>
        <div className="contrato-texto-firmas">
          <div className="contrato-texto-firmante"><div className="contrato-texto-area-firma"><span className="contrato-texto-huella">Huella</span></div><div className="contrato-texto-linea"/><strong>{identidad.isRuc20 ? 'REPRESENTANTE DEL PRESTATARIO' : 'EL PRESTATARIO'}</strong><span>{personaQueFirma || 'Representante no registrado'}</span><span>{documentoFirmante}</span>{identidad.isRuc20 && <small>Por {identidad.name}</small>}</div>
          <div className="contrato-texto-firmante"><div className="contrato-texto-area-firma"/><div className="contrato-texto-linea"/><strong>LA ENTIDAD PRESTAMISTA</strong><span>{campoVerificado(datosFinanciera.representante)}</span><span>{campoVerificado(datosFinanciera.cargo)}</span><small>{campoVerificado(datosFinanciera.razonSocial)}</small></div>
        </div>
        <p className="contrato-texto-anexo"><strong>ANEXO:</strong> El cronograma de pagos del préstamo N.° {numero} se imprime desde la opción «Imprimir cronograma» del sistema y se adjunta a este contrato.</p>
        <p className="contrato-texto-aviso">Documento generado por Préstamo Castillo. Pendiente de la firma de las partes. El texto contractual debe ser aprobado jurídicamente antes de utilizarse en operaciones reales.</p>
        {esBorrador && <p className="contrato-texto-estado-borrador">BORRADOR — Existen datos pendientes de verificación. No usar como contrato definitivo ni para firma hasta completarlos.</p>}
      </div>
      <footer className="contrato-texto-pie">Préstamo Castillo · Gestión de créditos <span>Contrato N.° {numero}</span><span>Página 3 de 3</span></footer>
    </section>
  </article>;

  return <>
    <Modal title={`Contrato ${numero}`} modalClassName="contrato-texto-modal" close={onClose}>
      <div className="contrato-texto-vista">
        <p className="contrato-texto-ayuda">Para descargar el documento, pulsa «Imprimir / Guardar PDF» y elige «Guardar como PDF» en tu navegador.</p>
        <div className="contrato-texto-preview">{documento}</div>
        <div className="contrato-texto-acciones"><button type="button" className="secondary" onClick={onClose}>Volver</button><button type="button" className="primary" onClick={imprimirContrato}>Imprimir / Guardar PDF</button></div>
      </div>
    </Modal>
    {createPortal(documento, document.body)}
  </>;
}
