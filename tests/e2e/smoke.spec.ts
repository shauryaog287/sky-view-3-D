import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page, path = '/') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
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

/** Mock-only time shift that puts scripted flight SKV101 (DEL 28 arrival, 460 s loop, offset 330 s) at `localS`. */
function simShiftFor(localS: number) {
  const local = (Date.now() / 1000 + 330) % 460;
  return Math.round((((localS - local) % 460) + 460) % 460);
}

test('approach detection offers tower and runway cameras', async ({ page }) => {
  // Mid-approach, ~8 NM out, so the test does not depend on where the demo loop happens to be.
  const errors = await boot(page, `/?simShift=${simShiftFor(200)}`);
  await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
  await page.fill('#flight-search', 'SKV101');
  await page.press('#flight-search', 'Enter');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  // Scripted arrival: phase detection should report approach (or landing/ground late in its loop).
  await expect(page.getByTestId('info-panel')).toContainText('On approach', { timeout: 15_000 });
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

test('freemium mode: locked feature → upsell → sign in → test checkout → unlocked', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sv_mock_launch_mode', JSON.stringify('freemium'));
    localStorage.removeItem('sv_mock_sub');
    localStorage.removeItem('sv_mock_user');
  });
  const errors = await boot(page);
  await expect(page.getByTestId('flight-count')).toContainText(/[1-9]\d* flights/);
  await page.fill('#flight-search', 'SKV202');
  await page.press('#flight-search', 'Enter');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  // Free features still work; Pro ones show a lock and open the upsell sheet instead of a broken screen.
  await expect(page.getByTestId('btn-replay')).toContainText('🔒');
  await page.getByTestId('btn-replay').click();
  await expect(page.getByTestId('upsell')).toBeVisible();
  await page.getByTestId('upsell-signin').click();
  await expect(page.getByTestId('account')).toBeVisible();
  await page.getByTestId('email').fill('pilot@example.com');
  await page.getByTestId('send-code').click();
  await page.getByTestId('otp').fill('123456');
  await page.getByTestId('verify-code').click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  await expect(page.getByTestId('plan')).toHaveText('Free');
  await page.getByTestId('buy-pro_monthly').click();
  await page.getByTestId('mock-pay').click();
  await expect(page.getByTestId('plan')).toHaveText('Pro Monthly');
  await expect(page.getByTestId('renew-date')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-replay')).not.toContainText('🔒');
  await page.getByTestId('btn-replay').click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  expect(errors).toEqual([]);
});
