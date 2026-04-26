import { describe, expect, test } from "vitest";

import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  CURRENT_RELAY_PROTOCOL_VERSION,
  extractBasicAuthCredentialsFromEndpoint,
  normalizeDaemonHttpEndpoint,
  normalizeRelayProtocolVersion,
  redactDaemonHttpEndpointCredentials,
} from "./daemon-endpoints.js";

describe("daemon direct HTTP endpoints", () => {
  test("normalizes legacy host:port values to explicit http URLs", () => {
    expect(normalizeDaemonHttpEndpoint("localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeDaemonHttpEndpoint("127.0.0.1:8080")).toBe("http://localhost:8080");
    expect(normalizeDaemonHttpEndpoint("example.com:443")).toBe("https://example.com");
  });

  test("preserves explicit http and https protocols", () => {
    expect(normalizeDaemonHttpEndpoint("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeDaemonHttpEndpoint("https://example.com:1443")).toBe(
      "https://example.com:1443",
    );
    expect(normalizeDaemonHttpEndpoint("https://example.com")).toBe("https://example.com");
  });

  test("builds websocket URLs from the declared direct protocol", () => {
    expect(buildDaemonWebSocketUrl("http://localhost:8080")).toBe("ws://localhost:8080/ws");
    expect(buildDaemonWebSocketUrl("https://example.com:1443")).toBe("wss://example.com:1443/ws");
    expect(buildDaemonWebSocketUrl("https://example.com")).toBe("wss://example.com/ws");
  });

  test("extracts and redacts HTTP Basic Auth credentials", () => {
    expect(extractBasicAuthCredentialsFromEndpoint("http://root:pass@localhost:8080")).toEqual({
      username: "root",
      password: "pass",
    });
    expect(redactDaemonHttpEndpointCredentials("http://root:pass@localhost:8080")).toBe(
      "http://root:****@localhost:8080",
    );
    expect(buildDaemonWebSocketUrl("http://root:pass@localhost:8080")).toBe(
      "ws://root:pass@localhost:8080/ws",
    );
  });
});

describe("relay websocket URL versioning", () => {
  test("defaults relay URLs to v2", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.paseo.sh:443",
        serverId: "srv_test",
        role: "client",
      }),
    );

    expect(url.searchParams.get("v")).toBe(CURRENT_RELAY_PROTOCOL_VERSION);
    expect(url.searchParams.has("connectionId")).toBe(false);
  });

  test("includes connectionId when provided (server data sockets)", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.paseo.sh:443",
        serverId: "srv_test",
        role: "server",
        connectionId: "conn_abc123",
      }),
    );

    expect(url.searchParams.get("connectionId")).toBe("conn_abc123");
  });

  test("allows explicitly requesting v1 relay URLs", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.paseo.sh:443",
        serverId: "srv_test",
        role: "server",
        version: "1",
      }),
    );

    expect(url.searchParams.get("v")).toBe("1");
  });

  test("normalizes numeric relay versions", () => {
    expect(normalizeRelayProtocolVersion(2)).toBe("2");
    expect(normalizeRelayProtocolVersion(1)).toBe("1");
  });

  test("rejects unsupported relay versions", () => {
    expect(() => normalizeRelayProtocolVersion("3")).toThrow('Relay version must be "1" or "2"');
  });
});
