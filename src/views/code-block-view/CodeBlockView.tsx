import { InlineError } from "@/components/InlineError";
import type { ComponentType } from "react";
import { JournalNav } from "@/containers/JournalNav";
import HabitTracker from "@/containers/HabitTracker";
import TimerBlock from "@/containers/TimerBlock";

type CodeBlockProps = Record<string, string>;

const blocksMap: Record<string, ComponentType<CodeBlockProps>> = {
  "journal-nav": JournalNav as ComponentType<CodeBlockProps>,
  habits: HabitTracker as ComponentType<CodeBlockProps>,
  timer: TimerBlock as ComponentType<CodeBlockProps>,
};

const parseInlineQuery = (query: string): CodeBlockProps => {
  const params = new URLSearchParams(query);
  const result: CodeBlockProps = {};

  params.forEach((value, key) => {
    if (key) {
      result[key] = value;
    }
  });

  return result;
};

const parseBlockSource = (
  raw: string
): { blockKey: string; props: CodeBlockProps } => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

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
};

export const CodeBlockView = ({ source }: { source: string }) => {
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

  return <BlockComponent {...componentProps} />;
};
