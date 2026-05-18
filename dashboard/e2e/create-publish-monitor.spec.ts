import { expect, test } from "@playwright/test";

test("create, publish, and monitor flow", async ({ page }) => {
  const jobId = "job-111";
  const intentId = "intent-111";
  const publicationId = "pub-111";
  const accountId = "acc-111";
  const now = new Date().toISOString();

  await page.route("**/accounts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: accountId, username: "qa_account" }]),
    });
  });

  await page.route("**/generation-jobs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ job_id: jobId }),
    });
  });

  await page.route(`**/generation-jobs/${jobId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: jobId,
        status: "completed",
        progress: 100,
        step_control: {},
        input_payload: {},
        output_url: null,
        logs: [],
        steps: [],
        scenes: [],
      }),
    });
  });

  await page.route(`**/generation-jobs/${jobId}/assets`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "asset-111",
          generation_job_id: jobId,
          asset_type: "image",
          storage_provider: "s3",
          object_key: "asset-111",
          public_url: "https://example.com/asset.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1234,
          checksum_sha256: "abc",
          status: "ready",
        },
      ]),
    });
  });

  await page.route(`**/generation-jobs/${jobId}/publish-intents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent_id: intentId,
        status: "queued",
        targets: [{ account_id: accountId, platform: "instagram", status: "pending" }],
      }),
    });
  });

  await page.route(`**/publication-intents/${intentId}/dispatch`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent_id: intentId,
        status: "queued",
        dispatched_targets: 1,
      }),
    });
  });

  await page.route("**/publications?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        publications: [
          {
            id: publicationId,
            content_id: "content-111",
            status: "retrying",
            post_url: null,
            published_at: null,
            error_message: "Temporary upstream error",
            retry_count: 1,
            attempt: 2,
            failure_type: "retryable",
            last_retry_at: now,
            next_retry_at: now,
            max_retries: 3,
            engagement_score: null,
            created_at: now,
            updated_at: now,
            account_username: "qa_account",
            account_platform: "instagram",
            content_caption: "QA caption",
            content_type: "post",
            content_niche: "fitness",
          },
        ],
        pagination: { total: 1, limit: 20, offset: 0 },
      }),
    });
  });

  await page.route("**/publications/stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 1,
        pending: 0,
        processing: 0,
        published: 0,
        failed: 0,
        retrying: 1,
        total_retries: 1,
        published_today: 0,
        failed_today: 0,
        published_7d: 3,
        failed_7d: 1,
      }),
    });
  });

  await page.route("**/dashboard/ops-summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generated_at: now,
        publication_windows: {
          last_1h: { published: 1, failed: 0, permanently_failed: 0 },
        },
        queue: {
          publish_commands_pending: 0,
          content_ready: 0,
          publish_delayed: 0,
          publish_failed_dlq: 0,
        },
        accounts: { total: 1, active: 1, warming: 0, low_health: 0 },
        failure_breakdown: [],
        proxy_capacity: { slots_available: 5, strict_one_to_one: true },
      }),
    });
  });

  await page.route("**/queue/stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue: { pending: 1, delayed: 0 },
        publications: {
          total: 1,
          pending: 0,
          processing: 0,
          published: 0,
          failed: 0,
          retrying: 1,
          total_retries: 1,
        },
      }),
    });
  });

  await page.route(`**/publications/${publicationId}/diagnostics`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: publicationId,
        status: "retrying",
        error_message: "Temporary upstream error",
        failure_type: "retryable",
        retry_count: 1,
        max_retries: 3,
        attempt: 2,
        last_retry_at: now,
        next_retry_at: now,
        created_at: now,
        updated_at: now,
        published_at: null,
        post_url: null,
        account_id: accountId,
        account_username: "qa_account",
        content_id: "content-111",
        content_type: "post",
        content_niche: "fitness",
        content_caption: "QA caption",
      }),
    });
  });

  await page.goto("/login");
  await page.locator("#username").fill("e2e-user");
  await page.locator("#password").fill("e2e-pass");
  await page.locator("button[type='submit']").click();
  await page.waitForURL("**/");

  await page.goto("/generation-studio");
  await page.getByPlaceholder("e.g. morning mobility routine").fill("e2e topic");
  await page.getByRole("button", { name: "Select target accounts" }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "@qa_account" }).first().click();
  await page.keyboard.press("Escape");
  await page.locator("button:has-text('Create draft job')").click();

  await expect(page.getByRole("button", { name: "Post to Instagram Now" })).toBeVisible();
  await page.getByRole("button", { name: "Select target accounts" }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "@qa_account" }).first().click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Post to Instagram Now" }).click();
  await expect(page.getByText("Posting started:", { exact: false })).toBeVisible();

  await page.goto("/publications");
  await expect(page.getByText("@qa_account")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Diagnostics", { exact: false })).toBeVisible();
  await expect(page.getByText("failure_type: retryable")).toBeVisible();
});