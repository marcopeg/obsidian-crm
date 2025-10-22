import type { HepticMode } from "./useGameApples";

const shouldVibrate = (mode: HepticMode) =>
  mode === "vibration" || mode === "both";

const shouldPlayAudio = (mode: HepticMode) =>
  mode === "audio" || mode === "both";

type WindowWithAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedContext: AudioContext | null = null;

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  const w = window as WindowWithAudioContext;
  return window.AudioContext ?? w.webkitAudioContext;
};

const getSharedAudioContext = (): AudioContext | null => {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) {
    return null;
  }

  if (sharedContext && sharedContext.state === "closed") {
    sharedContext = null;
  }

  if (!sharedContext) {
    try {
      sharedContext = new Ctor();
    } catch (error) {
      console.error("GameApples: unable to create audio context", error);
      sharedContext = null;
      return null;
    }
  }

  return sharedContext;
};

const withAudioContext = (
  mode: HepticMode,
  run: (ctx: AudioContext) => void
) => {
  if (!shouldPlayAudio(mode)) {
    return;
  }
  const ctx = getSharedAudioContext();
  if (!ctx) {
    return;
  }
  const schedule = () => {
    try {
      run(ctx);
    } catch (error) {
      console.error("GameApples: failed to play sound", error);
    }
  };
  if (typeof ctx.resume === "function" && ctx.state === "suspended") {
    ctx
      .resume()
      .then(schedule)
      .catch((error) => {
        console.error("GameApples: unable to resume audio context", error);
        schedule();
      });
  } else {
    schedule();
  }
};

const triggerVibration = (pattern: number | number[], mode: HepticMode) => {
  if (!shouldVibrate(mode)) {
    return;
  }
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  navigator.vibrate(pattern);
};

export const playGrabFeedback = (mode: HepticMode) => {
  triggerVibration(40, mode);
  withAudioContext(mode, (ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.2, now);
    osc.connect(gain);
    gain.connect(ctx.destination);
    const end = now + 0.12;
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(end);
  });
};

export const playSuccessFeedback = (mode: HepticMode) => {
  triggerVibration([120, 40, 120], mode);
  withAudioContext(mode, (ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.25);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.45);
  });
};

export const playSplashFeedback = (mode: HepticMode) => {
  triggerVibration(90, mode);
  withAudioContext(mode, (ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.3);
  });
};
