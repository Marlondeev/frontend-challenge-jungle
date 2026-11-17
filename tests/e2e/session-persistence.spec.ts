import type { Session } from "../../src/domain/types";
import { test, expect, control, login, ready, rest } from "./helpers";

test("a page opened before login accepts the shared session without logging out either tab", async ({
  page,
  context,
}) => {
  const older = await context.newPage();
  await older.goto("/");
  await ready(older);
  await login(page);
  await expect
    .poll(async () => (await rest<Session>(older, "/session")).user?.id)
    .toBe("user-collector");
  await rest(older, "/cart/items", "POST", {
    nftId: "emerald-ape-042",
    editionId: "ten",
    quantity: 2,
  });
  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  await page.goto("/cart");
  await expect(page.locator(".cart-quantity output")).toHaveText("2");
  await older.reload();
  await expect(older.locator("html")).toHaveAttribute("data-ready", "true");
  await expect
    .poll(async () => (await rest<Session>(older, "/session")).user?.id)
    .toBe("user-collector");
});

test("a successful login recovers from the expired-session demo scenario", async ({
  page,
}) => {
  await control(page, { action: "scenario", scenario: "expired-session" });
  await login(page);
  expect((await rest<Session>(page, "/session")).user?.id).toBe(
    "user-collector",
  );
  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
});

test("manual logout still ends the shared session in both tabs", async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  await other.goto("/account");
  await expect(other.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(other).toHaveURL(/\/login\?redirect=/);
  expect(
    await other.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
});

test("the automatic session recheck keeps a valid login active", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  const checkedAfter = Date.now() + 20_000;
  const recheck = await page.waitForResponse(
    (response) =>
      Date.now() >= checkedAfter &&
      new URL(response.url()).pathname === "/api/session" &&
      response.request().method() === "GET" &&
      !!response.request().headers().authorization,
    { timeout: 45_000 },
  );
  expect(recheck.status()).toBe(200);
  expect((await recheck.json()).user?.id).toBe("user-collector");
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  expect(
    await page.evaluate(() => !!localStorage.getItem("kurio.session")),
  ).toBe(true);
});
