import { test, expect } from '@playwright/test';

test.describe('SkyView 3D smoke', () => {
  test('globe renders with a base layer and visible attribution', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('globe').locator('canvas').first()).toBeVisible();
    await expect(page.getByTestId('layer-badge')).toBeVisible();
    // Data/imagery attribution must stay on screen.
    await expect(page.locator('.cesium-widget-credits')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
