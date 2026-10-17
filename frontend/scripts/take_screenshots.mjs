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

    // Click Change to open modal at 1280x800
    await changeBtn.click();
    await page0.waitForTimeout(1000);
    const modal1280 = path.join(outputDir, 'caption_dialog_1280x800.png');
    await page0.screenshot({ path: modal1280 });
    console.log(`Saved modal 1280x800 screenshot to ${modal1280}`);
    await page0.close();

    // Modal at 960x640
    const page1 = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page1.goto('http://localhost:3456');
    await page1.waitForTimeout(1000);
    const changeBtn1 = page1.locator('button:has-text("Change")');
    await changeBtn1.scrollIntoViewIfNeeded();
    await changeBtn1.click();
    await page1.waitForTimeout(1000);
    const modal960 = path.join(outputDir, 'caption_dialog_960x640.png');
    await page1.screenshot({ path: modal960 });
    console.log(`Saved modal 960x640 screenshot to ${modal960}`);
    await page1.close();

    // Clips page with project_001 (mock/direct)
    const pageClips = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await pageClips.goto('http://localhost:3456/clips.html?project=project_001');
    await pageClips.waitForTimeout(1500);
    const clipsShot = path.join(outputDir, 'clips_page_controls.png');
    await pageClips.screenshot({ path: clipsShot });
    console.log(`Saved clips page screenshot to ${clipsShot}`);
    await pageClips.close();

    // Projects page
    const pageProjects = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await pageProjects.route('**/api/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [
            {
              project_id: 'project_001',
              created_at: new Date().toISOString(),
              source_type: 'Local MP4',
              clips: 3,
              status: 'Ready',
            },
          ],
        }),
      });
    });
    await pageProjects.route('**/api/jobs/active', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobs: [] }),
      });
    });
    await pageProjects.goto('http://localhost:3456/projects.html');
    await pageProjects.waitForTimeout(1000);
    const projectsShot = path.join(outputDir, 'projects_page.png');
    await pageProjects.screenshot({ path: projectsShot });
    console.log(`Saved projects page screenshot to ${projectsShot}`);
    await pageProjects.close();

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    server.close();
  }
});

