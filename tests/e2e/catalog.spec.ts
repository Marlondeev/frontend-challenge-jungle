import { test, expect, control, filters, closeFilters, rest } from "./helpers";
import type { CatalogResponse } from "../../src/domain/types";

test("catalogue combines search, collection, network, price and sort in the URL", async ({
  page,
}) => {
  const mobileSearch = page.getByRole("textbox", {
    name: "Explorar coleções",
    exact: true,
  });
  if (await mobileSearch.isVisible()) await mobileSearch.fill("Emerald");
  else {
    await page.getByRole("button", { name: "Abrir busca" }).click();
    await page
      .getByRole("textbox", { name: "Buscar NFTs", exact: true })
      .fill("Emerald");
    await page
      .getByRole("textbox", { name: "Buscar NFTs", exact: true })
      .press("Enter");
  }
  await expect(page).toHaveURL(/q=Emerald/);
  const panel = await filters(page);
  await panel.getByRole("button", { name: /^Arte digital/ }).click();
  await panel.getByRole("button", { name: /^Ethereum/ }).click();
  const minimum = panel.getByRole("slider", {
    name: "Preço mínimo",
    exact: true,
  });
  const maximum = panel.getByRole("slider", {
    name: "Preço máximo",
    exact: true,
  });
  await minimum.press("Home");
  for (let step = 0; step < 100; step++) await minimum.press("ArrowRight");
  await maximum.press("Home");
  for (let step = 0; step < 100; step++) await maximum.press("ArrowRight");
  await panel.getByRole("button", { name: "Aplicar", exact: true }).click();
  await closeFilters(page);
  await page
    .getByRole("combobox", { name: "Ordenar por" })
    .selectOption("price-asc");
  await expect(page.locator(".result-count")).toHaveText("1 NFTs encontrados");
  await expect(page.locator(".nft-grid .nft-card")).toHaveCount(1);
  await expect(page.locator(".nft-grid")).toContainText("Emerald Ape #042");
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({
    q: "Emerald",
    category: "Arte digital",
    network: "Ethereum",
    sort: "price-asc",
    page: "1",
  });
  // TanStack Router JSON-encodes numeric-looking strings to retain their type.
  expect(JSON.parse(params.get("min")!)).toBe("1.00");
  expect(JSON.parse(params.get("max")!)).toBe("2.00");
  const url = page.url();
  await page.reload();
  await expect(page.locator(".result-count")).toHaveText("1 NFTs encontrados");
  await expect(page).toHaveURL(url);
});

test("catalogue pagination, sort, tabs and browser history restore their context", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Paginação" })
    .getByRole("button", { name: "2", exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".nft-grid")).toContainText("Violet Dreams #010");
  const pageTwo = page.url();
  await page
    .getByRole("combobox", { name: "Ordenar por" })
    .selectOption("price-desc");
  await expect(page).toHaveURL(/page=1/);
  await expect(page.locator(".nft-grid .card-name").first()).toHaveText(
    "Neon Vessel #552",
  );
  await page.goBack();
  await expect(page).toHaveURL(pageTwo);
  await expect(page.locator(".nft-grid")).toContainText("Violet Dreams #010");
  await page.goForward();
  await expect(page.getByRole("combobox", { name: "Ordenar por" })).toHaveValue(
    "price-desc",
  );
  await page
    .getByRole("button", { name: "Novos lançamentos", exact: true })
    .click();
  await expect(page).toHaveURL(/tab=new/);
  await expect(page.locator(".result-count")).toHaveText("7 NFTs encontrados");
  const data = await rest<CatalogResponse>(
    page,
    "/nfts?tab=new&sort=price-desc",
  );
  await expect(page.locator(".nft-grid .card-name")).toHaveText(
    data.items.map((nft) => nft.name),
  );
});

test("detail works through a direct URL and missing NFT is recoverable", async ({
  page,
}) => {
  await page.goto("/nft/emerald-ape-042");
  await expect(
    page.getByRole("heading", { name: "Emerald Ape #042", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1/10", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1/10", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: /Avaliações de colecionadores/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("nota média 4.8");
  await page.goto("/nft/nft-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "NFT indisponível" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("NFT não encontrado.");
  await page
    .getByRole("link", { name: "Voltar ao mercado", exact: true })
    .click();
  await expect(page.locator(".result-count")).toHaveText("27 NFTs encontrados");
});

test("slow catalogue preserves skeleton space and service failure retries successfully", async ({
  page,
}) => {
  await control(page, { action: "scenario", scenario: "slow" });
  await page.reload();
  await expect(page.locator(".card-skeleton")).toHaveCount(9);
  const skeleton = await page.locator(".card-skeleton").first().boundingBox();
  expect(skeleton?.height).toBeGreaterThan(150);
  await expect(page.locator(".nft-grid .nft-card")).toHaveCount(9);
  await control(page, { action: "scenario", scenario: "server-error" });
  await page.goto("/?q=Emerald");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Serviço temporariamente indisponível" }),
  ).toBeVisible();
  await control(page, { action: "scenario", scenario: "success" });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(page.locator(".nft-grid .nft-card")).toHaveCount(5);
  await control(page, { action: "scenario", scenario: "empty" });
  await page.goto("/?q=nenhum");
  await expect(
    page.getByText("Nenhum NFT encontrado. Experimente alterar os filtros."),
  ).toBeVisible();
});
