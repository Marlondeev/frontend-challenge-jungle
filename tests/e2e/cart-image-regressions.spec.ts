import { test, expect, control } from "./helpers";

for (const width of [390, 768, 1440]) {
  test(`adding to the cart preserves NFT artwork dimensions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/nft/emerald-ape-042");
    await expect(
      page.getByRole("heading", { name: "Emerald Ape #042", exact: true }),
    ).toBeVisible();
    const add = page.getByRole("button", {
      name: "Adicionar ao carrinho",
      exact: true,
    });
    await expect(add).toBeEnabled();
    const artwork = page.locator(".detail-image img");
    await artwork.evaluate(async (image) => {
      await document.fonts.ready;
      if (image instanceof HTMLImageElement) await image.decode();
    });
    const before = await artwork.boundingBox();
    expect(before).not.toBeNull();
    await control(page, { action: "scenario", scenario: "slow" });
    const response = page.waitForResponse(
      (item) =>
        item.request().method() === "POST" &&
        new URL(item.url()).pathname === "/api/cart/items",
    );
    await add.click();
    await expect(add).toBeDisabled();
    const pending = await artwork.boundingBox();
    expect(pending).not.toBeNull();
    expect(pending!.width).toBeCloseTo(before!.width, 0);
    expect(pending!.height).toBeCloseTo(before!.height, 0);
    await expect(page.locator(".detail-info [role=status]")).toHaveText(
      "NFT adicionado ao carrinho.",
    );
    const after = await artwork.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 0);
    expect(after!.height).toBeCloseTo(before!.height, 0);
    expect((await (await response).json()).items).toEqual([
      expect.objectContaining({ nftId: "emerald-ape-042", quantity: 1 }),
    ]);
    await page.screenshot({
      path: `output/playwright/followup/image-after-add-${width}.png`,
      fullPage: true,
    });
  });
}
