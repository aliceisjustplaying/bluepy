import type { ReactNode } from 'react';
import { createContext } from 'react';
import { use } from 'react';

const AuthContext = createContext<boolean>(false);
export const AUTH_CHANGED_EVENT = 'bluepy:auth-changed';

export function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

export function AuthProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value: boolean;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return use(AuthContext);
}
