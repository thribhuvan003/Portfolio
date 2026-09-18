const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync('index.html', 'utf8');
const code = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

function setup(width = 1366, storage = new Map()) {
  const events = {};
  const window = {
    innerWidth: width, innerHeight: 900,
    location: { hash: '', pathname: '/', search: '' },
    history: { pushState(_state, _title, url) { window.location.hash = url.startsWith('#') ? url : ''; } },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    matchMedia() { return { matches: false }; },
    addEventListener(name, handler) { events[name] = handler; }, removeEventListener() {},
  };
  const document = { hidden: false, querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener() {}, removeEventListener() {} };
  class DCLogic {
    constructor(props) { this.props = props; }
    setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); cb?.(); }
  }
  const ctx = vm.createContext({ window, document, DCLogic, setInterval() { return 1; }, clearInterval() {}, cancelAnimationFrame() {}, fetch: async () => ({ ok: true, json: async () => ({ ok: false }) }) });
  vm.runInContext(code + '\nthis.App = Component;', ctx);
  return { app: new ctx.App({}), window, document, events };
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
