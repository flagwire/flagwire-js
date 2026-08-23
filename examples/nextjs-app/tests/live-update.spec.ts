import { expect, test } from "@playwright/test";

test("published flag updates over the stream without a reload", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("flag-value")).toHaveText("off");
  await expect
    .poll(async () =>
      (await request.get("http://127.0.0.1:4311/health")).json().then((v) => v.connections),
    )
    .toBeGreaterThan(0);

  const startedAt = Date.now();
  await expect((await request.post("http://127.0.0.1:4311/__publish")).ok()).toBeTruthy();
  await expect(page.getByTestId("flag-value")).toHaveText("on", { timeout: 1_800 });
  expect(Date.now() - startedAt).toBeLessThan(2_000);
});
