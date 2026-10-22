import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/api';
import type { NationalClient } from './NationalClientSearch';

type DocumentType = 'DNI' | 'RUC10' | 'RUC20';
type Representative = {
  nombre?: string; cargo?: string; desde?: string;
  tipo_documento?: string; numero_documento?: string;
};
type Company = {
  ruc: string; razon_social?: string; estado?: string; condicion?: string;
  domicilio?: { direccion?: string }; representantes?: Representative[];
};
export type LinkedDocument = {
  id?: number; documentType: 'RUC10' | 'RUC20'; documentNumber: string; clientId: number;
  responsibleDni: string; responsibleName: string; borrowerName: string;
  representativeName?: string; representativeRole?: string; checkedAt: string;
};
type Props = {
  canRegister: boolean;
  onNewDni: (dni: string) => void;
  onExistingDni: (client: NationalClient) => void;
  onLinked: (link: LinkedDocument) => void;
};

/** El DNI solo se autocompleta cuando el proveedor entrega ocho dígitos reales. */
function publishedDni(rep?: Representative): string {
  if (!rep || (rep.tipo_documento && rep.tipo_documento.toUpperCase() !== 'DNI')) return '';
  const number = rep.numero_documento?.trim() ?? '';
  return /^[0-9]{8}$/.test(number) ? number : '';
}

/** Alta integrada: empresa + DNI nuevo/existente + vínculo, sin otro formulario de registro. */
export function RucLookup({ canRegister, onNewDni, onExistingDni, onLinked }: Props) {
  const [kind, setKind] = useState<DocumentType>('DNI');
  const [document, setDocument] = useState('');
  const [company, setCompany] = useState<Company>();
  const [saved, setSaved] = useState<LinkedDocument>();
  const [person, setPerson] = useState<NationalClient>();
  const [dniNotFound, setDniNotFound] = useState(false);
  const [selectedRepresentative, setSelectedRepresentative] = useState('');
  const [responsibleDni, setResponsibleDni] = useState('');
  const [documentsReviewed, setDocumentsReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = kind === 'DNI' ? /^[0-9]{8}$/.test(document)
    : new RegExp(`^${kind === 'RUC10' ? '10' : '20'}[0-9]{9}$`).test(document);
  const rep = company?.representantes?.find(row => row.nombre === selectedRepresentative);
  const knownDni = publishedDni(rep);
  const canOnboard = canRegister && !!company && /^[0-9]{8}$/.test(responsibleDni)
    && (kind === 'RUC10' || !!selectedRepresentative) && documentsReviewed && !registerBusy;

  function clearResult() {
    setCompany(undefined); setSaved(undefined); setPerson(undefined); setDniNotFound(false);
    setSelectedRepresentative(''); setResponsibleDni(''); setDocumentsReviewed(false); setError('');
  }
  function selectType(value: DocumentType) { setKind(value); setDocument(''); clearResult(); }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); clearResult();
    try {
      if (kind === 'DNI') {
        setPerson(await api<NationalClient>(`/clients/national?dni=${encodeURIComponent(document)}`));
      } else {
        try {
          setSaved(await api<LinkedDocument>(`/ruc/links/${document}`));
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
          const data = await api<Company>(`/ruc/${document}`);
          setCompany(data);
          if (kind === 'RUC10') setResponsibleDni(document.slice(2, 10));
        }
      }
    } catch (cause) {
      if (kind === 'DNI' && cause instanceof ApiError && cause.status === 404) setDniNotFound(true);
      else setError(cause instanceof Error ? cause.message : 'No se pudo consultar el documento.');
    } finally { setBusy(false); }
  }

  async function registerAndContinue() {
    if (!canOnboard || !company) return;
    setRegisterBusy(true); setError('');
    try {
      const linked = await api<LinkedDocument>('/ruc/onboard', {
        method: 'POST',
        body: JSON.stringify({
          documentType: kind, documentNumber: company.ruc, responsibleDni,
          representativeName: kind === 'RUC20' ? selectedRepresentative : null,
          documentsReviewed: true,
        }),
      });
      // La API verifica identidad, reutiliza el DNI si existe, registra empresa y vincula.
      // Solo después de una respuesta exitosa navega a la evaluación; no crea crédito aún.
      onLinked(linked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar y vincular el documento.');
    } finally { setRegisterBusy(false); }
  }

  return <section className="panel ruc-lookup document-lookup">
    <div className="panel-head"><div><span className="eyebrow">CONSULTA DE IDENTIDAD</span><h3>Buscar persona o empresa</h3><p className="muted">Consulta un documento y continúa directamente a Nuevo préstamo.</p></div></div>
    <form className="document-lookup-form" onSubmit={lookup}>
      <label htmlFor="document-kind">Tipo de documento<select id="document-kind" value={kind} onChange={e => selectType(e.target.value as DocumentType)}>
        <option value="DNI">DNI — Persona natural</option>
        <option value="RUC10">RUC 10 — Persona con negocio</option>
        <option value="RUC20">RUC 20 — Empresa</option>
      </select></label>
      <label htmlFor="document-number">Número de {kind === 'DNI' ? 'DNI' : 'RUC'}<input id="document-number" value={document} inputMode="numeric" autoComplete="off" maxLength={kind === 'DNI' ? 8 : 11} placeholder={kind === 'DNI' ? '8 dígitos' : '11 dígitos'} onChange={e => { if (/^[0-9]{0,11}$/.test(e.target.value)) { setDocument(e.target.value); clearResult(); } }} /></label>
      <button className="primary" disabled={!valid || busy}>{busy ? 'Consultando…' : 'Consultar datos →'}</button>
    </form>

    {error && <p className="dni-status error" role="alert">{error}</p>}
    {person && <div className="document-result" role="status"><span className="tag">Cliente existente</span><h4>{person.names} {person.surnames}</h4><p>DNI {person.dni} · Registrado en {person.agency}</p><p>Capital original activo: S/ {person.activeOriginalCapital.toLocaleString('es-PE')} · Disponible: S/ {person.availableOriginalCapital.toLocaleString('es-PE')}</p>
      {person.hasOverdueInstallments && <p className="dni-status error">Tiene cuotas vencidas.</p>}
      {canRegister && <button className="primary" type="button" disabled={!person.active || person.hasOverdueInstallments || person.availableOriginalCapital < 1} onClick={() => onExistingDni(person)}>Solicitar nuevo préstamo →</button>}</div>}
    {dniNotFound && <div className="document-result"><h4>DNI no registrado</h4><p>La consulta de identidad permitirá completar sus datos automáticamente.</p>{canRegister && <button type="button" className="primary" onClick={() => onNewDni(document)}>Registrar DNI →</button>}</div>}

    {saved && <div className="document-result"><span className="tag">Documento vinculado</span><h4>{saved.borrowerName}</h4><p>{saved.documentType} {saved.documentNumber} · Responsable DNI {saved.responsibleDni}</p>
      {saved.representativeName && <p>Representante: {saved.representativeName} · {saved.representativeRole || 'Cargo no indicado'}</p>}
      <p className="field-hint">Vínculo registrado el {new Date(saved.checkedAt).toLocaleDateString('es-PE')}; las facultades de representación se acreditan documentalmente.</p>
      {canRegister && <button className="primary" type="button" onClick={() => onLinked(saved)}>Continuar con préstamo {saved.documentType === 'RUC20' ? 'RUC 20' : 'RUC 10'} →</button>}
    </div>}

    {company && <div className="document-result"><span className="tag">RUC consultado</span><h4>{company.razon_social || 'Razón social no disponible'}</h4><p>RUC {company.ruc} · {company.estado || 'Sin estado'}{company.condicion ? ` · ${company.condicion}` : ''}</p>
      {company.domicilio?.direccion && <details><summary>Ver domicilio fiscal</summary><p>{company.domicilio.direccion}</p></details>}
      {canRegister && <details className="representative-details" open>
        <summary>{kind === 'RUC20' ? `Elegir representante (${company.representantes?.length ?? 0})` : 'Titular del RUC 10'}</summary>
        {kind === 'RUC20' && <div className="representative-choices">{company.representantes?.length ? company.representantes.map((row, index) =>
          <label key={`${row.nombre}-${index}`} className="representative-choice">
            <input type="radio" name="legal-representative" checked={selectedRepresentative === row.nombre} onChange={() => { setSelectedRepresentative(row.nombre ?? ''); setResponsibleDni(publishedDni(row)); setDocumentsReviewed(false); setError(''); }} />
            <span><b>{row.nombre || 'Sin nombre'}</b><small>{row.cargo || 'Cargo no disponible'}{row.desde ? ` · Desde ${row.desde}` : ''}</small></span>
          </label>
        ) : <p>El proveedor no publicó representantes. No se puede registrar una vinculación sin identificar al responsable.</p>}</div>}
        <label className="ruc-dni-field">DNI del {kind === 'RUC20' ? 'representante elegido' : 'titular'}
          <input value={responsibleDni} inputMode="numeric" maxLength={8} readOnly={kind === 'RUC10' || Boolean(knownDni)} placeholder={kind === 'RUC20' && !knownDni ? 'DNI no publicado: 8 dígitos' : '8 dígitos'} onChange={e => { if (/^[0-9]{0,8}$/.test(e.target.value)) { setResponsibleDni(e.target.value); setDocumentsReviewed(false); } }} /></label>
        <p className="field-hint">{kind === 'RUC10'
          ? 'El DNI se obtiene del RUC 10 y se comprueba automáticamente con el servicio de identidad.'
          : knownDni ? 'DNI proporcionado por la consulta. Se comprobará automáticamente la identidad al registrar.'
            : 'El proveedor ocultó el DNI. Introduce los ocho dígitos del documento presentado; el sistema lo verificará automáticamente.'}</p>
        <label className="ruc-acknowledgement"><input type="checkbox" checked={documentsReviewed} onChange={e => setDocumentsReviewed(e.target.checked)} />
          <span>He comprobado el DNI y la documentación {kind === 'RUC20' ? 'que acredita las facultades aplicables del representante' : 'del titular'}.</span></label>
        <button className="primary" type="button" disabled={!canOnboard} onClick={() => void registerAndContinue()}>{registerBusy
          ? 'Verificando y registrando…' : `Registrar y continuar con préstamo ${kind === 'RUC20' ? 'RUC 20' : 'RUC 10'} →`}</button>
        <p className="field-hint">El sistema reutilizará el DNI si ya existe o lo registrará si es nuevo. No se guardará un préstamo hasta confirmarlo en Nuevo préstamo. Los datos de contacto faltantes deberán completarse antes de formalizar el contrato.</p>
      </details>}
      {!canRegister && <p>Solo los asesores pueden registrar y vincular documentos.</p>}
    </div>}
  </section>;
}
