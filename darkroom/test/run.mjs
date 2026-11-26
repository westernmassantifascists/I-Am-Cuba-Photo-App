// Darkroom tests: compiler checks, a full build + package of the template, the Twine importer,
// and (when Playwright is installed) a real browser playthrough of the sample story.
//   node test/run.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseTwee, parseTwineHTML } from '../lib/twine.mjs';
import { compileStory } from '../lib/compile.mjs';
import { indexAssets } from '../lib/assets.mjs';
import { translateExpr } from '../lib/expr.mjs';
import { newProject } from '../lib/scaffold.mjs';
import { analyze, build } from '../lib/build.mjs';
import { packageProject } from '../lib/package.mjs';
import { importTwine } from '../lib/importer.mjs';
import { preview } from '../lib/serve.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-test-'));
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
}
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

function compileText(twee, { files = [], config = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'c-'));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  const { passages } = parseTwee(twee, 'test.twee');
  return compileStory({ passages, startName: null, config: { characters: { Mara: {} }, ...config }, assetIndex: indexAssets(dir) });
}

await test('expressions translate Twine operators', () => {
  assert.equal(translateExpr('$a to $a + 1'), 'S.a = S.a + 1');
  assert.equal(translateExpr('$a is 2 and not $b'), 'S.a === 2 && ! S.b');
  assert.equal(translateExpr('$a is not "to and or"'), 'S.a !== "to and or"');
  assert.equal(translateExpr('$x gte 3 or $y lt 1'), 'S.x >= 3 || S.y < 1');
});

await test('links, choices, speakers and conditions compile', () => {
  const r = compileText(`:: Start\n@bg harbor\nMara: Hello *there*, {$name}.\n@if $n > 1\n[[Go->B][$n += 1]]\n@else\n[[Stay|B]]\n@endif\n\n:: B\n@ending b "Bee"\n`, {
    files: ['bg/harbor.jpg'],
  });
  assert.deepEqual(r.errors, []);
  const ops = r.story.passages.Start.ops;
  assert.equal(ops[0].src, 'bg/harbor.jpg');
  assert.equal(ops[1].who, 'Mara');
  assert.match(ops[1].html, /<em>there<\/em>/);
  assert.deepEqual(ops[1].x, ['S.name']);
  assert.equal(ops[2].t, 'if');
  assert.equal(ops[2].branches[0].ops[0].set, 'S.n += 1');
  assert.equal(ops[2].else[0].target, 'B');
});

await test('errors: missing passage, missing media, wrong case, bad expression, unclosed if', () => {
  const r = compileText(`:: Start\n@bg Harbor.jpg\n@music nope\n@if $a >\n[[Gone]]\n`, { files: ['bg/harbor.jpg'] });
  const msgs = r.errors.map((e) => e.msg).join('\n');
  assert.match(msgs, /wrong letter case/);
  assert.match(msgs, /@music nope: file not found/);
  assert.match(msgs, /bad expression/);
  assert.match(msgs, /never closed/);
  assert.match(msgs, /missing passage "Gone"/);
  assert.equal(r.errors.find((e) => /Gone/.test(e.msg)).line, 5);
});

await test('warnings: unreachable passage, dead end, unset variable', () => {
  const r = compileText(`:: Start\nHi $ghost\n[[A]]\n\n:: A\nThe end?\n\n:: Lost\n[[A]]\n`);
  const msgs = r.warnings.map((e) => e.msg).join('\n');
  assert.match(msgs, /never reached/);
  assert.match(msgs, /dead end/);
  assert.match(msgs, /\$ghost is read but never set/);
});

await test('Twine 2 HTML is read (published game or archive)', () => {
  const html = `<tw-storydata name="Old &amp; Gold" startnode="2" format="Harlowe" format-version="3.3.8"><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">body{color:red}</style><tw-passagedata pid="1" name="Two" tags="" position="1,1">Bye</tw-passagedata><tw-passagedata pid="2" name="One" tags="a b" position="5,5">Hi [[Two]] &lt;3</tw-passagedata></tw-storydata>`;
  const r = parseTwineHTML(html);
  assert.equal(r.story.name, 'Old & Gold');
  assert.equal(r.startName, 'One');
  assert.equal(r.passages[1].text, 'Hi [[Two]] <3');
  assert.deepEqual(r.passages[1].tags, ['a', 'b']);
  assert.equal(r.css, 'body{color:red}');
});

const project = path.join(tmp, 'sample');
await test('template project builds, lean-packages and passes the itch.io check', async () => {
  newProject(project, { title: 'Sample Night' });
  const a = analyze(project);
  assert.deepEqual(a.result.errors, []);
  assert.equal(a.result.story.endings.length, 3);
  const b = await quiet(() => build(project));
  assert.ok(b.ok);
  assert.ok(fs.existsSync(path.join(project, 'dist', 'assets', 'bg', 'harbor.jpg')));
  const zip = await quiet(() => packageProject(project));
  assert.ok(zip && fs.existsSync(zip), 'zip written');
  assert.match(path.basename(zip), /^sample-night-itch-\d{4}-\d\d-\d\d-v1\.zip$/);
  const zip2 = await quiet(() => packageProject(project));
  assert.match(path.basename(zip2), /-v2\.zip$/);
});

await test('importer converts a Harlowe/SugarCube story and copies its media', async () => {
  const src = path.join(tmp, 'old-game');
  fs.mkdirSync(path.join(src, 'images'), { recursive: true });
  fs.writeFileSync(path.join(src, 'images', 'street.jpg'), 'x');
  const passages = [
    ['Start', `(set: $coins to 0)<img src="images/street.jpg">\n''Night.'' //Rain.//\n(if: $coins > 0)[Rich.](else:)[Poor.]\n(link-goto: "Walk", "Walk")`],
    ['Walk', `<<set $coins to $coins + 1>><<if $coins gt 0>>You found one.<</if>>\n<<audio "rain" play>>\n[[Start]]`],
  ];
  const pd = passages.map(([n, t], i) => `<tw-passagedata pid="${i + 1}" name="${n}" tags="" position="0,0">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</tw-passagedata>`).join('');
  fs.writeFileSync(path.join(src, 'Old Game.html'), `<html><body><tw-storydata name="Old Game" startnode="1" format="Harlowe" format-version="3.3.8">${pd}</tw-storydata></body></html>`);
  const out = path.join(tmp, 'imported');
  const r = importTwine(src, out);
  assert.equal(r.passages, 2);
  assert.ok(fs.existsSync(path.join(out, 'assets', 'images', 'street.jpg')));
  const twee = fs.readFileSync(path.join(out, 'story', r.outName), 'utf8');
  assert.match(twee, /@set \$coins to 0/);
  assert.match(twee, /@if \$coins > 0\nRich\.\n@else\nPoor\.\n@endif/);
  assert.match(twee, /\*\*Night\.\*\* \*Rain\.\*/);
  assert.match(twee, /\[\[Walk->Walk\]\]/);
  assert.match(fs.readFileSync(path.join(out, 'IMPORT-REPORT.md'), 'utf8'), /Walk\*\*: <<audio>>/);
  const a = analyze(out);
  assert.deepEqual(a.result.errors, []);
  assert.ok(a.result.usedAssets.has('images/street.jpg'));
});

// ---------------------------------------------------------------- browser
let playwright;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  console.log('skip browser test (playwright not installed)');
}
if (playwright) {
  await test('browser: play the sample story to an ending, save, load, back', async () => {
    const server = await quiet(() => preview(path.join(project, 'dist'), { port: 8765 }));
    const port = server.address().port;
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.goto(`http://localhost:${port}/`);
      await page.waitForSelector('.dr-title.on');
      assert.equal(await page.textContent('.dr-title-name'), 'Sample Night');
      await page.click('.dr-title-buttons [data-t=new]');
      const shot = (n) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, `${n}.png`) });
      // Click through lines until choices appear.
      const clickUntilChoices = async () => {
        for (let i = 0; i < 40; i++) {
          if (await page.$('.dr-choices.on .dr-choice')) return;
          await page.mouse.click(640, 300);
          await page.waitForTimeout(120);
        }
        throw new Error('no choices appeared');
      };
      await page.waitForSelector('.dr-card.on');
      await shot('1-card');
      await page.mouse.click(640, 300);
      await page.waitForSelector('.dr-box.ready');
      await page.waitForTimeout(1200);
      await shot('2-text');
      await page.waitForFunction(() => document.querySelector('.dr-body').textContent.includes('Rain on the black water'));
      await clickUntilChoices();
      await shot('3-choices');
      const labels = await page.$$eval('.dr-choice', (bs) => bs.map((b) => b.textContent));
      assert.deepEqual(labels, ['Walk with Mara', 'Answer the stranger', 'Read the letter in your pocket']);
      // Read the letter, which comes back to the same choices without the letter.
      await page.click('.dr-choice >> text=Read the letter');
      await page.waitForSelector('.dr-img.on');
      await clickUntilChoices();
      assert.deepEqual(await page.$$eval('.dr-choice', (bs) => bs.map((b) => b.textContent)), ['Walk with Mara', 'Answer the stranger']);
      // Save to slot 1 here.
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=save]');
      await page.click('.dr-slot[data-slot="1"]');
      await page.click('.dr-close');
      await page.click('.dr-choice >> text=Walk with Mara');
      await page.waitForFunction(() => document.querySelector('.dr-body').textContent.includes('I knew'));
      // The tram video plays and can be skipped with a tap.
      for (let i = 0; i < 10 && !(await page.$('.dr-video.on')); i++) {
        await page.mouse.click(640, 300);
        await page.waitForTimeout(150);
      }
      await page.waitForSelector('.dr-video.on video');
      await page.mouse.click(640, 300);
      await page.waitForSelector('.dr-video:not(.on)');
      await clickUntilChoices();
      await page.click('.dr-choice >> text=Climb to the roof');
      await clickUntilChoices();
      await shot('4-ending');
      assert.match(await page.textContent('.dr-toasts'), /The Night You Remembered/);
      const stored = await page.evaluate(() => localStorage.getItem('darkroom:sample-night:endings'));
      assert.match(stored, /remember/);
      // Back goes to the previous passage (Alley).
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => window.Darkroom.helpers.passage() === 'Alley');
      // Load slot 1: we are at the harbor with the letter read.
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=load]');
      await page.click('.dr-slot[data-slot="1"]');
      await clickUntilChoices();
      assert.equal(await page.evaluate(() => window.Darkroom.state.hasLetter), true);
      assert.equal(await page.evaluate(() => window.Darkroom.state.trust), 0);
      // Back to the title: Continue, Load and Endings are offered.
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=title]');
      const t = await page.$$eval('.dr-title-buttons button', (bs) => bs.map((b) => b.dataset.t));
      assert.deepEqual(t, ['continue', 'new', 'load', 'endings', 'settings']);
      await page.click('[data-t=endings]');
      assert.match(await page.textContent('.dr-count'), /1 of 3 found/);
      await shot('5-endings');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });

  await test('browser: page mode and a phone-sized screen', async () => {
    const cfgPath = path.join(project, 'darkroom.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.mode = 'page';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    await quiet(() => build(project));
    const server = await quiet(() => preview(path.join(project, 'dist'), { port: 8766 }));
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(`http://localhost:${server.address().port}/`);
      await page.click('[data-t=new]');
      await page.mouse.click(200, 400); // dismiss the chapter card
      await page.waitForSelector('.dr-page .dr-choice');
      const paras = await page.$$eval('.dr-page-inner p', (ps) => ps.length);
      assert.ok(paras >= 4, `page shows all lines at once (${paras})`);
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, '6-phone-page.png') });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
