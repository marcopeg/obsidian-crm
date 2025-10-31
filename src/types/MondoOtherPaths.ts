/**
 * Shape for miscellaneous folder paths used by the plugin.
 */
export interface MondoJournalSettings {
  root: string; // folder where journal entries are stored
  entry: string; // filename format for journal entries (e.g. YYYY-MM-DD)
}

export type DailyEntryLineFormat = "plain" | "bullet" | "checkbox";

export interface MondoDailySettings {
  root: string; // folder where daily notes are stored
  entry: string; // filename format for daily entries (e.g. YYYY-MM-DD)
  note: string; // note filename/time format inside a daily note (e.g. HH:MM)
  section?: string; // heading level for daily notes (h1..h6)
  entryLineFormat?: DailyEntryLineFormat; // how new daily entries should be prefixed
  useBullets?: boolean; // legacy flag for bullet insertion (deprecated)
}

/** Defaults for journal settings */
export const DEFAULT_MONDO_JOURNAL_SETTINGS: MondoJournalSettings = {
  root: "Journal",
  entry: "YYYY-MM-DD",
};

/** Defaults for daily settings */
export const DEFAULT_MONDO_DAILY_SETTINGS: MondoDailySettings = {
  root: "Daily",
  entry: "YYYY-MM-DD",
  note: "HH:MM",
  section: "h2",
  entryLineFormat: "bullet",
};
