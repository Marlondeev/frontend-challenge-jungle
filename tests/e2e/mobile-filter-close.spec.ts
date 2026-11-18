import type { Page } from "@playwright/test";
import { test, expect, filters } from "./helpers";

async function expectApplied(page: Page) {
  if (await page.locator(".mobile-search > button").isVisible()) {
    await expect(
      page.getByRole("dialog", { name: "Filtros", exact: true }),
    ).toHaveCount(0);
  } else {
    await expect(page.locator(".market > aside")).toBeVisible();
  }
}

test("collection selection applies immediately and closes the mobile filter panel", async ({
  page,
}) => {
  let panel = await filters(page);
  await panel.getByRole("button", { name: /^Arte 3D/ }).click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("3 NFTs encontrados");
  expect(new URL(page.url()).searchParams.get("category")).toBe("Arte 3D");

  panel = await filters(page);
  await panel.getByRole("button", { name: /^Todas/ }).click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("27 NFTs encontrados");
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);
});

test("network selection and clearing filters close the mobile panel with updated results", async ({
  page,
}) => {
  let panel = await filters(page);
  await panel.getByRole("button", { name: /^Polygon/ }).click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("9 NFTs encontrados");
  expect(new URL(page.url()).searchParams.get("network")).toBe("Polygon");

  panel = await filters(page);
  await panel
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("27 NFTs encontrados");
  expect(new URL(page.url()).searchParams.has("network")).toBe(false);
});

test("sorting applies before the mobile filter panel closes", async ({
  page,
}) => {
  const mobile = await page
    .getByRole("button", { name: "Abrir filtros", exact: true })
    .isVisible();
  const panel = mobile ? await filters(page) : page.locator(".market-toolbar");
  await panel
    .getByRole("combobox", { name: "Ordenar por", exact: true })
    .selectOption("price-asc");
  await expectApplied(page);
  await expect(page.locator(".nft-grid .card-name").first()).toHaveText(
    "Violet Dreams #026",
  );
  expect(new URL(page.url()).searchParams.get("sort")).toBe("price-asc");
});

test("price handles keep the mobile panel open until Apply commits the range", async ({
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
  await minimum.press("Home");
  await minimum.press("ArrowRight");
  await maximum.press("Home");
  await maximum.press("ArrowRight");
  await expect(panel).toBeVisible();
  await expect(minimum).toHaveValue("1");
  await expect(maximum).toHaveValue("2");
  expect(new URL(page.url()).searchParams.has("min")).toBe(false);
  expect(new URL(page.url()).searchParams.has("max")).toBe(false);

  await panel.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("0 NFTs encontrados");
  expect(JSON.parse(new URL(page.url()).searchParams.get("min")!)).toBe("0.01");
  expect(JSON.parse(new URL(page.url()).searchParams.get("max")!)).toBe("0.02");

  panel = await filters(page);
  await expect(
    panel.getByRole("slider", { name: "Preço mínimo", exact: true }),
  ).toHaveValue("1");
  await expect(
    panel.getByRole("slider", { name: "Preço máximo", exact: true }),
  ).toHaveValue("2");
  await panel
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expectApplied(page);
  await expect(page.locator(".result-count")).toHaveText("27 NFTs encontrados");
});
