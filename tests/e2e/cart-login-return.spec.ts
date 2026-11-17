import { test, expect, seedCart } from "./helpers";

for (const method of ["email", "Google", "Facebook"] as const) {
  test(`cart sign-in preserves its destination and items with ${method}`, async ({
    page,
  }, testInfo) => {
    await seedCart(page, 2);
    await page.goto("/cart");
    const desktop = testInfo.project.name === "desktop-chromium";
    if (desktop)
      await page
        .locator(".header-actions")
        .getByRole("link", {
          name: "Entrar",
          exact: true,
        })
        .click();
    else
      await page
        .getByRole("link", {
          name: "Conectar e finalizar",
          exact: true,
        })
        .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("redirect"))
      .toBe(desktop ? "/cart" : "/checkout");
    if (method === "email") {
      await page.locator("#auth-email").fill("colecionador@kurio.test");
      await page.locator("#auth-password").fill("Kurio123!");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
    } else {
      await page
        .getByRole("button", {
          name: `Continuar com ${method}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog", {
          name: `Demonstração com ${method}`,
          exact: true,
        })
        .getByRole("button", {
          name: "Entrar na demonstração",
          exact: true,
        })
        .click();
    }
    await expect(page).toHaveURL(desktop ? /\/cart$/ : /\/checkout$/);
    if (desktop)
      await expect(
        page.locator(".cart-row").getByRole("status", { name: "Quantidade" }),
      ).toHaveText("2");
    else
      await expect(page.locator(".purchase-total dd")).toHaveText("2.396 ETH");
    await page.reload();
    await expect(page).toHaveURL(desktop ? /\/cart$/ : /\/checkout$/);
  });
}

test("checkout sign-in preserves the cart context when canceled", async ({
  page,
}, testInfo) => {
  await seedCart(page, 2);
  await page.goto("/cart");
  await page
    .getByRole("link", { name: "Conectar e finalizar", exact: true })
    .click();
  await expect(page.locator("#auth-email")).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await expect(page.locator(".auth-background .cart-page")).toBeVisible();
    await expect(page.locator(".auth-background .cart-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
  } else {
    await page.goBack();
  }
  await expect(page).toHaveURL(/\/cart$/);
  await expect(
    page.locator(".cart-row").getByRole("status", { name: "Quantidade" }),
  ).toHaveText("2");
});
