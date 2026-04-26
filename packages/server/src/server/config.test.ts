import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

describe("daemon Basic Auth config", () => {
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

  test("loads username and password from daemon startup environment", () => {
    const config = loadConfig(createPaseoHome(), {
      env: {
        PASEO_AUTH_USERNAME: "root",
        PASEO_AUTH_PASSWORD: "pass",
      },
    });

    expect(config.basicAuth).toEqual({ username: "root", password: "pass" });
  });

  test("loads username and password from CLI overrides", () => {
    const config = loadConfig(createPaseoHome(), {
      env: {},
      cli: {
        username: "root",
        password: "pass",
      },
    });

    expect(config.basicAuth).toEqual({ username: "root", password: "pass" });
  });

  test("requires username and password together", () => {
    expect(() =>
      loadConfig(createPaseoHome(), {
        env: {
          PASEO_AUTH_USERNAME: "root",
        },
      }),
    ).toThrow("Both username and password are required for daemon Basic Auth");
  });
});
