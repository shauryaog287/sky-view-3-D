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

test.describe('flight details and cameras', () => {
  test('search a flight number, open details, follow and stop', async ({ page }) => {
    const errors = await boot(page);
    await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
    // SKV101 is a scripted demo arrival into Delhi in mock mode.
    await page.fill('#flight-search', 'SKV101');
    await page.press('#flight-search', 'Enter');
    const panel = page.getByTestId('info-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('info-callsign')).toHaveText('SKV101');
    await expect(page.getByTestId('route')).toContainText('DEL');
    await expect(page.getByTestId('data-age')).toContainText(/Live|Estimated/);
    await page.getByTestId('cam-chase').click();
    await expect(page.getByTestId('cam-chase')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cam-stop').click();
    await expect(page.getByTestId('cam-chase')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
});

test('approach detection offers tower and runway cameras', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
  await page.fill('#flight-search', 'SKV101');
  await page.press('#flight-search', 'Enter');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  // Scripted arrival: phase detection should report approach (or landing/ground late in its loop).
  await expect(page.getByTestId('info-panel')).toContainText(/On approach|Landing|On ground|Descending/, { timeout: 15_000 });
  await page.getByTestId('cam-tower').click();
  await expect(page.getByTestId('cam-tower')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('cam-runway').click();
  await expect(page.getByTestId('cam-runway')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('settings: quality presets and toggles', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('open-settings').click();
  const sheet = page.getByTestId('settings');
  await expect(sheet).toBeVisible();
  await page.getByTestId('quality-low').click();
  await expect(page.getByTestId('quality-low')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('quality-high').click(); // open launch mode: everything unlocked
  await expect(page.getByTestId('quality-high')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('replay the last hour of a flight', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
  await page.fill('#flight-search', 'SKV202');
  await page.press('#flight-search', 'Enter');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await page.getByTestId('btn-replay').click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  await expect(page.getByTestId('replay-play')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('replay-play').click(); // pause
  await page.getByTestId('replay-exit').click();
  await expect(page.getByTestId('replay-bar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('set a flight alert', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
  await page.fill('#flight-search', 'SKV101');
  await page.press('#flight-search', 'Enter');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await page.getByTestId('btn-alerts').click();
  const sheet = page.getByTestId('alert-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByText('lands').click();
  await page.getByTestId('alert-create').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.toast').filter({ hasText: 'Alert set' })).toBeVisible();
  expect(errors).toEqual([]);
});
