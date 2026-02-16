import { App, PluginSettingTab, Setting, FuzzySuggestModal, TFolder, Notice, Modal, setIcon } from "obsidian";
import type TimelinePlugin from "./main";
import { IconPickerModal } from "./modals/IconPickerModal";
import { TimelineDate, type DateFormatStyle } from "./utils/TimelineDate";

export type { DateFormatStyle };

/**
 * Configuration for a single timeline view
 */
export interface TimelineViewConfig {
	id: string;           // Unique identifier (UUID)
	name: string;         // Custom display name
	rootPath: string;     // Root directory path (recursive scan), "" = vault root
	icon?: string;        // Lucide icon name for the tab (defaults to "calendar")
}

export interface TimelinePluginSettings {
	timelineViews: TimelineViewConfig[];
	dateFormat: DateFormatStyle;
}

/**
 * Generate a unique ID for timeline views
 */
export function generateTimelineId(): string {
	return crypto.randomUUID();
}

/**
 * Default "All" timeline that scans entire vault
 */
export function createDefaultAllTimeline(): TimelineViewConfig {
	return {
		id: generateTimelineId(),
		name: "All",
		rootPath: ""
	};
}

export const DEFAULT_SETTINGS: TimelinePluginSettings = {
	timelineViews: [createDefaultAllTimeline()],
	dateFormat: "DD/MM/YYYY"
};

/**
 * Modal for selecting a folder from the vault
 */
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private folders: TFolder[];
	private onSelect: (folder: TFolder | null) => void;

	constructor(app: App, onSelect: (folder: TFolder | null) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Select a folder...");

		// Collect all folders in the vault
		this.folders = this.getAllFolders();
	}

	private getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];
		const rootFolder = this.app.vault.getRoot();
		
		// Add root folder as option (represents entire vault)
		folders.push(rootFolder);

		// Recursively collect all folders
		const collectFolders = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					folders.push(child);
					collectFolders(child);
				}
			}
		};

		collectFolders(rootFolder);

		// Sort alphabetically by path
		folders.sort((a, b) => a.path.localeCompare(b.path));

		return folders;
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		// Root folder shows as "/ (Entire vault)"
		if (folder.path === "/" || folder.path === "") {
			return "/ (Entire vault)";
		}
		return folder.path;
	}

	onChooseItem(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(folder);
	}

	onClose(): void {
		// If modal was closed without selection, call with null
		// Note: onChooseItem is called before onClose when an item is selected
	}
}

export class TimelineSettingTab extends PluginSettingTab {
	plugin: TimelinePlugin;

	constructor(app: App, plugin: TimelinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Date format setting
		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Day-level date display: DD/MM/YYYY (European) or MM/DD/YYYY (US)")
			.addDropdown(dropdown => dropdown
				.addOption("DD/MM/YYYY", "DD/MM/YYYY")
				.addOption("MM/DD/YYYY", "MM/DD/YYYY")
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value as DateFormatStyle;
					TimelineDate.setDateFormat(value as DateFormatStyle);
					await this.plugin.saveSettings();
				}));

		// Header
		containerEl.createEl("h2", { text: "Timeline views" });
		containerEl.createEl("p", {
			text: "Configure timeline views that scan specific directories for timeline items.",
			cls: "setting-item-description"
		});

		// Add new timeline button
		new Setting(containerEl)
			.setName("Add timeline view")
			.setDesc("Create a new timeline view for a specific folder")
			.addButton(button => button
				.setButtonText("Add")
				.setCta()
				.onClick(() => {
					this.showAddTimelineModal();
				}));

		// Separator
		containerEl.createEl("hr");

		// List existing timelines
		const timelineViews = this.plugin.settings.timelineViews;

		if (timelineViews.length === 0) {
			containerEl.createEl("p", {
				text: "No timeline views configured. Click 'Add' to create one.",
				cls: "setting-item-description"
			});
		} else {
			for (const timeline of timelineViews) {
				this.renderTimelineItem(containerEl, timeline);
			}
		}
	}

	private renderTimelineItem(containerEl: HTMLElement, timeline: TimelineViewConfig): void {
		const currentIcon = timeline.icon ?? "calendar";

		const setting = new Setting(containerEl)
			.setName(timeline.name)
			.setDesc(timeline.rootPath === "" ? "Entire vault" : timeline.rootPath);

		// Prepend icon preview to the name element
		const nameEl = setting.nameEl;
		const iconPreview = nameEl.createSpan({ cls: "timeline-setting-icon-preview" });
		setIcon(iconPreview, currentIcon);
		nameEl.prepend(iconPreview);

		// Change icon button
		setting.addButton(button => button
			.setIcon(currentIcon)
			.setTooltip(`Change icon (${currentIcon})`)
			.onClick(() => {
				new IconPickerModal(this.app, async (iconId) => {
					timeline.icon = iconId;
					await this.plugin.saveSettings();
					this.plugin.updateOpenTimelineViews();
					this.display();
				}).open();
			}));

		// Edit name button
		setting.addButton(button => button
			.setIcon("pencil")
			.setTooltip("Edit name")
			.onClick(() => {
				this.showEditNameModal(timeline);
			}));

		// Change folder button
		setting.addButton(button => button
			.setIcon("folder")
			.setTooltip("Change folder")
			.onClick(() => {
				this.showChangeFolderModal(timeline);
			}));

		// Delete button
		setting.addButton(button => button
			.setIcon("trash")
			.setTooltip("Delete")
			.setWarning()
			.onClick(async () => {
				await this.deleteTimeline(timeline.id);
			}));
	}

	private showAddTimelineModal(): void {
		new FolderSuggestModal(this.app, async (folder) => {
			if (!folder) return;

			const rootPath = folder.path === "/" ? "" : folder.path;
			const name = folder.path === "/" || folder.path === "" ? "All" : folder.name;

			const newTimeline: TimelineViewConfig = {
				id: generateTimelineId(),
				name,
				rootPath
			};

			this.plugin.settings.timelineViews.push(newTimeline);
			await this.plugin.saveSettings();
			this.display(); // Refresh the settings tab
		}).open();
	}

	private showEditNameModal(timeline: TimelineViewConfig): void {
		const modal = new EditNameModal(this.app, timeline.name, async (newName) => {
			if (newName && newName.trim()) {
				timeline.name = newName.trim();
				await this.plugin.saveSettings();
				this.display(); // Refresh the settings tab
			}
		});
		modal.open();
	}

	private showChangeFolderModal(timeline: TimelineViewConfig): void {
		new FolderSuggestModal(this.app, async (folder) => {
			if (!folder) return;

			timeline.rootPath = folder.path === "/" ? "" : folder.path;
			await this.plugin.saveSettings();
			this.display(); // Refresh the settings tab
		}).open();
	}

	private async deleteTimeline(timelineId: string): Promise<void> {
		const index = this.plugin.settings.timelineViews.findIndex(t => t.id === timelineId);
		if (index !== -1) {
			// Delete the timeline from settings
			this.plugin.settings.timelineViews.splice(index, 1);
			await this.plugin.saveSettings();
			
			// Delete the timeline cache data
			this.plugin.deleteTimelineCache(timelineId);
			
			this.display(); // Refresh the settings tab
		}
	}
}

/**
 * Simple modal for editing a timeline name
 */
class EditNameModal extends Modal {
	private currentName: string;
	private onSubmit: (newName: string) => void;
	private inputEl: HTMLInputElement | null = null;

	constructor(app: App, currentName: string, onSubmit: (newName: string) => void) {
		super(app);
		this.currentName = currentName;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Edit timeline name" });

		const inputContainer = contentEl.createDiv({ cls: "setting-item" });
		this.inputEl = inputContainer.createEl("input", {
			type: "text",
			value: this.currentName,
			cls: "timeline-name-input"
		});
		this.inputEl.style.width = "100%";
		this.inputEl.style.marginBottom = "1em";

		// Focus and select all text
		this.inputEl.focus();
		this.inputEl.select();

		// Handle Enter key
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		
		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		const saveButton = buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveButton.addEventListener("click", () => this.submit());
	}

	private submit(): void {
		if (this.inputEl) {
			this.onSubmit(this.inputEl.value);
		}
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
