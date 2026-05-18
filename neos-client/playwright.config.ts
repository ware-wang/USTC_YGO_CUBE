import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const base = new URL(baseURL);
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: process.env.PLAYWRIGHT_LIVE === "1" ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: `npm run dev -- --host ${base.hostname} --port ${base.port || "5173"}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
