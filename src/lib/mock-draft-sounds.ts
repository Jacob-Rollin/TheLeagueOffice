/**
 * Solo mock-draft UI sounds (Web Audio). Recipes match the user-picked
 * options from the Draft Sound Picker (no external audio files).
 */

export type MockDraftSoundEvent =
  | "pick-locked"
  | "your-turn"
  | "turn-warning"
  | "clock-expired"
  | "draft-complete"
  | "queue-add"
  | "queue-remove"
  | "claim-slot";

const SR = 44100;
const MUTE_KEY = "mock-draft-sounds-muted";

let sharedCtx: AudioContext | null = null;
let resumeHookInstalled = false;

/** Persisted mute preference (localStorage). Default: sounds on. */
export function isMockDraftSoundsMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMockDraftSoundsMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

function audioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

function getCtx(): AudioContext | null {
  const AC = audioContextCtor();
  if (!AC) return null;
  if (sharedCtx && sharedCtx.state === "closed") {
    sharedCtx = null;
  }
  if (!sharedCtx) {
    try {
      sharedCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

function recreateCtx(): AudioContext | null {
  const AC = audioContextCtor();
  if (!AC) return null;
  if (sharedCtx) {
    try {
      void sharedCtx.close();
    } catch {
      /* ignore */
    }
    sharedCtx = null;
  }
  try {
    sharedCtx = new AC();
    return sharedCtx;
  } catch {
    return null;
  }
}

async function ensureRunning(ctx: AudioContext): Promise<AudioContext | null> {
  if (ctx.state === "closed") return recreateCtx();
  if (ctx.state === "running") return ctx;
  try {
    await ctx.resume();
  } catch {
    /* fall through — may still be suspended without a gesture */
  }
  if (ctx.state === "running") return ctx;
  // Closed or stuck suspended after a long background — rebuild once.
  if (ctx.state === "closed") return recreateCtx();
  return ctx;
}

/**
 * Call from a user gesture (or when the tab becomes visible again) so later
 * AI / clock sounds can play. Mobile browsers suspend AudioContext in the
 * background; resume() often only sticks when tied to a gesture.
 */
export function unlockMockDraftAudio() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "running") return;
  void ensureRunning(ctx).then((ready) => {
    if (!ready || ready.state !== "running") return;
    // Tiny silent blip keeps some WebKit contexts alive after resume.
    try {
      const buffer = ready.createBuffer(1, 1, ready.sampleRate || SR);
      const src = ready.createBufferSource();
      src.buffer = buffer;
      src.connect(ready.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Resume on tab focus and the next pointer/key gesture. Safe to call once from
 * the mock-draft arena mount.
 */
export function installMockDraftAudioResume() {
  if (typeof window === "undefined" || resumeHookInstalled) return () => undefined;
  resumeHookInstalled = true;

  const onVisible = () => {
    if (document.visibilityState === "visible") unlockMockDraftAudio();
  };
  const onGesture = () => unlockMockDraftAudio();

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  window.addEventListener("focus", onVisible);
  // Capture so sheet / menu / board taps all re-arm audio after backgrounding.
  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);

  if (document.visibilityState === "visible") unlockMockDraftAudio();

  return () => {
    resumeHookInstalled = false;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
    window.removeEventListener("focus", onVisible);
    document.removeEventListener("pointerdown", onGesture, true);
    document.removeEventListener("keydown", onGesture, true);
  };
}

function clamp(x: number, lo = -1, hi = 1) {
  return Math.min(hi, Math.max(lo, x));
}

function envADSR(t: number, a: number, d: number, s: number, r: number, dur: number) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
  if (t < dur - r) return s;
  if (t < dur) return s * (1 - (t - (dur - r)) / r);
  return 0;
}

function noise() {
  return Math.random() * 2 - 1;
}

function lowpass(samples: number[], cutoff = 0.2) {
  let y = 0;
  const a = cutoff;
  return samples.map((x) => {
    y += a * (x - y);
    return y;
  });
}

function highpass(samples: number[], cutoff = 0.05) {
  let prevX = 0;
  let prevY = 0;
  const a = cutoff;
  return samples.map((x) => {
    const y = a * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    return y;
  });
}

function mix(...parts: Array<Float32Array | number[]>) {
  const len = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(len);
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[i]! += p[i]!;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const g = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < len; i++) out[i]! *= g;
  return out;
}

function tone(opts: {
  freq: number;
  dur: number;
  type?: "sine" | "square" | "triangle" | "saw";
  gain?: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  slideTo?: number;
}) {
  const {
    freq,
    dur,
    type = "sine",
    gain = 0.35,
    a = 0.005,
    d = 0.04,
    s = 0.2,
    r = 0.06,
    slideTo,
  } = opts;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = slideTo ? freq + (slideTo - freq) * (t / dur) : freq;
    phase += (2 * Math.PI * f) / SR;
    let x: number;
    if (type === "square") x = Math.sin(phase) > 0 ? 1 : -1;
    else if (type === "triangle") {
      const p = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
      x = 4 * Math.abs(p - 0.5) - 1;
    } else if (type === "saw") {
      const p = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
      x = 2 * p - 1;
    } else x = Math.sin(phase);
    out[i] = x * gain * envADSR(t, a, d, s, r, dur);
  }
  return out;
}

function noiseBurst(opts: {
  dur: number;
  gain?: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  lp?: number;
}) {
  const { dur, gain = 0.25, a = 0.001, d = 0.03, s = 0.05, r = 0.04, lp = 0.35 } = opts;
  const n = Math.floor(SR * dur);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    raw[i] = noise() * gain * envADSR(t, a, d, s, r, dur);
  }
  return Float32Array.from(lowpass(Array.from(raw), lp));
}

function concat(parts: Array<Float32Array | number[]>, gapMs = 0) {
  const gap = Math.floor((gapMs / 1000) * SR);
  let total = gap * Math.max(0, parts.length - 1);
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, o);
    o += parts[i]!.length + (i < parts.length - 1 ? gap : 0);
  }
  return out;
}

function padEnd(samples: Float32Array | number[], extraMs = 80) {
  const extra = Math.floor((extraMs / 1000) * SR);
  const out = new Float32Array(samples.length + extra);
  out.set(samples, 0);
  return out;
}

/** User-selected recipes from the Draft Sound Picker. */
function samplesFor(event: MockDraftSoundEvent): Float32Array {
  switch (event) {
    case "pick-locked":
      // source-a — mechanical confirm tick
      return padEnd(
        mix(
          Float32Array.from(
            highpass(
              Array.from(
                noiseBurst({
                  dur: 0.025,
                  gain: 0.45,
                  a: 0.0005,
                  d: 0.01,
                  s: 0.02,
                  r: 0.015,
                  lp: 0.7,
                }),
              ),
              0.15,
            ),
          ),
          tone({
            freq: 1800,
            dur: 0.03,
            type: "triangle",
            gain: 0.15,
            a: 0.001,
            d: 0.01,
            s: 0.05,
            r: 0.015,
          }),
        ),
      );
    case "your-turn":
      // computer-a — two-note up chime
      return padEnd(
        concat(
          [
            tone({
              freq: 523.25,
              dur: 0.1,
              type: "sine",
              gain: 0.32,
              a: 0.005,
              d: 0.04,
              s: 0.25,
              r: 0.05,
            }),
            tone({
              freq: 659.25,
              dur: 0.14,
              type: "sine",
              gain: 0.32,
              a: 0.005,
              d: 0.05,
              s: 0.2,
              r: 0.07,
            }),
          ],
          40,
        ),
      );
    case "turn-warning":
      // computer-a — double beep
      return padEnd(
        concat(
          [
            tone({
              freq: 740,
              dur: 0.07,
              type: "sine",
              gain: 0.28,
              a: 0.003,
              d: 0.03,
              s: 0.15,
              r: 0.03,
            }),
            tone({
              freq: 740,
              dur: 0.07,
              type: "sine",
              gain: 0.28,
              a: 0.003,
              d: 0.03,
              s: 0.15,
              r: 0.03,
            }),
          ],
          90,
        ),
      );
    case "clock-expired":
      // source-a — muted fall + soft noise
      return padEnd(
        mix(
          tone({
            freq: 400,
            dur: 0.2,
            type: "triangle",
            gain: 0.22,
            a: 0.01,
            d: 0.08,
            s: 0.15,
            r: 0.09,
            slideTo: 200,
          }),
          Float32Array.from(lowpass(Array.from(noiseBurst({ dur: 0.15, gain: 0.2, lp: 0.15 })), 0.1)),
        ),
      );
    case "draft-complete":
      // computer-a — three-note fanfare
      return padEnd(
        concat(
          [
            tone({
              freq: 523.25,
              dur: 0.1,
              type: "sine",
              gain: 0.28,
              a: 0.008,
              d: 0.04,
              s: 0.25,
              r: 0.04,
            }),
            tone({
              freq: 659.25,
              dur: 0.1,
              type: "sine",
              gain: 0.28,
              a: 0.008,
              d: 0.04,
              s: 0.25,
              r: 0.04,
            }),
            tone({
              freq: 783.99,
              dur: 0.22,
              type: "sine",
              gain: 0.3,
              a: 0.01,
              d: 0.08,
              s: 0.3,
              r: 0.12,
            }),
          ],
          35,
        ),
      );
    case "queue-add":
      // computer-a — quick upward blip
      return padEnd(
        tone({
          freq: 980,
          dur: 0.06,
          type: "sine",
          gain: 0.28,
          a: 0.002,
          d: 0.025,
          s: 0.1,
          r: 0.03,
          slideTo: 1200,
        }),
      );
    case "queue-remove":
      // computer-a — downward blip
      return padEnd(
        tone({
          freq: 720,
          dur: 0.07,
          type: "sine",
          gain: 0.26,
          a: 0.002,
          d: 0.03,
          s: 0.1,
          r: 0.035,
          slideTo: 420,
        }),
      );
    case "claim-slot":
      // computer-a — two-step confirm
      return padEnd(
        concat(
          [
            tone({
              freq: 880,
              dur: 0.05,
              type: "sine",
              gain: 0.26,
              a: 0.002,
              d: 0.02,
              s: 0.1,
              r: 0.025,
            }),
            tone({
              freq: 1175,
              dur: 0.07,
              type: "triangle",
              gain: 0.24,
              a: 0.002,
              d: 0.03,
              s: 0.1,
              r: 0.03,
            }),
          ],
          25,
        ),
      );
  }
}

function startSound(ctx: AudioContext, event: MockDraftSoundEvent) {
  const samples = samplesFor(event);
  const buffer = ctx.createBuffer(1, samples.length, SR);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = clamp(samples[i]!);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

export function playMockDraftSound(event: MockDraftSoundEvent) {
  if (typeof window === "undefined") return;
  if (isMockDraftSoundsMuted()) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  const ctx = getCtx();
  if (!ctx) return;

  void (async () => {
    let ready = await ensureRunning(ctx);
    if (!ready) return;
    try {
      startSound(ready, event);
    } catch {
      // Context may have been closed under us — rebuild and retry once.
      ready = recreateCtx();
      if (!ready) return;
      ready = (await ensureRunning(ready)) ?? ready;
      if (ready.state !== "running" && ready.state !== "suspended") return;
      try {
        if (ready.state === "suspended") await ready.resume();
        startSound(ready, event);
      } catch {
        /* ignore autoplay / decode failures */
      }
    }
  })();
}
