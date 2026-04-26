import { DaemonClient } from "@server/client/daemon-client";
import type { DaemonClientConfig } from "@server/client/daemon-client";
import type { HostConnection } from "@/types/host-connection";
import { getOrCreateClientId } from "./client-id";
import { resolveAppVersion } from "./app-version";
import {
  DAEMON_AUTH_TOKEN_QUERY_PARAM,
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  parseDaemonHttpEndpoint,
} from "./daemon-endpoints";
import {
  buildLocalDaemonTransportUrl,
  createDesktopLocalDaemonTransportFactory,
} from "@/desktop/daemon/desktop-daemon-transport";
import { isDev, isWeb } from "@/constants/platform";

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickBestReason(reason: string | null, lastError: string | null): string {
  const genericReason =
    reason &&
    (reason.toLowerCase() === "transport error" || reason.toLowerCase() === "transport closed");
  const genericLastError =
    lastError &&
    (lastError.toLowerCase() === "transport error" ||
      lastError.toLowerCase() === "transport closed" ||
      lastError.toLowerCase() === "unable to connect");

  if (genericReason && lastError && !genericLastError) {
    return lastError;
  }
  if (reason) return reason;
  if (lastError) return lastError;
  return "Unable to connect";
}

export class DaemonConnectionTestError extends Error {
  reason: string | null;
  lastError: string | null;

  constructor(message: string, details: { reason: string | null; lastError: string | null }) {
    super(message);
    this.name = "DaemonConnectionTestError";
    this.reason = details.reason;
    this.lastError = details.lastError;
  }
}

type LocalNetworkFetchInit = RequestInit & { targetAddressSpace?: "local" };

function isHttpsBrowserPage(): boolean {
  return (
    isWeb &&
    typeof window !== "undefined" &&
    typeof window.location?.protocol === "string" &&
    window.location.protocol === "https:"
  );
}

function isLocalOrPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) return true;

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return false;
    }
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168)
    );
  }

  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:")
  );
}

async function queryLocalNetworkPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined") return null;
  const permissions = navigator.permissions as
    | (Permissions & {
        query: (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;
      })
    | undefined;
  if (!permissions?.query) return null;

  try {
    const result = await permissions.query({ name: "local-network" as PermissionName });
    return result.state;
  } catch {
    return null;
  }
}

function buildLocalNetworkAccessError(state: PermissionState | null): DaemonConnectionTestError {
  const stateCopy =
    state === "denied"
      ? "The browser has denied Local Network Access for this site."
      : "The browser needs Local Network Access permission for this site.";
  const message = `${stateCopy} Allow Local Network Access in the browser permission prompt or site settings, then try again.`;
  return new DaemonConnectionTestError(message, { reason: message, lastError: null });
}

async function probeBrowserLocalNetworkAccess(endpoint: string, token?: string): Promise<void> {
  if (!isHttpsBrowserPage() || typeof fetch !== "function") return;

  const parsed = parseDaemonHttpEndpoint(endpoint);
  if (parsed.protocol !== "http" || !isLocalOrPrivateHost(parsed.host)) return;

  const url = new URL("/api/health", endpoint);
  if (token) {
    url.searchParams.set(DAEMON_AUTH_TOKEN_QUERY_PARAM, token);
  }

  const init: LocalNetworkFetchInit = {
    method: "GET",
    mode: "cors",
    credentials: "include",
    cache: "no-store",
    // Chrome 142+ 需要公网 HTTPS 页面显式声明本次请求会访问本地网络，
    // 否则本地 daemon 请求会在进入 WebSocket 之前被浏览器拦截。
    targetAddressSpace: "local",
  };

  try {
    const response = await fetch(url.toString(), init);
    if (response.ok) return;

    const message =
      response.status === 401
        ? "Invalid daemon token. Check the token and try again."
        : `Daemon health check failed with HTTP ${response.status}.`;
    throw new DaemonConnectionTestError(message, { reason: message, lastError: null });
  } catch (error) {
    if (error instanceof DaemonConnectionTestError) throw error;
    throw buildLocalNetworkAccessError(await queryLocalNetworkPermissionState());
  }
}

export async function buildClientConfig(
  connection: HostConnection,
  serverId?: string,
): Promise<DaemonClientConfig> {
  const clientId = await getOrCreateClientId();
  const localTransportFactory = createDesktopLocalDaemonTransportFactory();
  const base = {
    clientId,
    clientType: "mobile" as const,
    appVersion: resolveAppVersion() ?? undefined,
    suppressSendErrors: true,
    reconnect: { enabled: false },
    ...(isDev ? { runtimeMetricsIntervalMs: 10_000 } : {}),
    ...((connection.type === "directSocket" || connection.type === "directPipe") &&
    localTransportFactory
      ? { transportFactory: localTransportFactory }
      : {}),
  };

  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return {
      ...base,
      url: buildLocalDaemonTransportUrl({
        transportType: connection.type === "directSocket" ? "socket" : "pipe",
        transportPath: connection.path,
      }),
    };
  }

  if (connection.type === "directTcp") {
    return {
      ...base,
      url: buildDaemonWebSocketUrl(connection.endpoint, connection.token),
    };
  }

  if (!serverId) {
    throw new Error("serverId is required to probe a relay connection");
  }

  return {
    ...base,
    url: buildRelayWebSocketUrl({
      endpoint: connection.relayEndpoint,
      serverId,
    }),
    e2ee: { enabled: true, daemonPublicKeyB64: connection.daemonPublicKeyB64 },
  };
}

export function connectAndProbe(
  config: DaemonClientConfig,
  timeoutMs: number,
): Promise<{ client: DaemonClient; serverId: string; hostname: string | null }> {
  const client = new DaemonClient(config);

  return new Promise<{ client: DaemonClient; serverId: string; hostname: string | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        void client.close().catch(() => undefined);
        reject(
          new DaemonConnectionTestError("Connection timed out", {
            reason: "Connection timed out",
            lastError: client.lastError ?? null,
          }),
        );
      }, timeoutMs);

      void client
        .connect()
        .then(() => {
          clearTimeout(timer);
          const serverInfo = client.getLastServerInfoMessage();
          if (!serverInfo) {
            void client.close().catch(() => undefined);
            reject(
              new DaemonConnectionTestError("Missing server info message", {
                reason: "Missing server info message",
                lastError: client.lastError ?? null,
              }),
            );
            return;
          }
          resolve({
            client,
            serverId: serverInfo.serverId,
            hostname: serverInfo.hostname,
          });
          return;
        })
        .catch((error) => {
          clearTimeout(timer);
          const reason = normalizeNonEmptyString(
            error instanceof Error ? error.message : String(error),
          );
          const lastError = normalizeNonEmptyString(client.lastError);
          const message = pickBestReason(reason, lastError);
          void client.close().catch(() => undefined);
          reject(new DaemonConnectionTestError(message, { reason, lastError }));
        });
    },
  );
}

interface ProbeOptions {
  serverId?: string;
  timeoutMs?: number;
}

function resolveTimeout(connection: HostConnection, options?: ProbeOptions): number {
  if (options?.timeoutMs) return options.timeoutMs;
  return connection.type === "relay" ? 10_000 : 6_000;
}

export async function connectToDaemon(
  connection: HostConnection,
  options?: ProbeOptions,
): Promise<{ client: DaemonClient; serverId: string; hostname: string | null }> {
  if (connection.type === "directTcp") {
    await probeBrowserLocalNetworkAccess(connection.endpoint, connection.token);
  }
  const config = await buildClientConfig(connection, options?.serverId);
  return connectAndProbe(config, resolveTimeout(connection, options));
}
