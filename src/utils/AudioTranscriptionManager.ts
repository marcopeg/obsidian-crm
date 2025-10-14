import type CRM from "@/main";
import { Notice, TFile } from "obsidian";

export const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

const MIME_FALLBACK = "application/octet-stream";
const EXTENSION_TO_MIME: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_MIME));

type Maybe<T> = T | null | undefined;

const getMimeFromExtension = (extension: Maybe<string>) => {
  if (!extension) {
    return MIME_FALLBACK;
  }

  const normalized = extension.replace(/^\./, "").toLowerCase();
  return EXTENSION_TO_MIME[normalized] ?? MIME_FALLBACK;
};

export class AudioTranscriptionManager {
  private readonly plugin: CRM;

  private readonly activeTranscriptions = new Set<string>();

  constructor(plugin: CRM) {
    this.plugin = plugin;
  }

  initialize = () => {
    // Placeholder for future initialization logic.
  };

  dispose = () => {
    this.activeTranscriptions.clear();
  };

  isAudioFile = (file: Maybe<TFile>) => {
    if (!file) {
      return false;
    }

    return SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase());
  };

  transcribeAudioFile = async (file: TFile) => {
    const apiKey = this.plugin.settings?.openAIWhisperApiKey?.trim?.();

    if (!apiKey) {
      new Notice(
        "Set your OpenAI Whisper API key in the CRM settings before transcribing."
      );
      return;
    }

    const key = file.path;

    if (this.activeTranscriptions.has(key)) {
      new Notice("A transcription is already in progress for this audio file.");
      return;
    }

    this.activeTranscriptions.add(key);
    new Notice("Transcribing audio…");

    try {
      const transcript = await this.createTranscription(apiKey, file);
      await this.writeMarkdownNote(file, transcript);
      new Notice("Transcription note ready.");
    } catch (error) {
      console.error("CRM: failed to transcribe audio note", error);
      const message =
        error instanceof Error ? error.message : "Unknown transcription error.";
      new Notice(`Transcription failed: ${message}`);
    } finally {
      this.activeTranscriptions.delete(key);
    }
  };

  private createTranscription = async (apiKey: string, file: TFile) => {
    const buffer = await this.plugin.app.vault.adapter.readBinary(file.path);
    const blob = new Blob([buffer], { type: getMimeFromExtension(file.extension) });

    const formData = new FormData();
    formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
    formData.append("file", blob, file.name);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = response.statusText || "Request failed";

      try {
        const payload = await response.json();
        errorMessage = payload?.error?.message ?? errorMessage;
      } catch (parseError) {
        console.warn(
          "CRM: unable to parse transcription error payload",
          parseError
        );
      }

      throw new Error(errorMessage);
    }

    const payload = await response.json();
    const transcript: Maybe<string> =
      payload?.text ??
      payload?.transcription ??
      payload?.results?.[0]?.text ??
      payload?.results?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript || !String(transcript).trim()) {
      throw new Error("Received an empty transcription result.");
    }

    return String(transcript).trim();
  };

  private writeMarkdownNote = async (file: TFile, transcript: string) => {
    const directory = file.parent?.path ?? "";
    const transcriptionBasename = `${file.basename}-transcription`;
    const notePath = `${
      directory ? `${directory}/` : ""
    }${transcriptionBasename}.md`;
    const embed = `![[${file.name}]]`;
    const noteContent = `${embed}\n\n${transcript}\n`;

    const existing = this.plugin.app.vault.getAbstractFileByPath(notePath);

    if (existing instanceof TFile) {
      await this.plugin.app.vault.modify(existing, noteContent);
      return;
    }

    await this.plugin.app.vault.create(notePath, noteContent);
  };
}
