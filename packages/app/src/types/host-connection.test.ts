import { describe, expect, it } from "vitest";

import { connectionFromListen, normalizeStoredHostProfile } from "./host-connection";

describe("direct TCP host connections", () => {
  it("normalizes daemon listen addresses to explicit HTTP URLs", () => {
    expect(connectionFromListen("127.0.0.1:8080")).toEqual({
      id: "direct:http://localhost:8080",
      type: "directTcp",
      endpoint: "http://localhost:8080",
    });
  });

  it("upgrades stored host:port endpoints and preserves direct tokens", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_test",
      label: "Test",
      connections: [
        {
          id: "direct:localhost:6767",
          type: "directTcp",
          endpoint: "localhost:6767",
        },
        {
          id: "direct:secure",
          type: "directTcp",
          endpoint: "https://example.com",
          token: "dev-token",
        },
      ],
    });

    expect(profile?.connections).toEqual([
      {
        id: "direct:http://localhost:6767",
        type: "directTcp",
        endpoint: "http://localhost:6767",
      },
      {
        id: "direct:https://example.com",
        type: "directTcp",
        endpoint: "https://example.com",
        token: "dev-token",
      },
    ]);
  });
});
