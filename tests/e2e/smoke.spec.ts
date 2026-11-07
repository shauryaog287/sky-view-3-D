import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('globe').locator('canvas').first()).toBeVisible();
  return errors;
}

test.describe('SkyView 3D smoke', () => {
  test('globe renders with a base layer and visible attribution', async ({ page }) => {
    const errors = await boot(page);
    await expect(page.getByTestId('layer-badge')).toBeVisible();
    // Data/imagery attribution must stay on screen.
    await expect(page.locator('.cesium-widget-credits')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('live aircraft appear (mock feed)', async ({ page }) => {
    const errors = await boot(page);
    await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
    expect(errors).toEqual([]);
  });
});
