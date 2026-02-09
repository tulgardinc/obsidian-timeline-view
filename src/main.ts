import {App, Editor, MarkdownView, Modal, Notice, Plugin, WorkspaceLeaf, type MarkdownFileInfo} from 'obsidian';
import {DEFAULT_SETTINGS, type MyPluginSettings, SampleSettingTab} from "./settings";
import {TimelineView, VIEW_TYPE_TIMELINE} from "./views/TimelineView";

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Register the Timeline view
		this.registerView(
			VIEW_TYPE_TIMELINE,
			(leaf: WorkspaceLeaf) => new TimelineView(leaf)
		);

		// Add ribbon icon to open Timeline view
		this.addRibbonIcon('calendar', 'Open Timeline view', () => {
			this.openTimelineView();
		});

		// Add command to open Timeline view
		this.addCommand({
			id: 'open-timeline-view',
			name: 'Open Timeline view',
			callback: () => {
				this.openTimelineView();
			}
		});

		// Original sample commands
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				editor.replaceSelection('Sample editor command');
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
		
		console.log("Timeline plugin loaded");
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TIMELINE);
	}

	async openTimelineView() {
		const {workspace} = this.app;

		// Check if view is already open
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
		if (leaves.length > 0) {
			// View already exists, reveal it
			const leaf = leaves[0];
			if (leaf) {
				workspace.revealLeaf(leaf);
			}
			return;
		}

		// Create a new leaf in the right sidebar
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not create Timeline view");
			return;
		}

		// Open the Timeline view
		await leaf.setViewState({
			type: VIEW_TYPE_TIMELINE,
			active: true
		});

		// Reveal the leaf
		workspace.revealLeaf(leaf);
		
		console.log("Opened Timeline view");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
