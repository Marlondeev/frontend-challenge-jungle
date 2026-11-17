import { test, expect, filters, closeFilters } from "./helpers";

test("clear before applying also resets the draft price handles", async ({
  page,
}) => {
  const panel = await filters(page);
  const minimum = panel.getByRole("slider", {
    name: "Preço mínimo",
    exact: true,
  });
  await minimum.press("ArrowRight");
  await expect(minimum).toHaveValue("3");
  await panel
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(minimum).toHaveValue("2");
  await expect(
    panel.getByRole("slider", { name: "Preço máximo", exact: true }),
  ).toHaveValue("1230");
});

test("price range applies both limits and restores them through refresh and clear", async ({
  page,
}) => {
  let panel = await filters(page);
  const minimum = panel.getByRole("slider", {
    name: "Preço mínimo",
    exact: true,
  });
  const maximum = panel.getByRole("slider", {
    name: "Preço máximo",
    exact: true,
  });
  await expect(minimum).toHaveValue("2");
  await expect(maximum).toHaveValue("1230");
  await minimum.press("Home");
  for (let step = 0; step < 50; step++) await minimum.press("ArrowRight");
  await maximum.press("Home");
  for (let step = 0; step < 50; step++) await maximum.press("ArrowRight");
  await expect(minimum).toHaveValue("50");
  await expect(maximum).toHaveValue("100");
  await expect(panel.locator(".price-range-label")).toHaveText(
    "Preço: 0,50 – 1,00 ETH",
  );
  expect(new URL(page.url()).searchParams.has("min")).toBe(false);
  await panel.getByRole("button", { name: "Aplicar", exact: true }).click();
  await closeFilters(page);
  await expect(page.locator(".result-count")).toHaveText("18 NFTs encontrados");
  const params = new URL(page.url()).searchParams;
  expect(JSON.parse(params.get("min")!)).toBe("0.50");
  expect(JSON.parse(params.get("max")!)).toBe("1.00");
  for (const price of await page
    .locator(".nft-grid .card-price")
    .allTextContents()) {
    const amount = Number.parseFloat(price);
    expect(amount).toBeGreaterThanOrEqual(0.5);
    expect(amount).toBeLessThanOrEqual(1);
  }
  await page.reload();
  await expect(page.locator(".result-count")).toHaveText("18 NFTs encontrados");
  panel = await filters(page);
  await expect(
    panel.getByRole("slider", { name: "Preço mínimo", exact: true }),
  ).toHaveValue("50");
  await expect(
    panel.getByRole("slider", { name: "Preço máximo", exact: true }),
  ).toHaveValue("100");
  await panel
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(
    panel.getByRole("slider", { name: "Preço mínimo", exact: true }),
  ).toHaveValue("2");
  await expect(
    panel.getByRole("slider", { name: "Preço máximo", exact: true }),
  ).toHaveValue("1230");
  await closeFilters(page);
  await expect(page.locator(".result-count")).toHaveText("27 NFTs encontrados");
  expect(new URL(page.url()).searchParams.has("min")).toBe(false);
});

test("dragging a price handle updates the draft before applying an empty range", async ({
  page,
}) => {
  const panel = await filters(page);
  const minimum = panel.getByRole("slider", {
    name: "Preço mínimo",
    exact: true,
  });
  await expect(minimum).toHaveValue("2");
  await minimum.scrollIntoViewIfNeeded();
  const bounds = await minimum.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 7, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width / 4,
    bounds!.y + bounds!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await minimum.inputValue()))
    .toBeGreaterThan(199);
  expect(new URL(page.url()).searchParams.has("min")).toBe(false);
  await panel.getByRole("button", { name: "Aplicar", exact: true }).click();
  await closeFilters(page);
  await expect(
    page.getByText("Nenhum NFT encontrado. Experimente alterar os filtros.", {
      exact: true,
    }),
  ).toBeVisible();
});
