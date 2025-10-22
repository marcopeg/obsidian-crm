import { InlineError } from "@/components/InlineError";
import type { ComponentType } from "react";
import YAML from "yaml";
import { JournalNav } from "@/containers/JournalNav";
import HabitTracker from "@/containers/HabitTracker";
import TimerBlock from "@/containers/TimerBlock";
import GameApples from "@/containers/GameApples";

type CodeBlockProps = Record<string, unknown>;

const blocksMap: Record<string, ComponentType<CodeBlockProps>> = {
  "journal-nav": JournalNav as ComponentType<CodeBlockProps>,
  habits: HabitTracker as ComponentType<CodeBlockProps>,
  timer: TimerBlock as ComponentType<CodeBlockProps>,
  "time-plan": TimerBlock as ComponentType<CodeBlockProps>,
  "game-apples": GameApples as ComponentType<CodeBlockProps>,
};

const parseInlineQuery = (query: string): Record<string, string> => {
  const params = new URLSearchParams(query);
  const result: Record<string, string> = {};

  params.forEach((value, key) => {
    if (key) {
      result[key] = value;
    }
  });

  return result;
};

const toRecord = (value: unknown): CodeBlockProps => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as CodeBlockProps;
};

const parseBlockSource = (
  raw: string
): { blockKey: string; props: CodeBlockProps } => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { blockKey: "", props: {} };
  }

  const [firstLine, ...rest] = lines;
  const questionMarkIndex = firstLine.indexOf("?");
  const blockKey =
    questionMarkIndex !== -1
      ? firstLine.slice(0, questionMarkIndex).trim()
      : firstLine;
  const inlineQuery =
    questionMarkIndex !== -1 ? firstLine.slice(questionMarkIndex + 1) : "";

  const baseProps: CodeBlockProps = inlineQuery
    ? parseInlineQuery(inlineQuery)
    : {};

  if (rest.length === 0) {
    return { blockKey, props: baseProps };
  }

  const normalizedLines = rest.map((line) => {
    const trimmed = line.trim();

    if (!trimmed.includes(":") && trimmed.includes("=")) {
      const equalsIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim();

      if (key.length === 0) {
        return trimmed;
      }

      return `${key}: ${value}`;
    }

    return line;
  });

  // Handle legacy format: scalar properties followed by top-level list items
  // Example (non-standard YAML): title: Gym\n- title: Step1\n  duration: 5
  // This splits at the first list item and parses separately
  const firstListItemIndex = normalizedLines.findIndex((line) =>
    line.trim().startsWith("-")
  );
  const hasTopLevelScalars =
    firstListItemIndex > 0 &&
    normalizedLines
      .slice(0, firstListItemIndex)
      .some((line) => line.includes(":"));

  if (firstListItemIndex > 0 && hasTopLevelScalars) {
    const scalarLines = normalizedLines.slice(0, firstListItemIndex);
    const listLines = normalizedLines.slice(firstListItemIndex);

    try {
      const scalarProps = toRecord(YAML.parse(scalarLines.join("\n")));
      const steps = YAML.parse(listLines.join("\n"));

      return {
        blockKey,
        props: {
          ...baseProps,
          ...scalarProps,
          ...(Array.isArray(steps) && steps.length > 0 ? { steps } : {}),
        },
      };
    } catch (error) {
      // Fall through to standard parsing
    }
  }

  const yamlSource = normalizedLines.join("\n");

  try {
    const parsed = YAML.parse(yamlSource);

    if (Array.isArray(parsed)) {
      return { blockKey, props: { ...baseProps, steps: parsed } };
    }

    const record = toRecord(parsed);

    if (record === baseProps) {
      return { blockKey, props: baseProps };
    }

    return { blockKey, props: { ...baseProps, ...record } };
  } catch (error) {
    const props = rest.reduce<CodeBlockProps>(
      (acc, line) => {
        const colonIndex = line.indexOf(":");
        const equalsIndex = line.indexOf("=");
        const separatorIndex = colonIndex !== -1 ? colonIndex : equalsIndex;
        if (separatorIndex === -1) {
          return acc;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();

        if (key.length === 0) {
          return acc;
        }

        acc[key] = value;

        return acc;
      },
      { ...baseProps }
    );

    return { blockKey, props };
  }
};

type CodeBlockViewProps = {
  source: string;
  sourcePath: string;
};

export const CodeBlockView = ({ source, sourcePath }: CodeBlockViewProps) => {
  const { blockKey, props } = parseBlockSource(source);
  const BlockComponent = blockKey ? blocksMap[blockKey] : undefined;

  if (!BlockComponent) {
    return (
      <InlineError message={`block not found: ${blockKey || "(empty)"}`} />
    );
  }

  const { key: keyProp, ...restProps } = props;
  const componentProps: CodeBlockProps =
    keyProp !== undefined
      ? { ...restProps, blockKey: keyProp, inlineKey: keyProp }
      : restProps;

  const enhancedProps =
    blockKey === "habits"
      ? { ...componentProps, notePath: sourcePath }
      : componentProps;

  return <BlockComponent {...enhancedProps} />;
};
