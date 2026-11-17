import type { Page, Request } from "@playwright/test";
import { test, expect, control, rest, seedCart } from "./helpers";
import type { Session } from "../../src/domain/types";

async function settleRequest(page: Page, request: Request) {
  const response = await request.response();
  if (response) await response.finished();
  // Let the response's React Query notification and React render finish.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function submitLogin(page: Page, email: string) {
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("Kurio123!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("a delayed anonymous session cannot undo a successful login", async ({
  page,
}) => {
  await control(page, { action: "scenario", scenario: "slow" });
  const pendingSessions: Request[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/session" &&
      request.method() === "GET" &&
      !request.headers().authorization
    )
      pendingSessions.push(request);
  });
  const initialSession = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/session" &&
      request.method() === "GET" &&
      !request.headers().authorization,
  );
  await page.goto("/login?redirect=%2Faccount");
  await initialSession;
  await control(page, { action: "scenario", scenario: "success" });
  await submitLogin(page, "nova@kurio.test");
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  for (const request of pendingSessions) await settleRequest(page, request);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  expect((await rest<Session>(page, "/session")).user?.email).toBe(
    "nova@kurio.test",
  );
});

test("leaving a pending login prevents it replacing a newer account", async ({
  page,
}, testInfo) => {
  await page.goto("/login?redirect=%2Faccount");
  await expect(page.locator("#auth-email")).toBeVisible();
  await control(page, { action: "scenario", scenario: "slow" });
  const pendingLogin = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/session/login" &&
      request.method() === "POST",
  );
  await submitLogin(page, "colecionador@kurio.test");
  const obsoleteRequest = await pendingLogin;
  if (testInfo.project.name === "desktop-chromium") {
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
  } else {
    // Mobile uses a full page: changing the authentication route cancels it.
    await page
      .getByRole("link", { name: "Crie uma conta", exact: true })
      .click();
    await expect(page).toHaveURL(/\/register/);
  }
  await control(page, { action: "scenario", scenario: "success" });
  await page
    .getByRole("link", {
      name: testInfo.project.name === "desktop-chromium" ? "Entrar" : "Entre",
      exact: true,
    })
    .click();
  await submitLogin(page, "nova@kurio.test");
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await settleRequest(page, obsoleteRequest);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  expect((await rest<Session>(page, "/session")).user?.email).toBe(
    "nova@kurio.test",
  );
});

test("failed credentials leave the guest cart accessible", async ({ page }) => {
  // The dialog's Close action exercises returning to the still-mounted app.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedCart(page, 1);
  await control(page, { action: "scenario", scenario: "slow" });
  const initialSession = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/session" &&
      request.method() === "GET" &&
      !request.headers().authorization,
  );
  await page.goto("/login?redirect=%2Faccount");
  await initialSession;
  await control(page, { action: "scenario", scenario: "success" });
  await page.locator("#auth-email").fill("nova@kurio.test");
  await page.locator("#auth-password").fill("Wrong123!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#auth-email-error")).toHaveText(
    "Confira suas credenciais.",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /^Carrinho, / }).click();
  await expect(page.locator(".cart-row")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".cart-row")).toContainText("Emerald Ape #042");
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
});
