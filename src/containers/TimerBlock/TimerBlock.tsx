import type { FC } from "react";
import { useTimerBlock } from "./useTimerBlock";

type TimerBlockProps = Record<string, string>;

export const TimerBlock: FC<TimerBlockProps> = (props) => {
  const {
    canStart,
    currentLabel,
    displayTitle,
    durationSeconds,
    formattedRemaining,
    intervalSeconds,
    isRunning,
    start,
    stop,
  } = useTimerBlock(props);

  const handleToggle = () => {
    if (isRunning) {
      stop();
    } else {
      start();
    }
  };

  return (
    <div className="crm-timer-block">
      <div className="crm-timer-block__label" aria-live="polite">
        {currentLabel}
      </div>
      <button
        type="button"
        className={`crm-timer-block__button ${
          isRunning ? "crm-timer-block__button--stop" : "crm-timer-block__button--start"
        }`}
        onClick={handleToggle}
        disabled={!canStart && !isRunning}
        aria-pressed={isRunning}
        aria-label={
          isRunning
            ? `Stop ${displayTitle} timer`
            : `Start ${displayTitle} timer`
        }
      >
        <span className="crm-timer-block__button-icon" aria-hidden>
          {isRunning ? "■" : "▶"}
        </span>
        <span className="crm-timer-block__countdown">{formattedRemaining}</span>
      </button>
      <div className="crm-timer-block__meta">
        <span className="crm-timer-block__meta-duration">{`${durationSeconds}s`}</span>
        <span className="crm-timer-block__meta-separator">/</span>
        <span className="crm-timer-block__meta-interval">{`${intervalSeconds}s`}</span>
      </div>
    </div>
  );
};
