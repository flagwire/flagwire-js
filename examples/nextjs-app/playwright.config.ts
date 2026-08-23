import { defineConfig } from "@playwright/test";

const clientKey = `pk_live_${"e".repeat(43)}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 15_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3001", browserName: "chromium" },
  webServer: [
    {
      command: "node tests/edge-stub.mjs",
      name: "edge-stub",
      reuseExistingServer: false,
      url: "http://127.0.0.1:4311/health",
    },
    {
      command: "next build && next start --port 3001",
      env: {
        NEXT_PUBLIC_FLAGWIRE_CLIENT_KEY: clientKey,
        NEXT_PUBLIC_FLAGWIRE_EDGE_URL: "http://127.0.0.1:4311",
      },
      name: "next-example",
      reuseExistingServer: false,
      url: "http://127.0.0.1:3001",
    },
  ],
});
