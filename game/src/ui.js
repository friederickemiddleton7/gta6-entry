// Every menu and overlay the game has, built in JS with inline styles so the page needs no images
// and no font files. One fixed root sits over the canvas: the cinematic title screen, the pause
// menu, the WASTED and BUSTED cards, the pointer-lock hint and the little toast line. The UI owns
// no game state; it calls back into main.js for PLAY, CONTINUE, SAVE and LOAD, and reports whether
// it is currently paused.
const SAVE_KEY = 'portvireo.save';
const ACCENT = '#ffb347';
const ACCENT_SOFT = 'rgba(255,179,71,0.16)';
const INK = '#f2eee4';
const MUTED = '#a8a294';
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const CONTROLS = [
  ['WASD', 'Move'],
  ['MOUSE', 'Look'],
  ['F', 'Enter / exit car'],
  ['CLICK', 'Shoot'],
  ['R', 'Reload'],
  ['SHIFT', 'Sprint'],
  ['SPACE', 'Jump'],
  ['ESC', 'Pause'],
];

function saveExists() {
  try {
    return window.localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function createUi(onPlay, onLoad, onSave) {
  const doc = typeof document !== 'undefined' ? document : null;
  const callbacks = {
    play: typeof onPlay === 'function' ? onPlay : () => {},
    load: typeof onLoad === 'function' ? onLoad : () => {},
    save: typeof onSave === 'function' ? onSave : () => {},
  };

  let paused = false;
  let startVisible = false;
  let overlayTimer = null;
  let bannerTimer = null;

  const root = doc ? doc.createElement('div') : null;
  if (root) {
    root.style.cssText = 'position:fixed;inset:0;z-index:40;font-family:' + FONT + ';color:' + INK + ';user-select:none;-webkit-user-select:none;';
    (doc.body || doc.documentElement).appendChild(root);
  }

  function element(tag, style, parent, text) {
    if (!doc) return null;
    const node = doc.createElement(tag);
    if (style) node.style.cssText = style;
    if (text !== undefined && text !== null) node.textContent = text;
    (parent || root).appendChild(node);
    return node;
  }

  function button(label, primary, handler, parent) {
    const node = element(
      'button',
      'display:block;width:100%;margin:8px 0;padding:13px 18px;font-family:inherit;font-size:15px;letter-spacing:0.2em;text-transform:uppercase;cursor:pointer;border-radius:2px;transition:background 120ms linear,color 120ms linear,border-color 120ms linear;'
        + (primary
          ? 'background:' + ACCENT + ';color:#1a1408;border:1px solid ' + ACCENT + ';font-weight:700;'
          : 'background:rgba(18,20,24,0.62);color:' + INK + ';border:1px solid rgba(242,238,228,0.28);'),
      parent,
      label,
    );
    if (node) {
      node.addEventListener('mouseenter', () => {
        if (primary) node.style.background = '#ffc46b';
        else {
          node.style.background = ACCENT_SOFT;
          node.style.borderColor = ACCENT;
        }
      });
      node.addEventListener('mouseleave', () => {
        if (primary) node.style.background = ACCENT;
        else {
          node.style.background = 'rgba(18,20,24,0.62)';
          node.style.borderColor = 'rgba(242,238,228,0.28)';
        }
      });
      node.addEventListener('click', (event) => {
        event.preventDefault();
        handler();
      });
    }
    return node;
  }

  // ---- start screen -------------------------------------------------------------------------

  const start = element(
    'div',
    'position:absolute;inset:0;display:none;align-items:stretch;justify-content:flex-start;overflow:auto;'
      + 'background:radial-gradient(ellipse at 72% 34%, rgba(10,13,18,0.18) 0%, rgba(7,9,13,0.66) 55%, rgba(5,6,9,0.94) 100%),'
      + 'linear-gradient(180deg, rgba(5,7,10,0.55) 0%, rgba(5,7,10,0.1) 38%, rgba(5,7,10,0.82) 100%);'
      + 'backdrop-filter:blur(1.5px);',
    root,
  );
  if (start) {
    start.style.pointerEvents = 'auto';
    const column = element(
      'div',
      'position:relative;box-sizing:border-box;margin:auto 0;padding:clamp(28px,6vh,64px) clamp(24px,7vw,96px);max-width:820px;',
      start,
    );
    const rule = element('div', 'width:64px;height:3px;background:' + ACCENT + ';margin-bottom:22px;box-shadow:0 0 18px rgba(255,179,71,0.55);', column);
    if (rule) rule.setAttribute('aria-hidden', 'true');
    element('div', 'font-size:12px;letter-spacing:0.42em;color:' + ACCENT + ';text-transform:uppercase;margin-bottom:14px;', column, 'PORT VIREO \u00b7 2026 \u00b7 OFFLINE');
    const title = element(
      'h1',
      'margin:0;font-family:inherit;font-size:clamp(38px,6.4vw,78px);line-height:0.95;letter-spacing:0.02em;font-weight:800;text-transform:uppercase;'
        + 'text-shadow:0 2px 0 rgba(0,0,0,0.55),0 18px 60px rgba(0,0,0,0.9);',
      column,
      'PORT VIREO: SALT & SIN',
    );
    if (title) title.style.color = INK;
    element(
      'div',
      'margin-top:16px;font-size:clamp(12px,1.5vw,15px);letter-spacing:0.3em;text-transform:uppercase;color:' + ACCENT + ';',
      column,
      'A city runs on salt, money and bad decisions.',
    );
    const blurb = element(
      'p',
      'margin:26px 0 0;max-width:620px;font-size:clamp(13px,1.45vw,15.5px);line-height:1.75;color:#d9d3c5;letter-spacing:0.02em;',
      column,
      'The harbour is quiet only because everybody is pretending. Rhea Quill has a courier run, the Salt Crew has a debt,'
        + ' and every corner from Marigold Row to Lantern Quay is watching to see which one of you blinks first.'
        + ' Drive, walk, steal, shoot if it comes to it \u2014 and get to the boat before the city decides you are the story.',
    );
    if (blurb) blurb.style.textShadow = '0 2px 14px rgba(0,0,0,0.9)';

    const table = element(
      'div',
      'display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:26px 0 8px;padding:16px 20px;max-width:520px;'
        + 'background:rgba(10,13,17,0.55);border:1px solid rgba(242,238,228,0.14);border-left:2px solid ' + ACCENT + ';backdrop-filter:blur(6px);',
      column,
    );
    for (let index = 0; index < CONTROLS.length; index += 1) {
      element('span', 'font-size:12px;letter-spacing:0.14em;color:' + ACCENT + ';', table, CONTROLS[index][0]);
      element('span', 'font-size:12px;letter-spacing:0.08em;color:' + MUTED + ';', table, CONTROLS[index][1]);
    }

    const actions = element('div', 'max-width:320px;margin-top:22px;', column);
    button('PLAY', true, () => {
      hideStart();
      callbacks.play();
    }, actions);
    const continueButton = button('CONTINUE', false, () => {
      hideStart();
      callbacks.load();
    }, actions);
    if (continueButton && !saveExists()) {
      continueButton.style.display = 'none';
      continueButton.setAttribute('aria-hidden', 'true');
    }
    element('div', 'margin-top:16px;font-size:11px;letter-spacing:0.2em;color:#7d7768;', column, 'CLICK TO CAPTURE THE MOUSE \u00b7 ESC TO RELEASE');
  }

  // ---- pointer-lock hint --------------------------------------------------------------------

  const prompt = element(
    'div',
    'position:absolute;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:8px 16px;font-size:11px;letter-spacing:0.22em;'
      + 'color:#e8e0cf;background:rgba(8,10,14,0.6);border:1px solid rgba(242,238,228,0.16);border-radius:2px;pointer-events:none;',
    root,
    'CLICK TO LOOK AROUND',
  );

  // ---- pause menu ---------------------------------------------------------------------------

  const pause = element('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(4,6,9,0.58);backdrop-filter:blur(7px);', root);
  let pausePanel = null;
  let controlsPanel = null;
  if (pause) {
    pause.style.pointerEvents = 'auto';
    pausePanel = element(
      'div',
      'position:relative;box-sizing:border-box;width:min(380px,86vw);padding:30px 30px 24px;background:rgba(14,16,21,0.9);'
        + 'border:1px solid rgba(242,238,228,0.16);border-top:2px solid ' + ACCENT + ';box-shadow:0 30px 90px rgba(0,0,0,0.8);backdrop-filter:blur(14px);',
      pause,
    );
    element('div', 'font-size:11px;letter-spacing:0.4em;color:' + ACCENT + ';', pausePanel, 'PORT VIREO');
    element('h2', 'margin:8px 0 20px;font-family:inherit;font-size:26px;font-weight:800;letter-spacing:0.22em;color:' + INK + ';text-transform:uppercase;', pausePanel, 'PAUSED');

    const resume = button('RESUME', true, () => togglePause(false), pausePanel);
    if (resume) resume.setAttribute('aria-label', 'Resume the game');
    button('SAVE', false, () => {
      callbacks.save();
      toast('PROGRESS SAVED');
    }, pausePanel);
    button('LOAD', false, () => {
      togglePause(false);
      callbacks.load();
    }, pausePanel);
    const controlsButton = button('CONTROLS', false, () => {
      if (!controlsPanel) return;
      controlsPanel.style.display = controlsPanel.style.display === 'none' ? 'grid' : 'none';
    }, pausePanel);
    if (controlsButton) controlsButton.setAttribute('aria-expanded', 'false');

    controlsPanel = element(
      'div',
      'display:none;grid-template-columns:max-content 1fr;gap:5px 16px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(242,238,228,0.12);',
      pausePanel,
    );
    for (let index = 0; index < CONTROLS.length; index += 1) {
      element('span', 'font-size:11px;letter-spacing:0.14em;color:' + ACCENT + ';', controlsPanel, CONTROLS[index][0]);
      element('span', 'font-size:11px;letter-spacing:0.08em;color:' + MUTED + ';', controlsPanel, CONTROLS[index][1]);
    }
    element('div', 'margin-top:18px;font-size:10px;letter-spacing:0.2em;color:#736d5f;text-align:center;', pausePanel, 'ESC RESUMES \u00b7 AUTOSAVE IS NOT A THING HERE');
  }

  // ---- wasted / busted ----------------------------------------------------------------------

  const overlay = element(
    'div',
    'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;'
      + 'opacity:0;transition:opacity 700ms ease-out;pointer-events:none;',
    root,
  );
  const overlayTitle = element(
    'div',
    'font-family:inherit;font-size:clamp(52px,12vw,132px);font-weight:900;letter-spacing:0.16em;text-transform:uppercase;'
      + 'text-shadow:0 4px 0 rgba(0,0,0,0.6),0 24px 80px rgba(0,0,0,0.95);',
    overlay,
    'WASTED',
  );
  const overlayRule = element('div', 'width:min(420px,60vw);height:1px;margin:22px 0 18px;background:rgba(242,238,228,0.4);', overlay);
  if (overlayRule) overlayRule.setAttribute('aria-hidden', 'true');
  const overlayHint = element('div', 'font-size:clamp(11px,1.5vw,14px);letter-spacing:0.32em;text-transform:uppercase;color:#e4ddcc;', overlay, 'PRESS SPACE TO RESPAWN AT PORT VIREO GENERAL');
  const overlaySub = element('div', 'margin-top:10px;font-size:clamp(10px,1.2vw,12px);letter-spacing:0.24em;color:#a8a294;', overlay, '');

  // ---- toast --------------------------------------------------------------------------------

  const toastNode = element(
    'div',
    'position:absolute;left:50%;top:96px;transform:translateX(-50%);padding:9px 18px;font-size:12px;letter-spacing:0.2em;'
      + 'color:#1d1609;background:' + ACCENT + ';border-radius:2px;opacity:0;transition:opacity 180ms linear;pointer-events:none;font-weight:700;',
    root,
  );

  // ---- behaviour ----------------------------------------------------------------------------

  function refreshContinue() {
    if (!continueButton) return;
    continueButton.style.display = saveExists() ? 'block' : 'none';
  }

  function showStart() {
    if (!start) return;
    refreshContinue();
    start.style.display = 'flex';
    startVisible = true;
    paused = false;
    if (pause) pause.style.display = 'none';
    if (prompt) prompt.style.display = 'none';
  }

  function hideStart() {
    if (start) start.style.display = 'none';
    startVisible = false;
  }

  function hidePrompt() {
    if (prompt) prompt.style.display = 'none';
  }

  function showPrompt() {
    if (prompt && !startVisible && !paused) prompt.style.display = 'block';
  }

  function togglePause(force) {
    const next = typeof force === 'boolean' ? force : !paused;
    if (next === paused) return paused;
    paused = next;
    if (startVisible && paused) paused = false;
    if (pause) pause.style.display = paused ? 'flex' : 'none';
    if (controlsPanel) controlsPanel.style.display = 'none';
    if (paused) {
      if (prompt) prompt.style.display = 'none';
      refreshContinue();
    }
    return paused;
  }

  function showOverlay(kind) {
    if (!overlay) return;
    const wasted = kind !== 'busted';
    overlay.style.display = 'flex';
    overlay.style.background = wasted
      ? 'radial-gradient(ellipse at center, rgba(70,0,0,0.35) 0%, rgba(72,0,0,0.72) 60%, rgba(20,0,0,0.94) 100%)'
      : 'radial-gradient(ellipse at center, rgba(0,14,44,0.32) 0%, rgba(6,20,58,0.72) 60%, rgba(2,6,20,0.94) 100%)';
    if (overlayTitle) {
      overlayTitle.textContent = wasted ? 'WASTED' : 'BUSTED';
      overlayTitle.style.color = wasted ? '#ff5a4a' : '#8fc4ff';
      overlayTitle.style.textShadow = wasted
        ? '0 4px 0 rgba(0,0,0,0.6),0 0 60px rgba(255,50,30,0.55),0 24px 80px rgba(0,0,0,0.95)'
        : '0 4px 0 rgba(0,0,0,0.6),0 0 60px rgba(80,150,255,0.55),0 24px 80px rgba(0,0,0,0.95)';
    }
    if (overlaySub) overlaySub.textContent = wasted ? 'YOU DIED IN PORT VIREO' : 'THE LAW GOT YOU THIS TIME';
    if (overlayHint) {
      overlayHint.textContent = wasted
        ? 'PRESS SPACE TO RESPAWN AT PORT VIREO GENERAL'
        : 'PRESS SPACE TO WALK OUT OF THE CELL';
    }
    if (overlayTimer !== null) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      overlay.style.opacity = '1';
    }, 18);
    if (bannerTimer !== null) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => hideOverlay(), 4200);
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    if (overlayTimer !== null) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      overlay.style.display = 'none';
    }, 720);
  }

  function toast(message) {
    if (!toastNode) return;
    toastNode.textContent = String(message || '');
    toastNode.style.opacity = '1';
    if (bannerTimer !== null) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      toastNode.style.opacity = '0';
    }, 2200);
  }

  const api = {
    root,
    showStart,
    hideStart,
    togglePause,
    showWasted: () => showOverlay('wasted'),
    showBusted: () => showOverlay('busted'),
    hideOverlay,
    toast,
    hidePrompt,
    showPrompt,
    refreshContinue,
    get isPaused() {
      return paused;
    },
    set isPaused(value) {
      togglePause(!!value);
    },
    get startVisible() {
      return startVisible;
    },
  };

  return api;
}
