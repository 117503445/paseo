import {
  DAEMON_AUTH_TOKEN_QUERY_PARAM,
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl as buildSharedRelayWebSocketUrl,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeDaemonAuthToken,
  normalizeDaemonHttpEndpoint,
  normalizeHostPort,
  parseDaemonHttpEndpoint,
  parseHostPort,
  redactDaemonHttpEndpointCredentials,
  type HostPortParts,
} from "@server/shared/daemon-endpoints";

export type { HostPortParts };

export {
  DAEMON_AUTH_TOKEN_QUERY_PARAM,
  buildDaemonWebSocketUrl,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeDaemonAuthToken,
  normalizeDaemonHttpEndpoint,
  normalizeHostPort,
  parseDaemonHttpEndpoint,
  parseHostPort,
  redactDaemonHttpEndpointCredentials,
};

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

export function buildRelayWebSocketUrl(params: { endpoint: string; serverId: string }): string {
  return buildSharedRelayWebSocketUrl({ ...params, role: "client" });
}
