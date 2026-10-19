import { createContext } from 'react';
import type { Me } from '../types/models';

export type AuthState = { me: Me | null; login: (me: Me, credentials: string) => void; logout: () => void };
export const AuthContext = createContext<AuthState | null>(null);
