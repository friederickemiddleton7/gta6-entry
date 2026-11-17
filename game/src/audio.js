// All of the sound, synthesised in the browser: no files, no network. One AudioContext is made on
// the first resume() (the PLAY click) because browsers refuse to start audio before a gesture; after
// that the engine is a sawtooth through a lowpass that follows speed, a shot is a short noise burst
// with a click, an impact is a low thud, the siren is two alternating tones, and the music bed is a
// four-bar loop of bass, pad and a light tick. Every level is scheduled from a small seeded random
// source so no take sounds different from the last.
const MASTER_LEVEL = 0.32;
const ENGINE_LEVEL = 0.14;
const MUSIC_LEVEL = 0.1;
const TEMPO = 96;
const BEAT = 60 / TEMPO;
const BAR = BEAT * 4;
const ROOT = 55;
const CHORDS = [
  [0, 3, 7, 10],
  [0, 4, 7, 11],
  [0, 3, 7, 10],
  [0, 5, 7, 12],
];
const BASS_STEPS = [0, 0, 7, 0, 3, 0, 7, 5];
const PAD_STEPS = [0, 2, 4, 6];

function seededRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function createAudio() {
  const random = seededRandom(0x5071ce);
  const api = {
    engine,
    shot,
    impact,
    siren,
    ui,
    musicStart,
    musicStop,
    resume,
    suspend,
    get ready() {
      return context !== null && context.state === 'running';
    },
  };

  let context = null;
  let master = null;
  let engineGain = null;
  let engineFilter = null;
  let engineOscA = null;
  let engineOscB = null;
  let engineRunning = false;
  let engineSpeed = 0;
  let musicGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let musicPlaying = false;
  let sirenNodes = null;
  let noiseBuffer = null;

  function ensureContext() {
    if (context) return context;
    const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!Ctor) return null;
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = MASTER_LEVEL;
      master.connect(context.destination);
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineFilter.Q.value = 3.2;
      engineGain.connect(engineFilter);
      engineFilter.connect(master);
      musicGain = context.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
      noiseBuffer = makeNoise(context);
    } catch {
      context = null;
      master = null;
    }
    return context;
  }

  function makeNoise(ctx) {
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = random() * 2 - 1;
    return buffer;
  }

  function resume() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {
        // A resume can only fail before a gesture; the caller tries again on the next click.
      });
    }
  }

  function suspend() {
    if (context && context.state === 'running') context.suspend().catch(() => {});
  }

  function now() {
    return context ? context.currentTime : 0;
  }

  // ---- engine --------------------------------------------------------------------------------

  function startEngine() {
    if (!context || engineRunning) return;
    engineOscA = context.createOscillator();
    engineOscA.type = 'sawtooth';
    engineOscA.frequency.value = 42;
    engineOscB = context.createOscillator();
    engineOscB.type = 'square';
    engineOscB.frequency.value = 21;
    const blend = context.createGain();
    blend.gain.value = 0.45;
    engineOscA.connect(engineGain);
    engineOscB.connect(blend);
    blend.connect(engineGain);
    engineOscA.start();
    engineOscB.start();
    engineRunning = true;
  }

  function engine(speed) {
    const value = Math.abs(Number(speed) || 0);
    engineSpeed = value;
    if (!context || context.state !== 'running') return;
    startEngine();
    if (!engineRunning) return;
    const t = now();
    const target = Math.min(1, value / 26);
    const frequency = 38 + target * 96;
    engineOscA.frequency.setTargetAtTime(frequency, t, 0.08);
    engineOscB.frequency.setTargetAtTime(frequency * 0.5, t, 0.08);
    engineFilter.frequency.setTargetAtTime(240 + target * 1500, t, 0.1);
    engineGain.gain.setTargetAtTime(value > 0.4 ? ENGINE_LEVEL * (0.45 + target * 0.55) : 0, t, 0.14);
  }

  // ---- one-shots -----------------------------------------------------------------------------

  function shot() {
    if (!context || context.state !== 'running') return;
    const t = now();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.34, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.9;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = 1.7 + random() * 0.3;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + 0.16);

    const crack = context.createOscillator();
    crack.type = 'square';
    crack.frequency.setValueAtTime(310, t);
    crack.frequency.exponentialRampToValueAtTime(60, t + 0.07);
    const crackGain = context.createGain();
    crackGain.gain.setValueAtTime(0.16, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0006, t + 0.08);
    crack.connect(crackGain);
    crackGain.connect(master);
    crack.start(t);
    crack.stop(t + 0.09);
  }

  function impact() {
    if (!context || context.state !== 'running') return;
    const t = now();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(150, t);
    oscillator.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(t);
    oscillator.stop(t + 0.22);

    const thud = context.createBufferSource();
    thud.buffer = noiseBuffer;
    thud.playbackRate.value = 0.4;
    const thudFilter = context.createBiquadFilter();
    thudFilter.type = 'lowpass';
    thudFilter.frequency.value = 420;
    const thudGain = context.createGain();
    thudGain.gain.setValueAtTime(0.18, t);
    thudGain.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    thud.connect(thudFilter);
    thudFilter.connect(thudGain);
    thudGain.connect(master);
    thud.start(t);
    thud.stop(t + 0.14);
  }

  function ui() {
    if (!context || context.state !== 'running') return;
    const t = now();
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(760, t);
    oscillator.frequency.setValueAtTime(980, t + 0.035);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0006, t + 0.07);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(t);
    oscillator.stop(t + 0.08);
  }

  function siren(on) {
    if (!context || context.state !== 'running') return;
    if (on) {
      if (sirenNodes) return;
      const t = now();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.2);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 680;
      const lfo = context.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.35;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(oscillator.frequency);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(t);
      lfo.start(t);
      sirenNodes = { oscillator, lfo, gain };
    } else if (sirenNodes) {
      const t = now();
      const nodes = sirenNodes;
      sirenNodes = null;
      nodes.gain.gain.setTargetAtTime(0.0001, t, 0.08);
      try {
        nodes.oscillator.stop(t + 0.4);
        nodes.lfo.stop(t + 0.4);
      } catch {
        // Already stopped: nothing to do.
      }
    }
  }

  // ---- the music bed ------------------------------------------------------------------------

  function playBass(note, at, length) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = midiToHz(note);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, at);
    filter.frequency.exponentialRampToValueAtTime(170, at + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.5, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0007, at + length);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
  }

  function playPad(notes, at, length) {
    for (let index = 0; index < notes.length; index += 1) {
      const oscillator = context.createOscillator();
      oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
      oscillator.frequency.value = midiToHz(notes[index]);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.1, at + 0.5);
      gain.gain.setValueAtTime(0.1, at + length - 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0008, at + length);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      oscillator.start(at);
      oscillator.stop(at + length + 0.02);
    }
  }

  function playTick(at) {
    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = 2400;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.035, at);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.03);
    oscillator.connect(gain);
    gain.connect(musicGain);
    oscillator.start(at);
    oscillator.stop(at + 0.04);
  }

  /** Schedule one bar (four beats) at time `at`; steps advance so the loop is four bars long. */
  function scheduleBar(at) {
    const chord = CHORDS[Math.floor(musicStep / 8) % CHORDS.length];
    const bassPattern = BASS_STEPS;
    for (let step = 0; step < 8; step += 1) {
      const when = at + step * (BEAT / 2);
      const degree = bassPattern[(step + musicStep) % bassPattern.length];
      playBass(ROOT + chord[0] + degree, when, BEAT * 0.46);
      if (step % 2 === 1) playTick(when);
    }
    const padNotes = [];
    for (let index = 0; index < PAD_STEPS.length; index += 1) padNotes.push(ROOT + 12 + chord[index % chord.length]);
    playPad(padNotes, at, BAR * 0.98);
    musicStep += 8;
  }

  function pumpMusic() {
    if (!musicPlaying || !context || context.state !== 'running') return;
    const lookahead = 0.35;
    // A tab that was asleep leaves musicTimer far behind: skip ahead instead of firing old bars.
    if (musicTimer === null || musicTimer < now() - BAR) musicTimer = now() + 0.05;
    while (musicTimer < now() + lookahead + BAR * 2) {
      scheduleBar(musicTimer);
      musicTimer += BAR;
    }
  }

  function musicStart() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (musicPlaying) return;
    musicPlaying = true;
    const t = ctx.currentTime + 0.08;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(0.0001, t);
    musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 1.2);
    musicStep = 0;
    musicTimer = t;
    scheduleBar(musicTimer);
    musicTimer += BAR;
  }

  function musicStop() {
    if (!context) return;
    musicPlaying = false;
    if (musicGain) {
      const t = now();
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setTargetAtTime(0.0001, t, 0.25);
    }
  }

  if (typeof window !== 'undefined') {
    setInterval(pumpMusic, 120);
  }

  return api;
}
