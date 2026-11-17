import type { Page, Request } from "@playwright/test";
import { test, expect, control, logout, seedCart } from "./helpers";

async function openDemo(page: Page, provider: "Google" | "Facebook") {
  const trigger = page.getByRole("button", {
    name: `Continuar com ${provider}`,
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: `Demonstração com ${provider}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nenhuma conta externa será acessada");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  return { dialog, trigger };
}

async function settleRequest(page: Page, request: Request) {
  const response = await request.response();
  if (response) await response.finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("social demos require confirmation, persist and isolate the two profiles", async ({
  page,
}) => {
  await page.goto("/login?redirect=%2Faccount");
  const { dialog, trigger } = await openDemo(page, "Google");
  await expect(dialog).toContainText("Colecionador Kurio");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
  await trigger.click();
  const loginRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/session/social-demo" &&
      request.method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  expect((await loginRequest).postDataJSON()).toEqual({ provider: "google" });
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  await seedCart(page, 2);
  await page.goto("/cart");
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await logout(page);
  await page.goto("/login?redirect=%2Faccount");
  const facebook = await openDemo(page, "Facebook");
  await expect(facebook.dialog).toContainText("Nova Colecionadora");
  await facebook.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await page.goto("/cart");
  await expect(page.locator(".cart-row")).toHaveCount(0);
  await page.goto("/account/wallets");
  await expect(page.getByText("nova.eth", { exact: true })).toBeVisible();
  await expect(page.getByText("colecionador.eth", { exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByText("nova.eth", { exact: true })).toBeVisible();
});

test("social confirmation returns to checkout with the merged guest cart", async ({
  page,
}) => {
  await seedCart(page, 2);
  await page.goto("/cart");
  await page
    .getByRole("link", { name: "Conectar e finalizar", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  const { dialog } = await openDemo(page, "Facebook");
  await dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(
    page.getByRole("heading", { name: "Perfil do colecionador", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".purchase-total dd")).toHaveText("2.396 ETH");
  await page.reload();
  await expect(page.locator(".purchase-total dd")).toHaveText("2.396 ETH");
});

test("canceling a delayed social request prevents it replacing a newer demo profile", async ({
  page,
}) => {
  await page.goto("/login?redirect=%2Faccount");
  const google = await openDemo(page, "Google");
  await control(page, { action: "scenario", scenario: "slow" });
  const request = page.waitForRequest(
    (entry) =>
      new URL(entry.url()).pathname === "/api/session/social-demo" &&
      entry.method() === "POST",
  );
  await google.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  const obsolete = await request;
  await expect(
    google.dialog.getByRole("button", { name: "Entrando…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(google.dialog).not.toBeVisible();
  await expect(google.trigger).toBeFocused();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await control(page, { action: "scenario", scenario: "success" });
  const facebook = await openDemo(page, "Facebook");
  await facebook.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await settleRequest(page, obsolete);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
});

test("social failures stay in the confirmation dialog and can be retried", async ({
  page,
}) => {
  await page.goto("/register?redirect=%2Faccount");
  const { dialog } = await openDemo(page, "Google");
  await control(page, { action: "scenario", scenario: "server-error" });
  await dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Serviço temporariamente indisponível",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
  await expect(
    dialog.getByRole("button", { name: "Entrar na demonstração", exact: true }),
  ).toBeEnabled();
  await control(page, { action: "scenario", scenario: "success" });
  await dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
});

test("canceling a delayed social request preserves the guest cart for the next confirmed provider", async ({
  page,
}) => {
  await seedCart(page, 1);
  await page.goto("/login?redirect=%2Faccount");
  const google = await openDemo(page, "Google");
  await control(page, { action: "scenario", scenario: "slow" });
  const request = page.waitForRequest(
    (entry) =>
      new URL(entry.url()).pathname === "/api/session/social-demo" &&
      entry.method() === "POST",
  );
  await google.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await request;
  await page.keyboard.press("Escape");
  await expect(google.dialog).not.toBeVisible();
  await control(page, { action: "scenario", scenario: "success" });
  // MSW serializes requests without their AbortSignal. Let its known 2400ms
  // slow handler finish while this document remains alive before changing route.
  await page.waitForTimeout(2700);
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
  await page.goto("/cart");
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Conectar e finalizar", exact: true })
    .click();
  const facebook = await openDemo(page, "Facebook");
  await facebook.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator(".purchase-total dd")).toHaveText("1.206 ETH");
  await logout(page);
  await page.goto("/login?redirect=%2Faccount");
  const collector = await openDemo(page, "Google");
  await collector.dialog
    .getByRole("button", { name: "Entrar na demonstração", exact: true })
    .click();
  await expect(page.locator("#profile-email")).toHaveValue(
    "colecionador@kurio.test",
  );
  await page.goto("/cart");
  await expect(page.locator(".cart-row")).toHaveCount(0);
});
