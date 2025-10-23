import type CRM from "@/main";
import {
  MarkdownPostProcessorContext,
  Notice,
  TFile,
  setIcon,
} from "obsidian";

const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

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

type ActiveTranscription = {
  controller: AbortController;
  startedAt: number;
  intervalId: number;
  alertEl: HTMLElement;
  labelEl: HTMLElement;
  timerEl: HTMLElement;
  durationEl: HTMLElement;
  cancelButton: HTMLButtonElement;
  audioName: string;
};

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

  private readonly activeTranscriptions = new Map<string, ActiveTranscription>();

  private readonly renderedEmbeds = new WeakMap<HTMLElement, string>();

  private transcriptionAlertsContainer: HTMLElement | null = null;

  private readonly audioDurationCache = new Map<string, number>();

  private readonly audioDurationRequests = new Map<string, Promise<number | null>>();

  private audioContext: AudioContext | null = null;

  constructor(plugin: CRM) {
    this.plugin = plugin;
  }

  initialize = () => {
    // Placeholder for future initialization logic.
  };

  dispose = () => {
    const activeKeys = Array.from(this.activeTranscriptions.keys());

    activeKeys.forEach((key) => {
      const session = this.activeTranscriptions.get(key);
      session?.controller.abort();
      this.stopTranscriptionSession(key);
    });

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  };

  isAudioFile = (file: Maybe<TFile>) => {
    if (!file) {
      return false;
    }

    return SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase());
  };

  transcribeAudioFile = async (
    file: TFile,
    originPath?: string
  ): Promise<TFile | null> => {
    const apiKey = this.plugin.settings?.openAIWhisperApiKey?.trim?.();

    if (!apiKey) {
      new Notice(
        "Set your OpenAI Whisper API key in the CRM settings before transcribing."
      );
      return null;
    }

    const key = file.path;

    const existing = this.getTranscriptionNoteFile(file);

    if (existing) {
      new Notice("Transcription already exists for this audio. Opening note.");
      this.refreshAudioEmbeds(file.path);
      this.openTranscriptionFile(existing, originPath ?? file.path);
      return existing;
    }

    if (this.activeTranscriptions.has(key)) {
      new Notice("A transcription is already in progress for this audio file.");
      return null;
    }

    const session = this.startTranscriptionSession(file);
    this.refreshAudioEmbeds(file.path);

    try {
      const transcript = await this.createTranscription(
        apiKey,
        file,
        session.controller.signal
      );
      const note = await this.writeMarkdownNote(file, transcript);
      this.openTranscriptionFile(note, originPath ?? file.path);
      new Notice("Transcription note ready.");
      this.refreshAudioEmbeds(file.path);
      return note;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        new Notice("Transcription canceled.");
      } else {
        console.error("CRM: failed to transcribe audio note", error);
        const message =
          error instanceof Error
            ? error.message
            : "Unknown transcription error.";
        new Notice(`Transcription failed: ${message}`);
      }
    } finally {
      this.stopTranscriptionSession(key);
      this.refreshAudioEmbeds(file.path);
    }

    return null;
  };

  decorateMarkdown = (
    element: HTMLElement,
    context: MarkdownPostProcessorContext
  ) => {
    const embeds = Array.from(
      element.querySelectorAll<HTMLElement>(
        "div.internal-embed.media-embed, div.internal-embed.audio-embed"
      )
    );

    embeds.forEach((embed) => {
      const audio = embed.querySelector("audio");
      if (!audio) {
        return;
      }

      const audioFile = this.getAudioFileFromEmbed(embed, context.sourcePath);

      if (!audioFile || !this.isAudioFile(audioFile)) {
        return;
      }

      embed.setAttribute("data-crm-audio-path", audioFile.path);
      this.renderedEmbeds.set(embed, context.sourcePath);

      let actions = embed.querySelector<HTMLElement>(".crm-audio-actions");
      if (!actions) {
        actions = embed.createDiv({ cls: "crm-audio-actions" });
      }

      this.renderActionButtons(actions, audioFile, context.sourcePath);
    });
  };

  openTranscription = (audioFile: TFile, originPath?: string) => {
    const note = this.getTranscriptionNoteFile(audioFile);

    if (!note) {
      new Notice("No transcription note found for this audio yet.");
      return;
    }

    this.openTranscriptionFile(note, originPath ?? audioFile.path);
  };

  hasExistingTranscription = (file: TFile) => {
    return Boolean(this.getTranscriptionNoteFile(file));
  };

  isTranscriptionInProgress = (file: TFile) => {
    return this.activeTranscriptions.has(file.path);
  };

  private getTranscriptionNotePath = (file: TFile) => {
    const directory = file.parent?.path ?? "";
    const transcriptionBasename = `${file.basename}-transcription`;
    const notePath = `${
      directory ? `${directory}/` : ""
    }${transcriptionBasename}.md`;
    return notePath;
  };

  private getTranscriptionNoteFile = (file: TFile) => {
    const notePath = this.getTranscriptionNotePath(file);
    const existing = this.plugin.app.vault.getAbstractFileByPath(notePath);

    if (existing instanceof TFile) {
      return existing;
    }

    return null;
  };

  private createTranscription = async (
    apiKey: string,
    file: TFile,
    signal: AbortSignal
  ) => {
    const buffer = await this.plugin.app.vault.adapter.readBinary(file.path);
    const blob = new Blob([buffer], { type: getMimeFromExtension(file.extension) });

    const formData = new FormData();
    formData.append("model", TRANSCRIPTION_MODEL);
    formData.append("file", blob, file.name);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal,
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
    const notePath = this.getTranscriptionNotePath(file);
    const now = new Date();
    const frontmatter = [
      "---",
      "type: transcription",
      `date: ${this.formatIsoDate(now)}`,
      `time: ${this.formatIsoTime(now)}`,
      `source: "[[${file.path}]]"`,
      "---",
      "",
    ].join("\n");
    const embed = `![[${file.name}]]`;
    const noteContent = `${frontmatter}${embed}\n\n${transcript}\n`;

    const existing = this.plugin.app.vault.getAbstractFileByPath(notePath);

    if (existing instanceof TFile) {
      await this.plugin.app.vault.modify(existing, noteContent);
      return existing;
    }

    return this.plugin.app.vault.create(notePath, noteContent);
  };

  private renderActionButtons = (
    container: HTMLElement,
    audioFile: TFile,
    originPath: string
  ) => {
    container.replaceChildren();
    container.classList.add("crm-audio-actions");

    const transcription = this.getTranscriptionNoteFile(audioFile);
    const inProgress = this.activeTranscriptions.has(audioFile.path);

    const transcribeButton = container.createEl("button", {
      cls: "crm-audio-action-button mod-cta",
    });
    transcribeButton.setAttr("type", "button");
    transcribeButton.setAttr(
      "title",
      "Transcribe this recording with Whisper and link the note"
    );
    const transcribeIcon = transcribeButton.createSpan({
      cls: "crm-audio-action-icon",
    });
    setIcon(transcribeIcon, inProgress ? "loader-2" : "wand-2");
    transcribeButton.createSpan({
      text: inProgress ? "Transcribing…" : "Transcribe",
    });

    transcribeButton.disabled = inProgress;

    transcribeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.transcribeAudioFile(audioFile, originPath);
    });

    if (transcription) {
      const openButton = container.createEl("button", {
        cls: "crm-audio-action-button",
      });
      openButton.setAttr("type", "button");
      openButton.setAttr(
        "title",
        "Open the linked transcription note in a new pane"
      );
      const openIcon = openButton.createSpan({ cls: "crm-audio-action-icon" });
      setIcon(openIcon, "file-text");
      openButton.createSpan({ text: "Open transcription" });

      openButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openTranscription(audioFile, originPath);
      });
    }
  };

  private startTranscriptionSession = (file: TFile) => {
    const key = file.path;
    const container = this.ensureTranscriptionAlertsContainer();
    const alertEl = container.createDiv({ cls: "crm-transcription-alert" });
    alertEl.setAttr("role", "status");
    alertEl.setAttr("aria-live", "polite");

    const audioName = file.basename || file.name;

    const headerEl = alertEl.createDiv({ cls: "crm-transcription-alert__header" });

    const labelEl = headerEl.createSpan({
      cls: "crm-transcription-alert__message",
      text: `Transcribing ${audioName}...`,
    });

    const cancelButton = headerEl.createEl("button", {
      cls: "crm-transcription-alert__cancel mod-warning",
      text: "Cancel",
    });
    cancelButton.setAttr("type", "button");

    const metaEl = alertEl.createDiv({ cls: "crm-transcription-alert__meta" });
    metaEl.createSpan({
      cls: "crm-transcription-alert__meta-label",
      text: "Duration:",
    });
    const durationEl = metaEl.createSpan({
      cls: "crm-transcription-alert__meta-value",
      text: "--",
    });

    metaEl.createSpan({ cls: "crm-transcription-alert__meta-separator", text: ";" });

    metaEl.createSpan({
      cls: "crm-transcription-alert__meta-label",
      text: "Elapsed:",
    });
    const timerEl = metaEl.createSpan({
      cls: "crm-transcription-alert__timer",
    });

    const controller = new AbortController();
    const startedAt = Date.now();

    const updateTimer = () => {
      timerEl.setText(this.formatElapsedDuration(Date.now() - startedAt));
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);

    void this.populateAudioDuration(file, durationEl);

    const session: ActiveTranscription = {
      controller,
      startedAt,
      intervalId,
      alertEl,
      labelEl,
      timerEl,
      durationEl,
      cancelButton,
      audioName,
    };

    this.activeTranscriptions.set(key, session);

    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancelTranscription(key);
    });

    return session;
  };

  private stopTranscriptionSession = (key: string) => {
    const session = this.activeTranscriptions.get(key);

    if (!session) {
      return;
    }

    window.clearInterval(session.intervalId);
    session.alertEl.remove();

    this.activeTranscriptions.delete(key);

    const container = this.transcriptionAlertsContainer;

    if (container && container.childElementCount === 0) {
      container.remove();
      this.transcriptionAlertsContainer = null;
    }
  };

  private ensureTranscriptionAlertsContainer = () => {
    if (
      this.transcriptionAlertsContainer &&
      document.body.contains(this.transcriptionAlertsContainer)
    ) {
      return this.transcriptionAlertsContainer;
    }

    this.transcriptionAlertsContainer = document.body.createDiv({
      cls: "crm-transcription-alerts",
    });

    return this.transcriptionAlertsContainer;
  };

  private populateAudioDuration = async (file: TFile, target: HTMLElement) => {
    const durationSeconds = await this.getAudioDurationSeconds(file);

    if (!target.isConnected) {
      return;
    }

    if (durationSeconds == null) {
      target.setText("--");
      return;
    }

    target.setText(this.formatDuration(durationSeconds));
  };

  private formatElapsedDuration = (elapsedMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    return `${seconds}s`;
  };

  private formatIsoDate = (value: Date) => {
    const year = value.getFullYear();
    const month = (value.getMonth() + 1).toString().padStart(2, "0");
    const day = value.getDate().toString().padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  private formatIsoTime = (value: Date) => {
    const hours = value.getHours().toString().padStart(2, "0");
    const minutes = value.getMinutes().toString().padStart(2, "0");
    const seconds = value.getSeconds().toString().padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  };

  private cancelTranscription = (key: string) => {
    const session = this.activeTranscriptions.get(key);

    if (!session) {
      return;
    }

    if (session.cancelButton.disabled) {
      return;
    }

    session.cancelButton.disabled = true;
    session.cancelButton.setText("Cancelling...");
    session.labelEl.setText(`Cancelling ${session.audioName}...`);
    session.controller.abort();
  };

  private getAudioDurationSeconds = (file: TFile) => {
    const cached = this.audioDurationCache.get(file.path);

    if (typeof cached === "number") {
      return Promise.resolve(cached);
    }

    const pending = this.audioDurationRequests.get(file.path);

    if (pending) {
      return pending;
    }

    const promise = (async (): Promise<number | null> => {
      try {
        const decoded = await this.decodeAudioDuration(file);

        if (decoded != null) {
          this.audioDurationCache.set(file.path, decoded);
          return decoded;
        }
      } catch (error) {
        console.warn("CRM: failed to decode audio buffer for duration", error);
      }

      const metadataDuration = await this.loadAudioMetadataDuration(file);

      if (metadataDuration != null) {
        this.audioDurationCache.set(file.path, metadataDuration);
      }

      return metadataDuration;
    })()
      .catch((error) => {
        console.warn("CRM: failed to resolve audio duration", error);
        return null;
      })
      .finally(() => {
        this.audioDurationRequests.delete(file.path);
      });

    this.audioDurationRequests.set(file.path, promise);

    return promise;
  };

  private loadAudioMetadataDuration = (file: TFile) => {
    return new Promise<number | null>((resolve) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.src = this.plugin.app.vault.getResourcePath(file);

      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        audio.src = "";
      };

      const onLoaded = () => {
        cleanup();
        const duration = Number.isFinite(audio.duration) ? audio.duration : null;
        resolve(duration);
      };

      const onError = () => {
        cleanup();
        resolve(null);
      };

      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
      audio.load();
    });
  };

  private decodeAudioDuration = async (file: TFile) => {
    try {
      const arrayBuffer = await this.plugin.app.vault.adapter.readBinary(file.path);
      const bufferCopy = arrayBuffer.slice(0);
      const context = this.ensureAudioContext();
      const audioBuffer = await context.decodeAudioData(bufferCopy);

      if (!Number.isFinite(audioBuffer.duration)) {
        return null;
      }

      return audioBuffer.duration;
    } catch (error) {
      console.warn("CRM: unable to decode audio duration", error);
      return null;
    }
  };

  private ensureAudioContext = () => {
    if (this.audioContext) {
      return this.audioContext;
    }

    const scopedWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };

    const AudioContextConstructor =
      window.AudioContext ?? scopedWindow.webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new Error("AudioContext is not supported in this environment.");
    }

    this.audioContext = new AudioContextConstructor();

    return this.audioContext;
  };

  private formatDuration = (totalSeconds: number) => {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const segments: string[] = [];

    if (hours > 0) {
      segments.push(`${hours}h`);
    }

    if (minutes > 0) {
      segments.push(`${minutes}m`);
    }

    if (hours === 0 && (minutes === 0 || remainingSeconds > 0)) {
      segments.push(`${remainingSeconds}s`);
    }

    if (segments.length === 0) {
      return "0s";
    }

    return segments.join(" ");
  };

  private refreshAudioEmbeds = (audioPath: string) => {
    if (!audioPath) {
      return;
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(audioPath);

    if (!(file instanceof TFile)) {
      return;
    }

    const selectorPath = audioPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const selector = `[data-crm-audio-path="${selectorPath}"]`;
    const embeds = Array.from(
      document.querySelectorAll<HTMLElement>(selector)
    );

    embeds.forEach((embed) => {
      const origin = this.renderedEmbeds.get(embed) ?? file.path;
      const container = embed.querySelector<HTMLElement>(".crm-audio-actions");

      if (!container) {
        return;
      }

      this.renderActionButtons(container, file, origin);
    });
  };

  private openTranscriptionFile = (note: TFile, originPath: string) => {
    this.plugin.app.workspace.openLinkText(note.path, originPath, true);
  };

  private getAudioFileFromEmbed = (
    embed: HTMLElement,
    sourcePath: string
  ): TFile | null => {
    const raw =
      embed.getAttribute("src") ??
      embed.getAttribute("data-src") ??
      (embed as HTMLElement & { dataset?: DOMStringMap }).dataset?.src ??
      "";

    let cleaned = raw.trim();
    if (cleaned.startsWith("!")) {
      cleaned = cleaned.slice(1);
    }
    if (cleaned.startsWith("[[")) {
      cleaned = cleaned.slice(2);
    }
    if (cleaned.endsWith("]]")) {
      cleaned = cleaned.slice(0, -2);
    }

    const linkPath = cleaned.split("|")[0]?.trim?.() ?? "";

    if (!linkPath) {
      return null;
    }

    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
      linkPath,
      sourcePath
    );

    if (file instanceof TFile) {
      return file;
    }

    return null;
  };
}
