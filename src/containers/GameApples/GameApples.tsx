import { InlineError } from "@/components/InlineError";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  playGrabFeedback,
  playSplashFeedback,
  playSuccessFeedback,
} from "./feedback";
import type { GameApplesProps, ScoreEntry } from "./useGameApples";
import { useGameApples } from "./useGameApples";

type GameState = "idle" | "running" | "ended";

type Apple = {
  id: string;
  x: number; // percent
  y: number; // percent
  size: number; // percent of container width/height
  velocity: number; // percent per second
};

type GameEffect = {
  id: string;
  type: "success" | "miss";
  x: number;
  y: number;
};

const MAX_APPLES = 1;
const MIN_APPLE_SIZE = 14;
const MAX_APPLE_SIZE = 18;
const MIN_VELOCITY = 18;
const MAX_VELOCITY = 28;
const START_Y = -12;
const GROUND_Y = 95;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
};

const formatFriendlyDate = (entry: ScoreEntry) => {
  const source = entry.recordedAt || `${entry.date}T00:00:00Z`;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return entry.date;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const isInsideBasket = (
  percentX: number,
  percentY: number,
  containerRect: DOMRect,
  basketRect: DOMRect
) => {
  const left = ((basketRect.left - containerRect.left) / containerRect.width) * 100;
  const right =
    ((basketRect.right - containerRect.left) / containerRect.width) * 100;
  const top = ((basketRect.top - containerRect.top) / containerRect.height) * 100;
  const bottom =
    ((basketRect.bottom - containerRect.top) / containerRect.height) * 100;

  return (
    percentX >= left && percentX <= right && percentY >= top && percentY <= bottom
  );
};

const getPercentFromPointer = (event: PointerEvent, rect: DOMRect) => {
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return {
    x: clamp(x, 4, 96),
    y: clamp(y, 4, 96),
  };
};

export const GameApples = (props: GameApplesProps) => {
  const {
    durationSeconds,
    hepticMode,
    scores,
    feedbackEnabled,
    toggleFeedback,
    persistScore,
    error,
    ready,
  } = useGameApples(props);

  const [isOpen, setIsOpen] = useState(false);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [recentScore, setRecentScore] = useState<ScoreEntry | null>(null);
  const [apples, setApples] = useState<Apple[]>([]);
  const [effects, setEffects] = useState<GameEffect[]>([]);

  const animationFrameRef = useRef<number | null>(null);
  const timerTimeoutRef = useRef<number | null>(null);
  const spawnTimeoutRef = useRef<number | null>(null);
  const draggingRef = useRef<{ id: string; pointerId: number } | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const endTimeRef = useRef<number>(0);
  const appleIdRef = useRef(0);
  const effectIdRef = useRef(0);
  const effectTimeoutsRef = useRef<Record<string, number>>({});
  const resultRecordedRef = useRef(false);
  const gameStateRef = useRef<GameState>("idle");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const basketRef = useRef<HTMLDivElement | null>(null);

  const effectiveMode = useMemo(
    () => (feedbackEnabled ? hepticMode : "none"),
    [feedbackEnabled, hepticMode]
  );

  const bestScore = scores.length > 0 ? scores[0].score : 0;

  const leaderboardPreview = useMemo(
    () => scores.slice(0, 10),
    [scores]
  );

  const clearTimer = useCallback(() => {
    if (timerTimeoutRef.current !== null) {
      window.clearTimeout(timerTimeoutRef.current);
      timerTimeoutRef.current = null;
    }
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const clearSpawnTimeout = useCallback(() => {
    if (spawnTimeoutRef.current !== null) {
      window.clearTimeout(spawnTimeoutRef.current);
      spawnTimeoutRef.current = null;
    }
  }, []);

  const createApple = useCallback((): Apple => {
    appleIdRef.current += 1;
    const size =
      MIN_APPLE_SIZE + Math.random() * (MAX_APPLE_SIZE - MIN_APPLE_SIZE);
    const velocity =
      MIN_VELOCITY + Math.random() * (MAX_VELOCITY - MIN_VELOCITY);
    const maxX = Math.max(0, 100 - size);
    const x = Math.random() * maxX;
    return {
      id: `apple-${appleIdRef.current}`,
      x,
      y: START_Y,
      size,
      velocity,
    };
  }, []);

  const scheduleNextSpawn = useCallback(
    (options?: { immediate?: boolean; delay?: number }) => {
      if (spawnTimeoutRef.current !== null) {
        window.clearTimeout(spawnTimeoutRef.current);
        spawnTimeoutRef.current = null;
      }

      if (gameStateRef.current !== "running") {
        return;
      }

      const performSpawn = () => {
        spawnTimeoutRef.current = null;
        if (gameStateRef.current !== "running") {
          return;
        }
        setApples((prev) => {
          if (prev.length >= MAX_APPLES) {
            scheduleNextSpawn();
            return prev;
          }
          const nextApple = createApple();
          scheduleNextSpawn();
          return [...prev, nextApple];
        });
      };

      if (options?.immediate) {
        performSpawn();
        return;
      }

      const delay =
        options?.delay ?? 620 + Math.random() * 1400;
      spawnTimeoutRef.current = window.setTimeout(performSpawn, delay);
    },
    [createApple]
  );

  const getAppleCenter = useCallback(
    (apple: Apple) => ({
      x: apple.x + apple.size / 2,
      y: apple.y + apple.size / 2,
    }),
    []
  );

  const triggerEffect = useCallback(
    (type: "success" | "miss", center?: { x: number; y: number }) => {
      if (!center) {
        return;
      }
      effectIdRef.current += 1;
      const id = `effect-${effectIdRef.current}`;
      setEffects((prev) => [...prev, { id, type, x: center.x, y: center.y }]);
      const timeout = window.setTimeout(() => {
        setEffects((prev) => prev.filter((effect) => effect.id !== id));
        delete effectTimeoutsRef.current[id];
      }, type === "success" ? 800 : 600);
      effectTimeoutsRef.current[id] = timeout;
    },
    []
  );

  const handleAppleOutcome = useCallback(
    (outcome: "success" | "miss", center?: { x: number; y: number }) => {
      if (outcome === "success") {
        setScore((current) => current + 1);
        playSuccessFeedback(effectiveMode);
        triggerEffect("success", center);
      } else {
        setMisses((current) => current + 1);
        playSplashFeedback(effectiveMode);
        triggerEffect("miss", center);
      }
      scheduleNextSpawn({ delay: outcome === "success" ? 650 : 420 });
    },
    [effectiveMode, scheduleNextSpawn, triggerEffect]
  );

  const tickTimer = useCallback(() => {
    if (gameStateRef.current !== "running") {
      return;
    }
    const remainingMs = endTimeRef.current - Date.now();
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    setTimeLeft(remainingSeconds);
    if (remainingSeconds <= 0) {
      gameStateRef.current = "ended";
      setGameState("ended");
      return;
    }
    timerTimeoutRef.current = window.setTimeout(tickTimer, 250);
  }, []);

  const startRound = useCallback(() => {
    resultRecordedRef.current = false;
    appleIdRef.current = 0;
    lastTickRef.current = null;
    setScore(0);
    setMisses(0);
    setRecentScore(null);
    setApples(() => []);
    setEffects(() => []);
    draggingRef.current = null;
    endTimeRef.current = Date.now() + durationSeconds * 1000;
    setTimeLeft(durationSeconds);
    clearTimer();
    cancelAnimation();
    clearSpawnTimeout();
    Object.values(effectTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    effectTimeoutsRef.current = {};
    gameStateRef.current = "running";
    setGameState("running");
    scheduleNextSpawn({ immediate: true });
  }, [
    cancelAnimation,
    clearSpawnTimeout,
    clearTimer,
    durationSeconds,
    scheduleNextSpawn,
  ]);

  const closeOverlay = useCallback(
    (options?: { skipFullscreenExit?: boolean }) => {
      if (!options?.skipFullscreenExit) {
        const element = containerRef.current;
        if (element && document.fullscreenElement === element) {
          void document.exitFullscreen().catch(() => undefined);
        }
      }

      setIsOpen(false);
      gameStateRef.current = "idle";
      setGameState("idle");
      clearTimer();
      cancelAnimation();
      clearSpawnTimeout();
      setApples([]);
      setEffects([]);
      draggingRef.current = null;
      Object.values(effectTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      effectTimeoutsRef.current = {};
    },
    [cancelAnimation, clearSpawnTimeout, clearTimer]
  );

  const handlePlayClick = useCallback(() => {
    setIsOpen(true);
    startRound();
  }, [startRound]);

  const handleReplay = useCallback(() => {
    startRound();
  }, [startRound]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (gameState !== "running") {
      clearSpawnTimeout();
    }
  }, [clearSpawnTimeout, gameState]);

  useEffect(() => {
    if (!isOpen) {
      return () => undefined;
    }

    const element = containerRef.current;
    if (!element || typeof element.requestFullscreen !== "function") {
      return () => undefined;
    }

    if (document.fullscreenElement !== element) {
      const result = element.requestFullscreen();
      if (result instanceof Promise) {
        void result.catch(() => undefined);
      }
    }

    return () => undefined;
  }, [isOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const element = containerRef.current;
      if (!element) {
        return;
      }

      if (document.fullscreenElement === element) {
        return;
      }

      if (isOpen) {
        closeOverlay({ skipFullscreenExit: true });
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [closeOverlay, isOpen]);

  useEffect(() => {
    if (gameState === "running") {
      tickTimer();
      return () => {
        clearTimer();
      };
    }
    clearTimer();
    return () => undefined;
  }, [gameState, tickTimer, clearTimer]);

  useEffect(() => {
    if (gameState !== "running") {
      cancelAnimation();
      lastTickRef.current = null;
      return () => undefined;
    }

    const step = (timestamp: number) => {
      const previous = lastTickRef.current ?? timestamp;
      const delta = clamp((timestamp - previous) / 1000, 0, 0.08);
      lastTickRef.current = timestamp;
      const fallen: { apple: Apple; center: { x: number; y: number } }[] = [];
      setApples((prev) => {
        const next: Apple[] = [];
        prev.forEach((apple) => {
          if (draggingRef.current?.id === apple.id) {
            next.push(apple);
            return;
          }
          const nextY = apple.y + apple.velocity * delta;
          if (nextY >= GROUND_Y) {
            const grounded = { ...apple, y: GROUND_Y };
            fallen.push({
              apple: grounded,
              center: getAppleCenter(grounded),
            });
          } else {
            next.push({ ...apple, y: nextY });
          }
        });
        return next;
      });

      if (fallen.length > 0) {
        fallen.forEach((item) => {
          handleAppleOutcome("miss", item.center);
        });
      }

      animationFrameRef.current = window.requestAnimationFrame(step);
    };

    animationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      cancelAnimation();
      lastTickRef.current = null;
    };
  }, [cancelAnimation, gameState, handleAppleOutcome]);

  useEffect(() => {
    if (gameState !== "running") {
      return () => undefined;
    }

    const container = containerRef.current;
    if (!container) {
      return () => undefined;
    }

    const basket = basketRef.current;

    const handleMove = (event: PointerEvent) => {
      const active = draggingRef.current;
      if (!active || event.pointerId !== active.pointerId) {
        return;
      }
      if (gameStateRef.current !== "running") {
        return;
      }
      const rect = container.getBoundingClientRect();
      const { x, y } = getPercentFromPointer(event, rect);
      event.preventDefault();

      if (basket) {
        const basketRect = basket.getBoundingClientRect();
        let capturedCenter: { x: number; y: number } | null = null;
        setApples((prev) => {
          const next: Apple[] = [];
          prev.forEach((apple) => {
            if (apple.id === active.id) {
              const updated = { ...apple, x, y };
              const center = getAppleCenter(updated);
              if (isInsideBasket(center.x, center.y, rect, basketRect)) {
                capturedCenter = center;
                return;
              }
              next.push(updated);
            } else {
              next.push(apple);
            }
          });
          return next;
        });

        if (capturedCenter) {
          draggingRef.current = null;
          handleAppleOutcome("success", capturedCenter);
        }
        return;
      }

      setApples((prev) =>
        prev.map((apple) =>
          apple.id === active.id ? { ...apple, x, y } : apple
        )
      );
    };

    const handleEnd = (event: PointerEvent) => {
      const active = draggingRef.current;
      if (!active || event.pointerId !== active.pointerId) {
        return;
      }
      draggingRef.current = null;
      if (gameStateRef.current !== "running") {
        return;
      }
      const rect = container.getBoundingClientRect();
      const { x, y } = getPercentFromPointer(event, rect);
      event.preventDefault();
      let dropped = false;
      let success = false;
      let landingCenter: { x: number; y: number } | null = null;
      const basketRect = basket?.getBoundingClientRect();
      setApples((prev) => {
        const next: Apple[] = [];
        prev.forEach((apple) => {
          if (apple.id === active.id) {
            dropped = true;
            const updated = { ...apple, x, y };
            landingCenter = getAppleCenter(updated);
            if (basketRect) {
              success = isInsideBasket(
                landingCenter.x,
                landingCenter.y,
                rect,
                basketRect
              );
            }
          } else {
            next.push(apple);
          }
        });
        return next;
      });
      if (!dropped) {
        return;
      }
      handleAppleOutcome(success ? "success" : "miss", landingCenter ?? undefined);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [gameState, getAppleCenter, handleAppleOutcome]);

  useEffect(() => {
    if (gameState !== "ended" || resultRecordedRef.current) {
      return;
    }
    resultRecordedRef.current = true;
    const now = new Date();
    const entry: ScoreEntry = {
      score,
      date: now.toISOString().slice(0, 10),
      recordedAt: now.toISOString(),
    };
    setRecentScore(entry);
    void persistScore(score);
  }, [gameState, persistScore, score]);

  useEffect(() => {
    if (gameState === "idle") {
      setTimeLeft(durationSeconds);
    }
  }, [durationSeconds, gameState]);

  useEffect(() => {
    return () => {
      Object.values(effectTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      effectTimeoutsRef.current = {};
    };
  }, []);

  if (!ready) {
    return <InlineError message="Open a note to play the apple game." />;
  }

  if (error) {
    return <InlineError message={error} />;
  }

  return (
    <div className="crm-game-apples-block">
      <div className="crm-game-apples-header">
        <div className="crm-game-apples-title">Apple Basket Adventure</div>
        <div className="crm-game-apples-subtitle">
          Catch the juicy apples before they bonk the ground!
        </div>
      </div>
      <button
        type="button"
        className="crm-game-apples-play"
        onClick={handlePlayClick}
      >
        <span className="crm-game-apples-play-icon" aria-hidden="true">
          ▶
        </span>
        <span className="crm-game-apples-play-label">Play now</span>
        <span className="crm-game-apples-play-meta">
          Best score: {bestScore}
        </span>
      {leaderboardPreview.length > 0 && (
        <ul className="crm-game-apples-leaderboard" aria-label="Best results">
          {leaderboardPreview.map((entry) => (
            <li key={entry.recordedAt} className="crm-game-apples-leaderboard-item">
              <span className="crm-game-apples-leaderboard-score">
                  {entry.score}
                </span>
                <span className="crm-game-apples-leaderboard-date">
                  {formatFriendlyDate(entry)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </button>

      {isOpen && (
        <div className="crm-game-apples-overlay" role="dialog" aria-modal="true">
          <div className="crm-game-apples-overlay-content" ref={containerRef}>
            <button
              type="button"
              className="crm-game-apples-close"
              onClick={() => closeOverlay()}
              aria-label="Close game"
            >
              ×
            </button>
            <div className="crm-game-apples-topbar">
              <div className="crm-game-apples-topbar-stat">
                <span className="crm-game-apples-topbar-label">Score</span>
                <span className="crm-game-apples-topbar-value">{score}</span>
              </div>
              <div className="crm-game-apples-topbar-timer">
                {formatClock(timeLeft)}
              </div>
              <div className="crm-game-apples-topbar-stat">
                <span className="crm-game-apples-topbar-label">Missed</span>
                <span className="crm-game-apples-topbar-value">{misses}</span>
              </div>
            </div>
            <div className="crm-game-apples-scene">
              <div className="crm-game-apples-sky" />
              <div className="crm-game-apples-sun" />
              <div className="crm-game-apples-tree">
                <div className="crm-game-apples-tree-trunk" />
                <div className="crm-game-apples-tree-crown" />
                <div className="crm-game-apples-tree-bird" aria-hidden="true">
                  🐦
                </div>
              </div>
              <div className="crm-game-apples-grass" />
              <div className="crm-game-apples-basket" ref={basketRef}>
                <div className="crm-game-apples-basket-rim" />
                <div className="crm-game-apples-basket-body" />
              </div>
              {apples.map((apple) => (
                <div
                  key={apple.id}
                  className="crm-game-apples-apple"
                  style={{
                    width: `${apple.size}%`,
                    height: `${apple.size}%`,
                    left: `${apple.x}%`,
                    top: `${apple.y}%`,
                  }}
                  onPointerDown={(event) => {
                    if (gameStateRef.current !== "running") {
                      return;
                    }
                    draggingRef.current = {
                      id: apple.id,
                      pointerId: event.pointerId,
                    };
                    if (event.currentTarget instanceof HTMLElement) {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }
                    playGrabFeedback(effectiveMode);
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      const { x, y } = getPercentFromPointer(event.nativeEvent, rect);
                      setApples((prev) =>
                        prev.map((item) =>
                          item.id === apple.id ? { ...item, x, y } : item
                        )
                      );
                    }
                  }}
                  role="button"
                  aria-label="Drag apple"
                >
                  <div className="crm-game-apples-apple-shine" />
                  <div className="crm-game-apples-apple-leaf" />
                  <div className="crm-game-apples-apple-stem" />
                </div>
              ))}
              {effects.map((effect) => (
                <div
                  key={effect.id}
                  className={`crm-game-apples-effect crm-game-apples-effect--${effect.type}`}
                  style={{
                    left: `${effect.x}%`,
                    top: `${effect.y}%`,
                  }}
                  aria-hidden="true"
                >
                  {effect.type === "success" ? "Yay!" : "Splash!"}
                </div>
              ))}
            </div>
            <button
              type="button"
              className={`crm-game-apples-sound ${
                feedbackEnabled ? "" : "crm-game-apples-sound--off"
              } ${hepticMode === "none" ? "crm-game-apples-sound--disabled" : ""}`}
              onClick={toggleFeedback}
              disabled={hepticMode === "none"}
            >
              {feedbackEnabled ? "Sound & buzz on" : "Sound muted"}
            </button>

            {gameState === "ended" && (
              <div className="crm-game-apples-results">
                <div className="crm-game-apples-results-card">
                  <h2 className="crm-game-apples-results-title">Time's up!</h2>
                  <p className="crm-game-apples-results-score">
                    You saved <strong>{score}</strong> apples!
                  </p>
                  <button
                    type="button"
                    className="crm-game-apples-replay"
                    onClick={handleReplay}
                  >
                    Play again
                  </button>
                  <div className="crm-game-apples-results-leaderboard">
                    <h3>Best harvests</h3>
                    <ol>
                      {scores.slice(0, 10).map((entry) => (
                        <li key={entry.recordedAt}>
                          <span className="crm-game-apples-results-score-value">
                            {entry.score}
                          </span>
                          <span className="crm-game-apples-results-score-date">
                            {formatFriendlyDate(entry)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {recentScore && (
                    <p className="crm-game-apples-results-note">
                      Latest game: {recentScore.score} apples on {formatFriendlyDate(recentScore)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export type { GameApplesProps };
