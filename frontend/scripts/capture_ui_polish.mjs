import path from 'path';
import { chromium } from 'playwright';

const outputDir = 'c:/Users/Abdullah PC/.gemini/antigravity/brain/8915abf3-0561-4872-bfcc-47fb0bcf4bec';

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    browser = await chromium.launch({ headless: true });
  }

  // 1. Dashboard at 2560x1080 (Ultrawide)
  console.log('Capturing Dashboard at 2560x1080...');
  const pageUltra = await browser.newPage({ viewport: { width: 2560, height: 1080 } });
  await pageUltra.goto('http://localhost:3000');
  await pageUltra.waitForTimeout(1500);
  await pageUltra.screenshot({ path: path.join(outputDir, 'dashboard_2560x1080.png') });
  await pageUltra.close();

  // 2. Dashboard at 1280x800
  console.log('Capturing Dashboard at 1280x800...');
  const page1280 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page1280.goto('http://localhost:3000');
  await page1280.waitForTimeout(1500);
  await page1280.screenshot({ path: path.join(outputDir, 'dashboard_1280x800.png') });

  // 3. Caption Style Modal at 1280x800
  console.log('Capturing Caption Modal at 1280x800...');
  const changeBtn = page1280.locator('button:has-text("Change")');
  await changeBtn.scrollIntoViewIfNeeded();
  await changeBtn.click();
  await page1280.waitForTimeout(1000);
  await page1280.screenshot({ path: path.join(outputDir, 'caption_modal_1280x800.png') });
  await page1280.close();

  // 4. Caption Style Modal at 960x640
  console.log('Capturing Caption Modal at 960x640...');
  const page960 = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page960.goto('http://localhost:3000');
  await page960.waitForTimeout(1500);
  const changeBtn960 = page960.locator('button:has-text("Change")');
  await changeBtn960.scrollIntoViewIfNeeded();
  await changeBtn960.click();
  await page960.waitForTimeout(1000);
  await page960.screenshot({ path: path.join(outputDir, 'caption_modal_960x640.png') });
  await page960.close();

  // 5. Clips Page at 2560x1080 with mock clips
  console.log('Capturing Clips Page at 2560x1080...');
  const pageClips = await browser.newPage({ viewport: { width: 2560, height: 1080 } });
  
  // Intercept clips API to provide rich mock data for visual review
  await pageClips.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [
          {
            project_id: 'sample_project',
            created_at: new Date().toISOString(),
            source_type: 'Local MP4',
            clips: 6,
            status: 'Ready',
          },
        ],
      }),
    });
  });

  await pageClips.route('**/api/projects/*/generation-jobs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: null }),
    });
  });

  await pageClips.route('**/api/projects/*/clips', async (route) => {
    const mockClips = [
      {
        id: 'clip_001',
        title: 'The AI Revolution in Vertical Video',
        start: 12.4,
        end: 42.8,
        duration: 30.4,
        reason: 'Discussion on how AI models process frames in real-time.',
        file: 'clip_001.mp4',
        top_line: 'THE REAL SECRET TO VIRAL HOOKS',
        framing_mode: 'standard',
        caption_style: 'robin',
        status: 'Ready',
      },
      {
        id: 'clip_002',
        title: 'Why Most Creators Fail in the First 3 Seconds',
        start: 65.2,
        end: 94.8,
        duration: 29.6,
        reason: 'Breakdown of audience retention patterns.',
        file: 'clip_002.mp4',
        top_line: 'WHY 90% OF CLIPS DIE EARLY',
        framing_mode: 'standard',
        caption_style: 'punch',
        status: 'Ready',
      },
      {
        id: 'clip_003',
        title: 'Sound Design & Subtitles Synergy',
        start: 110.0,
        end: 140.0,
        duration: 30.0,
        reason: 'Analyzing audio cues with kinetic typography.',
        file: 'clip_003.mp4',
        framing_mode: 'square_rounded',
        caption_style: 'pill',
        status: 'Ready',
      },
      {
        id: 'clip_004',
        title: 'Hardware Acceleration Benchmarks',
        start: 155.0,
        end: 185.0,
        duration: 30.0,
        reason: 'Local GPU vs CPU encoding performance on desktop.',
        file: 'clip_004.mp4',
        framing_mode: 'standard',
        caption_style: 'clean',
        status: 'Ready',
      },
      {
        id: 'clip_005',
        title: 'Optimizing Aspect Ratio & Safe Areas',
        start: 200.0,
        end: 230.0,
        duration: 30.0,
        reason: 'Guaranteed viewer engagement without edge clipping.',
        file: 'clip_005.mp4',
        framing_mode: 'standard',
        caption_style: 'classic',
        status: 'Ready',
      },
      {
        id: 'clip_006',
        title: 'Monetization Secrets for Long-form Repurposing',
        start: 245.0,
        end: 275.0,
        duration: 30.0,
        reason: 'Turning a single podcast into 20 viral shorts.',
        file: 'clip_006.mp4',
        framing_mode: 'standard',
        caption_style: 'karaoke',
        status: 'Ready',
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_id: 'sample_project',
        clips: mockClips,
        total: mockClips.length,
      }),
    });
  });

  await pageClips.goto('http://localhost:3000/clips?project=sample_project');
  await pageClips.waitForTimeout(1500);
  await pageClips.screenshot({ path: path.join(outputDir, 'clips_page_2560x1080.png') });
  await pageClips.close();

  await browser.close();
  console.log('All screenshots successfully captured!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
