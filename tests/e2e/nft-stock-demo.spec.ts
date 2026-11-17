import { control, expect, rest, test } from "./helpers";
import type { Cart } from "../../src/domain/types";

test("the first NFT opens with multiple editions and adds quantity two to the persistent cart", async ({
  page,
  isMobile,
}, testInfo) => {
  await page
    .getByRole("link", { name: "Ver Emerald Ape #042", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "1/10", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const purchase = page.locator(
    isMobile ? ".mobile-purchase" : ".desktop-purchase",
  );
  const quantity = purchase.locator(".quantity > span");
  const increase = purchase.getByRole("button", {
    name: "Aumentar quantidade",
    exact: true,
  });
  const decrease = purchase.getByRole("button", {
    name: "Diminuir quantidade",
    exact: true,
  });
  await expect(quantity).toHaveText("1");
  await expect(decrease).toBeDisabled();
  await expect(increase).toBeEnabled();
  await increase.click();
  await expect(quantity).toHaveText("2");
  await decrease.click();
  await expect(quantity).toHaveText("1");
  await increase.click();
  await expect(quantity).toHaveText("2");
  await page.screenshot({
    path: `output/playwright/stock-demo-defaults/quantity-two-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/cart/items",
  );
  await purchase
    .getByRole("button", { name: "Adicionar ao carrinho", exact: true })
    .click();
  const response = await posted;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({
    nftId: "emerald-ape-042",
    editionId: "ten",
    quantity: 2,
  });
  expect((await response.json()).items).toEqual([
    expect.objectContaining({
      nftId: "emerald-ape-042",
      editionId: "ten",
      quantity: 2,
    }),
  ]);
  await page.goto("/cart");
  const row = page.locator(".cart-row").filter({ hasText: "Emerald Ape #042" });
  await expect(
    row.getByRole("status", { name: "Quantidade", exact: true }),
  ).toHaveText("2");
  await page.reload();
  await expect(
    row.getByRole("status", { name: "Quantidade", exact: true }),
  ).toHaveText("2");
  expect((await rest<Cart>(page, "/cart")).items).toEqual([
    expect.objectContaining({
      nftId: "emerald-ape-042",
      editionId: "ten",
      quantity: 2,
    }),
  ]);
  await page.screenshot({
    path: `output/playwright/stock-demo-defaults/cart-two-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("only the three examples prefer multiple editions and a manual 1/1 choice remains limited", async ({
  page,
  isMobile,
}) => {
  const purchase = page.locator(
    isMobile ? ".mobile-purchase" : ".desktop-purchase",
  );
  for (const id of ["sage-nomad-009", "neon-vessel-552", "emerald-ape-042"]) {
    await page.goto(`/nft/${id}`);
    await expect(
      page.getByRole("button", { name: "1/10", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      purchase.getByRole("button", {
        name: "Aumentar quantidade",
        exact: true,
      }),
    ).toBeEnabled();
  }
  const increase = purchase.getByRole("button", {
    name: "Aumentar quantidade",
    exact: true,
  });
  for (let count = 1; count < 10; count++) await increase.click();
  await expect(purchase.locator(".quantity > span")).toHaveText("10");
  await expect(increase).toBeDisabled();
  await page.getByRole("button", { name: "1/1", exact: true }).click();
  await expect(purchase.locator(".quantity > span")).toHaveText("1");
  await expect(increase).toBeDisabled();
  await control(page, {
    action: "nft-update",
    nftId: "emerald-ape-042",
    price: "1.25",
  });
  await expect(page.locator(".detail-price")).toContainText("1.25 ETH");
  await expect(
    page.getByRole("button", { name: "1/1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(increase).toBeDisabled();
  await page.goto("/nft/cosmic-bloom-118");
  await expect(
    page.getByRole("button", { name: "1/1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(increase).toBeDisabled();
});

test("an exhausted preferred edition falls back without replenishing the saved stock", async ({
  page,
  isMobile,
}) => {
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("kurio.mock.v1")!);
    const nft = saved.nfts.find(
      (entry: { id: string }) => entry.id === "emerald-ape-042",
    );
    nft.editions.find((edition: { id: string }) => edition.id === "ten").stock =
      0;
    localStorage.setItem("kurio.mock.v1", JSON.stringify(saved));
  });
  await page.goto("/nft/emerald-ape-042");
  await expect(
    page.getByRole("button", { name: "1/10 (esgotada)", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "1/1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const purchase = page.locator(
    isMobile ? ".mobile-purchase" : ".desktop-purchase",
  );
  await expect(
    purchase.getByRole("button", { name: "Aumentar quantidade", exact: true }),
  ).toBeDisabled();
});
