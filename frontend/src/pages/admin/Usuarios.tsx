import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/api';
import type { Agency, AppUser } from '../../types/models';
import './Usuarios.css';
export function Usuarios({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [users, setUsers] = useState<AppUser[]>([]); const [agencies, setAgencies] = useState<Agency[]>([]);
  const load = useCallback(async () => { try { const [u, a] = await Promise.all([api<AppUser[]>('/admin/users'), api<Agency[]>('/admin/agencies')]); setUsers(u); setAgencies(a); } catch (e) { notify((e as Error).message, true); } }, [notify]);
  // oxlint-disable-next-line react/set-state-in-effect -- Load the page data after mount.
  useEffect(() => { void load(); }, [load]);
  return <div className="page-admin"><section className="panel"><div className="panel-head"><h3>Cuentas y asignación a sedes</h3></div><p className="muted">Cada sede conserva su asesor asignado. La cuenta ADMIN puede consultar todo el sistema.</p><div className="table-scroll"><table><thead><tr><th>Usuario</th><th>Perfil</th><th>Sede asignada</th><th>Estado</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td><b>{u.username}</b></td><td>{u.role === 'ADMIN' ? 'Administrador general' : 'Asesor'}</td><td>{u.agency}</td><td><span className={`tag${u.enabled ? '' : ' warn'}`}>{u.enabled ? 'Activo' : 'Inactivo'}</span></td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-head"><h3>Sedes</h3></div><div className="cards">{agencies.map(a => <article className="card" key={a.id}><div className="metric-label">Sede</div><div className="metric agency-name">{a.name}</div><span className="tag">{a.enabled ? 'Habilitada' : 'Deshabilitada'}</span></article>)}</div></section></div>;
}
