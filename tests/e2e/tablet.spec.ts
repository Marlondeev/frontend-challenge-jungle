import { test, expect } from "./helpers";

test("tablet catalogue keeps filtering and sorting inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(768);
  const sort = page.getByRole("combobox", { name: "Ordenar por" });
  const sortBounds = await sort.boundingBox();
  expect(sortBounds).not.toBeNull();
  expect(sortBounds!.x + sortBounds!.width).toBeLessThanOrEqual(768);
  await sort.selectOption("price-desc");
  await expect(page.locator(".nft-grid .card-name").first()).toHaveText(
    "Neon Vessel #552",
  );
  await page
    .locator(".market > aside")
    .getByRole("button", { name: /^Arte digital/ })
    .click();
  await expect(page.locator(".result-count")).toHaveText("3 NFTs encontrados");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(768);
  await page.goto("/nft/emerald-ape-042");
  await expect(
    page.getByRole("heading", { name: "Emerald Ape #042", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(768);
});
