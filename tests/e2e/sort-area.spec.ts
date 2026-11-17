import { test, expect } from "./helpers";

test("the whole sort control opens its options and preserves the selected order", async ({
  page,
}) => {
  const control = page.locator(".sort");
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
  await expect(select).toHaveValue("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.reload();
  await expect(select).toHaveValue("price-asc");
});
