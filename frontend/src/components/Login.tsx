import { useState, type FormEvent } from 'react';
import { api, setCredentials } from '../api/api';
import type { Me } from '../types/models';
import './Login.css';

export function Login({ onLogin }: { onLogin: (me: Me, auth: string) => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); const auth = btoa(unescape(encodeURIComponent(`${username}:${password}`))); setCredentials(auth); try { const me = await api<Me>('/me'); onLogin(me, auth); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.'); } }
  return <main id="login" className="login-wrap"><section className="login-card"><div className="login-brand"><span className="brand-mark">F</span><span><b>Financiera</b><small>GESTIÓN DE CRÉDITOS</small></span></div><p className="eyebrow">PORTAL DE ACCESO</p><h1>Bienvenido</h1><p className="muted">Ingresa tus credenciales para acceder de forma segura a la plataforma.</p><form onSubmit={submit}><label>Usuario<input required autoComplete="username" placeholder="Ingresa tu usuario" value={username} onChange={e => setUsername(e.target.value)} /></label><label>Contraseña<input type="password" required autoComplete="current-password" placeholder="Ingresa tu contraseña" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary full login-submit">Iniciar sesión <span>→</span></button><p className="error" role="alert">{error}</p></form><p className="login-secure"><span>●</span> Acceso protegido para personal autorizado</p></section><footer className="login-footer">Financiera · Plataforma de gestión</footer></main>;
}
