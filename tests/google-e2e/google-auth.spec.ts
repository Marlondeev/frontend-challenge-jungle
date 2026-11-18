import type {
  Cart,
  GoogleCredential,
  Nft,
  Order,
  Session,
} from "../../src/domain/types";
import {
  test,
  expect,
  rest,
  googleButton,
  googleLogin,
  holdGoogle,
  deliverGoogle,
  rejectNextGoogle,
} from "./helpers";

test("Google login persists through reload and logout revokes the session", async ({
  page,
  identity,
}) => {
  await googleLogin(page);
  await expect(page.locator("#profile-email")).toHaveValue(identity.email);
  expect((await rest<Session>(page, "/session")).user).toMatchObject({
    email: identity.email,
    authProvider: "google",
  });
  const oldToken = await page.evaluate(() =>
    localStorage.getItem("kurio.session"),
  );
  await page.reload();
  await expect(page.locator("#profile-email")).toHaveValue(identity.email);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
  ).toBeNull();
  const response = await page.request.get("/api/session", {
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  expect(response.status()).toBe(401);
  expect((await rest<Session>(page, "/session")).user).toBeNull();
});

test("Google checkout login merges the guest cart and returns to checkout", async ({
  page,
  identity,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await rest<Cart>(page, "/cart/items", "POST", {
    nftId: "emerald-ape-042",
    editionId: "fifty",
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
  const cart = await rest<Cart>(page, "/cart");
  expect(cart.items).toMatchObject([
    { nftId: "emerald-ape-042", editionId: "fifty", quantity: 2 },
  ]);
  expect((await rest<Session>(page, "/session")).user?.email).toBe(
    identity.email,
  );
  await expect(
    page.getByText("Cadastre uma carteira para continuar.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/checkout$/);
  expect((await rest<Cart>(page, "/cart")).items).toHaveLength(1);
  await page.goto("/cart");
  await expect(page.locator(".cart-quantity output")).toHaveText("2");
});

test("Google favorite login stays on NFT details and preserves its edition draft", async ({
  page,
}) => {
  const path = "/nft/emerald-ape-042";
  await page.goto(path);
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

test("canceling Google and a newer password login ignore both delayed Google callbacks", async ({
  page,
}) => {
  let googlePosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/session/google"
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
  await expect(
    page.getByRole("button", { name: "Cancelar login do Google", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".google-sign-in")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await googleButton(page).click();
  await expect(
    page.getByRole("button", { name: "Cancelar login do Google", exact: true }),
  ).toBeVisible();
  let releasePassword!: () => void;
  let passwordHeld = false;
  const gate = new Promise<void>((resolve) => {
    releasePassword = resolve;
  });
  await page.route("**/api/session/login", async (route) => {
    passwordHeld = true;
    await gate;
    await route.continue();
  });
  await page.locator("#auth-email").fill("nova@kurio.test");
  await page.locator("#auth-password").fill("Kurio123!");
  await page
    .locator(".auth-form")
    .getByRole("button", { name: "Entrar", exact: true })
    .click();
  await expect.poll(() => passwordHeld).toBe(true);
  await deliverGoogle(page, 0);
  await deliverGoogle(page, 1);
  releasePassword();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  expect((await rest<Session>(page, "/session")).user?.id).toBe("user-nova");
  expect(googlePosts).toBe(0);
});

test("a rejected Google credential supports registration retry with a fresh nonce", async ({
  page,
  identity,
  context,
}) => {
  const submissions: GoogleCredential[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/session/google"
    )
      submissions.push(request.postDataJSON() as GoogleCredential);
  });
  await page.goto("/register?redirect=%2Faccount");
  await googleButton(page).waitFor();
  const challenge = (
    await context.cookies("http://127.0.0.1:5174/api/session/google")
  ).find((cookie) => cookie.name === "kurio_google_challenge");
  expect(challenge).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "kurio_google_challenge",
  );
  await rejectNextGoogle(page);
  await googleButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível validar sua conta Google",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("kurio.session")),
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

test("Google collector completes a fictional purchase through real REST and Socket.IO", async ({
  page,
}) => {
  const frames: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) =>
      frames.push(payload.toString()),
    ),
  );
  await googleLogin(page);
  const user = (await rest<Session>(page, "/session")).user!;
  const before = await rest<Nft>(page, "/nfts/emerald-ape-042");
  await rest(page, "/wallets", "POST", {
    label: "E2E Wallet",
    network: "Ethereum",
    address: `0x${"a".repeat(40)}`,
    provider: "MetaMask",
    primary: true,
  });
  await rest(page, "/cart/items", "POST", {
    nftId: "emerald-ape-042",
    editionId: "fifty",
    quantity: 1,
  });
  await page.goto("/checkout");
  await page
    .getByRole("button", { name: "Conectar carteira", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revisar compra", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise sua compra" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await expect(page).toHaveURL(/\/order\/[^/?]+$/);
  await expect(
    page.getByRole("heading", {
      name: "Seus NFTs agora estão na sua carteira",
    }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(await rest<Order>(page, `/orders/${id}`)).toMatchObject({
    userId: user.id,
    status: "confirmed",
  });
  await expect
    .poll(() =>
      frames.some(
        (frame) => frame.includes("order.updated") && frame.includes(id),
      ),
    )
    .toBe(true);
  expect((await rest<Cart>(page, "/cart")).items).toEqual([]);
  const after = await rest<Nft>(page, "/nfts/emerald-ape-042");
  expect(after.editions.find((edition) => edition.id === "fifty")?.stock).toBe(
    before.editions.find((edition) => edition.id === "fifty")!.stock - 1,
  );
});
