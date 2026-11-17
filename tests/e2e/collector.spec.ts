import { test, expect, login, seedCart, rest, control, order } from "./helpers";
import type { Order, PlaceOrderInput } from "../../src/domain/types";

test("collector and selected provider survive interrupted submission and remain immutable on the receipt", async ({
  page,
}, testInfo) => {
  await login(page);
  await seedCart(page);
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "Revisar compra", exact: true }),
  ).toBeEnabled();
  const details = page.locator(".collector-form");
  if (!(await page.locator("#checkout-name").isVisible()))
    await details.locator("summary").click();
  const collector = {
    displayName: "Colecionador da compra",
    username: "compra.e2e",
    email: "compra.e2e@kurio.test",
    ens: "compra.eth",
    note: "Observação preservada na compra.",
  };
  await page.locator("#checkout-name").fill(collector.displayName);
  await page.locator("#checkout-username").fill(collector.username);
  await page.locator("#checkout-email").fill(collector.email);
  await page.locator("#checkout-ens").fill(collector.ens);
  await page.locator("#checkout-note").fill(collector.note);
  if (testInfo.project.name === "mobile-chromium")
    await details.locator("summary").click();
  await page
    .getByRole("radio", { name: "Coinbase Wallet", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Conectar carteira", exact: true })
    .click();
  await page.screenshot({
    path: `output/playwright/collector/checkout-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Revisar compra", exact: true })
    .click();
  await expect(page.locator(".purchase-review")).toContainText(collector.email);
  await expect(page.locator(".purchase-review")).toContainText(collector.note);
  await expect(page.locator(".purchase-review")).toContainText(
    "Coinbase Wallet",
  );
  await control(page, { action: "scenario", scenario: "order-timeout" });
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/orders",
  );
  await page
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  const input = (await submitted).postDataJSON() as PlaceOrderInput;
  expect(input).toMatchObject({ collector, provider: "Coinbase Wallet" });
  const persisted = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("kurio.purchase.user-collector") ?? "null",
    ),
  );
  expect(persisted).toMatchObject({
    collector,
    provider: "Coinbase Wallet",
    key: input.idempotencyKey,
  });
  await expect
    .poll(() =>
      page.evaluate(async (key) => {
        const response = await fetch(`/api/orders/by-key/${key}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("kurio.session")}`,
          },
        });
        return response.status;
      }, input.idempotencyKey),
    )
    .toBe(200);
  const created = await rest<Order>(
    page,
    `/orders/by-key/${input.idempotencyKey}`,
  );
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/order/${created.id}$`));
  await expect(
    page.getByRole("heading", {
      name: "Seus NFTs agora estão na sua carteira",
    }),
  ).toBeVisible();
  await expect(page.locator(".receipt-collector")).toContainText(
    collector.email,
  );
  await expect(page.locator(".receipt-collector")).toContainText(
    collector.note,
  );
  await expect(page.locator(".receipt-wallet")).toContainText(
    "Coinbase Wallet",
  );
  const receipt = await order(page, created.id);
  expect(receipt.collector).toEqual(collector);
  await rest(page, "/profile", "PATCH", {
    displayName: "Perfil alterado depois",
    email: "perfil.depois@kurio.test",
    ens: "depois.eth",
  });
  await page.reload();
  await expect(page.locator(".receipt-collector")).toContainText(
    collector.email,
  );
  expect(await order(page, created.id)).toEqual(receipt);
});

test("invalid collector fields open the mobile disclosure and focus the visible error", async ({
  page,
}, testInfo) => {
  await login(page);
  await seedCart(page);
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "Revisar compra", exact: true }),
  ).toBeEnabled();
  const details = page.locator(".collector-form");
  if (!(await page.locator("#checkout-name").isVisible()))
    await details.locator("summary").click();
  await page.locator("#checkout-name").fill("");
  if (testInfo.project.name === "mobile-chromium") {
    await details.locator("summary").click();
    await expect(details).not.toHaveAttribute("open", "");
  }
  await page
    .getByRole("button", { name: "Conectar carteira", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revisar compra", exact: true })
    .click();
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator("#checkout-name-error")).toBeVisible();
  await expect(page.locator("#checkout-name")).toBeFocused();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("kurio.purchase.user-collector"),
    ),
  ).toBeNull();
});

test("confirmation locks the reviewed collector, wallet and provider throughout cart revalidation", async ({
  page,
}) => {
  await login(page);
  await seedCart(page);
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "Revisar compra", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Conectar carteira", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revisar compra", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise sua compra" }),
  ).toBeVisible();
  const originalName = await page.locator("#checkout-name").inputValue();
  await control(page, { action: "scenario", scenario: "slow" });
  const cartRevalidation = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/cart",
  );
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/orders",
  );
  await page
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await cartRevalidation;
  // Immediate assertions are intentional: retrying could miss the editable
  // cart-fetch interval once the subsequent quote request sets its own pending flag.
  expect(await page.locator("#checkout-name").isDisabled()).toBe(true);
  expect(
    await page
      .getByRole("radio", { name: "Coinbase Wallet", exact: true })
      .isDisabled(),
  ).toBe(true);
  expect(
    await page.getByRole("radio", { name: /Carteira secundária/ }).isDisabled(),
  ).toBe(true);
  expect(
    await page
      .getByRole("button", { name: "Desconectar carteira", exact: true })
      .isDisabled(),
  ).toBe(true);
  await control(page, { action: "scenario", scenario: "success" });
  const input = (await submitted).postDataJSON() as PlaceOrderInput;
  expect(input).toMatchObject({
    collector: { displayName: originalName },
    provider: "MetaMask",
  });
  await expect(page).toHaveURL(/\/order\/[^/?]+$/);
  await expect(
    page.getByRole("heading", {
      name: "Seus NFTs agora estão na sua carteira",
    }),
  ).toBeVisible();
});

test("failed cart revalidation releases the purchase lock after explicit recovery", async ({
  page,
}) => {
  await login(page);
  await seedCart(page);
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "Revisar compra", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Conectar carteira", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revisar compra", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise sua compra" }),
  ).toBeVisible();
  await control(page, { action: "scenario", scenario: "server-error" });
  await page
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Tentar novamente", exact: true }),
  ).toBeVisible();
  await control(page, { action: "scenario", scenario: "success" });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Revisar compra", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#checkout-name")).toBeEnabled();
  await expect(
    page.getByRole("radio", { name: "Coinbase Wallet", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Desconectar carteira", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("kurio.purchase.user-collector"),
    ),
  ).toBeNull();
});
