import React, { useEffect, useMemo, useRef, useState } from "react";
import { setIcon } from "obsidian";

type VoiceFabButtonProps = {
  visible: boolean;
  disabled: boolean;
  tooltip?: string;
  onStart: () => Promise<void>;
  onAbort: () => void;
  onSubmit: (audio: Blob) => Promise<void>;
};

type RecorderStatus =
  | "idle"
  | "recording"
  | "processing"
  | "error"
  | "success";

const VISUALIZER_BARS = 12;
const SUCCESS_DISPLAY_MS = 1200;
const DEFAULT_AUDIO_TYPE = "audio/webm";

const createInitialLevels = () => new Array(VISUALIZER_BARS).fill(0);

export const VoiceFabButton: React.FC<VoiceFabButtonProps> = ({
  visible,
  disabled,
  tooltip,
  onStart,
  onAbort,
  onSubmit,
}) => {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [levels, setLevels] = useState<number[]>(() => createInitialLevels());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const successTimeoutRef = useRef<number | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);

  const isInteractive = visible && !disabled;
  const ariaLabel = useMemo(() => {
    if (!visible) {
      return "";
    }

    if (status === "recording") {
      return "Stop voice capture";
    }

    if (status === "processing") {
      return "Processing voice capture";
    }

    if (status === "success") {
      return "Voice capture inserted";
    }

    return "Start voice capture";
  }, [status, visible]);

  const clearError = () => setErrorMessage(null);

  const stopAnimation = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const resetVisualizer = () => {
    stopAnimation();
    setLevels(createInitialLevels());
  };

  const cleanupRecording = () => {
    stopAnimation();

    const recorder = mediaRecorderRef.current;
    if (recorder) {
      try {
        recorder.stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        console.error("CRM: failed to stop recorder tracks", error);
      }
    }

    const stream = mediaStreamRef.current;
    if (stream) {
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        console.error("CRM: failed to stop media stream", error);
      }
    }

    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    chunksRef.current = [];

    const analyser = analyserRef.current;
    if (analyser) {
      analyser.disconnect();
    }
    analyserRef.current = null;

    const audioContext = audioContextRef.current;
    if (audioContext) {
      try {
        void audioContext.close();
      } catch (error) {
        console.error("CRM: failed to close audio context", error);
      }
    }
    audioContextRef.current = null;
  };

  const updateLevels = () => {
    const analyser = analyserRef.current;
    if (!analyser) {
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const bucketSize = Math.max(1, Math.floor(bufferLength / VISUALIZER_BARS));
    const nextLevels = new Array(VISUALIZER_BARS).fill(0).map((_, index) => {
      const start = index * bucketSize;
      const end = Math.min(start + bucketSize, bufferLength);
      let sum = 0;
      for (let i = start; i < end; i += 1) {
        sum += dataArray[i];
      }
      const average = sum / Math.max(1, end - start);
      return Math.max(0, Math.min(1, average / 255));
    });

    setLevels(nextLevels);
    animationFrameRef.current = requestAnimationFrame(updateLevels);
  };

  const startVisualizer = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      updateLevels();
    } catch (error) {
      console.error("CRM: failed to initialize visualizer", error);
      resetVisualizer();
    }
  };

  const handleRecordingStop = async () => {
    const blob = new Blob(chunksRef.current, {
      type: mediaRecorderRef.current?.mimeType || DEFAULT_AUDIO_TYPE,
    });

    cleanupRecording();

    if (blob.size === 0) {
      setStatus("idle");
      setErrorMessage("No audio captured. Try again.");
      onAbort();
      return;
    }

    try {
      setStatus("processing");
      await onSubmit(blob);
      setStatus("success");
      successTimeoutRef.current = window.setTimeout(() => {
        setStatus("idle");
        resetVisualizer();
        clearError();
      }, SUCCESS_DISPLAY_MS);
    } catch (error) {
      console.error("CRM: voice submission failed", error);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to process recording"
      );
      resetVisualizer();
    }
  };

  const startRecording = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage("Microphone access is not supported in this environment.");
      return;
    }

    try {
      await onStart();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start recording"
      );
      return;
    }

    try {
      clearError();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : DEFAULT_AUDIO_TYPE;
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener(
        "stop",
        () => {
          void handleRecordingStop();
        },
        { once: true }
      );

      startVisualizer(stream);
      recorder.start();
      setStatus("recording");
    } catch (error) {
      onAbort();
      cleanupRecording();
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Microphone permission denied"
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }

    try {
      recorder.stop();
    } catch (error) {
      console.error("CRM: failed to stop recorder", error);
      cleanupRecording();
      setStatus("error");
      setErrorMessage("Unable to stop recording");
    }
  };

  const handleClick = () => {
    if (!visible) {
      return;
    }

    if (status === "recording") {
      stopRecording();
      return;
    }

    if (status === "processing") {
      return;
    }

    if (!isInteractive) {
      if (tooltip) {
        setErrorMessage(tooltip);
      }
      return;
    }

    void startRecording();
  };

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) {
      return;
    }

    const iconName = (() => {
      if (status === "recording") {
        return "waveform";
      }
      if (status === "processing") {
        return "loader-2";
      }
      if (status === "success") {
        return "check";
      }
      if (status === "error") {
        return "alert-circle";
      }
      return "mic";
    })();

    setIcon(icon, iconName);

    if (status === "processing") {
      icon.classList.add("crm-voice-fab-icon--spin");
    } else {
      icon.classList.remove("crm-voice-fab-icon--spin");
    }
  }, [status]);

  useEffect(() => {
    return () => {
      cleanupRecording();
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      cleanupRecording();
      setStatus("idle");
      resetVisualizer();
    }
  }, [visible]);

  const title = tooltip ?? "Record voice note";

  const statusLabel =
    status === "recording"
      ? "Recording…"
      : status === "processing"
      ? "Processing…"
      : status === "success"
      ? "Inserted"
      : status === "error"
      ? "Retry"
      : "Record";

  return (
    <div
      className={`crm-voice-fab ${visible ? "crm-voice-fab--visible" : ""}`.trim()}
    >
      <button
        className={`crm-voice-fab__button crm-voice-fab__button--${status}`}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={status === "recording"}
        disabled={!visible || status === "processing"}
        onClick={handleClick}
        title={title}
      >
        <span className="crm-voice-fab__visualizer" aria-hidden>
          {levels.map((level, index) => (
            <span
              key={index}
              className="crm-voice-fab__bar"
              style={{
                transform: `scaleY(${0.2 + level * 0.8})`,
              }}
            />
          ))}
        </span>
        <span className="crm-voice-fab__icon" ref={iconRef} aria-hidden />
      </button>
      {visible ? (
        <div className="crm-voice-fab__status" aria-live="polite">
          {statusLabel}
        </div>
      ) : null}
      {errorMessage && visible ? (
        <div className="crm-voice-fab__message" role="status">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
};

export default VoiceFabButton;
