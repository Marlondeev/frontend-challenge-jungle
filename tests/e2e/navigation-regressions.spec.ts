import {
  test,
  expect,
  seedCart,
  openSort,
  closeFilters,
  sortCatalog,
} from "./helpers";

test("promo explore returns to the market on repeated same-hash activation", async ({
  page,
}) => {
  await page.goto("/#mercado");
  await sortCatalog(page, "price-desc");
  await expect(page.locator(".nft-grid .card-name").first()).toHaveText(
    "Neon Vessel #552",
  );
  for (const [index, keyboard] of [
    [0, false],
    [1, true],
    [0, false],
  ] as const) {
    const explore = page.locator(".promos .solid-link").nth(index);
    await explore.scrollIntoViewIfNeeded();
    if (keyboard) await explore.press("Enter");
    else await explore.click();
    await expect
      .poll(() =>
        page
          .locator("#mercado")
          .evaluate((element) =>
            Math.abs(element.getBoundingClientRect().top - 24),
          ),
      )
      .toBeLessThan(5);
    await expect(page).toHaveURL(/sort=price-desc.*#mercado$/);
  }
});

async function scrollToMarket(page: import("@playwright/test").Page) {
  await page.locator("#mercado").evaluate((element) => {
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - 24,
      behavior: "instant",
    });
  });
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
}

test("header selects each catalogue section and keeps it selected after filtering", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const navigation = page.getByRole("navigation", {
    name: "Navegação principal",
  });
  for (const [name, hash] of [
    ["Mercado", "mercado"],
    ["Criadores", "criadores"],
    ["Aprenda", "aprenda"],
  ] as const) {
    const link = navigation.getByRole("link", { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(link).toHaveClass(/active/);
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(
      navigation.getByRole("link", { name: "Início", exact: true }),
    ).not.toHaveClass(/active/);
  }
  await navigation.getByRole("link", { name: "Mercado", exact: true }).click();
  await page
    .locator(".market > aside")
    .getByRole("button", { name: /^Arte digital/ })
    .click();
  await expect(page.locator(".result-count")).toHaveText("3 NFTs encontrados");
  await expect(
    navigation.getByRole("link", { name: "Mercado", exact: true }),
  ).toHaveClass(/active/);
  await navigation.getByRole("link", { name: "Início", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await expect(
    navigation.getByRole("link", { name: "Início", exact: true }),
  ).toHaveClass(/active/);
});

test("catalogue sort and filters preserve the visible market position", async ({
  page,
}, testInfo) => {
  await scrollToMarket(page);
  // Opening the mobile drawer brings its search-bar trigger into view.
  // Record the position after that user action, before sorting changes data.
  const sort = await openSort(page);
  const drawer = page.getByRole("dialog", { name: "Filtros", exact: true });
  const mobile = await drawer.isVisible();
  const beforeSort = await page.evaluate(() => window.scrollY);
  await sort
    .getByRole("combobox", { name: "Ordenar por" })
    .selectOption("price-desc");
  if (mobile) await expect(drawer).toBeHidden();
  await closeFilters(page);
  await expect(page.locator(".nft-grid .card-name").first()).toHaveText(
    "Neon Vessel #552",
  );
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - beforeSort),
  ).toBeLessThan(3);
  if (testInfo.project.name === "desktop-chromium") {
    const beforeFilter = await page.evaluate(() => window.scrollY);
    await page
      .locator(".market > aside")
      .getByRole("button", { name: /^Arte digital/ })
      .click();
    await expect(page.locator(".result-count")).toHaveText(
      "3 NFTs encontrados",
    );
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - beforeFilter),
    ).toBeLessThan(3);
  } else {
    await scrollToMarket(page);
    const beforeTab = await page.evaluate(() => window.scrollY);
    await page
      .getByRole("button", { name: "Novos lançamentos", exact: true })
      .click();
    await expect(page.locator(".result-count")).toHaveText(
      "7 NFTs encontrados",
    );
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - beforeTab),
    ).toBeLessThan(3);
  }
  await expect(page).toHaveURL(/#mercado$/);
});

test("continue shopping returns from the cart to the real market anchor", async ({
  page,
}) => {
  await seedCart(page);
  await page.goto("/cart");
  await page
    .getByRole("link", { name: "Continuar explorando", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#mercado$/);
  await expect(page.locator(".nft-grid .nft-card")).toHaveCount(9);
  await expect
    .poll(() =>
      page
        .locator("#mercado")
        .evaluate((element) =>
          Math.abs(element.getBoundingClientRect().top - 24),
        ),
    )
    .toBeLessThan(5);
});

test("detail and unavailable NFT return to the market section", async ({
  page,
}, testInfo) => {
  await page.goto("/nft/emerald-ape-042");
  await expect(
    page.getByRole("heading", { name: "Emerald Ape #042", exact: true }),
  ).toBeVisible();
  const back =
    testInfo.project.name === "mobile-chromium"
      ? page.getByRole("link", { name: "Voltar ao mercado", exact: true })
      : page
          .getByRole("navigation", { name: "Navegação principal" })
          .getByRole("link", { name: "Mercado", exact: true });
  await back.click();
  await expect(page).toHaveURL(/\/#mercado$/);
  await expect
    .poll(() =>
      page
        .locator("#mercado")
        .evaluate((element) =>
          Math.abs(element.getBoundingClientRect().top - 24),
        ),
    )
    .toBeLessThan(5);
  await page.goto("/nft/nft-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "NFT indisponível", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Voltar ao mercado", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#mercado$/);
  await expect
    .poll(() =>
      page
        .locator("#mercado")
        .evaluate((element) =>
          Math.abs(element.getBoundingClientRect().top - 24),
        ),
    )
    .toBeLessThan(5);
});
