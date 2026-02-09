import type { App, TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';
import type { TimelineHistoryManager } from '../utils/TimelineHistoryManager';
import type { TimelineItem } from '../stores/timelineStore';

export interface EventHandlerServiceDependencies {
	app: App;
	historyManager: TimelineHistoryManager;
	getTimelineItems: () => TimelineItem[];
	getExpectedFileStates: () => Map<string, { dateStart: string; dateEnd: string; layer: number; timestamp: number }>;
	refreshItems: () => Promise<void>;
	onUndo: () => Promise<boolean>;
	onRedo: () => Promise<boolean>;
	isViewActive: () => boolean;
	contentEl: HTMLElement;
}

export class EventHandlerService {
	private app: App;
	private historyManager: TimelineHistoryManager;
	private getTimelineItems: () => TimelineItem[];
	private getExpectedFileStates: () => Map<string, { dateStart: string; dateEnd: string; layer: number; timestamp: number }>;
	private refreshItems: () => Promise<void>;
	private onUndo: () => Promise<boolean>;
	private onRedo: () => Promise<boolean>;
	private isViewActive: () => boolean;
	private contentEl: HTMLElement;

	private metadataChangeTimeout: ReturnType<typeof setTimeout> | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(deps: EventHandlerServiceDependencies) {
		this.app = deps.app;
		this.historyManager = deps.historyManager;
		this.getTimelineItems = deps.getTimelineItems;
		this.getExpectedFileStates = deps.getExpectedFileStates;
		this.refreshItems = deps.refreshItems;
		this.onUndo = deps.onUndo;
		this.onRedo = deps.onRedo;
		this.isViewActive = deps.isViewActive;
		this.contentEl = deps.contentEl;
	}

	/**
	 * Register all event handlers
	 */
	registerEventHandlers(): void {
		this.registerFileRenameHandler();
		this.registerMetadataChangeHandler();
		this.registerKeyboardHandler();
	}

	/**
	 * Cleanup all event handlers
	 */
	cleanup(): void {
		if (this.metadataChangeTimeout) {
			clearTimeout(this.metadataChangeTimeout);
			this.metadataChangeTimeout = null;
		}

		if (this.keydownHandler) {
			window.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}
	}

	/**
	 * Register handler for file rename events
	 */
	private registerFileRenameHandler(): void {
		const handler = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;

			const items = this.getTimelineItems();
			const itemIndex = items.findIndex(item =>
				item.file.path === file.path || item.file.path === oldPath
			);

			if (itemIndex !== -1) {
				console.log(`Timeline: File renamed, refreshing...`);
				this.refreshItems();
			}
		};

		this.app.vault.on('rename', handler);
	}

	/**
	 * Register handler for metadata changes
	 */
	private registerMetadataChangeHandler(): void {
		const handler = (file: TFile) => {
			if (!(file instanceof TFile)) return;

			const items = this.getTimelineItems();
			const isInTimeline = items.some(item => item.file.path === file.path);
			const metadata = this.app.metadataCache.getFileCache(file);
			const hasTimelineFlag = metadata?.frontmatter?.timeline === true;

			if (!isInTimeline && !hasTimelineFlag) return;

			// Check if this is our own change
			const expectedStates = this.getExpectedFileStates();
			const expectedState = expectedStates.get(file.path);
			if (expectedState) {
				const currentDateStart = String(metadata?.frontmatter?.['date-start'] ?? '');
				const currentDateEnd = String(metadata?.frontmatter?.['date-end'] ?? '');
				const currentLayer = parseInt(String(metadata?.frontmatter?.['layer'] ?? '0'), 10);

				if (currentDateStart === expectedState.dateStart &&
				    currentDateEnd === expectedState.dateEnd &&
				    currentLayer === expectedState.layer) {
					expectedStates.delete(file.path);
					return;
				}

				if (Date.now() - expectedState.timestamp > 5000) {
					expectedStates.delete(file.path);
				}
			}

			// Debounce rapid changes
			if (this.metadataChangeTimeout) {
				clearTimeout(this.metadataChangeTimeout);
			}

			this.metadataChangeTimeout = setTimeout(() => {
				this.refreshItems();
			}, 300);
		};

		this.app.metadataCache.on('changed', handler);
	}

	/**
	 * Register keyboard handler for undo/redo
	 */
	private registerKeyboardHandler(): void {
		this.keydownHandler = (event: KeyboardEvent) => {
			const isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
			const isRedo = ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z') ||
			               ((event.ctrlKey || event.metaKey) && event.key === 'y');

			if (!isUndo && !isRedo) return;

			// Check if editor has focus
			const activeElement = document.activeElement;
			const isEditorFocused = activeElement?.closest('.cm-editor') !== null ||
			                       activeElement?.closest('.markdown-source-view') !== null ||
			                       activeElement?.tagName === 'TEXTAREA' ||
			                       activeElement?.tagName === 'INPUT';

			if (isEditorFocused) return;

			// Check if our view is active
			if (!this.isViewActive() || !this.contentEl.isConnected) return;

			if (isUndo) {
				event.preventDefault();
				event.stopPropagation();
				this.onUndo();
			} else if (isRedo) {
				event.preventDefault();
				event.stopPropagation();
				this.onRedo();
			}
		};

		window.addEventListener('keydown', this.keydownHandler, true);
	}
}
