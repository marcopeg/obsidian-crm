import { App, MarkdownView, Modal, Notice, TFile } from "obsidian";

const cleanMagicPasteContent = (value: string): string => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const previous = cleanedLines[cleanedLines.length - 1];

    if (line.trim() === "" && previous?.trim() === "") {
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n");
};

const insertContentIntoActiveNote = async (app: App, value: string) => {
  const view = app.workspace.getActiveViewOfType(MarkdownView);

  if (view?.editor) {
    view.editor.replaceSelection(value);
    return true;
  }

  const activeFile = app.workspace.getActiveFile();

  if (!activeFile || !(activeFile instanceof TFile)) {
    return false;
  }

  const existingContent = await app.vault.read(activeFile);
  const needsSeparator = existingContent.length > 0 && !existingContent.endsWith("\n");
  const contentToAppend = needsSeparator ? `\n${value}` : value;

  await app.vault.append(activeFile, contentToAppend);
  return true;
};

class MagicPasteModal extends Modal {
  private textareaEl: HTMLTextAreaElement | null = null;

  onOpen = () => {
    const { contentEl, titleEl } = this;

    titleEl.setText("Magic Paste");
    contentEl.empty();
    contentEl.addClass("mondo-magic-paste");

    const descriptionEl = contentEl.createEl("p", {
      text: "Paste content below to clean up unwanted blank lines before inserting.",
    });
    descriptionEl.addClass("mondo-magic-paste__description");

    this.textareaEl = contentEl.createEl("textarea", {
      cls: "mondo-magic-paste__input",
      attr: {
        placeholder: "Paste content here...",
      },
    });

    this.textareaEl.spellcheck = false;

    const actionsEl = contentEl.createDiv({
      cls: "mondo-magic-paste__actions",
    });

    const insertButton = actionsEl.createEl("button", {
      text: "Insert",
      cls: "mod-cta",
    });

    insertButton.addEventListener("click", () => {
      void this.handleInsert();
    });

    const cancelButton = actionsEl.createEl("button", {
      text: "Cancel",
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });

    window.setTimeout(() => {
      this.textareaEl?.focus();
    }, 50);
  };

  onClose = () => {
    this.contentEl.empty();
    this.textareaEl = null;
  };

  private handleInsert = async () => {
    const value = this.textareaEl?.value ?? "";
    const cleaned = cleanMagicPasteContent(value);

    if (!cleaned) {
      this.close();
      return;
    }

    const inserted = await insertContentIntoActiveNote(this.app, cleaned);

    if (!inserted) {
      new Notice("Open or focus a note to insert content.");
      return;
    }

    this.close();
  };
}

export const openMagicPaste = (app: App) => {
  const modal = new MagicPasteModal(app);
  modal.open();
};
