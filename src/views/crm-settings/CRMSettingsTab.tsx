import {
  PluginSettingTab,
  Setting,
  App,
  TFolder,
  AbstractInputSuggest,
} from "obsidian";
import type CRM from "@/main";
import {
  CRMFileType,
  CRM_FILE_TYPES,
  getCRMEntityConfig,
} from "@/types/CRMFileType";
import { CRM_DEFAULT_TEMPLATES } from "@/templates";
import { getSupportedOpenAIModels } from "@/utils/VoiceNoteEditor";

// Settings tab for CRM plugin
export class CRMSettingsTab extends PluginSettingTab {
  plugin: CRM;

  constructor(app: App, plugin: CRM) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Use core settings heading for consistency with Obsidian UI
    new Setting(containerEl)
      .setName("Entity Paths")
      .setDesc("Group your entities by folder to boost performances.")
      .setHeading();

    // Ensure settings object exists
    (this.plugin as any).settings = (this.plugin as any).settings ?? {
      rootPaths: Object.fromEntries(
        CRM_FILE_TYPES.map((t) => [String(t), "/"])
      ),
    };
    // Ensure journal/daily settings exist with sensible defaults
    (this.plugin as any).settings.inbox =
      (this.plugin as any).settings.inbox ?? "Inbox";
    (this.plugin as any).settings.journal = (this.plugin as any).settings
      .journal ?? { root: "Journal", entry: "YYYY-MM-DD" };
    (this.plugin as any).settings.daily = (this.plugin as any).settings
      .daily ?? { root: "Daily", entry: "YYYY-MM-DD", note: "HH:MM" };
    (this.plugin as any).settings.templates =
      (this.plugin as any).settings.templates ??
      Object.fromEntries(CRM_FILE_TYPES.map((t) => [String(t), ""]));
    // Helper: collect folder paths from the vault
    const collectFolderPaths = (root: TFolder, out: string[] = []) => {
      out.push(root.path === "" ? "/" : root.path);
      for (const child of root.children) {
        if (child instanceof TFolder) collectFolderPaths(child as TFolder, out);
      }
      return out;
    };

    // Use Obsidian's AbstractInputSuggest pattern via Setting.addSearch for native UX
    const folderPaths = collectFolderPaths(this.app.vault.getRoot() as TFolder);

    // Implement a suggest class for the input element using API export
    class FolderSuggest extends AbstractInputSuggest<string> {
      private _onPick?: (item: string) => void;
      constructor(
        app: App,
        inputEl: HTMLInputElement,
        onPick?: (item: string) => void
      ) {
        super(app, inputEl);
        this._onPick = onPick;
      }

      getSuggestions(query: string) {
        const q = query.toLowerCase();
        return folderPaths.filter((p) => p.toLowerCase().includes(q));
      }

      renderSuggestion(item: string, el: HTMLElement) {
        el.setText(item);
      }

      selectSuggestion(item: string) {
        // Prefer callback to set the value via the SearchComponent
        if (this._onPick) {
          try {
            this._onPick(item);
          } catch (e) {}
        } else {
          const input = (this as any).inputEl as HTMLInputElement | undefined;
          if (input) {
            input.value = item;
            // Trigger input/change so Setting.onChange handlers fire
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }

        // Close the suggest UI
        try {
          (this as any).close();
        } catch (e) {
          // ignore
        }
      }
    }

    const addFolderSetting = (
      name: string,
      desc: string,
      getValue: () => string,
      setValue: (v: string) => Promise<void>
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addSearch((s) => {
          s.setPlaceholder("/")
            .setValue(getValue() ?? "/")
            .onChange(async (v) => {
              await setValue(v || "/");
            });

          // Attach native suggest to the input element
          // AbstractInputSuggest expects the global Obsidian to exist
          try {
            const sugg = new FolderSuggest(
              this.app,
              s.inputEl as HTMLInputElement,
              async (picked: string) => {
                // Update UI
                try {
                  s.setValue(picked);
                } catch (e) {
                  s.inputEl.value = picked;
                  s.inputEl.dispatchEvent(
                    new Event("input", { bubbles: true })
                  );
                  s.inputEl.dispatchEvent(
                    new Event("change", { bubbles: true })
                  );
                }

                // Persist via the provided setter
                try {
                  await setValue(picked || "/");
                } catch (e) {
                  // ignore persistence errors here
                }
              }
            );
            // Keep a reference to avoid GC and allow later cleanup
            (this as any)._suggesters = (this as any)._suggesters || [];
            (this as any)._suggesters.push(sugg);
          } catch (e) {
            // Fallback: no suggest available
          }
        });
    };

    const entityDefinitions = CRM_FILE_TYPES.map((type) => {
      const config = getCRMEntityConfig(type);
      return {
        type,
        label: config?.name ?? type,
        entityHelper: config?.settings.entity.helper ?? "",
        templateHelper: config?.settings.template.helper ?? "",
      };
    });

    for (const { label, type, entityHelper } of entityDefinitions) {
      addFolderSetting(
        label,
        entityHelper || `type=${type}`,
        () => (this.plugin as any).settings.rootPaths[type],
        async (v) => {
          (this.plugin as any).settings.rootPaths[type] = v || "/";
          await (this.plugin as any).saveSettings();
        }
      );
    }

    new Setting(containerEl)
      .setName("Entity Templates")
      .setDesc(
        "Customize the content inserted when creating new CRM entities. Variables: {{title}}, {{type}}, {{filename}}, {{slug}}, {{date}}, {{time}}, {{datetime}}. Use {{date:YYYY-MM-DD}} or {{time:HH:mm}} for custom formatting. Leave blank to fallback to the default template."
      )
      .setHeading();

    for (const { label, type, templateHelper } of entityDefinitions) {
      new Setting(containerEl)
        .setName(label)
        .setDesc(templateHelper || `Template for new ${label.toLowerCase()} notes.`)
        .addTextArea((textarea) => {
          textarea
            .setPlaceholder(CRM_DEFAULT_TEMPLATES[type])
            .setValue(
              (this.plugin as any).settings.templates?.[type] ?? ""
            )
            .onChange(async (value) => {
              (this.plugin as any).settings.templates =
                (this.plugin as any).settings.templates || {};
              (this.plugin as any).settings.templates[type] = value;
              await (this.plugin as any).saveSettings();
            });

          textarea.inputEl.rows = 6;
          textarea.inputEl.addClass("crm-settings-template");
        });
    }

    new Setting(containerEl)
      .setName("Audio Transcription")
      .setDesc("Configure AI transcription for embedded audio.")
      .setHeading();

    new Setting(containerEl)
      .setName("OpenAI Whisper API key")
      .setDesc(
        "Used to transcribe embedded audio with OpenAI Whisper-compatible models."
      )
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
          .setValue(
            (this.plugin as any).settings.openAIWhisperApiKey?.toString?.() ?? ""
          )
          .onChange(async (value) => {
            (this.plugin as any).settings.openAIWhisperApiKey = value.trim();
            await (this.plugin as any).saveSettings();
          });

        try {
          (text.inputEl as HTMLInputElement).type = "password";
        } catch (e) {}
      });

    const openAIModels = getSupportedOpenAIModels();

    new Setting(containerEl)
      .setName("OpenAI model")
      .setDesc(
        "Select the OpenAI model that will update notes after voice transcription."
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions(openAIModels);
        const value = (this.plugin as any).settings.openAIModel ?? "gpt-5o-mini";
        dropdown.setValue(
          Object.prototype.hasOwnProperty.call(openAIModels, value)
            ? value
            : "gpt-5o-mini"
        );
        dropdown.onChange(async (model) => {
          (this.plugin as any).settings.openAIModel = model;
          await (this.plugin as any).saveSettings();
        });
      });

    // Daily Logs section
    new Setting(containerEl)
      .setName("Daily Logs")
      .setDesc("Settings for Daily Logs")
      .setHeading();

    addFolderSetting(
      "Daily root",
      "Where do you want to store your Daily Logs?\n(Default: Daily)",
      () => (this.plugin as any).settings.daily?.root ?? "Daily",
      async (v) => {
        (this.plugin as any).settings.daily =
          (this.plugin as any).settings.daily || {};
        (this.plugin as any).settings.daily.root = v || "Daily";
        await (this.plugin as any).saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Entry format")
      .setDesc("Filename format for daily entries (default: YYYY-MM-DD)")
      .addText((t) => {
        t.setPlaceholder("YYYY-MM-DD")
          .setValue((this.plugin as any).settings.daily?.entry ?? "YYYY-MM-DD")
          .onChange(async (v) => {
            (this.plugin as any).settings.daily =
              (this.plugin as any).settings.daily || {};
            (this.plugin as any).settings.daily.entry = v || "YYYY-MM-DD";
            await (this.plugin as any).saveSettings();
          });
        try {
          (t.inputEl as HTMLInputElement).style.textAlign = "right";
        } catch (e) {}
      });

    new Setting(containerEl)
      .setName("Section Level")
      .setDesc("Heading level used for daily notes (default: h2)")
      .addDropdown((d) => {
        const opts: Record<string, string> = {
          h1: "H1",
          h2: "H2",
          h3: "H3",
          h4: "H4",
          h5: "H5",
          h6: "H6",
        };
        const current = (this.plugin as any).settings.daily?.section ?? "h2";
        d.addOptions(opts)
          .setValue(current)
          .onChange(async (v) => {
            (this.plugin as any).settings.daily =
              (this.plugin as any).settings.daily || {};
            (this.plugin as any).settings.daily.section = v;
            await (this.plugin as any).saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Section Title")
      .setDesc("Time format for notes inside daily logs (default: HH:MM)")
      .addText((t) => {
        t.setPlaceholder("HH:MM")
          .setValue((this.plugin as any).settings.daily?.note ?? "HH:MM")
          .onChange(async (v) => {
            (this.plugin as any).settings.daily =
              (this.plugin as any).settings.daily || {};
            (this.plugin as any).settings.daily.note = v || "HH:MM";
            await (this.plugin as any).saveSettings();
          });
        try {
          (t.inputEl as HTMLInputElement).style.textAlign = "right";
        } catch (e) {}
      });

    // New: toggle for inserting bullets in daily logs
    const dailyUseBullets = (this.plugin as any).settings.daily?.useBullets;
    new Setting(containerEl)
      .setName("Use bullets for entries")
      .setDesc(
        "If enabled, new daily entries will be prefixed with a bullet ('- ')."
      )
      .addToggle((t) => {
        t.setValue(dailyUseBullets ?? true).onChange(async (v) => {
          (this.plugin as any).settings.daily =
            (this.plugin as any).settings.daily || {};
          (this.plugin as any).settings.daily.useBullets = v;
          await (this.plugin as any).saveSettings();
        });
      });

    // Journal section
    new Setting(containerEl)
      .setName("Journal")
      .setDesc("Settings for the Journal feature")
      .setHeading();

    addFolderSetting(
      "Journal root",
      "Where do you want to store your Journaling notes?\n(Default: Journal)",
      () => (this.plugin as any).settings.journal?.root ?? "Journal",
      async (v) => {
        (this.plugin as any).settings.journal =
          (this.plugin as any).settings.journal || {};
        (this.plugin as any).settings.journal.root = v || "Journal";
        await (this.plugin as any).saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Entry format")
      .setDesc("Filename format for journal entries (default: YYYY-MM-DD)")
      .addText((t) => {
        t.setPlaceholder("YYYY-MM-DD")
          .setValue(
            (this.plugin as any).settings.journal?.entry ?? "YYYY-MM-DD"
          )
          .onChange(async (v) => {
            (this.plugin as any).settings.journal =
              (this.plugin as any).settings.journal || {};
            (this.plugin as any).settings.journal.entry = v || "YYYY-MM-DD";
            await (this.plugin as any).saveSettings();
          });
        try {
          (t.inputEl as HTMLInputElement).style.textAlign = "right";
        } catch (e) {}
      });

    // Journal sections toggle + conditional settings
    const journalUseSections =
      (this.plugin as any).settings.journal?.useSections ?? false;

    new Setting(containerEl)
      .setName("Enable Sections")
      .setDesc("Organize your journal by time entries")
      .addToggle((t) => {
        t.setValue(journalUseSections).onChange(async (v) => {
          (this.plugin as any).settings.journal =
            (this.plugin as any).settings.journal || {};
          (this.plugin as any).settings.journal.useSections = v;
          await (this.plugin as any).saveSettings();
          // Re-render settings so conditional fields appear/disappear
          this.display();
        });
      });

    if (journalUseSections) {
      new Setting(containerEl)
        .setName("Section Level")
        .setDesc("Heading level used for journal notes (default: h3)")
        .addDropdown((d) => {
          const opts: Record<string, string> = {
            inline: "Inline",
            h1: "H1",
            h2: "H2",
            h3: "H3",
            h4: "H4",
            h5: "H5",
            h6: "H6",
          };
          const current =
            (this.plugin as any).settings.journal?.section ?? "h3";
          d.addOptions(opts)
            .setValue(current)
            .onChange(async (v) => {
              (this.plugin as any).settings.journal =
                (this.plugin as any).settings.journal || {};
              (this.plugin as any).settings.journal.section = v;
              await (this.plugin as any).saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Section Title")
        .setDesc(
          "Time format for notes inside journal entries (default: HH:MM)"
        )
        .addText((t) => {
          t.setPlaceholder("HH:MM")
            .setValue((this.plugin as any).settings.journal?.note ?? "HH:MM")
            .onChange(async (v) => {
              (this.plugin as any).settings.journal =
                (this.plugin as any).settings.journal || {};
              (this.plugin as any).settings.journal.note = v || "HH:MM";
              await (this.plugin as any).saveSettings();
            });
          try {
            (t.inputEl as HTMLInputElement).style.textAlign = "right";
          } catch (e) {}
        });
    }
  }
}
