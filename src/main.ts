import {
  type App,
  MarkdownView,
  Plugin,
  Menu,
  Notice,
  Platform,
  TAbstractFile,
  TFile,
  type ViewState,
  type WorkspaceLeaf,
} from "obsidian";
import {
  MondoDashboardViewWrapper,
  DASHBOARD_VIEW,
} from "@/views/dashboard-view/wrapper";
import { MondoAudioLogsViewWrapper } from "@/views/audio-logs-view/wrapper";
import {
  AUDIO_LOGS_ICON,
  AUDIO_LOGS_VIEW,
} from "@/views/audio-logs-view/constants";
import { MondoVaultImagesViewWrapper } from "@/views/vault-images-view/wrapper";
import {
  VAULT_IMAGES_ICON,
  VAULT_IMAGES_VIEW,
} from "@/views/vault-images-view/constants";
import { MondoVaultFilesViewWrapper } from "@/views/vault-files-view/wrapper";
import {
  VAULT_FILES_ICON,
  VAULT_FILES_VIEW,
} from "@/views/vault-files-view/constants";
import { MondoVaultNotesViewWrapper } from "@/views/vault-notes-view/wrapper";
import {
  VAULT_NOTES_ICON,
  VAULT_NOTES_VIEW,
} from "@/views/vault-notes-view/constants";
import {
  MondoEntityPanelViewWrapper,
  ENTITY_PANEL_VIEW,
  type MondoEntityPanelViewState,
} from "@/views/entity-panel-view/wrapper";
import { MondoInlineViewWrapper } from "@/views/code-block-view/wrapper";
import { SettingsView } from "@/views/settings/SettingsView";
import { MondoFileManager } from "@/utils/MondoFileManager";
import { AudioTranscriptionManager } from "@/utils/AudioTranscriptionManager";
import { VoiceoverManager } from "@/utils/VoiceoverManager";
import { NoteDictationManager } from "@/utils/NoteDictationManager";
import { validateMondoConfig } from "@/utils/MondoConfigManager";
import { normalizeFolderPath } from "@/utils/normalizeFolderPath";
import {
  MONDO_DICTATION_ICON_ID,
  registerDictationIcon,
} from "@/utils/registerDictationIcon";
import {
  MondoFileType,
  MONDO_FILE_TYPES,
  getMondoEntityConfig,
} from "@/types/MondoFileType";
import {
  MONDO_CONFIG_PRESETS,
  MONDO_ENTITY_TYPES,
  setMondoConfig,
} from "@/entities";
import defaultMondoConfig from "@/mondo-config.json";
import {
  DEFAULT_MONDO_JOURNAL_SETTINGS,
  DEFAULT_MONDO_DAILY_SETTINGS,
} from "@/types/MondoOtherPaths";
import { openJournal } from "@/commands/journal.open";
import { openDailyNote } from "@/commands/daily.open";
import { addDailyLog } from "@/commands/daily.addLog";
import { journalMoveFactory } from "@/commands/journal.nav";
import { insertTimestamp } from "@/commands/timestamp.insert";
import { sendToChatGPT } from "@/commands/chatgpt.send";
import { openSelfPersonNote } from "@/commands/self.open";
import { openMagicPaste } from "@/commands/magicPaste";
import { injectJournalNav } from "@/events/inject-journal-nav";
import {
  injectMondoLinks,
  disposeMondoLinkInjections,
} from "@/events/inject-mondo-links";
import { requestGeolocation } from "@/utils/geolocation";
import { buildVoiceoverText } from "@/utils/buildVoiceoverText";
import {
  activateFocusMode,
  deactivateFocusMode,
  isFocusModeActive,
  resetFocusMode,
} from "@/utils/focusMode";
import DailyNoteTracker from "@/utils/DailyNoteTracker";
import { TimestampToolbarManager } from "@/utils/TimestampToolbarManager";
import {
  DEFAULT_TIMESTAMP_SETTINGS,
  normalizeTimestampSettings,
} from "@/types/TimestampSettings";
import { getTemplateForType, renderTemplate } from "@/utils/MondoTemplates";
import { slugify, focusAndSelectTitle } from "@/utils/createLinkedNoteHelpers";

const MONDO_ICON = "anchor";

type PanelOpenOptions = {
  state?: Record<string, unknown>;
  reuseMatching?: (leaf: WorkspaceLeaf) => boolean;
};

export default class Mondo extends Plugin {
  // Settings shape and defaults
  settings: any = {
    // default rootPaths: map every known Mondo type to '/'
    rootPaths: Object.fromEntries(
      MONDO_FILE_TYPES.map((t) => [String(t), "/"])
    ),
    journal: DEFAULT_MONDO_JOURNAL_SETTINGS,
    daily: DEFAULT_MONDO_DAILY_SETTINGS,
    templates: Object.fromEntries(MONDO_FILE_TYPES.map((t) => [String(t), ""])),
    openAIWhisperApiKey: "",
    openAIVoice: "",
    openAIModel: "gpt-5-nano",
    openAITranscriptionPolishEnabled: true,
    voiceoverCachePath: "/voiceover",
    selfPersonPath: "",
    includeFrontmatterInChatGPT: false,
    mondoConfigPresetKey: "",
    mondoConfigJson: "",
    mondoConfigNotePath: "", // deprecated; no longer used
    timestamp: DEFAULT_TIMESTAMP_SETTINGS,
    dashboard: {
      openAtBoot: false,
      forceTab: false,
      enableQuickTasks: true,
      enableRelevantNotes: true,
      enableStats: true,
    },
  };

  private hasFocusedDashboardOnStartup = false;

  private audioTranscriptionManager: AudioTranscriptionManager | null = null;
  private voiceoverManager: VoiceoverManager | null = null;
  private noteDictationManager: NoteDictationManager | null = null;
  private timestampToolbarManager: TimestampToolbarManager | null = null;
  private dailyNoteTracker: DailyNoteTracker | null = null;
  private geolocationAbortController: AbortController | null = null;
  private mondoConfigManager: null = null;
  private audioLogsRibbonEl: HTMLElement | null = null;

  private applyGeolocationToFile = async (
    file: TFile,
    { notify }: { notify: boolean }
  ): Promise<boolean> => {
    this.geolocationAbortController = new AbortController();

    let notice: Notice | null = null;

    try {
      // Show loading indicator using Notice
      notice = new Notice("Getting your location...", 0);

      const geoloc = await requestGeolocation(
        this.geolocationAbortController.signal
      );

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        // Store as strings with dots to ensure international compatibility
        fm.lat = String(geoloc.lat).replace(",", ".");
        fm.lon = String(geoloc.lon).replace(",", ".");
      });

      if (notify) {
        new Notice("Geolocation saved.");
      }

      return true;
    } catch (error) {
      console.error("Mondo: Failed to capture geolocation", error);

      if (notify) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to capture geolocation.";

        // Don't show error if user cancelled
        if (message !== "Geolocation request cancelled.") {
          new Notice(`Geolocation failed: ${message}`);
        }
      }

      return false;
    } finally {
      notice?.hide();
      this.geolocationAbortController = null;
    }
  };

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign(this.settings, data ?? {});

    this.settings.rootPaths = Object.assign(
      Object.fromEntries(MONDO_FILE_TYPES.map((t) => [String(t), "/"])),
      this.settings.rootPaths ?? {}
    );

    this.settings.templates = Object.assign(
      Object.fromEntries(MONDO_FILE_TYPES.map((t) => [String(t), ""])),
      this.settings.templates ?? {}
    );

    this.settings.openAIWhisperApiKey = this.settings.openAIWhisperApiKey ?? "";
    this.settings.openAIVoice = this.settings.openAIVoice ?? "";
    this.settings.openAIModel = this.settings.openAIModel ?? "gpt-5-nano";
    this.settings.openAITranscriptionPolishEnabled =
      typeof this.settings.openAITranscriptionPolishEnabled === "boolean"
        ? this.settings.openAITranscriptionPolishEnabled
        : true;
    const cachePath = this.settings.voiceoverCachePath;
    if (typeof cachePath === "string" && cachePath.trim()) {
      this.settings.voiceoverCachePath = cachePath.trim();
    } else {
      this.settings.voiceoverCachePath = "/voiceover";
    }

    const selfPersonPath = this.settings.selfPersonPath;
    if (typeof selfPersonPath === "string") {
      this.settings.selfPersonPath = selfPersonPath.trim();
    } else {
      this.settings.selfPersonPath = "";
    }

    this.settings.includeFrontmatterInChatGPT =
      this.settings.includeFrontmatterInChatGPT === true;

    // Normalize settings-based custom JSON configuration (textarea)
    const customJson = this.settings.mondoConfigJson;
    this.settings.mondoConfigJson =
      typeof customJson === "string" ? customJson : "";

    const presetKey = this.settings.mondoConfigPresetKey;
    this.settings.mondoConfigPresetKey =
      typeof presetKey === "string" ? presetKey.trim() : "";

    // Deprecated: file-based config path is ignored, keep only as stored string
    const configNotePath = this.settings.mondoConfigNotePath;
    if (typeof configNotePath !== "string") {
      this.settings.mondoConfigNotePath = "";
    }

    this.settings.timestamp = normalizeTimestampSettings(
      this.settings.timestamp
    );

    const dashboardSettings = this.settings.dashboard ?? {};
    this.settings.dashboard = {
      openAtBoot: dashboardSettings.openAtBoot === true,
      forceTab: dashboardSettings.forceTab === true,
      enableQuickTasks: dashboardSettings.enableQuickTasks !== false,
      enableRelevantNotes: dashboardSettings.enableRelevantNotes !== false,
      enableStats: dashboardSettings.enableStats !== false,
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Apply Mondo configuration from the settings textarea
  async applyMondoConfigFromSettings() {
    const raw = (this.settings.mondoConfigJson ?? "").trim();
    if (!raw) {
      const presetKey = (this.settings.mondoConfigPresetKey ?? "").trim();
      if (presetKey) {
        const preset = MONDO_CONFIG_PRESETS.find(
          (entry) => entry.key === presetKey
        );

        if (preset) {
          setMondoConfig(preset.config as any);
          const entityCount = Object.keys(preset.config.entities ?? {}).length;
          console.log(
            `Mondo: applied preset Mondo config "${presetKey}" with ${entityCount} entities`
          );
          this.app.workspace.trigger("mondo:config-updated", {
            source: `preset:${presetKey}`,
            notePath: null,
          });
          return;
        }

        console.warn(
          `Mondo: unable to find preset configuration for key "${presetKey}"`
        );
      }

      setMondoConfig(defaultMondoConfig as any);
      console.log("Mondo: applied built-in Mondo config (no custom JSON)");
      this.app.workspace.trigger("mondo:config-updated", {
        source: "default",
        notePath: null,
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      new Notice(
        `Invalid Mondo configuration JSON: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return;
    }

    const validation = validateMondoConfig(parsed);
    if (!validation.ok) {
      const details = validation.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("\n");
      console.warn("Mondo: invalid pasted configuration\n" + details);
      new Notice("Mondo configuration is invalid. See console for details.");
      return;
    }

    setMondoConfig(validation.config as any);
    console.log(
      `Mondo: applied custom Mondo config from settings with ${
        Object.keys(validation.config.entities).length
      } entities`
    );
    this.app.workspace.trigger("mondo:config-updated", {
      source: "custom",
      notePath: null,
    });
  }

  async onload() {
    console.clear();
    console.log("Mondo: Loading plugin");

    // Initialize settings
    this.addSettingTab(new SettingsView(this.app, this));
    await this.loadSettings();

    // Apply configuration from settings (custom JSON or defaults)
    await this.applyMondoConfigFromSettings();

    registerDictationIcon();

    this.audioTranscriptionManager = new AudioTranscriptionManager(this);
    this.audioTranscriptionManager.initialize();

    this.voiceoverManager = new VoiceoverManager(this);
    this.voiceoverManager.initialize();

    this.noteDictationManager = new NoteDictationManager(this);
    this.noteDictationManager.initialize();
    this.noteDictationManager.activateMobileToolbar();

    this.timestampToolbarManager = new TimestampToolbarManager(this);
    this.timestampToolbarManager.initialize();
    this.timestampToolbarManager.activateMobileToolbar();

    this.dailyNoteTracker = new DailyNoteTracker(this);

    this.app.workspace.onLayoutReady(() => {
      this.noteDictationManager?.activateMobileToolbar();
      this.timestampToolbarManager?.activateMobileToolbar();
    });

    // Initialize the Mondo file manager in the background (non-blocking)
    const fileManager = MondoFileManager.getInstance(this.app);
    fileManager.initialize().catch((err) => {
      console.error("Mondo: Failed to initialize file manager:", err);
    });

    this.registerEvent(
      this.app.vault.on("create", (abstract) => {
        if (!(abstract instanceof TFile) || abstract.extension !== "md") {
          return;
        }

        this.dailyNoteTracker?.handleFileCreated(abstract);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (abstract) => {
        if (!(abstract instanceof TFile) || abstract.extension !== "md") {
          return;
        }

        this.dailyNoteTracker?.handleFileModified(abstract);
      })
    );

    this.addCommand({
      id: "open-dashboard",
      name: "Open Mondo dashboard",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }], // Cmd/Ctrl+Shift+M (user can change later)
      callback: () => this.showPanel(DASHBOARD_VIEW, "main"),
    });

    this.addCommand({
      id: "open-audio-notes",
      name: "OpenAudioNotes",
      callback: () => this.showPanel(AUDIO_LOGS_VIEW, "main"),
    });

    this.addCommand({
      id: "open-vault-images",
      name: "Open Vault Images",
      callback: () => this.showPanel(VAULT_IMAGES_VIEW, "main"),
    });

    this.addCommand({
      id: "open-vault-files",
      name: "Open Vault Files",
      callback: () => this.showPanel(VAULT_FILES_VIEW, "main"),
    });

    this.addCommand({
      id: "open-vault-notes",
      name: "Open Vault Notes",
      callback: () => this.showPanel(VAULT_NOTES_VIEW, "main"),
    });

    this.addCommand({
      id: "transcribe-audio-note",
      name: "Start transcription",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();

        if (!file || !this.audioTranscriptionManager?.isAudioFile(file)) {
          return false;
        }

        if (!checking) {
          void this.audioTranscriptionManager?.transcribeAudioFile(
            file,
            file.path
          );
        }

        return true;
      },
    });

    this.addCommand({
      id: "mondo-start-note-dictation",
      name: "Start dictation",
      editorCallback: async () => {
        const result = await this.noteDictationManager?.startDictation();
        if (result === "started") {
          new Notice("Dictation started. Tap again to stop.");
        } else if (result === "recording") {
          new Notice("Dictation already in progress.");
        }
      },
    });

    this.addCommand({
      id: "mondo-toggle-note-dictation",
      name: "Start Dictation (Mobile)",
      mobileOnly: true,
      icon: MONDO_DICTATION_ICON_ID,
      editorCallback: async () => {
        const status = this.noteDictationManager?.getDictationStatus();
        if (status === "recording") {
          const stopResult = this.noteDictationManager?.stopDictation({
            showDisabledNotice: true,
          });
          if (stopResult === "stopped") {
            new Notice("Dictation stopped. Processing…");
          }
          return;
        }

        const result = await this.noteDictationManager?.startDictation();
        if (result === "started") {
          new Notice("Dictation started. Tap again to stop.");
        } else if (result === "recording") {
          new Notice("Dictation already in progress.");
        }
      },
    });

    this.addCommand({
      id: "open-journal",
      name: "Open Journal",
      callback: async () => {
        try {
          console.log("Opening journal...");
          await openJournal(this.app, this);
        } catch (e) {
          console.error("Mondo: Failed to open journal:", e);
        }
      },
    });

    this.addCommand({
      id: "focus-mode-start",
      name: "Start focus mode",
      callback: () => {
        activateFocusMode(this.app, "manual");
      },
    });

    this.addCommand({
      id: "focus-mode-stop",
      name: "Stop focus mode",
      callback: () => {
        deactivateFocusMode(this.app, "manual");
      },
    });

    this.addCommand({
      id: "open-today",
      name: "Open Daily note",
      callback: async () => openDailyNote(this.app, this),
    });

    this.addCommand({
      id: "open-self-person",
      name: "Open myself",
      callback: () => {
        void openSelfPersonNote(this.app, this);
      },
    });

    this.addCommand({
      id: "add-log",
      name: "Append to Daily note",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
      callback: async () => addDailyLog(this.app, this),
    });

    this.addCommand({
      id: "insert-timestamp",
      name: "Insert timestamp",
      editorCallback: () => {
        insertTimestamp(this.app, this);
      },
    });

    this.addCommand({
      id: "magic-paste",
      name: "Magic Paste",
      callback: () => {
        openMagicPaste(this.app);
      },
    });

    this.addCommand({
      id: "send-to-chatgpt",
      name: "Send to ChatGPT",
      editorCallback: (editor, context) => {
        const markdownView =
          context instanceof MarkdownView
            ? context
            : this.app.workspace.getActiveViewOfType(MarkdownView);

        void sendToChatGPT(this.app, {
          editor,
          view: markdownView,
          includeFrontmatter: this.settings.includeFrontmatterInChatGPT,
        });
      },
    });

    this.addCommand({
      id: "add-geolocation",
      name: "Add Geolocation to Current Note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();

        if (!file || file.extension !== "md") {
          return false;
        }

        if (!checking) {
          void this.applyGeolocationToFile(file, { notify: true });
        }

        return true;
      },
    });

    this.addCommand({
      id: "cancel-geolocation",
      name: "Cancel Geolocation Request",
      checkCallback: (checking) => {
        if (checking) {
          return this.geolocationAbortController !== null;
        }

        if (this.geolocationAbortController) {
          this.geolocationAbortController.abort();
          this.geolocationAbortController = null;
        }

        return true;
      },
    });

    this.addCommand({
      id: "start-voiceover",
      name: "Start Voiceover",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          return false;
        }

        if (!checking) {
          void (async () => {
            const content = await this.app.vault.read(file);
            const activeView =
              this.app.workspace.getActiveViewOfType(MarkdownView);
            const activeEditor =
              activeView?.file?.path === file.path ? activeView.editor : null;
            const selection = activeEditor?.getSelection?.() ?? "";

            // If there's a selection, use it; otherwise use the entire note
            const selectedText = selection.trim() ? selection : null;
            const voiceoverText = buildVoiceoverText(
              content,
              file,
              selectedText
            );

            void this.voiceoverManager?.generateVoiceover(
              file,
              activeEditor ?? null,
              voiceoverText,
              {
                scope: selectedText ? "selection" : "note",
              }
            );
          })();
        }

        return true;
      },
    });

    MONDO_ENTITY_TYPES.forEach((fileType) => {
      const config = getMondoEntityConfig(fileType);
      const label = config?.name ?? fileType;
      this.addCommand({
        id: `open-${fileType}`,
        name: `Open ${label}`,
        callback: () => {
          void this.openEntityPanel(fileType);
        },
      });
      this.addCommand({
        id: `new-${fileType}`,
        name: `New ${label}`,
        callback: () => {
          void this.createEntityNote(fileType);
        },
      });
    });

    // Journal navigation (previous / next)
    const journalMove = journalMoveFactory(this.app, this);

    this.addCommand({
      id: "journal-prev",
      name: "Move to Previous Journal Entry",
      callback: () => journalMove("prev"),
    });

    this.addCommand({
      id: "journal-next",
      name: "Move to Next Journal Entry",
      callback: () => journalMove("next"),
    });

    this.addCommand({
      id: "open-mondo-settings",
      name: "Open Mondo settings",
      callback: () => {
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById(this.manifest.id);
      },
    });

    this.registerMarkdownCodeBlockProcessor(
      "mondo",
      async (...args) => new MondoInlineViewWrapper(this.app, ...args)
    );

    this.registerMarkdownPostProcessor((element, context) => {
      this.audioTranscriptionManager?.decorateMarkdown(element, context);
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        this.extendFileMenu(menu, file, source);
      })
    );

    // this.registerView(
    //   MONDO_SIDE_VIEW,
    //   (leaf) => new MondoSideViewWrapper(leaf, MONDO_ICON)
    // );

    this.registerView(
      DASHBOARD_VIEW,
      (leaf) => new MondoDashboardViewWrapper(leaf, MONDO_ICON)
    );

    this.registerView(
      AUDIO_LOGS_VIEW,
      (leaf) => new MondoAudioLogsViewWrapper(this, leaf, AUDIO_LOGS_ICON)
    );

    this.registerView(
      VAULT_IMAGES_VIEW,
      (leaf) => new MondoVaultImagesViewWrapper(leaf, VAULT_IMAGES_ICON)
    );

    this.registerView(
      VAULT_FILES_VIEW,
      (leaf) => new MondoVaultFilesViewWrapper(leaf, VAULT_FILES_ICON)
    );

    this.registerView(
      VAULT_NOTES_VIEW,
      (leaf) => new MondoVaultNotesViewWrapper(leaf, VAULT_NOTES_ICON)
    );

    this.registerView(
      ENTITY_PANEL_VIEW,
      (leaf) => new MondoEntityPanelViewWrapper(leaf, MONDO_ICON)
    );

    if (Platform.isDesktopApp) {
      this.audioLogsRibbonEl = this.addRibbonIcon(
        AUDIO_LOGS_ICON,
        "Open Audio Logs",
        () => {
          void this.showPanel(AUDIO_LOGS_VIEW, "main");
        }
      );
    }

    // Auto open/close panels based on context (debounced)
    this.app.workspace.onLayoutReady(async () => {
      await this.focusDashboardOnStartup();
      await this.syncPanels();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.dailyNoteTracker?.handleFileOpened(file);
        void this.syncPanels();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.syncPanels();
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        void this.syncPanels();
      })
    );
    this.registerDomEvent(window, "focus", () => {
      void this.syncPanels();
    });

    // Inject journal navigational components (pass plugin so handler can read settings)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", injectJournalNav(this))
    );

    // Inject a small "Hello World" div for Mondo-type notes (company/person/project/team)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", injectMondoLinks(this))
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView)) {
          return;
        }

        const file = view.file;
        if (!file) {
          return;
        }

        const resolvedEditor = editor ?? view.editor ?? null;
        const selection = resolvedEditor?.getSelection?.() ?? "";
        if (!selection.trim()) {
          return;
        }

        menu.addItem((item) => {
          item.setTitle("Start Voiceover");
          item.setIcon("file-audio");
          item.onClick(() => {
            const selection = resolvedEditor?.getSelection?.() ?? "";
            if (selection.trim()) {
              void this.voiceoverManager?.generateVoiceover(
                file,
                resolvedEditor,
                selection,
                { scope: "selection" }
              );
            }
          });
        });
      })
    );
  }

  onunload() {
    console.log("Mondo: Unloading plugin");

    // No config manager to dispose; settings-based config only
    this.mondoConfigManager = null;

    resetFocusMode(this.app);

    // Cleanup the Mondo file manager
    const fileManager = MondoFileManager.getInstance(this.app);
    fileManager.cleanup();

    this.app.workspace
      .getLeavesOfType(DASHBOARD_VIEW)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(ENTITY_PANEL_VIEW)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(AUDIO_LOGS_VIEW)
      .forEach((leaf) => leaf.detach());

    this.audioLogsRibbonEl?.remove();
    this.audioLogsRibbonEl = null;

    disposeMondoLinkInjections();

    this.audioTranscriptionManager?.dispose();
    this.audioTranscriptionManager = null;

    this.voiceoverManager?.dispose();
    this.voiceoverManager = null;

    this.noteDictationManager?.dispose();
    this.noteDictationManager = null;

    this.timestampToolbarManager?.dispose();
    this.timestampToolbarManager = null;
  }

  getAudioTranscriptionManager(): AudioTranscriptionManager | null {
    return this.audioTranscriptionManager;
  }

  private extendFileMenu(menu: Menu, file: TAbstractFile, source?: string) {
    if (!(file instanceof TFile)) {
      return;
    }

    if (file.extension === "md") {
      const commandId = `${this.manifest.id}:start-voiceover`;
      const commandSources = new Set([
        "view-header",
        "more-options",
        "inline-title",
        "tab-header",
      ]);

      menu.addItem((item) => {
        item.setTitle("Start Voiceover");
        item.setIcon("file-audio");
        item.onClick(() => {
          if (commandSources.has(source ?? "")) {
            const commands = (
              this.app as App & {
                commands?: { executeCommandById?: (id: string) => boolean };
              }
            ).commands;
            if (commands?.executeCommandById) {
              void commands.executeCommandById(commandId);
            }
            return;
          }

          void (async () => {
            const content = await this.app.vault.read(file);
            const activeView =
              this.app.workspace.getActiveViewOfType(MarkdownView);
            const activeEditor =
              activeView?.file?.path === file.path ? activeView.editor : null;
            const voiceoverText = buildVoiceoverText(content, file);
            void this.voiceoverManager?.generateVoiceover(
              file,
              activeEditor ?? null,
              voiceoverText,
              { scope: "note" }
            );
          })();
        });
      });
    }

    if (!this.audioTranscriptionManager) {
      return;
    }

    if (!this.audioTranscriptionManager.isAudioFile(file)) {
      return;
    }

    const inProgress =
      this.audioTranscriptionManager.isTranscriptionInProgress(file);

    menu.addItem((item) => {
      item.setTitle(inProgress ? "Transcribing audio…" : "Transcribe audio");
      item.setIcon(inProgress ? "loader-2" : "wand-2");
      if (inProgress) {
        item.setDisabled(true);
        return;
      }

      item.onClick(() => {
        void this.audioTranscriptionManager?.transcribeAudioFile(
          file,
          source ?? file.path
        );
      });
    });

    if (this.audioTranscriptionManager.hasExistingTranscription(file)) {
      menu.addItem((item) => {
        item.setTitle("Open transcription");
        item.setIcon("file-text");
        item.onClick(() => {
          this.audioTranscriptionManager?.openTranscription(
            file,
            source ?? file.path
          );
        });
      });
    }
  }

  private async createEntityNote(
    entityType: MondoFileType
  ): Promise<TFile | null> {
    const config = getMondoEntityConfig(entityType);
    const label = config?.name ?? entityType;

    const sanitizeFileBase = (value: string): string =>
      value
        .replace(/[<>:"/\\|?*]/g, "-")
        .replace(/\s+/g, " ")
        .replace(/[\r\n]+/g, " ")
        .trim();

    try {
      const now = new Date();
      const settings = this.settings as {
        rootPaths?: Partial<Record<MondoFileType, string>>;
        templates?: Partial<Record<MondoFileType, string>>;
      };

      const folderSetting = settings.rootPaths?.[entityType] ?? "/";
      const normalizedFolder = normalizeFolderPath(folderSetting);
      if (normalizedFolder) {
        const existingFolder =
          this.app.vault.getAbstractFileByPath(normalizedFolder);
        if (!existingFolder) {
          await this.app.vault.createFolder(normalizedFolder);
        }
      }

      const displayBase =
        `Untitled ${label}`.replace(/\s+/g, " ").trim() || "Untitled";
      const fileBaseRoot =
        sanitizeFileBase(displayBase) || `untitled-${Date.now()}`;

      let attempt = 0;
      let filename = "";
      let filePath = "";
      let displayTitle = displayBase;

      while (true) {
        const suffix = attempt === 0 ? "" : `-${attempt}`;
        const titleSuffix = attempt === 0 ? "" : ` ${attempt + 1}`;
        filename = `${fileBaseRoot}${suffix}.md`;
        filePath = normalizedFolder
          ? `${normalizedFolder}/${filename}`
          : filename;
        displayTitle = `${displayBase}${titleSuffix}`.trim();
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (!existing) {
          break;
        }
        attempt += 1;
      }

      const isoTimestamp = now.toISOString();
      const templateSource = await getTemplateForType(
        this.app,
        settings.templates ?? {},
        entityType
      );
      const slugValue =
        slugify(displayTitle) || slugify(fileBaseRoot) || `${Date.now()}`;

      const content = renderTemplate(templateSource, {
        title: displayTitle,
        type: String(entityType),
        filename,
        slug: slugValue,
        date: isoTimestamp,
        datetime: isoTimestamp,
      });

      const created = (await this.app.vault.create(filePath, content)) as TFile;

      const leaf = this.app.workspace.getLeaf(true);
      if (leaf) {
        await (leaf as any).openFile(created);
        focusAndSelectTitle(leaf);
      }

      new Notice(`Created new ${label} note.`);
      return created;
    } catch (error) {
      console.error(`Mondo: failed to create ${label} note`, error);
      new Notice(`Failed to create ${label} note.`);
      return null;
    }
  }

  private async openEntityPanel(entityType: MondoFileType) {
    const state: MondoEntityPanelViewState = { entityType };
    if (!getMondoEntityConfig(entityType)) {
      console.warn(
        "Mondo: attempted to open panel for unknown type",
        entityType
      );
      return;
    }
    await this.showPanel(ENTITY_PANEL_VIEW, "main", {
      state,
      reuseMatching: (leaf) => {
        const viewState = leaf.getViewState();
        const entityState = viewState.state as
          | MondoEntityPanelViewState
          | undefined;
        return entityState?.entityType === entityType;
      },
    });
  }

  async showPanel(
    viewType: string,
    placement: "main" | "left" | "right" | "current",
    options?: PanelOpenOptions
  ) {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(viewType);
    let leaf: WorkspaceLeaf | null = null;

    if (options?.reuseMatching) {
      leaf = leaves.find(options.reuseMatching) ?? null;
    } else {
      leaf = leaves[0] ?? null;
    }

    if (!leaf) {
      switch (placement) {
        case "main":
          leaf = workspace.getLeaf(true);
          break;
        case "current":
          leaf = workspace.getLeaf(false);
          break;
        case "left":
          leaf = workspace.getLeftLeaf(false);
          break;
        case "right":
          leaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
          break;
      }
    }

    if (!leaf) {
      return;
    }

    const viewState: ViewState = options?.state
      ? { type: viewType, active: true, state: options.state }
      : { type: viewType, active: true };

    await leaf.setViewState(viewState);
    workspace.revealLeaf(leaf);
  }

  private async syncPanels() {
    const ws = this.app.workspace;

    const hasAnyNote = ws.getLeavesOfType("markdown").length > 0;
    const forceDashboardTab = Boolean(this.settings?.dashboard?.forceTab);

    if (!hasAnyNote) {
      deactivateFocusMode(this.app, "journal");

      if (!forceDashboardTab) {
        return;
      }

      const dashboardOpen = ws.getLeavesOfType(DASHBOARD_VIEW).length > 0;
      if (!dashboardOpen) {
        await this.showPanel(DASHBOARD_VIEW, "main");
      }

      if (!isFocusModeActive() && !Platform.isMobileApp) {
        ws.leftSplit?.expand?.();
      }
      ws.rightSplit?.collapse?.();
      return;
    }

    const activeLeaf = ws.activeLeaf ?? null;
    const focusedTab =
      activeLeaf?.view?.getViewType?.() ??
      activeLeaf?.getViewState?.()?.type ??
      null;

    if (focusedTab === "dashboard-view") {
      ws.rightSplit?.collapse?.();
    }

    const normalize = (value?: string) =>
      (value ?? "").replace(/^\/+|\/+$/g, "");
    const journalRoot = normalize(
      this.settings?.journal?.root ?? DEFAULT_MONDO_JOURNAL_SETTINGS.root
    );
    const activeFile = this.app.workspace.getActiveFile();
    const activePath = normalize(activeFile?.path);
    const isJournal =
      activePath.startsWith(journalRoot) && activePath.length > 0;

    if (isJournal) {
      activateFocusMode(this.app, "journal");
      return;
    }

    deactivateFocusMode(this.app, "journal");

    if (!isFocusModeActive() && !Platform.isMobileApp) {
      ws.leftSplit?.expand?.();
    }
  }

  private async focusDashboardOnStartup() {
    if (!this.settings?.dashboard?.openAtBoot) return;
    if (this.hasFocusedDashboardOnStartup) return;
    this.hasFocusedDashboardOnStartup = true;
    await this.showPanel(DASHBOARD_VIEW, "main");
  }

  getVoiceoverManager = () => this.voiceoverManager;

  getNoteDictationManager = () => this.noteDictationManager;
}
