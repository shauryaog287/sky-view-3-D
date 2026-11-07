/**
 * Rasterises public/icons/icon.svg into the PWA / Play Store icon sizes using the preinstalled Chromium.
 *
 *   npm run data:icons
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const plane =
  'M32 3c2 0 3.2 2.6 3.2 6v14.5L60 36.5v4.2l-24.8-7.4v16.2l7.4 5.6v3.6L32 56l-10.6 2.7v-3.6l7.4-5.6V33.3L4 40.7v-4.2l24.8-13V9c0-3.4 1.2-6 3.2-6z';

const jobs: { file: string; size: number; html: string }[] = [
  { file: 'icon-192.png', size: 192, html: svg },
  { file: 'icon-512.png', size: 512, html: svg },
  { file: 'apple-touch-icon.png', size: 180, html: svg.replace('rx="112"', 'rx="0"') },
  // Maskable: full-bleed background, artwork inside the 80% safe zone.
  {
    file: 'maskable-512.png',
    size: 512,
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#060b14"/><g transform="translate(51 51) scale(0.8)">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g></svg>`,
  },
  // Notification badge: white silhouette on transparent (Android tints it).
  {
    file: 'badge-72.png',
    size: 72,
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#fff" transform="rotate(45 32 32)" d="${plane}"/></svg>`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${j.html.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  writeFileSync(join(dir, j.file), png);
  console.log(`${j.file} ${j.size}px`);
}
await browser.close();
