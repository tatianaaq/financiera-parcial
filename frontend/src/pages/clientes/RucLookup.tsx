import { useState, type FormEvent } from 'react';
import { api } from '../../api/api';

type Representative = { nombre?: string; cargo?: string; desde?: string };
type Company = { ruc: string; clase?: string; razon_social?: string; nombre_comercial?: string;
  estado?: string; condicion?: string; domicilio?: { direccion?: string; departamento?: string; provincia?: string; distrito?: string };
  representantes?: Representative[] };

export function RucLookup() {
  const [ruc, setRuc] = useState(''); const [result, setResult] = useState<Company>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function lookup(event: FormEvent) {
    event.preventDefault(); if (!/^(10|20)\d{9}$/.test(ruc) || busy) return;
    setBusy(true); setError(''); setResult(undefined);
    try { setResult(await api<Company>(`/ruc/${encodeURIComponent(ruc)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo consultar el RUC.'); }
    finally { setBusy(false); }
  }
  return <section className="panel ruc-lookup"><div className="panel-head"><div>
    <span className="eyebrow">CONSULTA DE RUC 10 / 20</span><h3>Verificar empresa o persona con RUC</h3>
    <p className="muted">Consulta el padrón de ElRUC.pe y los representantes de RUC 20, cuando estén publicados. Consulta informativa, todavía no crea clientes empresariales.</p>
  </div></div><form className="national-client-form" onSubmit={lookup}><label htmlFor="ruc-search">RUC (11 dígitos)</label>
    <div className="national-client-form-row"><input id="ruc-search" value={ruc} inputMode="numeric" maxLength={11} placeholder="10… o 20…" onChange={e=> { if (/^\d{0,11}$/.test(e.target.value)) {setRuc(e.target.value);setResult(undefined);setError('');}}}/>
    <button className="secondary" type="submit" disabled={busy || !/^(10|20)\d{9}$/.test(ruc)}>{busy?'Consultando…':'Consultar RUC'}</button></div>
  </form>{error&&<p role="alert" className="national-client-error">{error}</p>}{result&&<div className="ruc-result"><h4>{result.razon_social || 'Sin razón social'}</h4>
    <p>RUC: {result.ruc} · {result.clase==='persona_natural'?'Persona natural':'Empresa'} · {result.estado || 'Estado no disponible'} · {result.condicion || 'Condición no disponible'}</p>
    {result.nombre_comercial&&<p>Nombre comercial: {result.nombre_comercial}</p>}
    {result.domicilio?.direccion&&<p>Domicilio fiscal: {result.domicilio.direccion}</p>}
    {result.ruc.startsWith('20')&&<><h4>Representantes registrados</h4>{result.representantes?.length ? <ul>{result.representantes.map((rep,i)=><li key={i}>{rep.nombre || 'Sin nombre'} — {rep.cargo || 'Cargo no disponible'} {rep.desde ? `(desde ${rep.desde})`:''}</li>)}</ul> : <p>No hay representantes disponibles en esta ficha.</p>}</>}
  </div>}</section>;
}
