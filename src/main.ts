import { Editor, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, type MarkdownFileInfo } from 'obsidian';
import { DEFAULT_SETTINGS, type MyPluginSettings, TimelineSettingTab, type TimelineViewConfig, createDefaultAllTimeline } from "./settings";
import { TimelineView, VIEW_TYPE_TIMELINE } from "./views/TimelineView";
import { TimelineSelectorModal } from "./modals/TimelineSelectorModal";
import { TimelineCacheService } from "./services/TimelineCacheService";

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;
	cacheService!: TimelineCacheService;

	async onload() {
		await this.loadSettings();

		// Initialize cache service
		this.cacheService = new TimelineCacheService(this.app);
		await this.cacheService.initialize();

		// Register the Timeline view with cache service
		this.registerView(
			VIEW_TYPE_TIMELINE,
			(leaf: WorkspaceLeaf) => {
				const view = new TimelineView(leaf);
				view.setCacheService(this.cacheService);
				return view;
			}
		);

		// Add ribbon icon to open Timeline view
		this.addRibbonIcon('calendar', 'Open Timeline view', () => {
			this.openTimelineSelector();
		});

		// Add command to open Timeline view (fuzzy finder)
		this.addCommand({
			id: 'open-timeline-view',
			name: 'Open Timeline view',
			callback: () => {
				this.openTimelineSelector();
			}
		});

		// Add command to undo last timeline operation
		this.addCommand({
			id: 'timeline-undo',
			name: 'Undo last timeline change',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(TimelineView);
				if (view) {
					void view.undo();
				}
			}
		});

		// Add command to redo last undone timeline operation
		this.addCommand({
			id: 'timeline-redo',
			name: 'Redo last timeline change',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(TimelineView);
				if (view) {
					void view.redo();
				}
			}
		});

		// Add command to go to a specific note in the timeline
		this.addCommand({
			id: 'timeline-go-to-note',
			name: 'Go to note',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(TimelineView);
				if (!view || view.timelineItems.length === 0) {
					new Notice('No timeline items available');
					return;
				}
				void import('./modals/TimelineItemSuggestModal').then(({ TimelineItemSuggestModal }) => {
					new TimelineItemSuggestModal(
						this.app,
						view.timelineItems,
						(item) => view.goToItem(item)
					).open();
				});
			}
		});

		// Add command to view current note in timeline (fit to view)
		this.addCommand({
			id: 'view-in-timeline',
			name: 'View in Timeline',
			editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				// Get the file from the context
				const file = ctx.file;
				if (!file) return;

				// Find the first ancestor timeline that contains this file
				const timeline = this.findTimelineForFile(file.path);
				if (!timeline) {
					// No timeline found - silently do nothing
					return;
				}

				// Open the timeline view for this config
				await this.openTimelineView(timeline);

				// Get the timeline view instance
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
				const targetLeaf = leaves.find(leaf => {
					const view = leaf.view as TimelineView;
					return view.getTimelineId() === timeline.id;
				});

				if (!targetLeaf) return;

				const timelineView = targetLeaf.view as TimelineView;
				if (!timelineView) return;

				// Call fit to view for this file
				timelineView.fitToCardByPath(file.path);
			}
		});

		// Add command to add a timeline card to the current timeline
		this.addCommand({
			id: 'add-timeline-card',
			name: 'Add Timeline',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(TimelineView);
				if (!view) {
					new Notice('No active timeline view');
					return;
				}
				
				// Show timeline selector to pick which timeline to add
				const timelines = this.settings.timelineViews;
				if (timelines.length === 0) {
					new Notice('No timelines configured');
					return;
				}
				
				new TimelineSelectorModal(
					this.app,
					timelines,
					(timeline) => view.addTimelineCard(timeline.id, timeline.name)
				).open();
			}
		});

		this.addSettingTab(new TimelineSettingTab(this.app, this));

		// Listen for view state restoration to configure timeline views
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.configureTimelineViews();
			})
		);

		// Listen for file rename events to update cache
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.cacheService.handleFileRename(oldPath, file.path);
				}
			})
		);

		console.log("Timeline plugin loaded");
	}

	onunload() {
		// Force save cache before unloading
		void this.cacheService.forceSave();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TIMELINE);
	}

	/**
	 * Find the first timeline that contains the given file path
	 * Walks up the directory tree to find the most specific (deepest) matching timeline
	 */
	findTimelineForFile(filePath: string): TimelineViewConfig | null {
		const timelines = this.settings.timelineViews;
		if (timelines.length === 0) return null;

		// Get the directory path (remove filename)
		const parts = filePath.split('/');
		parts.pop(); // Remove filename

		// Build list of all ancestor paths from most specific to least
		const ancestorPaths: string[] = [];
		for (let i = parts.length; i >= 0; i--) {
			ancestorPaths.push(parts.slice(0, i).join('/'));
		}

		// Find the most specific (deepest) timeline that matches
		for (const ancestorPath of ancestorPaths) {
			const matchingTimeline = timelines.find(t => t.rootPath === ancestorPath);
			if (matchingTimeline) {
				return matchingTimeline;
			}
		}

		// Fall back to vault-wide timeline if it exists
		const allTimeline = timelines.find(t => t.rootPath === "");
		return allTimeline ?? null;
	}

	/**
	 * Configure any timeline views that need their config loaded
	 */
	private configureTimelineViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
		for (const leaf of leaves) {
			const view = leaf.view;
			// Check if view is actually a TimelineView with the required method
			// (during startup, view might not be fully initialized yet)
			if (view instanceof TimelineView && view.getTimelineId && view.getTimelineId()) {
				const config = this.settings.timelineViews.find(t => t.id === view.getTimelineId());
				if (config) {
					view.setTimelineConfig(config);
				}
			}
		}
	}

	/**
	 * Open the timeline selector modal (fuzzy finder)
	 */
	openTimelineSelector(): void {
		const timelines = this.settings.timelineViews;

		if (timelines.length === 0) {
			new Notice('No timelines configured. Open settings to create one.');
			return;
		}

		// If only one timeline, open it directly
		if (timelines.length === 1) {
			void this.openTimelineView(timelines[0]!);
			return;
		}

		// Show fuzzy finder for multiple timelines
		new TimelineSelectorModal(
			this.app,
			timelines,
			(timeline) => void this.openTimelineView(timeline)
		).open();
	}

	/**
	 * Open a specific timeline view
	 */
	async openTimelineView(config: TimelineViewConfig): Promise<void> {
		const { workspace } = this.app;

		// Check if a view with this timeline ID is already open
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
		for (const leaf of leaves) {
			const view = leaf.view;
			// First check: fully initialized TimelineView with matching ID
			if (view instanceof TimelineView && typeof view.getTimelineId === 'function' && view.getTimelineId() === config.id) {
				workspace.revealLeaf(leaf);
				return;
			}
			// Second check: deferred/restored view via its persisted state
			// This handles workspace restoration where view may not be fully instantiated yet
			const viewState = leaf.getViewState();
			if (viewState?.type === VIEW_TYPE_TIMELINE && viewState.state?.timelineId === config.id) {
				workspace.revealLeaf(leaf);
				// If the view is now ready, ensure it's configured
				const revealedView = leaf.view;
				if (revealedView instanceof TimelineView) {
					revealedView.setTimelineConfig(config);
				}
				return;
			}
		}

		// Create a new leaf in the right sidebar
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not create Timeline view");
			return;
		}

		// Open the Timeline view with state
		await leaf.setViewState({
			type: VIEW_TYPE_TIMELINE,
			active: true,
			state: {
				timelineId: config.id
			}
		});

		// Reveal the leaf FIRST - ensures the sidebar is expanded and has proper dimensions
		// This must happen BEFORE setTimelineConfig to avoid viewport restoration with zero dimensions
		workspace.revealLeaf(leaf);

		// Wait for layout to settle and dimensions to be computed
		await new Promise(resolve => requestAnimationFrame(resolve));

		// Configure the view with the timeline config AFTER leaf is visible
		const view = leaf.view as TimelineView;
		if (view) {
			view.setTimelineConfig(config);
		}
	}

	/**
	 * Delete timeline data from cache when a timeline is deleted
	 */
	deleteTimelineCache(timelineId: string): void {
		this.cacheService.deleteTimeline(timelineId);
	}

	async loadSettings() {
		const savedData = await this.loadData() as Partial<MyPluginSettings> | null;
		
		// Handle migration: if no settings exist, create defaults
		if (!savedData || !savedData.timelineViews) {
			this.settings = { ...DEFAULT_SETTINGS };
		} else {
			this.settings = {
				timelineViews: savedData.timelineViews
			};
		}

		// Ensure at least one timeline exists (create "All" if empty)
		if (this.settings.timelineViews.length === 0) {
			this.settings.timelineViews.push(createDefaultAllTimeline());
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
