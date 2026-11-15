// All sound is synthesised with WebAudio: no audio files, nothing fetched. A shot is a filtered
// noise burst with a body thump, a hit is a short tick, the charge beeps, and the explosion is a
// noise swell over a falling sine. The context is created lazily on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer() {
    const len = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  let sharedNoise = null;

  function burst({ dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', sweepTo = 300 }) {
    if (!ensure()) return;
    if (!sharedNoise) sharedNoise = noiseBuffer();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = sharedNoise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone({ freq = 440, dur = 0.09, gain = 0.2, type = 'square', slideTo = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'sniper') { burst({ dur: 0.32, freq: 2600, gain: 0.8, sweepTo: 120 }); tone({ freq: 120, dur: 0.2, gain: 0.4, type: 'sine', slideTo: 45 }); }
      else if (kind === 'shotgun') { burst({ dur: 0.24, freq: 1500, gain: 0.75, sweepTo: 150 }); }
      else if (kind === 'smg') { burst({ dur: 0.08, freq: 2100, gain: 0.4, sweepTo: 500 }); }
      else if (kind === 'pistol') { burst({ dur: 0.1, freq: 1900, gain: 0.45, sweepTo: 350 }); }
      else { burst({ dur: 0.13, freq: 2000, gain: 0.55, sweepTo: 280 }); }
    },
    botShot() { burst({ dur: 0.1, freq: 1200, gain: 0.16, sweepTo: 300 }); },
    dry() { tone({ freq: 1400, dur: 0.04, gain: 0.12 }); },
    reload() { tone({ freq: 500, dur: 0.05, gain: 0.15 }); setTimeout(() => tone({ freq: 760, dur: 0.05, gain: 0.15 }), 160); },
    hit(kill) { tone({ freq: kill ? 1560 : 1180, dur: kill ? 0.14 : 0.07, gain: 0.22, type: 'triangle' }); },
    hurt() { burst({ dur: 0.09, freq: 500, gain: 0.3, sweepTo: 120 }); },
    buy() { tone({ freq: 880, dur: 0.06, gain: 0.15, type: 'triangle' }); tone({ freq: 1320, dur: 0.08, gain: 0.12, type: 'triangle' }); },
    denied() { tone({ freq: 220, dur: 0.12, gain: 0.15, type: 'sawtooth' }); },
    beep(final = false) { tone({ freq: final ? 1760 : 1174, dur: final ? 0.3 : 0.07, gain: 0.2, type: 'sine' }); },
    explosion() {
      burst({ dur: 0.9, freq: 900, gain: 0.9, sweepTo: 40 });
      tone({ freq: 90, dur: 0.8, gain: 0.6, type: 'sine', slideTo: 30 });
    },
    throwPin() { tone({ freq: 2000, dur: 0.03, gain: 0.08 }); },
    roundEnd(won) {
      const notes = won ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.16, type: 'triangle' }), i * 110));
    },
  };
}
