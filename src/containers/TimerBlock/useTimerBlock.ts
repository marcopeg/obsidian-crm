import { useCallback, useEffect, useMemo, useState } from "react";

type TimerPhase = "work" | "rest";
type HepticMode = "audio" | "vibration";

type TimerBlockProps = Record<string, string>;

type TimerBlockState = {
  canStart: boolean;
  currentLabel: string;
  displayTitle: string;
  durationSeconds: number;
  formattedRemaining: string;
  intervalSeconds: number;
  isResting: boolean;
  isRunning: boolean;
  remainingSeconds: number;
  start: () => void;
  stop: () => void;
};

const parseSeconds = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.floor(numeric));
};

const formatTime = (value: number): string => {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
};

type WindowWithAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const audioWindow = window as WindowWithAudioContext;

  return window.AudioContext ?? audioWindow.webkitAudioContext;
};

const triggerShortBeep = (mode: HepticMode) => {
  if (mode === "vibration") {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(180);
    }

    return;
  }

  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor) {
    return;
  }

  try {
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.18, context.currentTime);

    oscillator.connect(gain);
    gain.connect(context.destination);

    const duration = 0.18;

    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.stop(context.currentTime + duration);

    oscillator.addEventListener("ended", () => {
      context.close().catch(() => undefined);
    });
  } catch (error) {
    // Silently ignore audio errors
  }
};

const triggerLongBeep = (mode: HepticMode) => {
  if (mode === "vibration") {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([250, 100, 250]);
    }

    return;
  }

  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor) {
    return;
  }

  try {
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    gain.gain.setValueAtTime(0.2, context.currentTime);

    oscillator.connect(gain);
    gain.connect(context.destination);

    const duration = 0.5;

    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.stop(context.currentTime + duration);

    oscillator.addEventListener("ended", () => {
      context.close().catch(() => undefined);
    });
  } catch (error) {
    // Silently ignore audio errors
  }
};

const stopFeedback = (mode: HepticMode) => {
  if (mode === "vibration") {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(0);
    }
  }
};

export const useTimerBlock = (props: TimerBlockProps): TimerBlockState => {
  const durationSeconds = useMemo(() => parseSeconds(props.duration), [props.duration]);
  const intervalSeconds = useMemo(() => parseSeconds(props.interval), [props.interval]);
  const hepticMode: HepticMode = useMemo(() => {
    return props.heptic?.toLowerCase() === "vibration" ? "vibration" : "audio";
  }, [props.heptic]);
  const title = useMemo(() => props.title?.trim() || "work", [props.title]);

  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<TimerPhase>("work");
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);

  useEffect(() => {
    if (!isRunning) {
      setPhase("work");
      setRemainingSeconds(durationSeconds);
    }
  }, [durationSeconds, isRunning]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    if (remainingSeconds <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRemainingSeconds((value) => (value > 0 ? value - 1 : 0));
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isRunning, remainingSeconds]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    if (remainingSeconds === 0) {
      triggerLongBeep(hepticMode);

      setPhase((currentPhase) => {
        if (currentPhase === "work" && intervalSeconds > 0) {
          setRemainingSeconds(intervalSeconds);

          return "rest";
        }

        setRemainingSeconds(durationSeconds);

        return "work";
      });
    } else if (remainingSeconds <= 3) {
      triggerShortBeep(hepticMode);
    }
  }, [durationSeconds, hepticMode, intervalSeconds, isRunning, remainingSeconds]);

  const start = useCallback(() => {
    if (durationSeconds <= 0) {
      return;
    }

    stopFeedback(hepticMode);
    setPhase("work");
    setRemainingSeconds(durationSeconds);
    setIsRunning(true);
  }, [durationSeconds, hepticMode]);

  const stop = useCallback(() => {
    setIsRunning(false);
    setPhase("work");
    setRemainingSeconds(durationSeconds);
    stopFeedback(hepticMode);
  }, [durationSeconds, hepticMode]);

  const formattedRemaining = useMemo(
    () => formatTime(isRunning ? remainingSeconds : durationSeconds),
    [durationSeconds, isRunning, remainingSeconds]
  );

  const currentLabel = useMemo(() => {
    if (isRunning && phase === "rest") {
      return "rest";
    }

    return title;
  }, [isRunning, phase, title]);

  return {
    canStart: durationSeconds > 0,
    currentLabel,
    displayTitle: title,
    durationSeconds,
    formattedRemaining,
    intervalSeconds,
    isResting: phase === "rest",
    isRunning,
    remainingSeconds: isRunning ? remainingSeconds : durationSeconds,
    start,
    stop,
  };
};
