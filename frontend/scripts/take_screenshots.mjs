import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../out');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join(outDir, reqPath);

  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    } else if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
});

server.listen(3456, async () => {
  try {
    let browser;
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch (e) {
      browser = await chromium.launch({ headless: true });
    }

    const outputDir = 'c:/Users/Abdullah PC/.gemini/antigravity/brain/8915abf3-0561-4872-bfcc-47fb0bcf4bec';

    // Summary row on main page (scroll to view)
    const page0 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page0.goto('http://localhost:3456');
    await page0.waitForTimeout(1000);
    const changeBtn = page0.locator('button:has-text("Change")');
    await changeBtn.scrollIntoViewIfNeeded();
    await page0.waitForTimeout(500);
    const summaryShot = path.join(outputDir, 'caption_summary_row.png');
    await page0.screenshot({ path: summaryShot });
    console.log(`Saved summary row screenshot to ${summaryShot}`);
    await page0.close();

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    server.close();
  }
});
