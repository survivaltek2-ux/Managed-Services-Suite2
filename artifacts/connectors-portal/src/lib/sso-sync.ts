export const SSO_BROADCAST_CHANNEL = "siebert_sso";

export interface SsoTokens {
  userToken?: string | null;
  partnerToken?: string | null;
  connectorToken?: string | null;
}

export function storeAllTokens(tokens: SsoTokens): void {
  if (tokens.userToken) localStorage.setItem("siebert_token", tokens.userToken);
  else if (tokens.userToken === null) localStorage.removeItem("siebert_token");

  if (tokens.partnerToken) localStorage.setItem("partner_token", tokens.partnerToken);
  else if (tokens.partnerToken === null) localStorage.removeItem("partner_token");

  if (tokens.connectorToken) localStorage.setItem("connector_token", tokens.connectorToken);
  else if (tokens.connectorToken === null) localStorage.removeItem("connector_token");
}

export function broadcastLogin(tokens: SsoTokens): void {
  storeAllTokens(tokens);
  try {
    const channel = new BroadcastChannel(SSO_BROADCAST_CHANNEL);
    channel.postMessage({ type: "login", ...tokens });
    channel.close();
  } catch {
    // BroadcastChannel may not be available in all environments
  }
}

export function broadcastLogout(): void {
  localStorage.removeItem("siebert_token");
  localStorage.removeItem("partner_token");
  localStorage.removeItem("connector_token");
  localStorage.removeItem("siebert_user");
  try {
    const channel = new BroadcastChannel(SSO_BROADCAST_CHANNEL);
    channel.postMessage({ type: "logout" });
    channel.close();
  } catch {
    // BroadcastChannel may not be available in all environments
  }
}
