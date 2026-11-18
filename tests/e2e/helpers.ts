import { expect, test as base, type Page } from "@playwright/test";
import type {
  Cart,
  CatalogSearch,
  DemoControl,
  Order,
  Quote,
} from "../../src/domain/types";

/** Browser fetch is intentional: APIRequestContext bypasses the MSW service worker. */
export async function rest<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = localStorage.getItem("kurio.session");
      const visitor = localStorage.getItem("kurio.visitor");
      if (token) headers.Authorization = `Bearer ${token}`;
      if (visitor) headers["X-Visitor-Id"] = visitor;
      const response = await fetch(`/api${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
  expect(
    result.status,
    `${method} ${path}: ${JSON.stringify(result.body)}`,
  ).toBeLessThan(400);
  return result.body as T;
}

export const control = (page: Page, input: DemoControl) =>
  rest(page, "/__control", "POST", input);

export async function ready(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByRole("link", { name: "Ver Emerald Ape #042", exact: true }),
  ).toBeVisible();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto("/");
    await ready(page);
    await control(page, { action: "reset" });
    await page.reload();
    await ready(page);
    await use(page);
  },
});
export { expect };

export async function login(
  page: Page,
  email = "colecionador@kurio.test",
  password = "Kurio123!",
  redirect = "/account",
) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`${redirect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  );
  await expect
    .poll(() => page.evaluate(() => !!localStorage.getItem("kurio.session")))
    .toBe(true);
}

export async function logout(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kurio.session")))
    .toBeNull();
}

export async function seedCart(
  page: Page,
  quantity = 1,
  nftId = "emerald-ape-042",
) {
  return rest<Cart>(page, "/cart/items", "POST", {
    nftId,
    editionId: "ten",
    quantity,
  });
}

export async function checkout(page: Page) {
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Perfil do colecionador", exact: true }),
  ).toBeVisible();
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
}

export async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Confirmar compra", exact: true })
    .click();
  await expect(page).toHaveURL(/\/order\/[^/?]+$/);
  return page.url().split("/").at(-1)!;
}

export async function order(page: Page, id: string) {
  return rest<Order>(page, `/orders/${id}`);
}
export async function quote(page: Page) {
  return rest<Quote>(page, "/quote", "POST", {});
}

export async function filters(page: Page) {
  const open = page.getByRole("button", { name: "Abrir filtros", exact: true });
  if (await open.isVisible()) {
    await open.click();
    return page.getByRole("dialog", { name: "Filtros", exact: true });
  }
  return page.locator(".market > aside");
}

export async function closeFilters(page: Page) {
  const close = page.getByRole("button", {
    name: "Ver resultados",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
}

/** Mobile keeps sorting in its filter drawer; desktop uses the toolbar. */
export async function openSort(page: Page) {
  await expect(page.locator(".market-toolbar")).toBeVisible();
  const toolbar = page.locator(".market-toolbar .sort");
  if (await toolbar.isVisible()) return toolbar;
  const drawer = page.getByRole("dialog", { name: "Filtros", exact: true });
  if (!(await drawer.isVisible())) await filters(page);
  const control = drawer.locator(".sort");
  await expect(control).toBeVisible();
  return control;
}

export async function sortCatalog(
  page: Page,
  value: NonNullable<CatalogSearch["sort"]>,
) {
  const control = await openSort(page);
  await control
    .getByRole("combobox", { name: "Ordenar por", exact: true })
    .selectOption(value);
  await closeFilters(page);
}
