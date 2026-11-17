import type { Page, Request } from "@playwright/test";
import type { Session } from "../../src/domain/types";
import { test, expect, control, rest } from "./helpers";

const path = "/nft/emerald-ape-042";
const favorite = (page: Page) =>
  page.getByRole("button", {
    name: /^(Favoritar|Favoritado|Remover dos favoritos)$/,
  });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Entrar na Kurio", exact: true });

async function openLogin(page: Page) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Emerald Ape #042", exact: true }),
  ).toBeVisible();
  await favorite(page).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(dialog(page)).toBeVisible();
}

async function submitEmail(page: Page, email = "colecionador@kurio.test") {
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("Kurio123!");
  await dialog(page)
    .locator(".auth-form")
    .getByRole("button", { name: "Entrar", exact: true })
    .click();
}

async function expectSaved(page: Page) {
  await expect(dialog(page)).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(favorite(page)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => rest<string[]>(page, "/favorites"))
    .toEqual(["emerald-ape-042"]);
}

test("detail favorite opens login in place and cancel preserves the detail draft and focus", async ({
  page,
}, testInfo) => {
  await page.goto(path);
  await expect(favorite(page)).toBeVisible();
  await page.getByRole("button", { name: "1/50", exact: true }).click();
  await page
    .getByRole("button", { name: "Aumentar quantidade", exact: true })
    .click();
  await page
    .locator(".nft-detail")
    .evaluate((element) =>
      element.setAttribute("data-original-detail", "true"),
    );
  await favorite(page).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator(".nft-detail")).toHaveAttribute(
    "data-original-detail",
    "true",
  );
  await expect(page.locator(".editions button[aria-pressed=true]")).toHaveText(
    "1/50",
  );
  await expect(page.locator(".quantity:visible > span")).toHaveText("2");
  const bounds = await dialog(page).boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await page.evaluate(() => document.fonts.ready);
  await testInfo.attach("Login sobre os detalhes do NFT", {
    body: await page.screenshot({
      path: `output/playwright/detail-auth/dialog-${testInfo.project.name}.png`,
      animations: "disabled",
    }),
    contentType: "image/png",
  });
  await dialog(page)
    .getByRole("button", { name: "Criar conta", exact: true })
    .click();
  const registration = page.getByRole("dialog", {
    name: "Criar conta Kurio",
    exact: true,
  });
  await expect(registration).toBeVisible();
  await expect(page.locator("#auth-username")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await registration
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await expect(registration).not.toBeVisible();
  await expect(favorite(page)).toBeFocused();
  await expect(page.locator(".quantity:visible > span")).toHaveText("2");
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
});

test("email sign-in favorites the requested NFT exactly once without leaving details", async ({
  page,
}) => {
  await openLogin(page);
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/favorites/emerald-ape-042"
    )
      posts++;
  });
  await submitEmail(page);
  await expectSaved(page);
  expect(posts).toBe(1);
  await page.reload();
  await expect(favorite(page)).toHaveAttribute("aria-pressed", "true");
});

for (const provider of ["Google", "Facebook"] as const) {
  test(`${provider} demo sign-in returns to the inline dialog and favorites the same NFT`, async ({
    page,
  }) => {
    await openLogin(page);
    const providerButton = dialog(page).getByRole("button", {
      name: `Continuar com ${provider}`,
      exact: true,
    });
    await providerButton.click();
    const consent = page.getByRole("dialog", {
      name: `Demonstração com ${provider}`,
      exact: true,
    });
    await consent
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(providerButton).toBeFocused();
    await providerButton.click();
    await consent
      .getByRole("button", { name: "Entrar na demonstração", exact: true })
      .click();
    await expectSaved(page);
    expect((await rest<Session>(page, "/session")).user?.email).toBe(
      provider === "Google" ? "colecionador@kurio.test" : "nova@kurio.test",
    );
  });
}

test("canceling pending inline login cannot favorite for a later login", async ({
  page,
}) => {
  await openLogin(page);
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/favorites/emerald-ape-042"
    )
      posts++;
  });
  await control(page, { action: "scenario", scenario: "slow" });
  const pending = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/session/login",
  );
  await submitEmail(page);
  const obsolete: Request = await pending;
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
  await control(page, { action: "scenario", scenario: "success" });
  await favorite(page).click();
  await submitEmail(page, "nova@kurio.test");
  await expectSaved(page);
  const response = await obsolete.response();
  if (response) await response.finished();
  expect((await rest<Session>(page, "/session")).user?.email).toBe(
    "nova@kurio.test",
  );
  expect(posts).toBe(1);
});

test("a failed automatic favorite leaves login complete and supports retry on details", async ({
  page,
}) => {
  await openLogin(page);
  await control(page, { action: "scenario", scenario: "favorite-error" });
  await submitEmail(page);
  await expect(dialog(page)).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.getByRole("region", { name: "Notificações" }),
  ).toContainText("Não foi possível salvar seu favorito");
  await expect(favorite(page)).toHaveAttribute("aria-pressed", "false");
  expect((await rest<Session>(page, "/session")).user?.id).toBe(
    "user-collector",
  );
  await control(page, { action: "scenario", scenario: "success" });
  await favorite(page).click();
  await expectSaved(page);
});
