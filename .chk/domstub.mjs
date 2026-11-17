// Minimal DOM + canvas 2D stub so hud.js and combat.js run headless.
class Style {
  constructor() { this.cssText = ''; this.width = ''; this.height = ''; this.opacity = ''; this.color = ''; this.textShadow = ''; this.borderColor = ''; }
}
class Node {
  constructor(tag) {
    this.tagName = tag; this.style = new Style(); this.children = []; this.textContent = ''; this.className = '';
    this._innerHTML = '';
  }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute() {}
  getContext(kind) {
    if (kind !== '2d') return null;
    if (!this._ctx) this._ctx = makeContext(this);
    return this._ctx;
  }
}
const calls = [];
function makeContext(canvas) {
  const ctx = {
    canvas, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, globalAlpha: 1,
  };
  const noop = (name) => (...args) => { calls.push(name); };
  for (const name of ['clearRect','fillRect','beginPath','arc','fill','stroke','save','restore','translate','rotate','scale','moveTo','lineTo','closePath','clip','fillText','setTransform','drawImage','ellipse','rect','measureText','createLinearGradient','createRadialGradient','arcTo','bezierCurveTo','quadraticCurveTo','strokeRect']) ctx[name] = noop(name);
  ctx.measureText = () => ({ width: 40 });
  const gradient = { addColorStop() {} };
  ctx.createLinearGradient = () => gradient;
  ctx.createRadialGradient = () => gradient;
  return ctx;
}
const body = new Node('body');
const documentStub = {
  body,
  createElement: (tag) => new Node(tag),
  addEventListener() {},
  removeEventListener() {},
};
export function installDom() {
  globalThis.document = documentStub;
  globalThis.devicePixelRatio = 1;
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720,
    devicePixelRatio: 1, localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    AudioContext: null,
  };
  win.window = win;
  globalThis.window = win;
  return { body, calls };
}
export { calls };
