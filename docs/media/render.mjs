// Optional authoring tool, never shipped inside the SVGs or application.
// PLAYWRIGHT_MODULE points to an installed playwright-core package's index.mjs.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const hash = (data) => createHash("sha256").update(data).digest("hex");

const root = dirname(fileURLToPath(import.meta.url));
const qa = process.env.QA_DIR || "/tmp/drop-explainer-qa";
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright-core");
const cache = join(homedir(), ".cache/ms-playwright");
const installed = (await readdir(cache)).filter((name) => /^chromium-\d+$/.test(name)).sort();
const executablePath = process.env.CHROMIUM_PATH ||
  join(cache, installed.at(-1), "chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
await mkdir(qa, { recursive: true });
const sources = {};
for (const theme of ["light", "dark"]) {
  sources[theme] = await readFile(join(root, `explainer-${theme}.svg`), "utf8");
}
const img = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const frame = (svg, seconds) =>
  svg.replace(
    "</style>",
    `*{animation-delay:-${seconds}s!important;animation-play-state:paused!important}</style>`,
  );
async function loadImage(svg) {
  await page.setContent(
    `<style>body{margin:0}img{display:block;width:100%}</style><img alt="Drop explainer" src="${
      img(svg)
    }">`,
  );
  await page.locator("img").evaluate((el) => el.decode());
}
const frames = [1, 6.6, 10.7, 14, 16.95, 18.8, 21.5];
for (const theme of ["light", "dark"]) {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
  for (const seconds of frames) {
    await loadImage(frame(sources[theme], seconds));
    await page.screenshot({ path: join(qa, `${theme}-${seconds}s.png`) });
  }
  await loadImage(frame(sources[theme], 0));
  const start = await page.screenshot();
  await loadImage(frame(sources[theme], 24));
  assert.equal(hash(await page.screenshot()), hash(start), `${theme}: loop boundary`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Chromium does not propagate reduced motion into image documents. The README
  // uses picture sources as well, selecting the matching static SVG explicitly.
  const stillName = theme === "dark" ? "explainer-still-dark.svg" : "explainer-still.svg";
  const still = await readFile(join(root, stillName), "utf8");
  await page.setContent(
    `<style>body{margin:0}img{display:block;width:100%}</style><picture><source media="(prefers-reduced-motion: reduce)" srcset="${
      img(still)
    }"><img src="${img(sources[theme])}" alt="Drop explainer"></picture>`,
  );
  await page.locator("img").evaluate((el) => el.decode());
  assert.equal(await page.locator("img").evaluate((el) => el.currentSrc), img(still));
  const reduced = await page.screenshot({ path: join(qa, `${theme}-reduced.png`) });
  await page.waitForTimeout(500);
  assert.equal(
    hash(await page.screenshot()),
    hash(reduced),
    `${theme}: picture reduced-motion still`,
  );
  // Separately verify the embedded media rule with the SVG opened directly.
  const direct = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  await direct.goto(pathToFileURL(join(root, `explainer-${theme}.svg`)).href);
  assert.equal(await direct.evaluate(() => document.getAnimations().length), 0);
  assert.equal(
    await direct.locator(".static-title").evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await direct.close();
  console.log(`${theme}: rendered 7 image-context frames; loop and reduced motion match`);
}
// An unmodified SVG must really animate as an <img>, without script inside it.
await page.emulateMedia({ reducedMotion: "no-preference" });
await loadImage(sources.light);
const before = await page.screenshot();
await page.waitForTimeout(2800);
assert.notEqual(hash(await page.screenshot()), hash(before), "Unmodified SVG animates as an image");
console.log("Unmodified SVG animates in an img element");
// Exercise the exact README picture markup, including all source priorities.
const readme = await readFile(join(root, "../../README.md"), "utf8");
let picture = readme.match(/<picture>[\s\S]*?<\/picture>/)[0];
for (
  const name of [
    "explainer-light.svg",
    "explainer-dark.svg",
    "explainer-still.svg",
    "explainer-still-dark.svg",
  ]
) {
  picture = picture.replaceAll(`docs/media/${name}`, img(await readFile(join(root, name), "utf8")));
}
for (const theme of ["light", "dark"]) {
  for (const motion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
    await page.setContent(
      `<style>body{margin:0}img{display:block;width:100%;height:auto}</style>${picture}`,
    );
    await page.locator("img").evaluate((el) => el.decode());
    const name = motion === "reduce"
      ? (theme === "dark" ? "explainer-still-dark.svg" : "explainer-still.svg")
      : `explainer-${theme}.svg`;
    assert.equal(
      await page.locator("img").evaluate((el) => el.currentSrc),
      img(await readFile(join(root, name), "utf8")),
    );
  }
}
console.log("README picture selects the correct source in all four theme/motion combinations");
await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
// Check the layout at typical README and mobile widths too.
for (const width of [768, 390]) {
  await page.setViewportSize({ width, height: Math.ceil(width * 720 / 1280) });
  await loadImage(frame(sources.light, 10.7));
  await page.screenshot({ path: join(qa, `light-${width}px.png`) });
}
await page.setViewportSize({ width: 1280, height: 720 });
let tiles = "";
for (const theme of ["light", "dark"]) {
  for (const seconds of frames) {
    const png = await readFile(join(qa, `${theme}-${seconds}s.png`));
    tiles += `<figure><img src="data:image/png;base64,${
      png.toString("base64")
    }"><figcaption>${theme}, ${seconds} seconds</figcaption></figure>`;
  }
}
await page.setViewportSize({ width: 1280, height: 1000 });
await page.setContent(
  `<style>body{margin:0;background:#ddd;font:18px Arial}main{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px}</style><main>${tiles}</main>`,
);
await page.screenshot({ path: join(qa, "contact-sheet.png"), fullPage: true });
await page.setViewportSize({ width: 1280, height: 720 });
if (process.argv.includes("--video")) {
  // Seek the original CSS timeline in Chromium, then pipe PNG frames into ffmpeg.
  // No real-time recording, random timers, extra asset loads or intermediate frame files.
  await page.setContent(`<style>body{margin:0}</style>${sources.light}`);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const encoder = spawn(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    "30",
    "-vcodec",
    "png",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(root, "explainer.mp4"),
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg: ${code}`)));
  });
  for (let i = 0; i < 720; i++) {
    await page.evaluate((time) =>
      document.getAnimations().forEach((a) => {
        a.currentTime = time;
      }), i * 1000 / 30);
    const png = await page.screenshot();
    if (!encoder.stdin.write(png)) {
      await new Promise((resolve) => encoder.stdin.once("drain", resolve));
    }
    if (i % 120 === 0) console.log(`Video: ${i}/720 frames`);
  }
  encoder.stdin.end();
  await done;
  console.log("Video: 720/720 frames, 24 seconds, 1280×720, 30 fps");
}
await writeFile(
  join(qa, "preview.html"),
  `<img style="width:100%;display:block" alt="Animated Heka Drop explainer" src="${
    img(sources.light)
  }">`,
);
await browser.close();
