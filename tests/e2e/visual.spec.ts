import { test, expect, login, seedCart } from './helpers'

for (const screen of ['home', 'detail', 'cart', 'checkout'] as const) {
  test(`visual regression: ${screen}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (screen === 'detail') {
      await page.goto('/nft/emerald-ape-042')
      await expect(page.getByRole('heading', { name: 'Emerald Ape #042', exact: true })).toBeVisible()
      // The related query initially reuses the broad catalogue while its
      // category request is pending; wait for the final fixture's two peers.
      await expect(page.locator('.related-grid .nft-card')).toHaveCount(2)
    } else if (screen === 'cart') {
      await seedCart(page, 2)
      await seedCart(page, 1, 'sage-nomad-009')
      await page.goto('/cart')
      await expect(page.locator('.purchase-total dd')).toContainText('ETH')
      await expect(page.getByRole('link', { name: 'Conectar e finalizar', exact: true })).toBeEnabled()
    } else if (screen === 'checkout') {
      await login(page)
      await seedCart(page, 2)
      await page.goto('/checkout')
      await expect(page.getByRole('button', { name: 'Revisar compra', exact: true })).toBeEnabled()
    }
    // Native lazy images below the viewport must be brought into view before
    // decode(): decoding an image whose lazy request never started can hang.
    for (const image of await page.locator('img:visible').all()) {
      await image.scrollIntoViewIfNeeded()
      await expect.poll(() => image.evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true)
    }
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images).filter(image => image.complete && image.naturalWidth > 0).map(image => image.decode()))
      window.scrollTo(0, 0)
    })
    await expect(page.locator('.card-skeleton')).toHaveCount(0)
    const path = `output/playwright/e2e/${screen}-${testInfo.project.name}.png`
    await page.screenshot({ path, fullPage: true, animations: 'disabled' })
    await testInfo.attach(`${screen} full-page capture`, { path, contentType: 'image/png' })
    await expect(page).toHaveScreenshot(`${screen}.png`, { fullPage: true })
  })
}
