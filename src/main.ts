import { Plugin, type ViewState, type WorkspaceLeaf } from "obsidian";
import {
  CRMDashboardViewWrapper,
  CRM_DASHBOARD_VIEW,
} from "@/views/crm-dashboard-view/wrapper";
import {
  CRMEntityPanelViewWrapper,
  CRM_ENTITY_PANEL_VIEW,
  type CRMEntityPanelViewState,
} from "@/views/crm-entity-panel-view/wrapper";
import { CRMInlineViewWrapper } from "@/views/crm-inline-view/wrapper";
import { CRMSettingsTab } from "@/views/crm-settings/CRMSettingsTab";
import { CRMFileManager } from "@/utils/CRMFileManager";
import { AudioTranscriptionManager } from "@/utils/AudioTranscriptionManager";
import { VoiceNoteEditor } from "@/utils/VoiceNoteEditor";
import {
  CRMFileType,
  CRM_FILE_TYPES,
  getCRMEntityConfig,
} from "@/types/CRMFileType";
import {
  DEFAULT_CRM_JOURNAL_SETTINGS,
  DEFAULT_CRM_DAILY_SETTINGS,
} from "@/types/CRMOtherPaths";
import { openJournal } from "@/commands/journal.open";
import { addDailyLog } from "@/commands/daily.addLog";
import { journalMoveFactory } from "@/commands/journal.nav";
import { injectJournalNav } from "@/events/inject-journal-nav";
import {
  injectCRMLinks,
  disposeCRMLinkInjections,
} from "@/events/inject-crm-links";

// Dev purposes: set to true to always focus on dashboard on startup
const focusOnDashboard = false;

const CRM_ICON = "anchor";

type PanelOpenOptions = {
  state?: Record<string, unknown>;
  reuseMatching?: (leaf: WorkspaceLeaf) => boolean;
};

export default class CRM extends Plugin {
  // Settings shape and defaults
  settings: any = {
    // default rootPaths: map every known CRM type to '/'
    rootPaths: Object.fromEntries(CRM_FILE_TYPES.map((t) => [String(t), "/"])),
    journal: DEFAULT_CRM_JOURNAL_SETTINGS,
    daily: DEFAULT_CRM_DAILY_SETTINGS,
    templates: Object.fromEntries(CRM_FILE_TYPES.map((t) => [String(t), ""])),
    openAIWhisperApiKey: "",
    openAIModel: "gpt-5o-mini",
  };

  private hasFocusedDashboardOnStartup = false;

  private audioTranscriptionManager: AudioTranscriptionManager | null = null;

  private voiceNoteEditor: VoiceNoteEditor | null = null;

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign(this.settings, data ?? {});

    this.settings.rootPaths = Object.assign(
      Object.fromEntries(CRM_FILE_TYPES.map((t) => [String(t), "/"])),
      this.settings.rootPaths ?? {}
    );

    this.settings.templates = Object.assign(
      Object.fromEntries(CRM_FILE_TYPES.map((t) => [String(t), ""])),
      this.settings.templates ?? {}
    );

    this.settings.openAIWhisperApiKey = this.settings.openAIWhisperApiKey ?? "";
    this.settings.openAIModel = this.settings.openAIModel ?? "gpt-5o-mini";
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onload() {
    console.clear();
    console.log("CRM: Loading plugin");

    // Initialize settings
    this.addSettingTab(new CRMSettingsTab(this.app, this));
    await this.loadSettings();

    this.audioTranscriptionManager = new AudioTranscriptionManager(this);
    this.audioTranscriptionManager.initialize();

    this.voiceNoteEditor = new VoiceNoteEditor(this);
    this.voiceNoteEditor.initialize();

    // Initialize the CRM file manager in the background (non-blocking)
    const fileManager = CRMFileManager.getInstance(this.app);
    fileManager.initialize().catch((err) => {
      console.error("CRM: Failed to initialize file manager:", err);
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open CRM Dashboard",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }], // Cmd/Ctrl+Shift+M (user can change later)
      callback: () => this.showPanel(CRM_DASHBOARD_VIEW, "main"),
    });

    this.addCommand({
      id: "crm-transcribe-audio-note",
      name: "Transcribe",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();

        if (
          !file ||
          !this.audioTranscriptionManager?.isAudioFile(file)
        ) {
          return false;
        }

        if (!checking) {
          void this.audioTranscriptionManager?.transcribeAudioFile(file);
        }

        return true;
      },
    });

    this.addCommand({
      id: "open-journal",
      name: "Open Journal",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "j" }],
      callback: async () => {
        try {
          await openJournal(this.app, this);
        } catch (e) {
          console.error("CRM: Failed to open journal:", e);
        }
      },
    });

    this.addCommand({
      id: "add-log",
      name: "Add Log",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
      callback: async () => {
        try {
          await addDailyLog(this.app, this);
        } catch (e) {
          console.error("CRM: Failed to add daily log:", e);
        }
      },
    });

    CRM_FILE_TYPES.forEach((fileType) => {
      const config = getCRMEntityConfig(fileType);
      const label = config?.name ?? fileType;
      this.addCommand({
        id: `open-${fileType}`,
        name: `Open ${label}`,
        callback: () => {
          void this.openEntityPanel(fileType);
        },
      });
    });

    // this.addCommand({
    //   id: "crm-open-side-panel",
    //   name: "Open CRM Panel",
    //   callback: () => this.showPanel(CRM_SIDE_VIEW, "right"),
    // });

    // Journal navigation (previous / next)
    const journalMove = journalMoveFactory(this.app, this);

    this.addCommand({
      id: "crm-journal-prev",
      name: "Move to Previous Journal Entry",
      callback: () => journalMove("prev"),
    });

    this.addCommand({
      id: "crm-journal-next",
      name: "Move to Next Journal Entry",
      callback: () => journalMove("next"),
    });

    this.registerMarkdownCodeBlockProcessor(
      "crm",
      async (...args) => new CRMInlineViewWrapper(this.app, ...args)
    );

    // this.registerView(
    //   CRM_SIDE_VIEW,
    //   (leaf) => new CRMSideViewWrapper(leaf, CRM_ICON)
    // );

    this.registerView(
      CRM_DASHBOARD_VIEW,
      (leaf) => new CRMDashboardViewWrapper(leaf, CRM_ICON)
    );

    this.registerView(
      CRM_ENTITY_PANEL_VIEW,
      (leaf) => new CRMEntityPanelViewWrapper(leaf, CRM_ICON)
    );

    // Auto open/close panels based on context (debounced)
    this.app.workspace.onLayoutReady(async () => {
      await this.focusDashboardOnStartup();
      await this.syncPanels();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.voiceNoteEditor?.syncWithActiveLeaf();
        void this.syncPanels();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.voiceNoteEditor?.syncWithActiveLeaf();
        void this.syncPanels();
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.voiceNoteEditor?.syncWithActiveLeaf();
        void this.syncPanels();
      })
    );
    this.registerDomEvent(window, "focus", () => {
      this.voiceNoteEditor?.syncWithActiveLeaf();
      void this.syncPanels();
    });

    this.app.workspace.onLayoutReady(() => {
      this.voiceNoteEditor?.syncWithActiveLeaf();
    });

    // Inject journal navigational components (pass plugin so handler can read settings)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", injectJournalNav(this))
    );

    // Inject a small "Hello World" div for CRM-type notes (company/person/project/team)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", injectCRMLinks(this))
    );
  }

  onunload() {
    console.log("CRM: Unloading plugin");

    // Cleanup the CRM file manager
    const fileManager = CRMFileManager.getInstance(this.app);
    fileManager.cleanup();

    this.app.workspace
      .getLeavesOfType(CRM_DASHBOARD_VIEW)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(CRM_ENTITY_PANEL_VIEW)
      .forEach((leaf) => leaf.detach());

    disposeCRMLinkInjections();

    this.audioTranscriptionManager?.dispose();
    this.audioTranscriptionManager = null;

    this.voiceNoteEditor?.dispose();
    this.voiceNoteEditor = null;
  }

  private async openEntityPanel(entityType: CRMFileType) {
    const state: CRMEntityPanelViewState = { entityType };
    if (!getCRMEntityConfig(entityType)) {
      console.warn("CRM: attempted to open panel for unknown type", entityType);
      return;
    }
    await this.showPanel(CRM_ENTITY_PANEL_VIEW, "main", {
      state,
      reuseMatching: (leaf) => {
        const viewState = leaf.getViewState();
        const entityState = viewState.state as
          | CRMEntityPanelViewState
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

    if (!hasAnyNote) {
      const dashboardOpen = ws.getLeavesOfType(CRM_DASHBOARD_VIEW).length > 0;
      if (!dashboardOpen) {
        await this.showPanel(CRM_DASHBOARD_VIEW, "main");
      }

      ws.leftSplit?.expand?.();
      ws.rightSplit?.collapse?.();
      document.body.classList.remove("focus-mode");
      return;
    }

    const activeLeaf = ws.activeLeaf ?? null;
    const focusedTab =
      activeLeaf?.view?.getViewType?.() ??
      activeLeaf?.getViewState?.()?.type ??
      null;

    if (focusedTab === "crm-dashboard-view") {
      ws.rightSplit?.collapse?.();
    }

    const normalize = (value?: string) =>
      (value ?? "").replace(/^\/+|\/+$/g, "");
    const journalRoot = normalize(
      this.settings?.journal?.root ?? DEFAULT_CRM_JOURNAL_SETTINGS.root
    );
    const activeFile = this.app.workspace.getActiveFile();
    const activePath = normalize(activeFile?.path);
    const isJournal =
      activePath.startsWith(journalRoot) && activePath.length > 0;

    if (isJournal) {
      ws.leftSplit?.collapse?.();
      ws.rightSplit?.collapse?.();
      document.body.classList.add("focus-mode");
      return;
    }

    document.body.classList.remove("focus-mode");
    ws.leftSplit?.expand?.();
  }

  private async focusDashboardOnStartup() {
    if (!focusOnDashboard) return;
    if (this.hasFocusedDashboardOnStartup) return;
    this.hasFocusedDashboardOnStartup = true;
    await this.showPanel(CRM_DASHBOARD_VIEW, "main");
  }
}
