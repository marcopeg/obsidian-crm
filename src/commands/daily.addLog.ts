import { App, TFile, MarkdownView } from "obsidian";
import type Mondo from "@/main";
import { DAILY_NOTE_TYPE, LEGACY_DAILY_NOTE_TYPE } from "@/types/MondoFileType";
import type { DailyEntryLineFormat } from "@/types/MondoOtherPaths";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDate(format: string, date: Date) {
  return format
    .split("YYYY")
    .join(String(date.getFullYear()))
    .split("MM")
    .join(pad(date.getMonth() + 1))
    .split("DD")
    .join(pad(date.getDate()));
}

function formatTime(format: string, date: Date) {
  // treat MM as minutes if HH present, otherwise ignore clash
  return format
    .split("HH")
    .join(pad(date.getHours()))
    .split("mm")
    .join(pad(date.getMinutes()))
    .split("MM")
    .join(pad(date.getMinutes()));
}

export type DailyLogEntryMode = "default" | "task";

export interface AddDailyLogOptions {
  text?: string | null;
  mode?: DailyLogEntryMode;
}

type RawDailySettings = {
  entryLineFormat?: unknown;
  useBullets?: unknown;
};

const DEFAULT_ENTRY_LINE_FORMAT: DailyEntryLineFormat = "bullet";

const resolveEntryLineFormat = (
  dailySettings: RawDailySettings
): DailyEntryLineFormat => {
  const candidate = dailySettings.entryLineFormat;
  if (candidate === "plain" || candidate === "bullet" || candidate === "checkbox") {
    return candidate;
  }
  const legacyFlag = dailySettings.useBullets;
  if (typeof legacyFlag === "boolean") {
    return legacyFlag ? "bullet" : "plain";
  }
  return DEFAULT_ENTRY_LINE_FORMAT;
};

const entryPrefixForFormat = (format: DailyEntryLineFormat): string => {
  if (format === "checkbox") {
    return "- [ ] ";
  }
  if (format === "bullet") {
    return "- ";
  }
  return "";
};

export async function addDailyLog(
  app: App,
  plugin: Mondo,
  options: AddDailyLogOptions = {}
) {
  const settings = (plugin as any).settings || {};
  const daily = settings.daily || {
    root: "Daily",
    entry: "YYYY-MM-DD",
    note: "HH:MM",
  };
  const folderSetting = daily.root || "Daily";
  const entryFormat = daily.entry || "YYYY-MM-DD";
  const noteFormat = daily.note || "HH:MM";
  const entryLineFormat = resolveEntryLineFormat(daily as RawDailySettings);
  const entryPrefix = entryPrefixForFormat(entryLineFormat);
  const providedText =
    typeof options.text === "string" ? options.text.trim() : "";
  const shouldAppendText = providedText.length > 0;
  const entryMode: DailyLogEntryMode =
    options.mode === "task" ? "task" : "default";

  const normalizedFolder =
    folderSetting === "/" ? "" : folderSetting.replace(/^\/+|\/+$/g, "");

  try {
    if (normalizedFolder !== "") {
      const existing = app.vault.getAbstractFileByPath(normalizedFolder);
      if (!existing) {
        await app.vault.createFolder(normalizedFolder);
      }
    }
  } catch (e) {
    throw e;
  }

  const now = new Date();
  const fileBase = formatDate(entryFormat, now);
  let fileName = fileBase;
  if (!fileName.endsWith(".md")) fileName = `${fileName}.md`;
  const filePath = normalizedFolder
    ? `${normalizedFolder}/${fileName}`
    : fileName;

  let tfile = app.vault.getAbstractFileByPath(filePath) as TFile | null;
  // Build today's date in YYYY-MM-DD format
  const isoDate = `${String(now.getFullYear())}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const makeFrontmatter = (dateStr: string) => {
    return (
      `---\n` +
      `type: ${DAILY_NOTE_TYPE}\n` +
      `date: ${dateStr}\n` +
      `---\n`
    );
  };

  if (!tfile) {
    // create with frontmatter
    tfile = await app.vault.create(filePath, makeFrontmatter(isoDate));
  } else {
    // Ensure existing file has normalized frontmatter (add or replace as needed)
    try {
      const raw = await app.vault.read(tfile);
      const fmRegex = /^\s*---\n([\s\S]*?)\n---\r?\n?/;
      const fmMatch = raw.match(fmRegex);
      if (fmMatch) {
        const existingFm = fmMatch[1] || "";
        const hasDailyType = new RegExp(
          `(^|\\n)\\s*type\\s*:\\s*${DAILY_NOTE_TYPE}(\\s|$)`,
          "i"
        ).test(existingFm);
        const hasLegacyType = new RegExp(
          `(^|\\n)\\s*type\\s*:\\s*${LEGACY_DAILY_NOTE_TYPE}(\\s|$)`,
          "i"
        ).test(existingFm);
        const hasDate = /(^|\n)\s*date\s*:\s*\d{4}-\d{2}-\d{2}(\s|$)/i.test(
          existingFm
        );
        const hasIsoDate = new RegExp(
          `(^|\\n)\\s*date\\s*:\\s*${isoDate}(\\s|$)`,
          "i"
        ).test(existingFm);

        if (hasLegacyType && !hasDailyType && hasIsoDate) {
          const updatedFrontmatter = existingFm.replace(
            new RegExp(
              `(^|\\n)(\\s*type\\s*:\\s*)${LEGACY_DAILY_NOTE_TYPE}(\\s|$)`,
              "i"
            ),
            `$1$2${DAILY_NOTE_TYPE}$3`
          );
          const rest = raw.replace(fmRegex, "").replace(/^\r?\n+/, "");
          const newContent = `---\n${updatedFrontmatter}\n---\n` + rest;
          await app.vault.modify(tfile, newContent);
        } else if (!hasDailyType || !hasDate || !hasIsoDate) {
          // replace frontmatter with normalized one
          const rest = raw.replace(fmRegex, "").replace(/^\r?\n+/, "");
          const newContent = makeFrontmatter(isoDate) + rest;
          await app.vault.modify(tfile, newContent);
        }
      } else {
        // prepend frontmatter
        const rest = raw.replace(/^\r?\n+/, "");
        const newContent = makeFrontmatter(isoDate) + rest;
        await app.vault.modify(tfile, newContent);
      }
    } catch (e) {
      // ignore read/modify errors
    }
  }

  const headingText = formatTime(noteFormat, now);
  const section = (daily.section || "h2").toLowerCase();
  const match = section.match(/^h([1-6])$/);
  const level = match ? Math.max(1, Math.min(6, Number(match[1]))) : 2;
  const prefix = "#".repeat(level);
  const headingLine = `${prefix} ${headingText}`;

  if (shouldAppendText) {
    await appendLogEntryToFile(app, tfile as TFile, {
      headingLine,
      entryPrefix,
      text: providedText,
      entryFormat: entryLineFormat,
      mode: entryMode,
    });
    return;
  }

  const markdownLeaves = app.workspace.getLeavesOfType("markdown");
  const existingLeaf = markdownLeaves.find((l) => {
    try {
      const f = (l.view as any)?.file as TFile | undefined | null;
      return f?.path === filePath;
    } catch (e) {
      return false;
    }
  });

  const leaf = (existingLeaf as any) ?? app.workspace.getLeaf(true);
  if (existingLeaf) {
    app.workspace.revealLeaf(existingLeaf);
  } else {
    await leaf.openFile(tfile as TFile);
  }

  // Editor work
  try {
    const view = leaf.view as unknown as MarkdownView | null;
    if (!view || !view.editor) return;
    const editor = view.editor;
    const content = editor.getValue();
    const lines = content.split(/\r?\n/);

    // Find existing H1 matching the headingText
    let foundIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === headingLine) {
        foundIndex = i;
        break;
      }
    }

    const findSectionEnd = (startIndex: number) => {
      for (let i = startIndex + 1; i < lines.length; i++) {
        if (/^#\s+/.test(lines[i])) return i - 1;
      }
      return lines.length - 1;
    };

    if (foundIndex >= 0) {
      // Move cursor to a new entry line at end of this section
      const sectionEnd = findSectionEnd(foundIndex);
      let insertLine = sectionEnd + 1;
      let nextLineText = lines[insertLine] ?? null;

      if (
        nextLineText === null &&
        sectionEnd >= 0 &&
        lines[sectionEnd]?.trim() === ""
      ) {
        insertLine = sectionEnd;
        nextLineText = lines[insertLine] ?? null;
      }

      if (nextLineText === "") {
        // Replace the existing empty line with the entry prefix
        // replaceRange(from, to) using positions
        const prefixText = entryPrefix;
        editor.replaceRange(
          prefixText,
          { line: insertLine, ch: 0 },
          { line: insertLine, ch: nextLineText.length }
        );
        editor.setCursor({ line: insertLine, ch: prefixText.length });
      } else {
        // Insert a single newline plus the entry prefix (no extra blank lines)
        const insert = `\n${entryPrefix}`;
        editor.replaceRange(insert, { line: insertLine, ch: 0 });
        editor.setCursor({ line: insertLine + 1, ch: entryPrefix.length });
      }
      editor.focus();
      try {
        if (typeof (editor as any).scrollIntoView === "function") {
          (editor as any).scrollIntoView({ line: insertLine + 1, ch: 0 }, true);
        } else if ((view as any).containerEl) {
          const cursorCoords = (editor as any).cursorCoords
            ? (editor as any).cursorCoords(true)
            : null;
          const scroller = (view as any).containerEl.querySelector?.(
            ".cm-scroller, .CodeMirror-scroll"
          );
          if (cursorCoords && scroller) {
            const sc = scroller as HTMLElement;
            const middle = sc.clientHeight / 2;
            sc.scrollTop = Math.max(0, cursorCoords.top - middle + 10);
          }
        }
      } catch (e) {}
      return;
    }

    // Not found: append heading right after the last H1 (or at EOF)
    let lastH1 = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+/.test(lines[i])) lastH1 = i;
    }

    const insertPosLine =
      lastH1 >= 0 ? findSectionEnd(lastH1) + 1 : lines.length;
    const prependNewline = insertPosLine !== 0;
    const entryLinePrefix = entryPrefix;
    const insertText = `${
      prependNewline ? "\n" : ""
    }${headingLine}\n${entryLinePrefix}`;
    editor.replaceRange(insertText, { line: insertPosLine, ch: 0 });
    // place cursor after the entry prefix (or at line start if none)
    const targetLine = insertPosLine + (prependNewline ? 2 : 1);
    editor.setCursor({ line: targetLine, ch: entryLinePrefix.length });
    editor.focus();
    try {
      if (typeof (editor as any).scrollIntoView === "function") {
        (editor as any).scrollIntoView({ line: targetLine, ch: 0 }, true);
      } else if ((view as any).containerEl) {
        const cursorCoords = (editor as any).cursorCoords
          ? (editor as any).cursorCoords(true)
          : null;
        const scroller = (view as any).containerEl.querySelector?.(
          ".cm-scroller, .CodeMirror-scroll"
        );
        if (cursorCoords && scroller) {
          const sc = scroller as HTMLElement;
          const middle = sc.clientHeight / 2;
          sc.scrollTop = Math.max(0, cursorCoords.top - middle + 10);
        }
      }
    } catch (e) {}
  } catch (e) {
    // ignore
  }
}

interface AppendLogEntryOptions {
  headingLine: string;
  entryPrefix: string;
  text: string;
  entryFormat: DailyEntryLineFormat;
  mode: DailyLogEntryMode;
}

async function appendLogEntryToFile(
  app: App,
  file: TFile,
  options: AppendLogEntryOptions
) {
  const { headingLine, entryPrefix, text, entryFormat, mode } = options;
  const entryLines = buildEntryLines(text, entryPrefix, entryFormat, mode);
  if (entryLines.length === 0) return;

  const raw = await app.vault.read(file);
  const lineBreak = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const updatedLines = insertEntryLines(lines, headingLine, entryLines);
  let updated = updatedLines.join(lineBreak);
  if (!updated.endsWith(lineBreak)) {
    updated += lineBreak;
  }

  if (updated !== raw) {
    await app.vault.modify(file, updated);
  }
}

function buildEntryLines(
  text: string,
  entryPrefix: string,
  entryFormat: DailyEntryLineFormat,
  mode: DailyLogEntryMode
) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const pieces = trimmed.split(/\r?\n/);
  const lines: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const part = pieces[i].trim();
    if (!part) continue;

    if (entryFormat === "plain") {
      if (i === 0) {
        const prefix = mode === "task" ? "[ ] " : "";
        lines.push(`${prefix}${part}`);
      } else {
        lines.push(part);
      }
      continue;
    }

    if (i === 0) {
      const prefix =
        entryFormat === "bullet" && mode === "task"
          ? "- [ ] "
          : entryPrefix;
      lines.push(`${prefix}${part}`);
    } else {
      lines.push(`  ${part}`);
    }
  }
  return lines;
}

function insertEntryLines(
  lines: string[],
  headingLine: string,
  entryLines: string[]
) {
  const result = [...lines];
  const trimmedHeading = headingLine.trim();
  const isHeading = (line: string) => /^#\s+/.test(line.trim());

  const findSectionEnd = (startIndex: number) => {
    let end = startIndex;
    for (let i = startIndex + 1; i < result.length; i++) {
      if (isHeading(result[i])) {
        return i - 1;
      }
      end = i;
    }
    return end;
  };

  const headingIndex = result.findIndex(
    (line) => line.trim() === trimmedHeading
  );

  if (headingIndex >= 0) {
    const nextHeadingIndex = (() => {
      for (let i = headingIndex + 1; i < result.length; i++) {
        if (isHeading(result[i])) return i;
      }
      return -1;
    })();

    const sectionEnd = findSectionEnd(headingIndex);
    let lastContentIndex = sectionEnd;
    while (lastContentIndex > headingIndex && result[lastContentIndex].trim() === "") {
      lastContentIndex--;
    }

    const blanksToRemove = sectionEnd - lastContentIndex;
    if (blanksToRemove > 0) {
      result.splice(lastContentIndex + 1, blanksToRemove);
    }

    const insertLine = lastContentIndex + 1;
    result.splice(insertLine, 0, ...entryLines);

    const nextIndex = insertLine + entryLines.length;
    const hasNextHeading = nextHeadingIndex !== -1;
    if (hasNextHeading && result[nextIndex]?.trim() !== "") {
      result.splice(nextIndex, 0, "");
    }

    return result;
  }

  let lastHeading = -1;
  for (let i = 0; i < result.length; i++) {
    if (isHeading(result[i])) {
      lastHeading = i;
    }
  }

  const insertPosLine =
    lastHeading >= 0 ? findSectionEnd(lastHeading) + 1 : result.length;
  const insertSegment = insertPosLine !== 0 ? ["", headingLine] : [headingLine];
  insertSegment.push(...entryLines);
  result.splice(insertPosLine, 0, ...insertSegment);
  return result;
}
