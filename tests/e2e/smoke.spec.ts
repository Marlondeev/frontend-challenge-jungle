import { test, expect } from '@playwright/test'
test('loads the real application and catalogue', async ({page}, testInfo) => {
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-ready','true')
  await expect(page.getByRole('heading',{name:/SEJA DONO/i})).toBeVisible()
  await expect(page.getByRole('link',{name:/Emerald Ape/}).first()).toBeVisible()
  await page.screenshot({path:`output/playwright/home-${testInfo.project.name}.png`,fullPage:true})
  expect(errors).toEqual([])
})
