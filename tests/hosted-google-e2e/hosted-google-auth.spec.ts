import type { Cart, GoogleCredential, Session } from "../../src/domain/types";
import {
  test,
  expect,
  rest,
  ready,
  googleButton,
  googleLogin,
  holdGoogle,
  deliverGoogle,
  rejectNextGoogle,
} from "./helpers";

test("verified identity uses Node, survives tab reload and stays out of localStorage", async ({
  page,
  identity,
  context,
  browser,
}) => {
  const verified = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/google-auth",
  );
  await googleLogin(page);
  const response = await verified;
  expect(response.status()).toBe(200);
  expect(response.headers()["x-hosted-google-e2e"]).toBe("node-handler");
  expect(await response.json()).toMatchObject({
    identity: { sub: identity.sub, email: identity.email, emailVerified: true },
  });
  await expect(page.locator("#profile-email")).toHaveValue(identity.email);
  await expect(page.locator("#profile-displayName")).toHaveValue(
    identity.name!,
  );
  expect((await rest<Session>(page, "/session")).user).toMatchObject({
    email: identity.email,
    authProvider: "google",
  });
  const stored = await page.evaluate(() => ({
    token: sessionStorage.getItem("kurio.session"),
    database: sessionStorage.getItem("kurio.mock.v1"),
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
  }));
  expect(stored.token).toBeTruthy();
  expect(stored.database).toContain(identity.email);
  expect(stored.local).not.toContain(identity.email);
  expect(stored.local).not.toContain(identity.sub);
  expect(stored.local).not.toContain(stored.token!);
  const credential = response.request().postDataJSON() as GoogleCredential;
  expect(credential.credential.startsWith("hosted-google-e2e.")).toBe(true);
  expect(stored.session.includes(credential.credential)).toBe(false);
  expect(
    await page.evaluate(() =>
      ["kurio.mock.v1", "kurio.session", "kurio.visitor"].map((key) =>
        localStorage.getItem(key),
      ),
    ),
  ).toEqual([null, null, null]);

  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue(identity.email);
  // Another tab shares localStorage but must not inherit this tab's identity.
  const otherTab = await context.newPage();
  await otherTab.goto(new URL("/", page.url()).href);
  expect((await rest<Session>(otherTab, "/session")).user).toBeNull();
  await otherTab.close();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("kurio.session")),
  ).toBeNull();
  expect((await rest<Session>(page, "/session")).user).toBeNull();
  const origin = new URL(page.url()).origin;
  await page.close();
  const fresh = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const freshPage = await fresh.newPage();
    await freshPage.goto(origin);
    expect((await rest<Session>(freshPage, "/session")).user).toBeNull();
    expect(
      await freshPage.evaluate(() =>
        JSON.stringify(Object.entries(sessionStorage)),
      ),
    ).not.toContain(identity.email);
  } finally {
    await fresh.close();
  }
});

test("Google checkout login preserves the visitor quantity and returns to checkout", async ({
  page,
  identity,
}) => {
  await page.goto("/");
  await rest<Cart>(page, "/cart/items", "POST", {
    nftId: "emerald-ape-042",
    editionId: "ten",
    quantity: 2,
  });
  await page.goto("/cart");
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Conectar e finalizar", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("redirect"))
    .toBe("/checkout");
  await googleButton(page).click();
  await expect(page).toHaveURL(/\/checkout$/);
  expect((await rest<Cart>(page, "/cart")).items).toMatchObject([
    { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
  ]);
  expect((await rest<Session>(page, "/session")).user?.email).toBe(
    identity.email,
  );
  await expect(
    page.getByText("Cadastre uma carteira para continuar.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/checkout$/);
  expect((await rest<Cart>(page, "/cart")).items[0].quantity).toBe(2);
});

test("Google favorite login keeps NFT URL, edition and quantity", async ({
  page,
}) => {
  const path = "/nft/emerald-ape-042";
  await page.goto(path);
  await ready(page);
  await page.getByRole("button", { name: "1/50", exact: true }).click();
  await page
    .getByRole("button", { name: "Aumentar quantidade", exact: true })
    .click();
  const favorite = page.getByRole("button", {
    name: /^(Favoritar|Favoritado|Remover dos favoritos)$/,
  });
  await favorite.click();
  const dialog = page.getByRole("dialog", {
    name: "Entrar na Kurio",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await googleButton(page).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".editions button[aria-pressed=true]")).toHaveText(
    "1/50",
  );
  await expect(page.locator(".quantity:visible > span")).toHaveText("2");
  expect(await rest<string[]>(page, "/favorites")).toEqual(["emerald-ape-042"]);
});

test("invalid credentials leave the visitor intact and retry with a fresh nonce", async ({
  page,
  identity,
  context,
}) => {
  const submissions: GoogleCredential[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/google-auth"
    )
      submissions.push(request.postDataJSON() as GoogleCredential);
  });
  await page.goto("/register?redirect=%2Faccount");
  await googleButton(page).waitFor();
  const cookies = await context.cookies(
    "http://127.0.0.1:5175/api/google-auth",
  );
  expect(
    cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === "Strict"),
  ).toBe(true);
  await rejectNextGoogle(page);
  await googleButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível validar sua conta Google",
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem("kurio.session")),
  ).toBeNull();
  await expect(page.locator(".google-sign-in")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await googleButton(page).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue(identity.email);
  expect(submissions).toHaveLength(2);
  expect(submissions[1].nonce).not.toBe(submissions[0].nonce);
});

test("canceled and delayed Google callbacks cannot replace a newer password login", async ({
  page,
}) => {
  let googlePosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/google-auth"
    )
      googlePosts++;
  });
  await page.goto("/login?redirect=%2Faccount");
  await googleButton(page).waitFor();
  await holdGoogle(page);
  await googleButton(page).click();
  await page
    .getByRole("button", { name: "Cancelar login do Google", exact: true })
    .click();
  await expect(page.locator(".google-sign-in")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await googleButton(page).click();
  await expect(
    page.getByRole("button", { name: "Cancelar login do Google", exact: true }),
  ).toBeVisible();
  await page.locator("#auth-email").fill("nova@kurio.test");
  await page.locator("#auth-password").fill("Kurio123!");
  const passwordStarted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/session/login",
  );
  await page
    .locator(".auth-form")
    .getByRole("button", { name: "Entrar", exact: true })
    .click();
  await passwordStarted;
  await deliverGoogle(page, 0);
  await deliverGoogle(page, 1);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  expect((await rest<Session>(page, "/session")).user?.id).toBe("user-nova");
  expect(googlePosts).toBe(0);
});
