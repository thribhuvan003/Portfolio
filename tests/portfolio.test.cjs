const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync('index.html', 'utf8');
const code = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

function setup(width = 1366, storage = new Map(), reducedMotion = false) {
  const events = {};
  const timers = new Map();
  const window = {
    innerWidth: width, innerHeight: 900,
    location: { hash: '', pathname: '/', search: '' },
    history: { pushState(_state, _title, url) { window.location.hash = url.startsWith('#') ? url : ''; } },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    matchMedia() { return { matches: reducedMotion, addEventListener() {}, removeEventListener() {} }; },
    addEventListener(name, handler) { events[name] = handler; }, removeEventListener(name) { delete events[name]; },
  };
  const document = { hidden: false, querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener() {}, removeEventListener() {} };
  class DCLogic {
    constructor(props) { this.props = props; }
    setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); cb?.(); }
  }
  const ctx = vm.createContext({ window, document, DCLogic, setInterval(fn, ms) { timers.set(ms, fn); return ms; }, clearInterval(id) { timers.delete(id); }, cancelAnimationFrame() {}, fetch: async () => ({ ok: true, json: async () => ({ ok: false }) }) });
  vm.runInContext(code + '\nthis.App = Component;', ctx);
  return { app: new ctx.App({}), window, document, events, timers };
}

test('project navigation creates a shareable URL', () => {
  const { app, window } = setup(); app.renderVals().showProjects();
  assert.equal(app.state.folder, 'projects'); assert.equal(window.location.hash, '#projects');
  assert.equal(app.renderVals().windows[0].label, 'Projects');
});
test('phone navigation opens a full-size content window', () => {
  const { app } = setup(390); app.renderVals().showOss();
  assert.equal(app.state.windows.work.maximized, true); assert.equal(app.state.folder, 'oss');
});
test('About dock entry opens the single About view', () => {
  const { app } = setup(); app.renderVals().dock.find((x) => x.label === 'About Me').activate();
  assert.equal(app.state.folder, 'about'); assert.equal(app.renderVals().windows.length, 1);
});
test('minimized windows are removed and can be restored from the dock', () => {
  const { app } = setup(); app.renderVals().showProjects();
  app.renderVals().windows[0].minimize(); assert.equal(app.renderVals().windows.length, 0);
  app.renderVals().dock.find((x) => x.label === 'Workspace').activate();
  assert.equal(app.renderVals().windows.length, 1); assert.equal(app.state.folder, 'projects');
});
test('featured and remaining contributions are complete and disjoint', () => {
  const { app } = setup(); const vals = app.renderVals();
  assert.equal(vals.featuredOss.length, 3);
  assert.equal(new Set([...vals.featuredOss, ...vals.remainingOss].map((x) => x.url)).size, vals.ossCount);
});
test('deep links and browser back restore the expected section', () => {
  const { app, window, events } = setup(); window.location.hash = '#resume'; app.componentDidMount();
  assert.equal(app.state.folder, 'resume'); window.location.hash = ''; events.hashchange();
  assert.equal(app.state.windows.work.open, false); app.componentWillUnmount();
});
test('failed Spotify response clears stale now-playing information', async () => {
  const { app } = setup(); app.state.np = { title: 'Old track', isPlaying: true }; app.componentDidMount();
  await new Promise(setImmediate); assert.equal(app.state.np, null); app.componentWillUnmount();
});
test('gallery close returns focus to the opener', () => {
  const { app, document } = setup(); let focused = false;
  document.activeElement = { focus() { focused = true; } };
  app.renderVals().gallery[1].open(); assert.equal(app.state.lightbox, 1);
  app.closeLightbox(); assert.equal(app.state.lightbox, null); assert.equal(focused, true);
});

test('first-visit guide stays dismissed on return visits', () => {
  const storage = new Map();
  const { app } = setup(1366, storage);
  assert.equal(app.renderVals().coachOpen, true);
  app.renderVals().dismissCoach();
  assert.equal(app.renderVals().coachOpen, false);
  assert.equal(setup(1366, storage).app.renderVals().coachOpen, false);
});

test('guide remains usable when browser storage is blocked', () => {
  const storage = { get() { throw new Error('Storage blocked'); }, set() { throw new Error('Storage blocked'); } };
  const { app } = setup(390, storage);
  assert.equal(app.renderVals().coachOpen, true);
  assert.doesNotThrow(() => app.renderVals().dismissCoach());
  assert.equal(app.renderVals().coachOpen, false);
});

test('launcher uses the same coordinate system as an open folder', () => {
  const { app } = setup();
  app.renderVals().dock.find((x) => x.label === 'Workspace').activate();
  const frame = app.renderVals().windows[0].frame;
  assert.equal(typeof frame.left, 'number');
  assert.equal(frame.transform, 'none');
  assert.equal(frame.width, app.state.windows.work.w);
});

test('switching folders and restoring from the dock preserves window placement', () => {
  const { app } = setup(); app.renderVals().showProjects();
  app.patch('work', { x: 90, y: 70, w: 800, h: 600, maximized: true });
  app.renderVals().showOss();
  assert.equal(app.state.windows.work.x, 90);
  assert.equal(app.state.windows.work.maximized, true);
  app.renderVals().windows[0].minimize();
  app.renderVals().dock.find((x) => x.label === 'Workspace').activate();
  assert.equal(app.state.windows.work.w, 800);
  assert.equal(app.state.windows.work.maximized, true);
});

test('dragging tracks the pointer without easing and cleans up on cancellation', () => {
  const { app, events } = setup(); app.renderVals().showProjects();
  const before = { ...app.state.windows.work };
  app.drag('work', { button: 0, clientX: 100, clientY: 100, target: { closest() { return null; } }, preventDefault() {} }, 'move');
  assert.equal(app.renderVals().windows[0].frame.transition, 'none');
  events.pointermove({ clientX: 140, clientY: 130 });
  assert.equal(app.state.windows.work.x, before.x + 40);
  events.pointercancel();
  assert.equal(events.pointermove, undefined);
  assert.notEqual(app.renderVals().windows[0].frame.transition, 'none');
});

test('quotes advance when the reading line completes, only on the visible desktop', () => {
  const { app, document, timers } = setup(); app.componentDidMount();
  const initial = app.renderVals().quoteText;
  assert.equal(typeof initial, 'string');
  app.renderVals().quoteTick(); assert.equal(app.renderVals().quoteText, initial, 'guide is open');
  app.renderVals().dismissCoach();
  app.renderVals().quoteTick(); assert.notEqual(app.renderVals().quoteText, initial);
  assert.equal(app.renderVals().quoteToggle, undefined);
  app.renderVals().showProjects(); const folderQuote = app.renderVals().quoteText;
  assert.equal(app.renderVals().quoteBarStyle.animationPlayState, 'paused');
  app.renderVals().quoteTick(); assert.equal(app.renderVals().quoteText, folderQuote);
  app.renderVals().windows[0].close(); document.hidden = true;
  app.renderVals().quoteTick(); assert.equal(app.renderVals().quoteText, folderQuote);
  timers.get(12000)(); assert.equal(app.renderVals().quoteText, folderQuote, 'timer only drives reduced motion');
  app.componentWillUnmount(); assert.equal(timers.size, 0);
});

test('reduced motion disables window transitions and swaps quotes without animation', () => {
  const { app, timers } = setup(390, new Map(), true); app.componentDidMount();
  app.renderVals().dismissCoach();
  assert.equal(app.renderVals().quoteAnimClass, '');
  assert.equal(app.renderVals().quoteBarClass, '');
  const quote = app.renderVals().quoteText;
  timers.get(12000)(); assert.notEqual(app.renderVals().quoteText, quote);
  app.renderVals().showProjects();
  assert.equal(app.renderVals().windows[0].frame.transition, 'none');
  const open = app.renderVals().quoteText;
  timers.get(12000)(); assert.equal(app.renderVals().quoteText, open);
  app.componentWillUnmount();
});

test('longer quotes stay on screen longer', () => {
  const { app } = setup();
  const short = app.quoteSeconds({ text: 'Do nothing which is of no use.' });
  const long = app.quoteSeconds({ text: 'Yesterday is history, tomorrow is a mystery, but today is a gift. That is why it is called the present.' });
  assert.ok(long > short); assert.ok(short >= 7 && long <= 15);
});

test('focusing a window changes stacking without moving its content in the DOM', () => {
  const { app } = setup(); app.renderVals().showProjects();
  app.renderVals().dock.find((x) => x.label === 'Photos').activate();
  const before = app.renderVals().windows.map((x) => x.id).join(',');
  app.focus('work');
  const windows = app.renderVals().windows;
  assert.equal(windows.map((x) => x.id).join(','), before);
  assert.ok(windows.find((x) => x.id === 'work').frame.zIndex > windows.find((x) => x.id === 'images').frame.zIndex);
});

test('all quotes have distinct text, clear attribution and a source', () => {
  const { app } = setup(); const quotes = [];
  let vals = app.renderVals();
  do {
    assert.ok(vals.quoteAuthor.length > 0);
    assert.ok(vals.quoteWork.length > 0);
    assert.match(vals.quoteSource, /^https:\/\//);
    quotes.push(vals.quoteText); vals.nextQuote(); vals = app.renderVals();
  } while (vals.quoteText !== quotes[0] && quotes.length < 100);
  assert.ok(quotes.length >= 12);
  assert.equal(new Set(quotes).size, quotes.length);
  assert.ok(quotes.includes('As long as I’m alive, there are infinite chances.'));
});
