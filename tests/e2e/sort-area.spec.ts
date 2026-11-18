import { test, expect, openSort, closeFilters } from "./helpers";

test("the whole sort control opens its options and preserves the selected order", async ({
  page,
}) => {
  const control = await openSort(page);
  const drawer = page.getByRole("dialog", { name: "Filtros", exact: true });
  const mobile = await drawer.isVisible();
  const select = control.getByRole("combobox", {
    name: "Ordenar por",
    exact: true,
  });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toHaveCSS("cursor", "pointer");
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  await control.click({ position: { x: 5, y: box!.height / 2 } });
  await expect
    .poll(() => select.evaluate((element) => element.matches(":open")))
    .toBe(true);
  await page.keyboard.press("Escape");
  await control.click({ position: { x: box!.width - 6, y: box!.height / 2 } });
  await expect
    .poll(() => select.evaluate((element) => element.matches(":open")))
    .toBe(true);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=price-asc/);
  if (mobile) {
    await expect(drawer).toBeHidden();
    const selectedControl = await openSort(page);
    await expect(
      selectedControl.getByRole("combobox", {
        name: "Ordenar por",
        exact: true,
      }),
    ).toHaveValue("price-asc");
  } else await expect(select).toHaveValue("price-asc");
  await closeFilters(page);
  await page.reload();
  const restoredControl = await openSort(page);
  await expect(
    restoredControl.getByRole("combobox", {
      name: "Ordenar por",
      exact: true,
    }),
  ).toHaveValue("price-asc");
  await closeFilters(page);
});
