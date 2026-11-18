import { fileURLToPath, URL } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./google-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  outputDir: "../reports/google-auth/results",
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: fileURLToPath(
          new URL("../reports/google-auth/html", import.meta.url),
        ),
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "google-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "google-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command:
      "npm run dev -- --config tests/fixtures/google-vite.config.ts --host 127.0.0.1",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
