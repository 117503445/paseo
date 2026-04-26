import {
  extractBasicAuthCredentialsFromEndpoint,
  parseDaemonHttpEndpoint,
} from "@server/shared/daemon-endpoints";
import type { WorkspaceScriptPayload } from "@server/shared/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";

export interface ResolvedWorkspaceScriptLink {
  openUrl: string | null;
  labelUrl: string | null;
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  return (
    normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1"
  );
}

function buildDirectServiceUrl(endpoint: string, port: number): string | null {
  try {
    const { host, isIpv6 } = parseDaemonHttpEndpoint(endpoint);
    const base = isIpv6 ? `[${host}]` : host;
    return `http://${base}:${port}`;
  } catch {
    return null;
  }
}

function buildProxyOpenUrl(proxyUrl: string, endpoint: string): string {
  const credentials = extractBasicAuthCredentialsFromEndpoint(endpoint);
  if (!credentials) {
    return proxyUrl;
  }

  try {
    const url = new URL(proxyUrl);
    url.username = credentials.username;
    url.password = credentials.password;
    return url.toString();
  } catch {
    return proxyUrl;
  }
}

export function resolveWorkspaceScriptLink(input: {
  script: WorkspaceScriptPayload;
  activeConnection: ActiveConnection | null;
}): ResolvedWorkspaceScriptLink {
  const { script, activeConnection } = input;
  if (script.type !== "service" || script.lifecycle !== "running") {
    return { openUrl: null, labelUrl: null };
  }

  if (!activeConnection) {
    return { openUrl: null, labelUrl: script.proxyUrl };
  }

  if (activeConnection.type === "relay") {
    return { openUrl: null, labelUrl: script.proxyUrl };
  }

  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return { openUrl: script.proxyUrl, labelUrl: script.proxyUrl };
  }

  try {
    const { host } = parseDaemonHttpEndpoint(activeConnection.endpoint);
    if (isLoopbackHost(host)) {
      if (!script.proxyUrl) {
        return { openUrl: null, labelUrl: null };
      }
      return {
        openUrl: buildProxyOpenUrl(script.proxyUrl, activeConnection.endpoint),
        labelUrl: script.proxyUrl,
      };
    }
  } catch {
    return { openUrl: null, labelUrl: script.proxyUrl };
  }

  if (script.port === null) {
    return { openUrl: null, labelUrl: script.proxyUrl };
  }

  const directUrl = buildDirectServiceUrl(activeConnection.endpoint, script.port);
  return {
    openUrl: directUrl,
    labelUrl: directUrl ?? script.proxyUrl,
  };
}
