import { chromium } from 'playwright';
import fs from 'node:fs';

const svg = fs.readFileSync('/home/user/PoolSystem/public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

async function render(size, out, pad = 0) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await page.setContent(`<body style="margin:0;background:#030b12"><div style="padding:${pad}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></div></body>`);
  await page.screenshot({ path: out });
}

await render(192, '/home/user/PoolSystem/public/icons/icon-192.png');
await render(512, '/home/user/PoolSystem/public/icons/icon-512.png');
await render(512, '/home/user/PoolSystem/public/icons/maskable-512.png', 60);
await render(180, '/home/user/PoolSystem/public/icons/apple-touch-icon.png');
await browser.close();
console.log('icons generated');
