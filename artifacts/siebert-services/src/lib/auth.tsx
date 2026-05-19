import React, { createContext, useContext, useState, useEffect } from "react";
import { User } from "@workspace/api-client-react";
import { SSO_BROADCAST_CHANNEL, broadcastLogout } from "./sso-sync";

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("siebert_token"));
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("siebert_user");
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (token) localStorage.setItem("siebert_token", token);
    else localStorage.removeItem("siebert_token");

    if (user) localStorage.setItem("siebert_user", JSON.stringify(user));
    else localStorage.removeItem("siebert_user");
  }, [token, user]);

  // Listen for SSO login/logout events from other tabs or portals
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SSO_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === "login" && event.data.userToken) {
          setToken(event.data.userToken);
          localStorage.setItem("siebert_token", event.data.userToken);
        } else if (event.data?.type === "logout") {
          setToken(null);
          setUser(null);
          localStorage.removeItem("siebert_token");
          localStorage.removeItem("siebert_user");
        }
      };
    } catch {
      // BroadcastChannel not available
    }
    return () => {
      try { channel?.close(); } catch {}
    };
  }, []);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    broadcastLogout();
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
