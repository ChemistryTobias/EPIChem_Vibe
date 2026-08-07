/**
 * Drives the console in a headless browser and writes one PNG per screen.
 *
 * Run against a stack that is already up and seeded (docs/MILESTONE_CI_CD.md
 * §5). Locally:
 *
 *     docker compose up -d
 *     npx playwright install --with-deps chromium
 *     node deploy/screenshots.mjs
 *
 * In CI this runs inside the Playwright image, which already has the browser.
 *
 * The hard part of this job is not taking the picture, it is taking the SAME
 * picture twice. A screenshot set that changes on every run is a diff nobody
 * reads, so everything below is in service of determinism: a fixed viewport,
 * a fixed seed (deploy/seed.sh uses hard-coded sample codes for exactly this
 * reason), waiting on real content rather than on a timeout, and blanking the
 * one thing that legitimately changes between runs — timestamps.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.EPICHEM_BASE_URL ?? "http://localhost:5173";
const OUT_DIR = process.env.EPICHEM_SCREENSHOT_DIR ?? "docs/screenshots";

/** Deliberately not a round number the CSS might special-case. */
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Each shot waits for a selector that only exists once real API data has
 * rendered. Waiting on `networkidle` instead would race: the app paints its
 * loading state, the request settles, and React has not re-rendered yet.
 */
const SHOTS = [
  { route: "layout", file: "layout.png", waitFor: "svg" },
  { route: "topology", file: "topology.png", waitFor: "[class*='tree']" },
  { route: "devices", file: "devices.png", waitFor: "[class*='card'], [class*='device']" },
  { route: "samples", file: "samples.png", waitFor: "table, [class*='table']" },
];

/**
 * Freeze anything time-dependent. `created_at` is rendered on the sample and
 * device inspectors, and it moves every run by definition.
 */
const FREEZE_TIMESTAMPS = `
  * { caret-color: transparent !important; }
  [data-testid='timestamp'], time { visibility: hidden !important; }
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // Retina-sharp in the README.
    reducedMotion: "reduce", // No mid-transition captures.
    colorScheme: "light",
  });

  const failures = [];

  for (const shot of SHOTS) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    try {
      await page.goto(`${BASE_URL}/#${shot.route}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(shot.waitFor, { timeout: 20_000 });
      await page.addStyleTag({ content: FREEZE_TIMESTAMPS });
      // Fonts are self-hosted (DESIGN.md — no fonts.googleapis.com, GDPR), so
      // this resolves locally and is not a network wait.
      await page.evaluate(() => document.fonts.ready);

      const file = path.join(OUT_DIR, shot.file);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`  captured ${file}`);

      // A screenshot of a screen that threw is still a valid PNG, which makes
      // this exactly the kind of failure a screenshot job hides. Fail on it.
      if (consoleErrors.length > 0) {
        failures.push(`${shot.route}: ${consoleErrors.join("; ")}`);
      }
    } catch (error) {
      failures.push(`${shot.route}: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.error("\nFAILED:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`\n${SHOTS.length} screenshots written to ${OUT_DIR}/`);
}

main();
