// Procedural sound effects. Each sound is synthesized once into an AudioBuffer (OfflineAudioContext)
// and then played cheaply, optionally positioned in 3D with HRTF so footsteps/shots have direction.
// Put files named <sound>.wav/.mp3/.ogg in public/sounds/ to replace any of them (e.g. shot_ak47.wav).

const SR = 44100;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function env(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(c, out, { t = 0, dur = 0.2, gain = 1, type = 'lowpass', freq = 2000, q = 0.7, freqEnd, attack = 0.001, seed = 1 }) {
  const len = Math.ceil((dur + 0.05) * c.sampleRate), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0), r = rng(seed);
  for (let i = 0; i < len; i++) d[i] = r();
  const src = c.createBufferSource();
  src.buffer = b;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = c.createGain();
  env(g.gain, t, gain, attack, dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

function tone(c, out, { t = 0, dur = 0.2, gain = 1, freq = 440, freqEnd, type = 'sine', attack = 0.002 }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = c.createGain();
  env(g.gain, t, gain, attack, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.02);
}

function softClip(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
}

// Gunshot = high "crack" + filtered body + low thump + room tail (+ optional action click).
function gun(o) {
  return (c, out) => {
    const bus = c.createGain();
    bus.gain.value = o.vol ?? 0.9;
    const sh = c.createWaveShaper();
    sh.curve = softClip(o.drive ?? 2);
    bus.connect(sh).connect(out);
    const s = o.seed ?? 3;
    noise(c, bus, { dur: o.crackDur ?? 0.05, gain: o.crack ?? 1, type: 'highpass', freq: o.hp ?? 1000, seed: s });
    noise(c, bus, { dur: o.bodyDur ?? 0.1, gain: o.body ?? 0.8, type: 'lowpass', freq: o.lp ?? 3000, freqEnd: 300, seed: s + 1 });
    tone(c, bus, { dur: o.thumpDur ?? 0.12, gain: o.thump ?? 0.8, freq: o.thumpF ?? 140, freqEnd: (o.thumpF ?? 140) * 0.35 });
    if (o.tail) noise(c, bus, { t: 0.015, dur: o.tailDur ?? 0.5, gain: o.tail, freq: o.tailF ?? 900, freqEnd: 140, attack: 0.02, seed: s + 2 });
    if (o.mech) noise(c, bus, { t: o.mechT ?? 0.06, dur: 0.03, gain: o.mech, type: 'bandpass', freq: 3500, q: 3, seed: 9 });
  };
}

const DEFS = {
  shot_glock: [0.5, gun({ crack: 0.9, hp: 1500, body: 0.7, lp: 4000, bodyDur: 0.08, thump: 0.5, thumpF: 190, tail: 0.25, tailDur: 0.35, tailF: 1200, mech: 0.2 })],
  shot_usp: [0.3, gun({ crack: 0.35, hp: 2500, crackDur: 0.035, body: 0.35, lp: 2000, bodyDur: 0.06, thump: 0.25, thumpF: 260, tail: 0.05, tailDur: 0.12, mech: 0.35, mechT: 0.03, drive: 1 })],
  shot_p250: [0.55, gun({ crack: 1, hp: 1300, body: 0.75, lp: 3800, bodyDur: 0.09, thump: 0.6, thumpF: 170, tail: 0.3, tailDur: 0.4, tailF: 1100, mech: 0.2, seed: 5 })],
  shot_deagle: [1.0, gun({ crack: 1, hp: 900, body: 1, lp: 3500, bodyDur: 0.16, thump: 1, thumpF: 110, thumpDur: 0.18, tail: 0.5, tailDur: 0.8, drive: 3 })],
  shot_mac10: [0.35, gun({ crack: 0.8, hp: 1600, body: 0.6, lp: 3500, bodyDur: 0.07, thump: 0.45, thumpF: 210, tail: 0.18, tailDur: 0.25, seed: 7 })],
  shot_mp9: [0.35, gun({ crack: 0.75, hp: 1800, body: 0.55, lp: 4200, bodyDur: 0.07, thump: 0.4, thumpF: 230, tail: 0.18, tailDur: 0.25, seed: 11 })],
  shot_p90: [0.35, gun({ crack: 0.7, hp: 2000, body: 0.5, lp: 4500, bodyDur: 0.07, thump: 0.4, thumpF: 250, tail: 0.2, tailDur: 0.25, seed: 13 })],
  shot_nova: [1.1, gun({ crack: 0.9, hp: 500, body: 1.1, lp: 2500, bodyDur: 0.2, thump: 1.1, thumpF: 80, thumpDur: 0.22, tail: 0.7, tailDur: 0.9, tailF: 700, drive: 3 })],
  shot_galil: [0.65, gun({ crack: 0.95, hp: 900, body: 0.85, lp: 3200, bodyDur: 0.1, thump: 0.8, thumpF: 135, tail: 0.4, tailDur: 0.5, drive: 2.5, seed: 17 })],
  shot_ak47: [0.7, gun({ crack: 1, hp: 700, body: 0.95, lp: 3000, bodyDur: 0.11, thump: 0.95, thumpF: 118, tail: 0.5, tailDur: 0.6, tailF: 850, drive: 3 })],
  shot_m4a4: [0.6, gun({ crack: 0.9, hp: 1100, body: 0.8, lp: 3800, bodyDur: 0.09, thump: 0.75, thumpF: 150, tail: 0.4, tailDur: 0.5, tailF: 1000, drive: 2.2, seed: 19 })],
  shot_m4a1s: [0.3, gun({ crack: 0.35, hp: 2200, crackDur: 0.035, body: 0.4, lp: 1800, bodyDur: 0.07, thump: 0.35, thumpF: 200, tail: 0.1, tailDur: 0.2, mech: 0.4, mechT: 0.025, drive: 1.2 })],
  shot_ssg08: [1.1, gun({ crack: 1, hp: 900, body: 0.9, lp: 5000, bodyDur: 0.1, thump: 0.8, thumpF: 130, tail: 0.55, tailDur: 0.9, tailF: 1100, seed: 23 })],
  shot_awp: [1.6, gun({ crack: 1, hp: 400, body: 1.2, lp: 3000, bodyDur: 0.2, thump: 1.3, thumpF: 65, thumpDur: 0.3, tail: 0.9, tailDur: 1.4, tailF: 700, drive: 4 })],
  knife_swing: [0.3, (c, o) => noise(c, o, { dur: 0.22, gain: 0.5, type: 'bandpass', freq: 500, freqEnd: 3000, q: 1.5, attack: 0.05 })],
  knife_hit: [0.2, (c, o) => { noise(c, o, { dur: 0.1, gain: 0.9, freq: 1500 }); tone(c, o, { dur: 0.1, gain: 0.6, freq: 150, freqEnd: 60 }); noise(c, o, { dur: 0.05, gain: 0.3, type: 'highpass', freq: 4000, seed: 4 }); }],
  dry: [0.08, (c, o) => { tone(c, o, { dur: 0.015, gain: 0.2, freq: 2000, type: 'square' }); noise(c, o, { dur: 0.02, gain: 0.3, type: 'bandpass', freq: 4000, q: 3 }); }],
  mag_out: [0.25, (c, o) => { noise(c, o, { dur: 0.05, gain: 0.6, type: 'bandpass', freq: 1800, q: 2 }); tone(c, o, { dur: 0.04, gain: 0.3, freq: 900, freqEnd: 700, type: 'triangle' }); noise(c, o, { t: 0.05, dur: 0.12, gain: 0.25, freq: 1500, seed: 6 }); }],
  mag_in: [0.2, (c, o) => { noise(c, o, { dur: 0.03, gain: 0.8, type: 'bandpass', freq: 2500, q: 3 }); tone(c, o, { t: 0.03, dur: 0.02, gain: 0.2, freq: 1200, type: 'square' }); noise(c, o, { t: 0.02, dur: 0.06, gain: 0.5, freq: 800, seed: 8 }); }],
  bolt: [0.25, (c, o) => { noise(c, o, { dur: 0.12, gain: 0.5, type: 'bandpass', freq: 1500, freqEnd: 3000, q: 2 }); noise(c, o, { t: 0.13, dur: 0.03, gain: 0.8, type: 'bandpass', freq: 3000, q: 4, seed: 12 }); }],
  deploy: [0.3, (c, o) => { noise(c, o, { dur: 0.18, gain: 0.25, type: 'bandpass', freq: 1000, freqEnd: 2500, attack: 0.04 }); noise(c, o, { t: 0.18, dur: 0.03, gain: 0.5, type: 'bandpass', freq: 3500, q: 4, seed: 14 }); }],
  shell: [0.12, (c, o) => { tone(c, o, { dur: 0.05, gain: 0.15, freq: 3000, freqEnd: 2600, type: 'triangle' }); noise(c, o, { dur: 0.04, gain: 0.5, type: 'bandpass', freq: 2000, q: 2 }); }],
  scope: [0.08, (c, o) => { noise(c, o, { dur: 0.025, gain: 0.4, type: 'bandpass', freq: 3000, q: 5 }); tone(c, o, { t: 0.03, dur: 0.02, gain: 0.1, freq: 1500 }); }],
  jump: [0.15, (c, o) => noise(c, o, { dur: 0.1, gain: 0.3, type: 'bandpass', freq: 1200, q: 1, attack: 0.02 })],
  land: [0.2, (c, o) => { noise(c, o, { dur: 0.12, gain: 0.9, freq: 700 }); tone(c, o, { dur: 0.12, gain: 0.8, freq: 80, freqEnd: 45 }); }],
  hit_body: [0.15, (c, o) => { noise(c, o, { dur: 0.09, gain: 1, freq: 1200 }); tone(c, o, { dur: 0.08, gain: 0.7, freq: 180, freqEnd: 70 }); }],
  // "dink": bullet glancing off a helmet — short, bright, inharmonic metal ping with a click
  dink: [0.35, (c, o) => {
    noise(c, o, { dur: 0.012, gain: 0.8, type: 'highpass', freq: 4000, seed: 54 });
    tone(c, o, { dur: 0.22, gain: 0.35, freq: 3150, freqEnd: 2950 });
    tone(c, o, { dur: 0.16, gain: 0.25, freq: 4730, freqEnd: 4480 });
    tone(c, o, { dur: 0.1, gain: 0.18, freq: 6640 });
    tone(c, o, { dur: 0.07, gain: 0.12, freq: 8910 });
  }],
  // headshot that didn't kill: crunchy impact + clean two-note ding
  headshot: [0.6, (c, o) => {
    noise(c, o, { dur: 0.06, gain: 0.9, type: 'bandpass', freq: 1800, q: 1.2, seed: 50 });
    noise(c, o, { dur: 0.12, gain: 0.5, freq: 700, seed: 51 });
    tone(c, o, { t: 0.01, dur: 0.45, gain: 0.32, freq: 1760 });
    tone(c, o, { t: 0.01, dur: 0.35, gain: 0.18, freq: 2637 });
    tone(c, o, { t: 0.01, dur: 0.2, gain: 0.08, freq: 3520 });
  }],
  // headshot kill: heavier crunch + punch, then a rising "ding-ding" chord with a shimmer tail
  headshot_kill: [0.9, (c, o) => {
    noise(c, o, { dur: 0.07, gain: 1, type: 'bandpass', freq: 1600, q: 1, seed: 52 });
    tone(c, o, { dur: 0.12, gain: 0.6, freq: 160, freqEnd: 60 });
    tone(c, o, { t: 0.02, dur: 0.7, gain: 0.3, freq: 1318.5 });
    tone(c, o, { t: 0.02, dur: 0.6, gain: 0.22, freq: 1975.5 });
    tone(c, o, { t: 0.09, dur: 0.6, gain: 0.28, freq: 2637 });
    noise(c, o, { t: 0.09, dur: 0.35, gain: 0.25, type: 'highpass', freq: 7000, seed: 53, attack: 0.01 });
  }],
  hurt: [0.2, (c, o) => { noise(c, o, { dur: 0.15, gain: 1, freq: 600 }); tone(c, o, { dur: 0.14, gain: 0.9, freq: 110, freqEnd: 55 }); }],
  kill: [0.4, (c, o) => { tone(c, o, { dur: 0.12, gain: 0.3, freq: 880, type: 'triangle' }); tone(c, o, { t: 0.07, dur: 0.25, gain: 0.3, freq: 1320, type: 'triangle' }); }],
  buy: [0.3, (c, o) => { tone(c, o, { dur: 0.03, gain: 0.12, freq: 1200, type: 'square' }); tone(c, o, { t: 0.04, dur: 0.2, gain: 0.2, freq: 1800 }); }],
  round_start: [0.5, (c, o) => { tone(c, o, { dur: 0.12, gain: 0.3, freq: 660 }); tone(c, o, { t: 0.15, dur: 0.3, gain: 0.3, freq: 990 }); }],
  win: [1.0, (c, o) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, { t: i * 0.1, dur: 0.5, gain: 0.22, freq: f, type: 'triangle' }))],
  lose: [1.0, (c, o) => [440, 349, 294].forEach((f, i) => tone(c, o, { t: i * 0.15, dur: 0.6, gain: 0.22, freq: f, type: 'triangle' }))],
  whiz: [0.15, (c, o) => { noise(c, o, { dur: 0.12, gain: 0.7, type: 'bandpass', freq: 5000, freqEnd: 1200, q: 2 }); noise(c, o, { dur: 0.015, gain: 0.6, type: 'highpass', freq: 6000, seed: 21 }); }],
  impact: [0.1, (c, o) => { noise(c, o, { dur: 0.04, gain: 0.5, type: 'bandpass', freq: 2500, q: 1 }); noise(c, o, { dur: 0.06, gain: 0.4, freq: 600, seed: 3 }); }],
  impact_w: [0.12, (c, o) => { noise(c, o, { dur: 0.07, gain: 0.6, type: 'bandpass', freq: 900, q: 2 }); tone(c, o, { dur: 0.05, gain: 0.3, freq: 300, freqEnd: 180 }); }],
  impact_m: [0.2, (c, o) => { tone(c, o, { dur: 0.15, gain: 0.2, freq: 1800 }); tone(c, o, { dur: 0.12, gain: 0.15, freq: 2700 }); noise(c, o, { dur: 0.03, gain: 0.4, type: 'highpass', freq: 3000 }); }],
  tick: [0.06, (c, o) => tone(c, o, { dur: 0.03, gain: 0.15, freq: 1000, type: 'square' })],
  // ---- reload stages (sequenced per weapon type in RELOAD_SEQ) ----
  rl_release: [0.06, (c, o) => { noise(c, o, { dur: 0.012, gain: 0.7, type: 'highpass', freq: 4500, seed: 60 }); tone(c, o, { dur: 0.01, gain: 0.25, freq: 2600, type: 'square' }); }],
  rl_out: [0.3, (c, o) => {
    noise(c, o, { dur: 0.12, gain: 0.55, type: 'bandpass', freq: 2600, freqEnd: 900, q: 2.5, attack: 0.01, seed: 61 });
    tone(c, o, { t: 0.1, dur: 0.07, gain: 0.45, freq: 190, freqEnd: 110 });
    noise(c, o, { t: 0.1, dur: 0.05, gain: 0.35, freq: 1200, seed: 62 });
  }],
  rl_in: [0.3, (c, o) => {
    noise(c, o, { dur: 0.08, gain: 0.45, type: 'bandpass', freq: 900, freqEnd: 2600, q: 2.5, attack: 0.01, seed: 63 });
    noise(c, o, { t: 0.085, dur: 0.035, gain: 1, type: 'bandpass', freq: 3000, q: 2, seed: 64 });
    tone(c, o, { t: 0.085, dur: 0.06, gain: 0.7, freq: 230, freqEnd: 140 });
  }],
  rl_rack: [0.4, (c, o) => {
    noise(c, o, { dur: 0.09, gain: 0.6, type: 'bandpass', freq: 1200, freqEnd: 3600, q: 2, attack: 0.01, seed: 65 });
    noise(c, o, { t: 0.09, dur: 0.02, gain: 0.7, type: 'highpass', freq: 4000, seed: 66 });
    noise(c, o, { t: 0.19, dur: 0.04, gain: 1, type: 'bandpass', freq: 2500, q: 1.5, seed: 67 });
    tone(c, o, { t: 0.19, dur: 0.08, gain: 0.8, freq: 170, freqEnd: 90 });
  }],
  rl_slide: [0.2, (c, o) => {
    noise(c, o, { dur: 0.035, gain: 1, type: 'bandpass', freq: 3400, q: 1.8, seed: 68 });
    tone(c, o, { dur: 0.05, gain: 0.55, freq: 320, freqEnd: 180 });
  }],
  rl_bolt_back: [0.25, (c, o) => {
    tone(c, o, { dur: 0.02, gain: 0.3, freq: 1800, type: 'triangle' });
    noise(c, o, { t: 0.03, dur: 0.1, gain: 0.55, type: 'bandpass', freq: 1500, freqEnd: 3200, q: 2, attack: 0.01, seed: 69 });
  }],
  rl_bolt_fwd: [0.25, (c, o) => {
    noise(c, o, { dur: 0.08, gain: 0.5, type: 'bandpass', freq: 3200, freqEnd: 1500, q: 2, attack: 0.01, seed: 70 });
    noise(c, o, { t: 0.08, dur: 0.035, gain: 1, type: 'bandpass', freq: 2800, q: 2, seed: 71 });
    tone(c, o, { t: 0.08, dur: 0.07, gain: 0.7, freq: 210, freqEnd: 120 });
  }],
  rl_pump: [0.45, (c, o) => {
    noise(c, o, { dur: 0.1, gain: 0.6, type: 'bandpass', freq: 800, freqEnd: 2000, q: 2, attack: 0.01, seed: 72 });
    tone(c, o, { t: 0.1, dur: 0.06, gain: 0.6, freq: 180, freqEnd: 100 });
    noise(c, o, { t: 0.2, dur: 0.1, gain: 0.6, type: 'bandpass', freq: 2000, freqEnd: 800, q: 2, attack: 0.01, seed: 73 });
    tone(c, o, { t: 0.3, dur: 0.07, gain: 0.8, freq: 200, freqEnd: 110 });
  }],
  death: [0.35, (c, o) => { noise(c, o, { dur: 0.3, gain: 0.8, freq: 400 }); tone(c, o, { dur: 0.3, gain: 0.6, freq: 90, freqEnd: 40 }); }],

  // ---- Zombie Holdout ----
  z_swipe: [0.35, (c, o) => { noise(c, o, { dur: 0.25, gain: 0.7, type: 'bandpass', freq: 350, freqEnd: 1800, q: 1.2, attack: 0.06, seed: 80 }); tone(c, o, { t: 0.02, dur: 0.2, gain: 0.35, freq: 140, freqEnd: 90, type: 'triangle' }); }],
  z_die: [0.9, (c, o) => { tone(c, o, { dur: 0.8, gain: 0.5, freq: 150, freqEnd: 45, type: 'sawtooth', attack: 0.03 }); noise(c, o, { dur: 0.7, gain: 0.5, type: 'bandpass', freq: 500, freqEnd: 180, q: 2, attack: 0.05, seed: 81 }); noise(c, o, { t: 0.45, dur: 0.12, gain: 0.8, freq: 500, seed: 82 }); }],
  brute_roar: [1.3, (c, o) => { tone(c, o, { dur: 1.1, gain: 0.6, freq: 70, freqEnd: 52, type: 'sawtooth', attack: 0.12 }); tone(c, o, { dur: 1.0, gain: 0.35, freq: 106, freqEnd: 80, type: 'sawtooth', attack: 0.15 }); noise(c, o, { dur: 1.1, gain: 0.7, type: 'bandpass', freq: 450, freqEnd: 250, q: 1.5, attack: 0.15, seed: 83 }); }],
  spit: [0.35, (c, o) => { noise(c, o, { dur: 0.22, gain: 0.8, type: 'bandpass', freq: 1800, freqEnd: 500, q: 2, attack: 0.02, seed: 84 }); tone(c, o, { dur: 0.15, gain: 0.3, freq: 300, freqEnd: 600 }); }],
  splat: [0.5, (c, o) => { noise(c, o, { dur: 0.3, gain: 1, freq: 900, freqEnd: 200, seed: 85 }); for (let i = 0; i < 4; i++) tone(c, o, { t: 0.05 + i * 0.07, dur: 0.06, gain: 0.2, freq: 500 + i * 170, freqEnd: 900 + i * 200 }); }],
  build: [0.25, (c, o) => { tone(c, o, { dur: 0.08, gain: 0.35, freq: 520, freqEnd: 880, type: 'triangle' }); noise(c, o, { dur: 0.06, gain: 0.5, type: 'bandpass', freq: 1600, q: 2, seed: 86 }); tone(c, o, { t: 0.06, dur: 0.1, gain: 0.25, freq: 1320 }); }],
  // hit_W/S + break_W/S: map props' own physical sound (wood crates/walls, concrete) — independent of the
  // Holdout build material. hit_Z/break_Z: the one Holdout build material, Zinkonium (also reused for metal
  // roof props). break_S also plays for the Maw erupting from the ground (zup) — a generic heavy-earth crash.
  hit_W: [0.3, (c, o) => { noise(c, o, { dur: 0.12, gain: 0.9, type: 'bandpass', freq: 700, q: 1.5, seed: 87 }); tone(c, o, { dur: 0.14, gain: 0.7, freq: 150, freqEnd: 85 }); }],
  hit_S: [0.3, (c, o) => { noise(c, o, { dur: 0.08, gain: 1, type: 'bandpass', freq: 2200, q: 1.2, seed: 88 }); tone(c, o, { dur: 0.1, gain: 0.6, freq: 210, freqEnd: 120 }); noise(c, o, { t: 0.02, dur: 0.18, gain: 0.35, freq: 900, seed: 89 }); }],
  hit_Z: [0.5, (c, o) => { tone(c, o, { dur: 0.4, gain: 0.3, freq: 820, freqEnd: 790 }); tone(c, o, { dur: 0.3, gain: 0.22, freq: 1310 }); noise(c, o, { dur: 0.04, gain: 0.7, type: 'highpass', freq: 2500, seed: 90 }); tone(c, o, { dur: 0.1, gain: 0.5, freq: 160, freqEnd: 90 }); }],
  break_W: [0.8, (c, o) => { for (let i = 0; i < 5; i++) noise(c, o, { t: i * 0.06, dur: 0.15, gain: 0.9 - i * 0.12, type: 'bandpass', freq: 600 + i * 150, q: 1.3, seed: 91 + i }); tone(c, o, { dur: 0.3, gain: 0.7, freq: 110, freqEnd: 50 }); }],
  break_S: [0.9, (c, o) => { noise(c, o, { dur: 0.7, gain: 1, freq: 1400, freqEnd: 200, seed: 96 }); for (let i = 0; i < 6; i++) noise(c, o, { t: 0.05 + i * 0.08, dur: 0.05, gain: 0.5, type: 'bandpass', freq: 2500 - i * 200, q: 3, seed: 97 + i }); tone(c, o, { dur: 0.35, gain: 0.7, freq: 90, freqEnd: 40 }); }],
  break_Z: [1.1, (c, o) => { tone(c, o, { dur: 0.9, gain: 0.35, freq: 640, freqEnd: 420 }); tone(c, o, { dur: 0.7, gain: 0.25, freq: 1010, freqEnd: 700 }); noise(c, o, { dur: 0.5, gain: 0.8, type: 'bandpass', freq: 1800, freqEnd: 500, q: 1, seed: 103 }); tone(c, o, { dur: 0.3, gain: 0.7, freq: 120, freqEnd: 50 }); }],
  chop_zink: [0.45, (c, o) => { tone(c, o, { dur: 0.35, gain: 0.35, freq: 1180, freqEnd: 1150 }); tone(c, o, { dur: 0.25, gain: 0.25, freq: 1770 }); noise(c, o, { dur: 0.03, gain: 0.8, type: 'highpass', freq: 3000, seed: 106 }); }],
  weak_hit: [0.5, (c, o) => { tone(c, o, { dur: 0.3, gain: 0.35, freq: 1568 }); tone(c, o, { t: 0.06, dur: 0.35, gain: 0.3, freq: 2349 }); noise(c, o, { dur: 0.05, gain: 0.4, type: 'highpass', freq: 5000, seed: 107 }); }],
  wave_horn: [2.2, (c, o) => { for (const [f, g] of [[98, 0.4], [147, 0.3], [196, 0.15]]) tone(c, o, { dur: 1.8, gain: g, freq: f, freqEnd: f * 0.97, type: 'sawtooth', attack: 0.25 }); noise(c, o, { dur: 1.8, gain: 0.25, type: 'bandpass', freq: 400, q: 1, attack: 0.3, seed: 108 }); }],
  core_alarm: [0.9, (c, o) => { for (let i = 0; i < 2; i++) { tone(c, o, { t: i * 0.4, dur: 0.18, gain: 0.3, freq: 880, type: 'square' }); tone(c, o, { t: i * 0.4 + 0.2, dur: 0.18, gain: 0.3, freq: 660, type: 'square' }); } }],
  revive: [0.8, (c, o) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, { t: i * 0.08, dur: 0.35, gain: 0.2, freq: f }))],
  downed: [0.9, (c, o) => { tone(c, o, { dur: 0.8, gain: 0.35, freq: 440, freqEnd: 110, type: 'triangle' }); noise(c, o, { dur: 0.3, gain: 0.5, freq: 500, seed: 109 }); }],
  shot_rocket: [1.2, (c, o) => { noise(c, o, { dur: 0.9, gain: 0.8, type: 'bandpass', freq: 700, freqEnd: 250, q: 0.8, attack: 0.02, seed: 120 }); tone(c, o, { dur: 0.25, gain: 0.7, freq: 90, freqEnd: 45 }); noise(c, o, { dur: 0.06, gain: 0.9, type: 'highpass', freq: 1500, seed: 121 }); }],
  shot_minigun: [0.25, gun({ crack: 0.7, hp: 1400, body: 0.6, lp: 3500, bodyDur: 0.05, thump: 0.4, thumpF: 170, tail: 0.12, tailDur: 0.15, drive: 2, seed: 122 })],
  explode: [2.0, (c, o) => { noise(c, o, { dur: 1.6, gain: 1.2, freq: 1800, freqEnd: 90, attack: 0.005, seed: 123 }); tone(c, o, { dur: 0.7, gain: 1, freq: 70, freqEnd: 28 }); noise(c, o, { dur: 0.08, gain: 1, type: 'highpass', freq: 2500, seed: 124 }); }],
  fire: [1.2, (c, o) => { for (let i = 0; i < 9; i++) noise(c, o, { t: i * 0.12 + (i % 3) * 0.02, dur: 0.05, gain: 0.5, type: 'bandpass', freq: 1400 + (i % 4) * 500, q: 3, seed: 125 + i }); noise(c, o, { dur: 1.1, gain: 0.5, freq: 600, attack: 0.1, seed: 134 }); }],
  shot_kinetic: [0.9, (c, o) => { noise(c, o, { dur: 0.5, gain: 1, type: 'lowpass', freq: 900, freqEnd: 120, attack: 0.005, seed: 140 }); tone(c, o, { dur: 0.35, gain: 0.8, freq: 140, freqEnd: 40 }); noise(c, o, { dur: 0.25, gain: 0.5, type: 'highpass', freq: 2500, freqEnd: 6000, seed: 141 }); }],
  zap: [0.4, (c, o) => { noise(c, o, { dur: 0.18, gain: 0.8, type: 'bandpass', freq: 3200, q: 3, seed: 142 }); for (let i = 0; i < 3; i++) tone(c, o, { t: i * 0.03, dur: 0.05, gain: 0.25, freq: 1800 + i * 900, freqEnd: 600 }); }],
  freeze_blast: [1.0, (c, o) => { noise(c, o, { dur: 0.8, gain: 0.8, type: 'highpass', freq: 3000, freqEnd: 8000, attack: 0.01, seed: 135 }); for (let i = 0; i < 5; i++) tone(c, o, { t: i * 0.05, dur: 0.4, gain: 0.12, freq: 2400 + i * 610 }); }],
  chest_chime: [0.9, (c, o) => [1175, 1480, 1760].forEach((f, i) => tone(c, o, { t: i * 0.09, dur: 0.5, gain: 0.12, freq: f }))],
  // Hoarder payout: a coin cascade — a bright ascending chime plus a scatter of metallic tinkles
  cash: [1.0, (c, o) => {
    [880, 1108, 1318, 1760, 2217].forEach((f, i) => tone(c, o, { t: i * 0.055, dur: 0.4, gain: 0.16, freq: f, type: 'triangle' }));
    for (let i = 0; i < 6; i++) noise(c, o, { t: i * 0.045 + Math.random() * 0.02, dur: 0.035, gain: 0.3, type: 'highpass', freq: 5000 + i * 700, seed: 190 + i });
  }],
  pop: [0.3, (c, o) => { noise(c, o, { dur: 0.08, gain: 1, type: 'bandpass', freq: 1200, q: 1, seed: 136 }); tone(c, o, { dur: 0.1, gain: 0.4, freq: 600, freqEnd: 200 }); }],
  throw: [0.3, (c, o) => noise(c, o, { dur: 0.22, gain: 0.6, type: 'bandpass', freq: 400, freqEnd: 1600, q: 1.2, attack: 0.04, seed: 137 })],
  pickup: [0.3, (c, o) => { tone(c, o, { dur: 0.08, gain: 0.25, freq: 900, freqEnd: 1300, type: 'triangle' }); tone(c, o, { t: 0.07, dur: 0.12, gain: 0.2, freq: 1760 }); }],
  sky_roar: [2.6, (c, o) => { tone(c, o, { dur: 2.3, gain: 0.7, freq: 52, freqEnd: 38, type: 'sawtooth', attack: 0.3 }); tone(c, o, { dur: 2.2, gain: 0.45, freq: 78, freqEnd: 60, type: 'sawtooth', attack: 0.35 }); noise(c, o, { dur: 2.3, gain: 0.8, type: 'bandpass', freq: 380, freqEnd: 160, q: 1.2, attack: 0.3, seed: 138 }); }],
  turret: [0.2, gun({ crack: 0.6, hp: 1800, body: 0.5, lp: 4000, bodyDur: 0.05, thump: 0.3, thumpF: 220, tail: 0.1, tailDur: 0.15, drive: 2, seed: 139 })],
  // Night Vision Goggles: a rising whine + click switching on, a bare click switching off
  nv_on: [0.4, (c, o) => { tone(c, o, { dur: 0.22, gain: 0.22, freq: 320, freqEnd: 1500, type: 'sine' }); noise(c, o, { t: 0.21, dur: 0.02, gain: 0.4, type: 'highpass', freq: 3500, seed: 150 }); tone(c, o, { t: 0.22, dur: 0.02, gain: 0.18, freq: 1800, type: 'square' }); }],
  nv_off: [0.08, (c, o) => { noise(c, o, { dur: 0.015, gain: 0.5, type: 'highpass', freq: 3000, seed: 151 }); tone(c, o, { dur: 0.02, gain: 0.2, freq: 750, type: 'square' }); }],
  // the Shade: a dissonant sting the first time you spot one, then a breathy tremolo whisper while it lingers
  shade_sting: [2.5, (c, o) => {
    tone(c, o, { dur: 2.3, gain: 0.35, freq: 55, freqEnd: 47, type: 'sawtooth', attack: 0.6 });
    tone(c, o, { t: 0.3, dur: 2.0, gain: 0.13, freq: 1108, attack: 0.8 });
    tone(c, o, { t: 0.3, dur: 2.0, gain: 0.12, freq: 1175, attack: 0.8 });
    tone(c, o, { t: 0.3, dur: 2.0, gain: 0.1, freq: 1245, attack: 0.8 });
    noise(c, o, { t: 0.5, dur: 1.8, gain: 0.3, type: 'bandpass', freq: 1600, freqEnd: 2600, q: 0.8, attack: 0.9, seed: 160 });
  }],
  shade_whisper: [1.2, (c, o) => { for (let i = 0; i < 6; i++) noise(c, o, { t: i * 0.18, dur: 0.16, gain: 0.24 - i * 0.02, type: 'bandpass', freq: 1800, freqEnd: 1200, q: 1.4, attack: 0.03, seed: 170 + i }); }],
  // Adrenaline Shot: a pressurized hiss + injector click
  inject: [0.5, (c, o) => {
    noise(c, o, { dur: 0.32, gain: 0.55, type: 'bandpass', freq: 3200, freqEnd: 5200, q: 0.9, attack: 0.02, seed: 180 });
    noise(c, o, { t: 0.02, dur: 0.02, gain: 0.7, type: 'highpass', freq: 4500, seed: 181 });
    tone(c, o, { t: 0.3, dur: 0.1, gain: 0.2, freq: 900, freqEnd: 600, type: 'triangle' });
  }],
  // the Ronin's katana: a whistling slash (and one that bites), the Fire Strike roar, the guard's ring, a block's clang,
  // a perfect parry's bell and the dash's rush of air
  kat_slash: [0.35, (c, o) => { noise(c, o, { dur: 0.2, gain: 0.7, type: 'bandpass', freq: 900, freqEnd: 5200, q: 1.8, attack: 0.03, seed: 190 }); tone(c, o, { t: 0.02, dur: 0.22, gain: 0.07, freq: 2600, freqEnd: 3400 }); }],
  kat_hit: [0.4, (c, o) => { noise(c, o, { dur: 0.16, gain: 0.7, type: 'bandpass', freq: 1200, freqEnd: 4200, q: 1.6, attack: 0.02, seed: 191 }); noise(c, o, { t: 0.05, dur: 0.1, gain: 0.8, freq: 900, seed: 192 }); tone(c, o, { t: 0.05, dur: 0.12, gain: 0.4, freq: 160, freqEnd: 70 }); }],
  kat_strike: [1.0, (c, o) => {
    noise(c, o, { dur: 0.7, gain: 0.9, type: 'bandpass', freq: 500, freqEnd: 2400, q: 0.9, attack: 0.04, seed: 193 });
    tone(c, o, { dur: 0.5, gain: 0.35, freq: 110, freqEnd: 60, type: 'sawtooth' });
    for (let i = 0; i < 6; i++) noise(c, o, { t: 0.1 + i * 0.08, dur: 0.05, gain: 0.3, type: 'bandpass', freq: 1500 + i * 400, q: 3, seed: 194 + i });
  }],
  kat_guard: [0.4, (c, o) => { noise(c, o, { dur: 0.12, gain: 0.5, type: 'bandpass', freq: 2500, freqEnd: 6000, q: 2, attack: 0.02, seed: 203 }); tone(c, o, { t: 0.08, dur: 0.3, gain: 0.12, freq: 3520 }); }],
  kat_block: [0.5, (c, o) => { noise(c, o, { dur: 0.04, gain: 1, type: 'highpass', freq: 2500, seed: 204 }); tone(c, o, { dur: 0.35, gain: 0.25, freq: 1760, freqEnd: 1680 }); tone(c, o, { dur: 0.3, gain: 0.18, freq: 2637 }); }],
  kat_parry: [0.9, (c, o) => { noise(c, o, { dur: 0.04, gain: 0.9, type: 'highpass', freq: 3000, seed: 200 }); for (const [f, g] of [[2093, 0.3], [3136, 0.22], [4186, 0.15]]) tone(c, o, { dur: 0.7, gain: g, freq: f }); }],
  kat_dash: [0.45, (c, o) => { noise(c, o, { dur: 0.3, gain: 0.8, type: 'bandpass', freq: 400, freqEnd: 3000, q: 1, attack: 0.02, seed: 201 }); noise(c, o, { t: 0.05, dur: 0.2, gain: 0.3, type: 'highpass', freq: 5000, seed: 202 }); }],
};
for (let i = 0; i < 4; i++) { // zombie groans: a detuned, wobbling moan through a throaty band-pass
  DEFS['z_groan' + i] = [1.4, (c, o) => {
    const f = 78 + i * 9, len = 0.8 + i * 0.12;
    tone(c, o, { dur: len, gain: 0.45, freq: f * 1.25, freqEnd: f, type: 'sawtooth', attack: 0.15 });
    tone(c, o, { dur: len, gain: 0.3, freq: f * 1.33, freqEnd: f * 1.05, type: 'sawtooth', attack: 0.2 });
    noise(c, o, { dur: len, gain: 0.6, type: 'bandpass', freq: 520 + i * 60, freqEnd: 280, q: 3, attack: 0.12, seed: 110 + i });
  }];
}
for (let i = 0; i < 4; i++) {
  DEFS['step' + i] = [0.15, (c, o) => {
    noise(c, o, { dur: 0.07, gain: 0.6, freq: 900 + i * 120, seed: 30 + i });
    tone(c, o, { dur: 0.06, gain: 0.5, freq: 95 + i * 6, freqEnd: 60 });
    noise(c, o, { t: 0.01, dur: 0.04, gain: 0.15, type: 'highpass', freq: 3500, seed: 40 + i });
  }];
}

// [stage sound, fraction of the reload time]
const RELOAD_SEQ = {
  pistol: [['rl_release', 0.04], ['rl_out', 0.12], ['rl_in', 0.52], ['rl_slide', 0.8]],
  smg: [['rl_release', 0.05], ['rl_out', 0.14], ['rl_in', 0.55], ['rl_rack', 0.72]],
  rifle: [['rl_release', 0.05], ['rl_out', 0.14], ['rl_in', 0.55], ['rl_rack', 0.74]],
  sniper: [['rl_release', 0.04], ['rl_out', 0.14], ['rl_in', 0.48], ['rl_bolt_back', 0.66], ['rl_bolt_fwd', 0.8]],
};

export class Sound {
  constructor() { this.ctx = null; this.buf = {}; this.vol = 0.7; }

  // Must be called from a user gesture (browsers block audio until then).
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.ready = this.build().then(() => this.loadOverrides());
  }

  async build() {
    await Promise.all(Object.entries(DEFS).map(async ([name, [dur, fn]]) => {
      const c = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
      fn(c, c.destination);
      this.buf[name] = await c.startRendering();
    }));
  }

  async loadOverrides() {
    try {
      const files = await (await fetch('/sounds/list')).json();
      for (const f of files) {
        const ab = await (await fetch('/sounds/' + encodeURIComponent(f))).arrayBuffer();
        this.buf[f.replace(/\.[^.]+$/, '')] = await this.ctx.decodeAudioData(ab);
      }
    } catch { /* overrides are optional */ }
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  setListener(pos, fwd) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = pos[0]; l.positionY.value = pos[1]; l.positionZ.value = pos[2];
      l.forwardX.value = fwd[0]; l.forwardY.value = fwd[1]; l.forwardZ.value = fwd[2];
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fwd[0], fwd[1], fwd[2], 0, 1, 0);
    }
  }

  // o: { pos:[x,y,z] (3D), vol, rate, ref (full-volume radius), roll (falloff), muffle (lowpass Hz), delay }
  play(name, o = {}) {
    const ctx = this.ctx, b = this.buf[name];
    if (!ctx || !b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    let node = src.connect(g);
    if (o.muffle) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.muffle;
      node = node.connect(f);
    }
    if (o.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? 4;
      p.rolloffFactor = o.roll ?? 1;
      p.maxDistance = 500;
      if (p.positionX) { p.positionX.value = o.pos[0]; p.positionY.value = o.pos[1]; p.positionZ.value = o.pos[2]; }
      else p.setPosition(o.pos[0], o.pos[1], o.pos[2]);
      node = node.connect(p);
    }
    node.connect(this.master);
    src.start(ctx.currentTime + (o.delay ?? 0));
    return src;
  }

  // Reload stages timed across the reload. Returns the sources so a cancel (weapon switch) can stop them.
  reloadSeq(w, o = {}) {
    if (w.shellReload || !w.reload) return [];
    const seq = RELOAD_SEQ[w.cat] || RELOAD_SEQ.rifle, rate = w.id === 'deagle' ? 0.85 : w.cat === 'pistol' ? 1.1 : 1;
    return seq.map(([name, at]) => this.play(name, { ...o, rate, delay: w.reload * at })).filter(Boolean);
  }

  // Bolt-action cycle after an AWP/SSG shot.
  boltCycle(o = {}) {
    this.play('rl_bolt_back', { ...o, delay: 0.3 });
    this.play('rl_bolt_fwd', { ...o, delay: 0.62 });
  }
}
