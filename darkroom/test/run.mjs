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

await test('emotion-led structure compiles: turns, drift pools, feel tags, nudges, moods', () => {
  const lib = new Map([
    ['a', { id: 'a', rel: 'bg/a.jpg', type: 'image', motifs: ['sea'], repeat: true }],
    ['b', { id: 'b', rel: 'bg/b.jpg', type: 'image', motifs: ['sea', 'night'], repeat: true }],
  ]);
  const dir = fs.mkdtempSync(path.join(tmp, 'e-'));
  for (const f of ['bg/a.jpg', 'bg/b.jpg', 'music/low.m4a']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  const { passages } = parseTwee(
    `:: Start [motif-sea music-sad look-quiet shot-a]\nHi\n[[Go->@drift town else=End][dread+5 longing-2]]\n\n` +
      `:: One [drift-town feel-dread]\n@when $dread > 1\n[[Back->@drift town else=End]]\n\n` +
      `:: Two [drift-town feel-longing feel-dread]\n[[Back->@drift nowhere]]\n\n` +
      `:: Turn\n@turn $dread >= 50\n@nudge dread-10\n[[Go on->@resume]]\n\n:: End\n@ending e "E"\n`,
    't.twee',
  );
  const config = { meters: { dread: {}, longing: {} }, scene: { music: { sad: 'music/low', silence: null } } };
  const r = compileStory({ passages, startName: 'Start', config, assetIndex: indexAssets(dir), library: lib });
  assert.deepEqual(r.errors.map((e) => e.msg), ['@drift nowhere: no passages are tagged drift-nowhere']);
  const start = r.story.passages.Start;
  assert.deepEqual(start.scene, { shot: 'a', motif: 'sea', music: 'music/low.m4a', look: 'quiet' });
  assert.deepEqual(start.ops[1].nudge, { dread: 5, longing: -2 });
  assert.equal(start.ops[1].target, '@drift town else=End');
  assert.deepEqual(r.story.pools, { town: ['One', 'Two'] });
  assert.deepEqual(r.story.turns, [{ passage: 'Turn', js: 'S.dread >= 50', once: true }]);
  assert.deepEqual(r.story.passages.Two.feel, ['longing', 'dread']);
  assert.equal(r.story.passages.One.when, 'S.dread > 1');
  assert.ok(r.reach.has('Turn') && r.reach.has('Two') && r.reach.has('End'));
  assert.ok(r.usedAssets.has('bg/b.jpg'), 'every picture of a used motif ships');
});

const project = path.join(tmp, 'sample');
await test('example piece builds, lean-packages and passes the itch.io check', async () => {
  newProject(project, { title: 'Sample Tide' });
  const a = analyze(project);
  assert.deepEqual(a.result.errors, []);
  assert.deepEqual(a.result.warnings, []);
  assert.equal(a.result.story.endings.length, 3);
  assert.equal(a.result.story.library.length, 11);
  assert.equal(a.result.story.turns.length, 2);
  const b = await quiet(() => build(project));
  assert.ok(b.ok);
  assert.ok(fs.existsSync(path.join(project, 'dist', 'assets', 'bg', 'pier.jpg')));
  const zip = await quiet(() => packageProject(project));
  assert.ok(zip && fs.existsSync(zip), 'zip written');
  assert.match(path.basename(zip), /^sample-tide-itch-\d{4}-\d\d-\d\d-v1\.zip$/);
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

async function openGame(port, viewport = { width: 1280, height: 720 }, extra = {}) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport, ...extra });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.dr-title.on');
  return { browser, page, errors };
}
const passage = (page) => page.evaluate(() => window.Darkroom.passage);
const state = (page) => page.evaluate(() => ({ ...window.Darkroom.state }));
// screenshots wait out the background crossfade first
const shot = async (page, n) => process.env.SHOTS && (await page.waitForTimeout(1700), await page.screenshot({ path: path.join(process.env.SHOTS, `${n}.png`) }));
async function choose(page, text) {
  await page.click(`.dr-choice:has-text(${JSON.stringify(text)})`);
  await page.waitForTimeout(250);
}
async function skipVideo(page) {
  if (await page.$('.dr-video.on video')) {
    await page.mouse.click(640, 300);
    await page.waitForSelector('.dr-video:not(.on)');
  }
}

if (playwright) {
  await test('browser: feelings choose the scenes, a threshold turn breaks in, the strongest feeling picks the ending', async () => {
    const server = await quiet(() => preview(path.join(project, 'dist'), { port: 8765 }));
    const { browser, page, errors } = await openGame(server.address().port);
    try {
      assert.equal(await page.textContent('.dr-title-name'), 'Sample Tide');
      await page.click('.dr-title-buttons [data-t=new]');
      await page.waitForSelector('.dr-card.on');
      await shot(page, '1-card');
      await page.mouse.click(640, 300);
      await page.waitForSelector('.dr-page .dr-choice');
      assert.equal(await passage(page), 'Arrival');
      assert.deepEqual(await state(page), { longing: 20, dread: 10, tenderness: 10, loaf: false });
      // shot-shore: the curated first picture; music-longing and sound-sea from the tags
      const media = await page.evaluate(() => window.Darkroom.media);
      assert.equal(media.bg.id, 'shore');
      assert.equal(media.music.src, 'music/longing.m4a');
      assert.equal(media.ambience.src, 'ambience/waves.m4a');
      await page.waitForTimeout(600);
      await shot(page, '2-arrival');

      // Longing is strongest, so the walk drifts to the longing scene.
      await choose(page, 'Walk along the front');
      assert.equal(await passage(page), 'The Pier');
      assert.equal(await page.evaluate(() => window.Darkroom.media.bg.id), 'pier'); // motif-pier
      await choose(page, 'Wait with him');
      assert.equal((await state(page)).longing, 35);
      // Longing > 25 opens the cliff path, which fits longing + dread best.
      assert.equal(await passage(page), 'The Cliff Path');
      assert.equal(await page.evaluate(() => document.querySelector('#dr').dataset.look), 'quiet'); // look rule: longing >= 35
      await choose(page, 'Go to the edge');
      assert.equal(await passage(page), 'The Grand Hotel'); // dread 25 now beats tenderness 10
      assert.equal(await page.evaluate(() => window.Darkroom.media.bg.id), 'hotel'); // the only facade picture
      // style "vigil": bundled fonts, atmosphere-night layer, overlay-ash particles
      assert.ok(await page.evaluate(async () => (await document.fonts.ready, document.fonts.check('1em "EB Garamond"') && [...document.fonts].some((f) => f.family.includes('EB Garamond') && f.status === 'loaded'))));
      assert.equal(await page.evaluate(() => document.querySelector('#dr').dataset.atmosphere), 'night');
      assert.equal(await page.evaluate(() => document.querySelector('#dr').dataset.overlay), 'ash');
      assert.ok(await page.$('.dr-particles.on'));
      await shot(page, '3-hotel');
      await choose(page, 'Look up at the third floor'); // dread 50: not yet over the line
      const s1 = await state(page);
      assert.equal(s1.dread, 50);
      const next = await passage(page);
      assert.ok(['The Bakery', 'The Bus Shelter'].includes(next), next);

      // Save here, then push dread over 55: the threshold turn takes over the next move.
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=save]');
      await page.click('.dr-slot[data-slot="1"]');
      await page.click('.dr-close');
      await page.evaluate(() => (window.Darkroom.state.dread = 60));
      await page.click('.dr-page .dr-choice >> nth=0');
      await page.waitForTimeout(300);
      assert.equal(await passage(page), 'The Water Comes In');
      await skipVideo(page);
      assert.equal(await page.evaluate(() => window.Darkroom.media.music.src), 'music/dread.m4a');
      assert.equal(await page.evaluate(() => document.querySelector('#dr').dataset.look), 'shadowed');
      await shot(page, '4-turn');
      assert.equal((await state(page)).dread, 70);
      // @resume: back to the scene the player was heading for.
      await choose(page, 'Go on');
      const resumed = await passage(page);
      assert.ok(['The Bakery', 'The Bus Shelter'].includes(resumed) && resumed !== next, resumed);

      // Walk on until the pool is used up: dread is strongest, so the ending is "The Last Bus".
      for (let i = 0; i < 6 && (await passage(page)) !== 'The House'; i++) await page.click('.dr-page .dr-choice >> nth=0').then(() => page.waitForTimeout(250));
      assert.equal(await passage(page), 'The House');
      await page.waitForSelector('.dr-toast');
      assert.match(await page.textContent('.dr-toasts'), /The Last Bus/);
      await shot(page, '5-ending');
      assert.equal(await page.evaluate(() => window.Darkroom.helpers.runs()), 1);

      // Loading the save restores the feelings and forgets that the turn happened.
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=load]');
      await page.click('.dr-slot[data-slot="1"]');
      await page.waitForTimeout(300);
      assert.equal(await passage(page), next);
      assert.equal((await state(page)).dread, 50);
      await page.click('.dr-bar [data-act=menu]');
      await page.click('.dr-menu [data-act=title]');
      await page.click('[data-t=endings]');
      assert.match(await page.textContent('.dr-count'), /1 of 3 found/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });

  await test('browser: a tender playthrough reaches a different ending', async () => {
    const server = await quiet(() => preview(path.join(project, 'dist'), { port: 8767 }));
    const { browser, page, errors } = await openGame(server.address().port);
    try {
      await page.click('[data-t=new]');
      await page.mouse.click(640, 300);
      await page.waitForSelector('.dr-page .dr-choice');
      await choose(page, 'Walk along the front');
      await choose(page, 'Leave him to it'); // tenderness 15: bakery or shelter next
      for (let i = 0; i < 8 && (await passage(page)) !== 'The House'; i++) {
        const labels = await page.$$eval('.dr-page .dr-choice', (bs) => bs.map((b) => b.textContent));
        const pick = labels.find((l) => /Thank her|Watch them|Keep your eyes|Turn back|Ask her|Go on/.test(l)) || labels[0];
        await choose(page, pick);
        await skipVideo(page);
      }
      assert.equal(await passage(page), 'The House');
      const s = await state(page);
      assert.ok(s.tenderness > s.dread && s.tenderness > s.longing, JSON.stringify(s));
      await page.waitForSelector('.dr-toast');
      assert.match(await page.textContent('.dr-toasts'), /Someone Lives Here/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });

  await test('browser: visual-novel mode on a phone-sized screen', async () => {
    const cfgPath = path.join(project, 'darkroom.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    Object.assign(cfg, { mode: 'vn', beat: 'line', typewriter: 80 });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    await quiet(() => build(project));
    const server = await quiet(() => preview(path.join(project, 'dist'), { port: 8766 }));
    const { browser, page, errors } = await openGame(server.address().port, { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
    try {
      await page.click('[data-t=new]');
      await page.mouse.click(200, 400); // chapter card
      await page.waitForSelector('.dr-box.ready');
      assert.match(await page.textContent('.dr-body'), /The bus leaves you/);
      for (let i = 0; i < 20 && !(await page.$('.dr-choices.on .dr-choice')); i++) {
        await page.mouse.click(200, 400);
        await page.waitForTimeout(150);
      }
      assert.deepEqual(await page.$$eval('.dr-choice', (bs) => bs.map((b) => b.textContent)), ['Walk along the front']);
      await shot(page, '6-phone-vn');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
