import { useApp } from "@/hooks/use-app";
import { useActiveTab } from "@/hooks/use-active-tab";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFile } from "obsidian";

type HepticMode = "audio" | "vibration" | "both" | "none";

type GameApplesProps = Record<string, unknown>;

type ScoreEntry = {
  score: number;
  date: string;
  recordedAt: string;
};

type ParsedFrontmatter = {
  scores: ScoreEntry[];
  sound: "on" | "off";
};

type UseGameApplesResult = {
  durationSeconds: number;
  hepticMode: HepticMode;
  scores: ScoreEntry[];
  feedbackEnabled: boolean;
  toggleFeedback: () => void;
  persistScore: (score: number) => Promise<void>;
  error: string | null;
  ready: boolean;
};

const FRONTMATTER_KEY = "gameApples";
const SCORES_KEY = "scores";
const SOUND_KEY = "sound";
const DEFAULT_DURATION = 60;

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
};

const parseDuration = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(5, Math.floor(value));
  }
  if (typeof value === "string") {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      const safe = Math.max(5, Math.floor(numeric));
      return safe;
    }
  }
  return DEFAULT_DURATION;
};

const parseHepticMode = (value: unknown): HepticMode => {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "audio" || normalized === "sound") return "audio";
  if (normalized === "vibration") return "vibration";
  if (normalized === "none") return "none";
  if (normalized === "both") return "both";
  return "both";
};

const toScoreEntry = (value: unknown): ScoreEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawScore = record.score ?? record.points;
  const score = Number(rawScore);
  if (!Number.isFinite(score)) {
    return null;
  }

  const rawRecordedAt = toStringValue(record.recordedAt);
  const recordedAt = rawRecordedAt
    ? new Date(rawRecordedAt).toISOString()
    : new Date().toISOString();

  const rawDate = toStringValue(record.date);
  const date = rawDate || recordedAt.slice(0, 10);

  return {
    score: Math.max(0, Math.floor(score)),
    date,
    recordedAt,
  };
};

const parseScores = (value: unknown): ScoreEntry[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    const entries: ScoreEntry[] = [];
    value.forEach((entry) => {
      const parsed = toScoreEntry(entry);
      if (parsed) {
        entries.push(parsed);
      }
    });
    return entries;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseScores(parsed);
      }
    } catch (error) {
      // ignore malformed JSON strings
    }
  }

  return [];
};

const normalizeFrontmatter = (value: unknown): ParsedFrontmatter => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { scores: [], sound: "on" };
  }

  const record = value as Record<string, unknown>;
  const rawSound = toStringValue(record[SOUND_KEY]).toLowerCase();
  const sound = rawSound === "off" || rawSound === "mute" ? "off" : "on";

  const scores = parseScores(record[SCORES_KEY]);

  return { scores, sound };
};

const formatScore = (entry: ScoreEntry): Record<string, unknown> => ({
  score: entry.score,
  date: entry.date,
  recordedAt: entry.recordedAt,
});

const sortScores = (entries: ScoreEntry[]): ScoreEntry[] => {
  const clone = [...entries];
  clone.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aTime = Date.parse(a.recordedAt);
    const bTime = Date.parse(b.recordedAt);
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
      return 0;
    }
    if (Number.isNaN(aTime)) {
      return 1;
    }
    if (Number.isNaN(bTime)) {
      return -1;
    }
    return bTime - aTime;
  });
  return clone.slice(0, 10);
};

const ensureFile = (file: TFile | undefined): file is TFile => !!file;

export const useGameApples = (
  props: GameApplesProps
): UseGameApplesResult => {
  const app = useApp();
  const { file } = useActiveTab();
  const targetFile = file?.file;
  const frontmatter = file?.cache?.frontmatter as
    | Record<string, unknown>
    | undefined;

  const durationSeconds = useMemo(
    () => parseDuration(props.duration),
    [props.duration]
  );

  const hepticMode = useMemo(() => parseHepticMode(props.heptic), [
    props.heptic,
  ]);

  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [soundDisabled, setSoundDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!frontmatter) {
      setScores([]);
      setSoundDisabled(false);
      return;
    }
    const parsed = normalizeFrontmatter(frontmatter[FRONTMATTER_KEY]);
    setScores(sortScores(parsed.scores));
    setSoundDisabled(parsed.sound === "off");
  }, [frontmatter]);

  const feedbackEnabled = hepticMode !== "none" && !soundDisabled;

  const persistFrontmatter = useCallback(
    async (
      updater: (current: ParsedFrontmatter) => ParsedFrontmatter
    ): Promise<void> => {
      if (!ensureFile(targetFile)) {
        setError("Unable to access the current note.");
        return;
      }

      try {
        await app.fileManager.processFrontMatter(targetFile, (fm) => {
          const current = normalizeFrontmatter(fm[FRONTMATTER_KEY]);
          const next = updater(current);
          const record: Record<string, unknown> = {
            [SCORES_KEY]: next.scores.map(formatScore),
            [SOUND_KEY]: next.sound,
          };
          fm[FRONTMATTER_KEY] = record;
        });
        setError(null);
      } catch (err) {
        console.error("GameApples: failed to persist frontmatter", err);
        setError("Unable to update the note's game settings.");
      }
    },
    [app.fileManager, targetFile]
  );

  const toggleFeedback = useCallback(() => {
    const nextDisabled = !soundDisabled;
    setSoundDisabled(nextDisabled);
    void persistFrontmatter((current) => ({
      ...current,
      sound: nextDisabled ? "off" : "on",
      scores: sortScores(current.scores),
    }));
  }, [persistFrontmatter, soundDisabled]);

  const persistScore = useCallback(
    async (score: number) => {
      const now = new Date();
      const entry: ScoreEntry = {
        score: Math.max(0, Math.floor(score)),
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(now.getDate()).padStart(2, "0")}`,
        recordedAt: now.toISOString(),
      };

      setScores((prev) => sortScores([...prev, entry]));

      await persistFrontmatter((current) => ({
        sound: current.sound,
        scores: sortScores([...current.scores, entry]),
      }));
    },
    [persistFrontmatter]
  );

  return {
    durationSeconds,
    hepticMode,
    scores,
    feedbackEnabled,
    toggleFeedback,
    persistScore,
    error,
    ready: ensureFile(targetFile),
  };
};

export type { GameApplesProps, ScoreEntry, HepticMode, UseGameApplesResult };
