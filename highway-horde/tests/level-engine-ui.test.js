// Story levels in the HUD (ui/levelhud.js) and the map lookups (shared/maps.js mapMeta): the
// section card (and how it gives way to a mission's own title card), the level toasts, the defend
// point's name on the objective bar, level names wherever the UI names a map. A small fake DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attrs = {};
    const cls = new Set();
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) };
    this.offsetWidth = 1;
  }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener() {}
}
globalThis.Node = FakeEl;
globalThis.document = { createElement: (t) => new FakeEl(t), createTextNode: (t) => Object.assign(new FakeEl('#text'), { textContent: t }) };

const { createLevelHud } = await import('../public/js/ui/levelhud.js');
const { buildMap, mapMeta, MAP_LIST } = await import('../public/js/shared/maps.js');
const { LEVEL_LIST } = await import('../public/js/shared/levels/index.js');
const { HIDEOUT_LIST } = await import('../public/js/shared/maps-hideouts.js');
const { mapTimes } = await import('../public/js/shared/timeofday.js');
const { levelGates } = await import('../public/js/shared/level.js');

function hud(mapId = 'millroad') {
  const map = buildMap(mapId, 3);
  const root = new FakeEl('div');
  const toasts = [];
  const objName = Object.assign(new FakeEl('span'), { textContent: 'Objective' });
  const L = createLevelHud(root, { map, toast: (text, tone) => toasts.push({ text, tone }), objName });
  const card = root.children[0];
  const text = () => card.children.map((c) => c.textContent).join(' | ');
  return { map, root, L, card, text, toasts, objName };
}

test('mapMeta finds match maps, hideouts and levels by id', () => {
  for (const m of MAP_LIST.concat(HIDEOUT_LIST, LEVEL_LIST)) assert.equal(mapMeta(m.id).name, m.name, m.id);
  assert.equal(mapMeta('nope'), null);
  assert.equal(mapMeta('hollowcreek').name, LEVEL_LIST.find((l) => l.id === 'hollowcreek').name);
  assert.ok(mapTimes('millroad').includes('day') && mapTimes('millroad').includes('night'), 'levels play day and night');
});

test('levelhud: the section card, after a beat; a mission title wins; the defend name; toasts', () => {
  assert.equal(createLevelHud(new FakeEl('div'), { map: buildMap('highway', 1), toast() {} }), null, 'no-op off a level');
  const { map, L, card, text, toasts, objName } = hud();
  const s = map.sections;
  // an arrival with no title of the mission's own: the section card after a beat
  L.addEvent({ type: 'area', id: s[0].id, name: s[0].name, i: 0 });
  L.update({ level: { defend: null } }, 0.5);
  assert.equal(card.hidden, true, 'waits for a mission title');
  L.update({ level: { defend: null } }, 1);
  assert.equal(card.hidden, false);
  assert.match(text(), new RegExp(`PART 1 OF ${s.length}`));
  assert.ok(text().includes(String(s[0].name).toUpperCase()), text());
  assert.ok(text().includes(mapMeta('millroad').name), 'the level name under it');
  // the same section again: nothing
  L.addEvent({ type: 'area', id: s[0].id, name: s[0].name, i: 0 });
  // an arrival whose mission title comes in the same beat: only the title
  for (let k = 0; k < 10; k++) L.update({ level: null }, 0.5);
  assert.equal(card.hidden, true, 'the card went away');
  L.addEvent({ type: 'area', id: s[1].id, name: s[1].name, i: 1 });
  L.update({ level: null }, 0.3);
  L.addEvent({ type: 'title', text: 'Gas and guns', sub: 'Mill Road, noon' });
  assert.ok(text().includes('GAS AND GUNS'), text());
  for (let k = 0; k < 4; k++) L.update({ level: null }, 0.5);
  assert.ok(text().includes('GAS AND GUNS'), 'the section card never replaced it');
  // a title first, the arrival just after: the section card is dropped
  for (let k = 0; k < 10; k++) L.update({ level: null }, 0.5);
  L.addEvent({ type: 'title', text: 'Shady Acres' });
  L.update({ level: null }, 1);
  L.addEvent({ type: 'area', id: s[2].id, name: s[2].name, i: 2 });
  for (let k = 0; k < 4; k++) L.update({ level: null }, 0.5);
  assert.ok(text().includes('SHADY ACRES'), text());
  assert.ok(!text().includes('PART 3'), 'no section card');
  // the defend point's name on the objective bar, and back
  L.update({ level: { defend: 'Tow truck' } }, 0.1);
  assert.equal(objName.textContent, 'Tow truck');
  L.update({ level: { defend: null } }, 0.1);
  assert.equal(objName.textContent, 'Objective');
  // toasts
  const g = levelGates(map)[0];
  for (const e of [{ type: 'gate', id: g.id, open: true }, { type: 'gate', id: g.id, open: false }, { type: 'checkpoint', section: s[1].id },
    { type: 'lights', section: s[1].id, on: false }, { type: 'lights', section: s[1].id, on: true }, { type: 'horde', x: 0, y: 0, n: 5 }]) {
    assert.equal(L.addEvent(e), true, e.type);
  }
  assert.equal(toasts.length, 6);
  assert.deepEqual(toasts.map((t) => t.tone), ['good', 'danger', 'minor', 'danger', 'good', 'danger']);
  assert.equal(L.addEvent({ type: 'music', state: 'battle' }), false, 'music is the audio\'s');
  assert.equal(L.addEvent({ type: 'shake', k: 1 }), false);
  L.destroy();
});
