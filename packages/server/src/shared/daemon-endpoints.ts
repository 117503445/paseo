export interface HostPortParts {
  host: string;
  port: number;
  isIpv6: boolean;
}

export type DaemonHttpProtocol = "http" | "https";

export interface DaemonHttpEndpointParts extends HostPortParts {
  protocol: DaemonHttpProtocol;
  username: string;
  password: string;
  hasExplicitPort: boolean;
}

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export type RelayRole = "server" | "client";
export type RelayProtocolVersion = "1" | "2";

export const CURRENT_RELAY_PROTOCOL_VERSION: RelayProtocolVersion = "2";

export function normalizeRelayProtocolVersion(
  value: unknown,
  fallback: RelayProtocolVersion = CURRENT_RELAY_PROTOCOL_VERSION,
): RelayProtocolVersion {
  if (value == null) {
    return fallback;
  }

  let normalized = "";
  if (typeof value === "string") {
    normalized = value.trim();
  } else if (typeof value === "number") {
    normalized = String(value);
  }
  if (!normalized) {
    return fallback;
  }
  if (normalized === "1" || normalized === "2") {
    return normalized;
  }
  throw new Error('Relay version must be "1" or "2"');
}

function parsePort(portStr: string, context: string): number {
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${context}: port must be between 1 and 65535`);
  }
  return port;
}

export function parseHostPort(input: string): HostPortParts {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Host is required");
  }

  // IPv6：[::1]:6767
  if (trimmed.startsWith("[")) {
    const match = trimmed.match(/^\[([^\]]+)\]:(\d{1,5})$/);
    if (!match) {
      throw new Error("Invalid host:port (expected [::1]:6767)");
    }
    const host = match[1].trim();
    if (!host) throw new Error("Host is required");
    const port = parsePort(match[2], "Invalid host:port");
    return { host, port, isIpv6: true };
  }

  const match = trimmed.match(/^(.+):(\d{1,5})$/);
  if (!match) {
    throw new Error("Invalid host:port (expected localhost:6767)");
  }
  const host = match[1].trim();
  if (!host) throw new Error("Host is required");
  const port = parsePort(match[2], "Invalid host:port");
  return { host, port, isIpv6: false };
}

export function normalizeHostPort(input: string): string {
  const { host, port, isIpv6 } = parseHostPort(input);
  return isIpv6 ? `[${host}]:${port}` : `${host}:${port}`;
}

export function normalizeLoopbackToLocalhost(endpoint: string): string {
  const { host, port, isIpv6 } = parseHostPort(endpoint);
  if (host === "127.0.0.1" || (!isIpv6 && host === "0.0.0.0")) {
    return `localhost:${port}`;
  }
  if (isIpv6 && (host === "::1" || host === "::")) {
    return `localhost:${port}`;
  }
  return endpoint;
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function normalizeDirectHost(host: string): { host: string; isIpv6: boolean } {
  const normalizedHost = stripIpv6Brackets(host.trim());
  const isIpv6 = normalizedHost.includes(":");
  if (
    normalizedHost === "127.0.0.1" ||
    (!isIpv6 && normalizedHost === "0.0.0.0") ||
    (isIpv6 && (normalizedHost === "::1" || normalizedHost === "::"))
  ) {
    return { host: "localhost", isIpv6: false };
  }
  return { host: normalizedHost, isIpv6 };
}

function defaultPortForProtocol(protocol: DaemonHttpProtocol): number {
  return protocol === "https" ? 443 : 80;
}

function encodeUserInfoPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeUserInfoPart(value: string): string {
  return decodeURIComponent(value);
}

function renderDaemonHttpEndpoint(parts: DaemonHttpEndpointParts): string {
  const protocol = parts.protocol;
  const hostPart = parts.isIpv6 ? `[${parts.host}]` : parts.host;
  const portPart =
    parts.hasExplicitPort || parts.port !== defaultPortForProtocol(protocol)
      ? `:${parts.port}`
      : "";
  const authPart =
    parts.username || parts.password
      ? `${encodeUserInfoPart(parts.username)}:${encodeUserInfoPart(parts.password)}@`
      : "";
  return `${protocol}://${authPart}${hostPart}${portPart}`;
}

export function parseDaemonHttpEndpoint(input: string): DaemonHttpEndpointParts {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Daemon URL is required");
  }

  if (!trimmed.includes("://")) {
    const { host, port, isIpv6 } = parseHostPort(trimmed);
    const normalized = normalizeDirectHost(isIpv6 ? `[${host}]` : host);
    const protocol = port === 443 ? "https" : "http";
    return {
      protocol,
      host: normalized.host,
      port,
      isIpv6: normalized.isIpv6,
      username: "",
      password: "",
      hasExplicitPort: port !== defaultPortForProtocol(protocol),
    };
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Daemon URL protocol must be http or https");
  }
  if (!parsed.hostname) {
    throw new Error("Daemon URL host is required");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Daemon URL must not include a path, query, or fragment");
  }

  const protocol = parsed.protocol === "https:" ? "https" : "http";
  const port = parsed.port
    ? parsePort(parsed.port, "Invalid daemon URL")
    : defaultPortForProtocol(protocol);
  const normalized = normalizeDirectHost(parsed.hostname);

  return {
    protocol,
    host: normalized.host,
    port,
    isIpv6: normalized.isIpv6,
    username: parsed.username ? decodeUserInfoPart(parsed.username) : "",
    password: parsed.password ? decodeUserInfoPart(parsed.password) : "",
    hasExplicitPort: parsed.port.length > 0,
  };
}

export function normalizeDaemonHttpEndpoint(input: string): string {
  return renderDaemonHttpEndpoint(parseDaemonHttpEndpoint(input));
}

export function redactDaemonHttpEndpointCredentials(input: string): string {
  const parts = parseDaemonHttpEndpoint(input);
  if (!parts.username && !parts.password) {
    return renderDaemonHttpEndpoint(parts);
  }
  return renderDaemonHttpEndpoint({
    ...parts,
    password: parts.password ? "****" : "",
  });
}

export function extractBasicAuthCredentialsFromEndpoint(
  input: string,
): BasicAuthCredentials | null {
  const { username, password } = parseDaemonHttpEndpoint(input);
  if (!username && !password) {
    return null;
  }
  return { username, password };
}

export function deriveLabelFromEndpoint(endpoint: string): string {
  try {
    const { host } = parseDaemonHttpEndpoint(endpoint);
    return host || "Unnamed Host";
  } catch {
    return "Unnamed Host";
  }
}

function shouldUseSecureWebSocket(port: number): boolean {
  return port === 443;
}

export function buildDaemonWebSocketUrl(endpoint: string): string {
  const {
    protocol: httpProtocol,
    host,
    port,
    isIpv6,
    username,
    password,
    hasExplicitPort,
  } = parseDaemonHttpEndpoint(endpoint);
  const protocol = httpProtocol === "https" ? "wss" : "ws";
  const hostPart = isIpv6 ? `[${host}]` : host;
  const authPart =
    username || password ? `${encodeUserInfoPart(username)}:${encodeUserInfoPart(password)}@` : "";
  const portPart =
    hasExplicitPort || port !== defaultPortForProtocol(httpProtocol) ? `:${port}` : "";
  return new URL(`${protocol}://${authPart}${hostPart}${portPart}/ws`).toString();
}

export function buildRelayWebSocketUrl(params: {
  endpoint: string;
  serverId: string;
  role: RelayRole;
  /**
   * 每条连接的路由标识，用于 daemon 打开服务端数据 socket。
   * 客户端不应提供该值，relay 会在连接时分配路由 ID。
   */
  connectionId?: string;
  version?: RelayProtocolVersion | 1 | 2;
}): string {
  const { host, port, isIpv6 } = parseHostPort(params.endpoint);
  const protocol = shouldUseSecureWebSocket(port) ? "wss" : "ws";
  const hostPart = isIpv6 ? `[${host}]` : host;
  const url = new URL(`${protocol}://${hostPart}:${port}/ws`);
  url.searchParams.set("serverId", params.serverId);
  url.searchParams.set("role", params.role);
  url.searchParams.set("v", normalizeRelayProtocolVersion(params.version));
  if (params.connectionId) {
    url.searchParams.set("connectionId", params.connectionId);
  }
  return url.toString();
}

export function extractHostPortFromWebSocketUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Invalid WebSocket URL protocol");
  }
  if (parsed.pathname.replace(/\/+$/, "") !== "/ws") {
    throw new Error("Invalid WebSocket URL (expected /ws path)");
  }

  const host = parsed.hostname;
  let port: number;
  if (parsed.port) {
    port = Number(parsed.port);
  } else if (parsed.protocol === "wss:") {
    port = 443;
  } else {
    port = 80;
  }
  if (!host) {
    throw new Error("Invalid WebSocket URL (missing hostname)");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid WebSocket URL (invalid port)");
  }

  const isIpv6 = host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
  return isIpv6 ? `[${host}]:${port}` : `${host}:${port}`;
}

export function isRelayClientWebSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("role") === "client" && parsed.searchParams.has("serverId");
  } catch {
    return false;
  }
}
