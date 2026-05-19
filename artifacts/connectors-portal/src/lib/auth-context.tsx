import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  connectorsApi,
  getConnectorToken,
  setConnectorToken,
  type ConnectorAccount,
} from "./connectorsApi";
import { SSO_BROADCAST_CHANNEL, broadcastLogout } from "./sso-sync";

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

  // Listen for SSO login/logout events from other tabs or portals
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SSO_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === "login") {
          if (event.data.connectorToken) {
            setConnectorToken(event.data.connectorToken);
          }
          // An admin userToken also grants connector portal access via passthrough.
          // getConnectorToken() falls back to siebert_token, so a re-load is sufficient.
          if (event.data.connectorToken || event.data.userToken) {
            void load();
          }
        } else if (event.data?.type === "logout") {
          setConnectorToken(null);
          setConnector(null);
        }
      };
    } catch {
      // BroadcastChannel not available
    }
    return () => {
      try { channel?.close(); } catch {}
    };
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
      broadcastLogout();
      window.location.href = "/login";
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
