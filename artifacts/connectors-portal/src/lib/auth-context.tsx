import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  connectorsApi,
  getConnectorToken,
  setConnectorToken,
  type ConnectorAccount,
} from "./connectorsApi";

interface AuthContextValue {
  connector: ConnectorAccount | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, connector: ConnectorAccount) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [connector, setConnector] = useState<ConnectorAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    const token = getConnectorToken();
    if (!token) {
      setConnector(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await connectorsApi.me();
      setConnector(me.connector);
    } catch {
      setConnectorToken(null);
      setConnector(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const value: AuthContextValue = {
    connector,
    isLoading,
    isAuthenticated: !!connector,
    login: (token, c) => {
      setConnectorToken(token);
      setConnector(c);
    },
    logout: () => {
      setConnectorToken(null);
      setConnector(null);
    },
    refresh: load,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
