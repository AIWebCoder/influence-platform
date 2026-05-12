// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3005",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- -p 3005",
    url: "http://127.0.0.1:3005",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "test",
      NEXTAUTH_URL: "http://127.0.0.1:3005",
      NEXTAUTH_SECRET: "e2e-test-secret",
      E2E_TEST_BYPASS_AUTH: "true",
      E2E_TEST_USERNAME: "e2e-user",
      E2E_TEST_PASSWORD: "e2e-pass",
      NEXT_PUBLIC_FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});