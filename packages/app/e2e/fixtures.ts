import { test as base, expect, type Page } from "@playwright/test";
import { buildCreateAgentPreferences, buildSeededHost } from "./helpers/daemon-registry";

// 扩展 base test，让 global-setup 提供动态 baseURL。
const test = base.extend({
  baseURL: async ({}, provide) => {
    const metroPort = process.env.E2E_METRO_PORT;
    if (!metroPort) {
      throw new Error("E2E_METRO_PORT not set - globalSetup must run first");
    }
    await provide(`http://localhost:${metroPort}`);
  },
});

const consoleEntries = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const daemonPort = process.env.E2E_DAEMON_PORT;
  const metroPort = process.env.E2E_METRO_PORT;
  if (!daemonPort) {
    throw new Error(
      "E2E_DAEMON_PORT is not set. Refusing to run e2e against the default daemon (e.g. localhost:6767). " +
        "Ensure Playwright `globalSetup` starts the e2e daemon and exports E2E_DAEMON_PORT.",
    );
  }
  if (daemonPort === "6767") {
    throw new Error(
      "E2E_DAEMON_PORT is 6767. Refusing to run e2e against the default local daemon. " +
        "Fix Playwright globalSetup to start an isolated test daemon and export its port.",
    );
  }
  if (!metroPort) {
    throw new Error(
      "E2E_METRO_PORT is not set. Ensure Playwright `globalSetup` starts Metro and exports E2E_METRO_PORT.",
    );
  }

  // 硬性保护：测试绝不能访问开发者默认 daemon。
  // 在任何导航前阻断所有指向 :6767 的 HTTP 和 WS 请求。
  await page.route(/:(6767)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767)\b/, async (ws) => {
    await ws.close({ code: 1008, reason: "Blocked connection to localhost:6767 during e2e." });
  });

  const entries: string[] = [];
  consoleEntries.set(page, entries);

  page.on("console", (message) => {
    entries.push(`[console:${message.type()}] ${message.text()}`);
  });

  page.on("pageerror", (error) => {
    entries.push(`[pageerror] ${error.message}`);
  });

  const nowIso = new Date().toISOString();
  const seedNonce = Math.random().toString(36).slice(2);
  const serverId = process.env.E2E_SERVER_ID;
  if (!serverId) {
    throw new Error("E2E_SERVER_ID is not set - expected from Playwright globalSetup.");
  }
  const testDaemon = buildSeededHost({
    serverId,
    endpoint: `127.0.0.1:${daemonPort}`,
    nowIso,
  });
  const createAgentPreferences = buildCreateAgentPreferences(testDaemon.serverId);

  await page.addInitScript(
    ({ daemon, preferences, seedNonce: nonce }) => {
      localStorage.setItem("@paseo:e2e-seed-nonce", nonce);

      // `addInitScript` 会在每次导航时运行，包括 reload。有些测试会主动覆盖存储并 reload；
      // 这些测试可以在 reload 前设置这个标记，让下一次导航跳过默认 seed。
      const disableOnceKey = "@paseo:e2e-disable-default-seed-once";
      const disableValue = localStorage.getItem(disableOnceKey);
      if (disableValue) {
        localStorage.removeItem(disableOnceKey);
        if (disableValue === nonce) {
          return;
        }
      }

      localStorage.setItem("@paseo:e2e", "1");

      // 硬重置所有可能指向开发者真实 daemon 的存储。
      localStorage.setItem("@paseo:daemon-registry", JSON.stringify([daemon]));
      localStorage.removeItem("@paseo:settings");
      localStorage.setItem("@paseo:create-agent-preferences", JSON.stringify(preferences));
    },
    { daemon: testDaemon, preferences: createAgentPreferences, seedNonce },
  );
});

test.afterEach(async ({ page }, testInfo) => {
  const entries = consoleEntries.get(page);
  if (!entries || entries.length === 0) {
    return;
  }

  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  await testInfo.attach("browser-console", {
    body: entries.join("\n"),
    contentType: "text/plain",
  });
});

export { test, expect, type Page };
