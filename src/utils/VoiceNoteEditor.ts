import { Notice, MarkdownView, TFile } from "obsidian";
import type CRM from "@/main";
import { OPENAI_TRANSCRIPTION_MODEL } from "@/utils/AudioTranscriptionManager";

const FAB_VISIBLE_CLASS = "crm-voice-fab-visible";
const BUTTON_RECORDING_CLASS = "is-recording";
const BUTTON_PROCESSING_CLASS = "is-processing";

const MIME_TYPE = "audio/webm";

const VISUALIZER_BAR_COUNT = 4;

const EXTRACTED_TEXT_FALLBACK = "";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const SUPPORTED_OPENAI_MODELS: Record<string, string> = {
  "gpt-5o-mini": "GPT 5o mini",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4o": "GPT-4o",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "gpt-4.1": "GPT-4.1",
  "o1-mini": "o1 mini",
  "o1-preview": "o1 preview",
};

const RESPONSE_ENDPOINT = "https://api.openai.com/v1/responses";

const TEXT_CONTENT_TYPE = "text";

const OUTPUT_TEXT_PATH = ["output", 0, "content", 0, "text"] as const;

type OutputPath = typeof OUTPUT_TEXT_PATH;

type PathIndex = OutputPath[number];

const getNested = (input: unknown, path: OutputPath): unknown => {
  let current: unknown = input;
  path.forEach((key) => {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<PathIndex, unknown>)[key];
    } else {
      current = undefined;
    }
  });
  return current;
};

const isSupportedModel = (model: string): model is keyof typeof SUPPORTED_OPENAI_MODELS =>
  Object.prototype.hasOwnProperty.call(SUPPORTED_OPENAI_MODELS, model);

export class VoiceNoteEditor {
  private readonly plugin: CRM;

  private containerEl: HTMLElement | null = null;

  private buttonEl: HTMLButtonElement | null = null;

  private visualizerBars: HTMLElement[] = [];

  private isVisible = false;

  private mediaRecorder: MediaRecorder | null = null;

  private mediaStream: MediaStream | null = null;

  private audioContext: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private frameId: number | null = null;

  private recordedChunks: Blob[] = [];

  private shouldProcessRecording = false;

  constructor(plugin: CRM) {
    this.plugin = plugin;
  }

  initialize = () => {
    this.createElements();
    this.syncWithActiveLeaf();
  };

  dispose = () => {
    this.stopRecording(false);
    this.teardownVisualization();
    this.containerEl?.remove();
    this.containerEl = null;
    this.buttonEl = null;
    this.visualizerBars = [];
  };

  syncWithActiveLeaf = () => {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const shouldShow = Boolean(view && file instanceof TFile && file.extension === "md");

    if (shouldShow) {
      this.show();
    } else {
      this.hide();
    }
  };

  private createElements = () => {
    if (this.containerEl) {
      return;
    }

    const container = document.createElement("div");
    container.className = "crm-voice-fab";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "crm-voice-fab-button";
    button.setAttribute("aria-label", "Voice edit note");
    button.addEventListener("click", () => {
      if (!button.isConnected) {
        return;
      }
      if (button.classList.contains(BUTTON_PROCESSING_CLASS)) {
        return;
      }
      if (this.mediaRecorder && button.classList.contains(BUTTON_RECORDING_CLASS)) {
        this.stopRecording(true);
        return;
      }
      void this.startRecording();
    });

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.classList.add("crm-voice-fab-icon");

    const micPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    micPath.setAttribute(
      "d",
      "M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20a1 1 0 1 1-2 0v-2.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
    );
    micPath.setAttribute("fill", "currentColor");
    icon.appendChild(micPath);

    const visualizer = document.createElement("div");
    visualizer.className = "crm-voice-fab-visualizer";

    for (let index = 0; index < VISUALIZER_BAR_COUNT; index += 1) {
      const bar = document.createElement("span");
      bar.className = "crm-voice-fab-bar";
      visualizer.appendChild(bar);
      this.visualizerBars.push(bar);
    }

    const spinner = document.createElement("span");
    spinner.className = "crm-voice-fab-spinner";

    button.appendChild(icon);
    button.appendChild(visualizer);
    button.appendChild(spinner);
    container.appendChild(button);
    document.body.appendChild(container);

    this.containerEl = container;
    this.buttonEl = button;
  };

  private show = () => {
    if (!this.containerEl) {
      return;
    }

    if (!this.isVisible) {
      this.containerEl.classList.add(FAB_VISIBLE_CLASS);
      this.isVisible = true;
    }
  };

  private hide = () => {
    if (!this.containerEl) {
      return;
    }

    if (this.isVisible) {
      this.containerEl.classList.remove(FAB_VISIBLE_CLASS);
      this.isVisible = false;
    }

    this.stopRecording(false);
  };

  private startRecording = async () => {
    const button = this.buttonEl;
    if (!button) {
      return;
    }

    const apiKey = this.plugin.settings?.openAIWhisperApiKey?.trim?.();
    if (!apiKey) {
      new Notice("Set your OpenAI API key before recording.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      new Notice("Microphone access is not supported in this environment.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      new Notice("Audio recording is not supported in this environment.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE });

      this.mediaStream = stream;
      this.mediaRecorder = recorder;
      this.recordedChunks = [];
      this.shouldProcessRecording = false;

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data) {
          return;
        }
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const blob = this.recordedChunks.length
          ? new Blob(this.recordedChunks, { type: MIME_TYPE })
          : null;
        this.handleRecordingComplete(blob);
      });

      this.startVisualization(stream);
      recorder.start();
      button.classList.add(BUTTON_RECORDING_CLASS);
    } catch (error) {
      console.error("CRM: failed to access microphone", error);
      new Notice("Unable to access the microphone.");
      this.resetRecordingState();
    }
  };

  private stopRecording = (shouldProcess: boolean) => {
    this.shouldProcessRecording = shouldProcess;

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }

    this.mediaStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.mediaStream = null;

    this.teardownVisualization();
  };

  private handleRecordingComplete = (blob: Blob | null) => {
    const button = this.buttonEl;
    if (button) {
      button.classList.remove(BUTTON_RECORDING_CLASS);
    }

    if (!blob || !this.shouldProcessRecording) {
      this.resetRecordingState();
      return;
    }

    void this.processRecording(blob);
  };

  private resetRecordingState = () => {
    const button = this.buttonEl;
    if (button) {
      button.classList.remove(BUTTON_RECORDING_CLASS, BUTTON_PROCESSING_CLASS);
      button.disabled = false;
    }

    this.recordedChunks = [];
    this.mediaRecorder = null;
    this.shouldProcessRecording = false;
  };

  private startVisualization = (stream: MediaStream) => {
    this.teardownVisualization();

    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((total, value) => total + value, 0);
        const normalized = dataArray.length
          ? clamp(average / dataArray.length / 255, 0, 1)
          : 0;
        const baseScale = 0.25 + normalized * 1.5;

        this.visualizerBars.forEach((bar, index) => {
          const jitter = Math.sin(Date.now() / 120 + index) * 0.25;
          const scale = clamp(baseScale + jitter, 0.1, 2.5);
          bar.style.setProperty("--crm-voice-bar-scale", scale.toFixed(2));
        });

        this.frameId = requestAnimationFrame(tick);
      };

      this.audioContext = audioContext;
      this.analyser = analyser;
      this.frameId = requestAnimationFrame(tick);
    } catch (error) {
      console.warn("CRM: visualization unavailable", error);
    }
  };

  private teardownVisualization = () => {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close().catch(() => {});
      } catch (error) {
        // noop
      }
    }

    this.audioContext = null;
    this.analyser = null;

    this.visualizerBars.forEach((bar) => {
      bar.style.setProperty("--crm-voice-bar-scale", "0");
    });
  };

  private processRecording = async (blob: Blob) => {
    const button = this.buttonEl;
    if (!button) {
      return;
    }

    button.classList.add(BUTTON_PROCESSING_CLASS);
    button.disabled = true;

    const apiKey = this.plugin.settings?.openAIWhisperApiKey?.trim?.();
    if (!apiKey) {
      new Notice("Set your OpenAI API key before recording.");
      this.resetRecordingState();
      return;
    }

    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file;
    if (!activeView || !(file instanceof TFile)) {
      new Notice("Open a markdown note to use voice editing.");
      this.resetRecordingState();
      return;
    }

    try {
      new Notice("Transcribing voice note…");
      const transcription = await this.createTranscription(apiKey, blob);
      const noteContent = activeView.editor?.getValue?.() ?? activeView.getViewData();
      const prompt = this.buildPrompt(transcription, noteContent ?? "");
      const model = isSupportedModel(this.plugin.settings?.openAIModel)
        ? this.plugin.settings.openAIModel
        : "gpt-5o-mini";

      new Notice("Updating note with AI…");
      const updated = await this.generateUpdatedNote(apiKey, model, prompt);

      activeView.editor?.setValue?.(updated);
      await this.plugin.app.vault.modify(file, updated);
      new Notice("Note updated.");
    } catch (error) {
      console.error("CRM: voice note editing failed", error);
      const message =
        error instanceof Error ? error.message : "Voice editing failed.";
      new Notice(message);
    } finally {
      this.resetRecordingState();
    }
  };

  private createTranscription = async (apiKey: string, blob: Blob) => {
    const formData = new FormData();
    formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
    formData.append("file", blob, "voice-note.webm");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = response.statusText || "Transcription failed";

      try {
        const payload = await response.json();
        errorMessage = payload?.error?.message ?? errorMessage;
      } catch (parseError) {
        console.warn("CRM: failed to parse transcription error", parseError);
      }

      throw new Error(errorMessage);
    }

    const payload = await response.json();
    const transcript: unknown =
      payload?.text ??
      payload?.transcription ??
      payload?.results?.[0]?.text ??
      payload?.results?.[0]?.alternatives?.[0]?.transcript ??
      EXTRACTED_TEXT_FALLBACK;

    const normalized = String(transcript ?? "").trim();
    if (!normalized) {
      throw new Error("Received an empty transcription.");
    }

    return normalized;
  };

  private buildPrompt = (transcription: string, note: string) => {
    return `You are an expert Obsidian note editor with advanced reasoning abilities.\n\nUse the USER FEEDBACK to update the NOTE intelligently.\n\nInterpret the intent behind the feedback — the user may express edits conversationally or indirectly.\n\nDecide what to add, remove, rewrite, or reorganize to best reflect the user’s intent while preserving tone, context, and structure.\n\nFollow these rules strictly:\n\n- Keep YAML frontmatter, headings, links, and markdown formatting intact when still relevant.\n- Apply changes as if you were editing the actual note file.\n- Do not explain or comment.\n- Output only the complete, final markdown source of the updated note.\n\n=== USER FEEDBACK\n${transcription}\n\n=== NOTE\n${note}`;
  };

  private generateUpdatedNote = async (apiKey: string, model: string, prompt: string) => {
    const payload = {
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: TEXT_CONTENT_TYPE,
              text: prompt,
            },
          ],
        },
      ],
      modalities: [TEXT_CONTENT_TYPE],
    };

    const response = await fetch(RESPONSE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = response.statusText || "Model request failed";
      try {
        const payloadJson = await response.json();
        errorMessage = payloadJson?.error?.message ?? errorMessage;
      } catch (parseError) {
        console.warn("CRM: unable to parse OpenAI error", parseError);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const output = getNested(data, OUTPUT_TEXT_PATH);
    const text = typeof output === "string" ? output.trim() : "";

    if (!text) {
      throw new Error("Model did not return any content.");
    }

    return text;
  };
}

export const getSupportedOpenAIModels = () => {
  return { ...SUPPORTED_OPENAI_MODELS };
};
