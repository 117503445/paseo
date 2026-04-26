import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

describe("daemon token auth config", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function createPaseoHome(): string {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paseo-config-auth-"));
    tempDirs.push(tempDir);
    return tempDir;
  }

  test("loads token from daemon startup environment", () => {
    const config = loadConfig(createPaseoHome(), {
      env: {
        PASEO_AUTH_TOKEN: "dev-token",
      },
    });

    expect(config.authToken).toBe("dev-token");
  });

  test("loads token from CLI overrides", () => {
    const config = loadConfig(createPaseoHome(), {
      env: {},
      cli: {
        token: "dev-token",
      },
    });

    expect(config.authToken).toBe("dev-token");
  });

  test("ignores blank token values", () => {
    const config = loadConfig(createPaseoHome(), {
      env: {
        PASEO_AUTH_TOKEN: "   ",
      },
    });

    expect(config.authToken).toBeUndefined();
  });
});
