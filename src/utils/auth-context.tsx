import type { ComponentChildren } from 'preact';
import { createContext } from 'preact/compat';
import { useContext } from 'preact/hooks';

const AuthContext = createContext<boolean>(false);

export function AuthProvider({
  children,
  value,
}: {
  children?: ComponentChildren;
  value: boolean;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
