/**
 * TimelineView - Obsidian ItemView for the timeline canvas.
 *
 * This is the top-level coordinator.  It owns the Svelte component
 * mount/unmount lifecycle and delegates domain logic to focused services:
 *
 *   SelectionManager   – card selection state
 *   CardOperations     – move / resize / layer-change / color
 *   CardDeletion       – remove-from-timeline / move-to-trash
 *   NoteCreator        – create new notes from canvas clicks
 *   TimelineCardManager– timeline-ref card collection & refresh
 *   ContextMenuBuilder – right-click context menu
 *   FileService        – collect note cards from vault files
 *   TimelineHistoryManager – undo / redo stack
 */

import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import Timeline from "../components/Timeline.svelte";
import { mount, unmount } from "svelte";
import { LayerManager } from "../utils/LayerManager";
import { TimelineHistoryManager, type TimelineState, type HistoryEntry } from "../utils/TimelineHistoryManager";
import { TimeScaleManager } from "../utils/TimeScaleManager";
import { TimelineDate } from "../utils/TimelineDate";
import type { TimelineItem } from "../types/timelineTypes";
import { DeleteConfirmModal, type DeleteAction } from "../modals/DeleteConfirmModal";
import type { TimelineViewConfig } from "../settings";
import { FileService } from "../services/FileService";
import type { TimelineCacheService, CachedViewportState } from "../services/TimelineCacheService";
import type { TimelinePluginContext } from "../types/plugin-context";

// Extracted services
import { SelectionManager } from "../services/SelectionManager";
import { resizeItem, moveItem, changeItemLayer, applyColorToItems } from "../services/CardOperations";
import { removeCardsFromTimeline, moveCardsToTrash } from "../services/CardDeletion";
import { createNoteFromClick } from "../services/NoteCreator";
import { collectTimelineCards, refreshTimelineCards, addTimelineCard as addTimelineCardService } from "../services/TimelineCardManager";
import { showCardContextMenu } from "../services/ContextMenuBuilder";
import { debug } from "../utils/debug";

export const VIEW_TYPE_TIMELINE = "timeline-view";

const TAG = "TimelineView";

export interface TimelineViewState {
	timelineId: string;
}

export interface TimelineFile {
	file: TFile;
	title: string;
}

export type { TimelineItem };

interface ExpectedFileState {
	dateStart: string;
	dateEnd: string;
	timestamp: number;
}

export class TimelineView extends ItemView {
	private component: {
		refreshItems?: (items: TimelineItem[]) => void;
		setSelection?: (selectedIndices: Set<number>, activeIndex: number | null, cardData: { startX: number; endX: number; startDate: string; endDate: string; title: string } | null) => void;
		centerOnItem?: (index: number) => void;
		getCenterTime?: () => number | null;
		centerOnTime?: (days: number) => void;
		fitCardWidth?: (cardStartX: number, cardWidth: number) => void;
		fitTimeRange?: (startDay: number, endDay: number, centerDay: number) => void;
		setViewport?: (viewport: CachedViewportState) => void;
		getViewport?: () => CachedViewportState | null;
		[key: string]: unknown;
	} | null = null;

	timelineItems: TimelineItem[] = [];
	private historyManager: TimelineHistoryManager;
	private selection: SelectionManager;
	private expectedFileStates = new Map<string, ExpectedFileState>();
	private keydownHandlerRegistered = false;

	// Time scale
	private timeScale: number = 10;

	// Timeline configuration
	private timelineId: string = "";
	private timelineName: string = "Timeline";
	private timelineIcon: string = "calendar";
	private rootPath: string = "";

	// Injected dependencies
	private cacheService: TimelineCacheService | null = null;
	private pluginCtx: TimelinePluginContext | null = null;

	// Debounce timers
	private viewportSaveTimeout: ReturnType<typeof setTimeout> | null = null;
	private timelineCardRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
	private metadataChangeTimeout: ReturnType<typeof setTimeout> | null = null;
	private fileChangeRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

	// Render guards
	private hasRendered: boolean = false;
	private configReady: boolean = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.historyManager = new TimelineHistoryManager();
		this.selection = new SelectionManager();
	}

	// ── Dependency injection ────────────────────────────────

	setCacheService(cacheService: TimelineCacheService): void {
		this.cacheService = cacheService;
	}

	setPluginContext(ctx: TimelinePluginContext): void {
		this.pluginCtx = ctx;
	}

	setTimelineConfig(config: TimelineViewConfig): void {
		debug(TAG, `Setting config for ${config.name} (${config.id})`);
		this.timelineId = config.id;
		this.timelineName = config.name;
		this.timelineIcon = config.icon ?? "calendar";
		this.rootPath = config.rootPath;

		// Update the tab title to reflect the timeline name (undocumented internal API)
		this.leaf.updateHeader();

		if (this.cacheService) {
			const viewport = this.cacheService.getViewport(this.timelineId);
			if (viewport) {
				this.timeScale = viewport.timeScale;
			}
		}

		this.configReady = true;
		if (!this.hasRendered) {
			void this.render();
		}
	}

	// ── Getters ─────────────────────────────────────────────

	getTimelineId(): string { return this.timelineId; }
	getRootPath(): string { return this.rootPath; }
	getViewType(): string { return VIEW_TYPE_TIMELINE; }
	getDisplayText(): string { return this.timelineName || "Timeline"; }
	getIcon(): string { return this.timelineIcon; }

	// ── View state persistence ──────────────────────────────

	getState(): Record<string, unknown> {
		return { timelineId: this.timelineId };
	}

	async setState(state: Record<string, unknown>, result: { history: boolean }): Promise<void> {
		if (state && typeof state.timelineId === 'string') {
			this.timelineId = state.timelineId;
		}
		await super.setState(state, result);
	}

	// ── Item collection ─────────────────────────────────────

	async collectTimelineItems(): Promise<TimelineItem[]> {
		const fileService = this.createFileService();
		if (!fileService) return [];

		const noteItems = await fileService.collectTimelineItems();

		let timelineCardItems: TimelineItem[] = [];
		if (this.cacheService && this.pluginCtx) {
			timelineCardItems = await collectTimelineCards(
				this.timelineId, this.timeScale, this.app, this.cacheService, this.pluginCtx
			);
		}

		return [...noteItems, ...timelineCardItems];
	}

	private createFileService(): FileService | null {
		if (!this.cacheService) return null;
		return new FileService({
			app: this.app,
			timeScale: this.timeScale,
			rootPath: this.rootPath,
			timelineId: this.timelineId,
			cacheService: this.cacheService,
		});
	}

	// ── Recalculate positions on timeScale change ───────────

	private recalculateItemPositions(): void {
		for (let i = 0; i < this.timelineItems.length; i++) {
			const item = this.timelineItems[i]!;
			const dateStart = TimelineDate.fromString(item.dateStart);
			if (!dateStart) continue;
			const dateEnd = TimelineDate.fromString(item.dateEnd) || dateStart;
			const daysFromStart = dateStart.getDaysFromEpoch();
			const newX = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);
			const duration = dateEnd.getDaysFromEpoch() - dateStart.getDaysFromEpoch();
			const newWidth = Math.max(duration, 1) * this.timeScale;
			this.timelineItems[i] = { ...item, x: newX, width: newWidth };
		}
	}

	// ── Selection (delegates to SelectionManager) ───────────

	private selectCard(index: number): void {
		if (this.app.workspace.getActiveViewOfType(TimelineView) !== this) {
			this.app.workspace.setActiveLeaf(this.leaf);
		}
		this.selection.select(index, this.timelineItems, this.timeScale);
		this.pushSelectionToComponent();
	}

	private toggleSelection(index: number): void {
		if (this.app.workspace.getActiveViewOfType(TimelineView) !== this) {
			this.app.workspace.setActiveLeaf(this.leaf);
		}
		this.selection.toggle(index, this.timelineItems, this.timeScale);
		this.pushSelectionToComponent();
	}

	private clearSelection(): void {
		this.selection.clear();
		this.pushSelectionToComponent();
	}

	private pushSelectionToComponent(): void {
		this.component?.setSelection?.(
			this.selection.selectedIndices,
			this.selection.activeIndex,
			this.selection.selectedCardData,
		);
	}

	/**
	 * Re-map selection indices after a full rebuild of timelineItems.
	 * Matches previously-selected cards by file path so that selection
	 * survives array reordering.
	 */
	private remapSelection(oldItems: TimelineItem[]): void {
		if (this.selection.selectedIndices.size === 0) return;

		// Collect file paths of previously selected cards
		const selectedPaths = new Set<string>();
		let activePath: string | null = null;
		for (const idx of this.selection.selectedIndices) {
			const item = oldItems[idx];
			if (item?.type === 'note') selectedPaths.add(item.file.path);
			else if (item?.type === 'timeline') selectedPaths.add(`timeline:${item.timelineId}`);
		}
		if (this.selection.activeIndex !== null) {
			const active = oldItems[this.selection.activeIndex];
			if (active?.type === 'note') activePath = active.file.path;
			else if (active?.type === 'timeline') activePath = `timeline:${active.timelineId}`;
		}

		// Re-map to new indices
		this.selection.selectedIndices.clear();
		this.selection.activeIndex = null;
		for (let i = 0; i < this.timelineItems.length; i++) {
			const item = this.timelineItems[i]!;
			const key = item.type === 'note' ? item.file.path : `timeline:${item.timelineId}`;
			if (selectedPaths.has(key)) {
				this.selection.selectedIndices.add(i);
				if (key === activePath) {
					this.selection.activeIndex = i;
				}
			}
		}

		// Update card data or clear if nothing matched
		if (this.selection.activeIndex !== null) {
			this.selection.updateCardData(this.selection.activeIndex, this.timelineItems, this.timeScale);
		} else if (this.selection.selectedIndices.size > 0) {
			const first = this.selection.selectedIndices.values().next().value as number;
			this.selection.activeIndex = first;
			this.selection.updateCardData(first, this.timelineItems, this.timeScale);
		} else {
			this.selection.selectedCardData = null;
		}

		this.pushSelectionToComponent();
	}

	// ── Card mutations (delegates to CardOperations) ────────

	private captureItemState(item: TimelineItem): TimelineState {
		return {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0,
		};
	}

	private async updateItemsResize(index: number, edge: 'left' | 'right', deltaX: number): Promise<void> {
		const item = this.timelineItems[index];
		const prevState = item?.type === 'note' ? this.captureItemState(item) : null;

		await resizeItem(this.timelineItems, index, edge, deltaX, this.timeScale, this.app, this.cacheService);
		this.component?.refreshItems?.(this.timelineItems);

		const updated = this.timelineItems[index];
		if (prevState && updated?.type === 'note') {
			this.historyManager.record(updated.file, prevState, this.captureItemState(updated), 'resize');
		}
	}

	private async updateItemsMove(index: number, deltaX: number, deltaY: number): Promise<void> {
		const item = this.timelineItems[index];
		const prevState = item?.type === 'note' ? this.captureItemState(item) : null;

		await moveItem(this.timelineItems, index, deltaX, deltaY, this.timeScale, this.timelineId, this.app, this.cacheService);
		this.component?.refreshItems?.(this.timelineItems);

		const updated = this.timelineItems[index];
		if (prevState && updated?.type === 'note') {
			this.historyManager.record(updated.file, prevState, this.captureItemState(updated), 'move');
		}
	}

	private async updateItemLayer(index: number, newLayer: number, newX: number, newWidth: number): Promise<void> {
		const item = this.timelineItems[index];
		const prevState = item?.type === 'note' ? this.captureItemState(item) : null;

		await changeItemLayer(this.timelineItems, index, newLayer, newX, newWidth, this.timeScale, this.timelineId, this.app, this.cacheService);
		this.component?.refreshItems?.(this.timelineItems);

		const updated = this.timelineItems[index];
		if (prevState && updated?.type === 'note') {
			this.historyManager.record(updated.file, prevState, this.captureItemState(updated), 'layer-change');
		}
	}

	// ── Open file / timeline ────────────────────────────────

	private async openFile(index: number): Promise<void> {
		const item = this.timelineItems[index];
		if (!item) return;

		if (item.type === 'timeline') {
			if (!this.pluginCtx) {
				new Notice('Timeline plugin not available');
				return;
			}
			const config = this.pluginCtx.findTimelineById(item.timelineId);
			if (!config) {
				new Notice(`Timeline "${item.timelineName}" not found`);
				return;
			}
			await this.pluginCtx.openTimelineView(config);
		} else if (item.type === 'note') {
			const file = this.app.vault.getAbstractFileByPath(item.file.path);
			if (file && file instanceof TFile) {
				let existingLeaf: WorkspaceLeaf | null = null;
				this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
					const view = leaf.view as { file?: { path: string } };
					if (view?.file?.path === item.file.path) existingLeaf = leaf;
				});
				if (existingLeaf) {
					this.app.workspace.setActiveLeaf(existingLeaf);
				} else {
					const leaf = this.app.workspace.getLeaf('tab');
					await leaf.openFile(file);
				}
			}
		}
	}

	// ── Create note from canvas click ───────────────────────

	private async createNoteFromClick(event: { worldX: number; worldY: number }): Promise<void> {
		if (!this.cacheService) {
			new Notice('Timeline cache service not available');
			return;
		}
		const newItem = await createNoteFromClick(
			event, this.timelineItems, this.timeScale, this.rootPath, this.timelineId, this.app, this.cacheService
		);
		if (newItem) {
			// Suppress the metadata-change refresh that will fire for this file —
			// we already have the correct state in timelineItems.
			if (newItem.type === 'note') {
				this.expectedFileStates.set(newItem.file.path, {
					dateStart: newItem.dateStart,
					dateEnd: newItem.dateEnd,
					timestamp: Date.now(),
				});
			}
			this.component?.refreshItems?.(this.timelineItems);
			const newIndex = this.timelineItems.length - 1;
			this.selectCard(newIndex);
			await this.openFile(newIndex);
		}
	}

	// ── Context menu (delegates to ContextMenuBuilder) ──────

	private handleCardContextMenu(index: number, event: MouseEvent): void {
		if (index < 0 || index >= this.timelineItems.length) return;
		const item = this.timelineItems[index]!;

		// Ensure item is selected for context
		if (!this.selection.selectedIndices.has(index)) {
			this.selectCard(index);
		} else {
			this.selection.activeIndex = index;
			this.selection.updateCardData(index, this.timelineItems, this.timeScale);
		}

		showCardContextMenu(item, event, {
			onFitToView: () => {
				if (this.selection.selectedIndices.size > 1) {
					this.fitSelectedCardsToView();
				} else if (this.component?.fitCardWidth) {
					this.component.fitCardWidth(item.x, item.width);
				}
			},
			onApplyColor: (color) => {
				const selected = this.selection.getSelectedItems(this.timelineItems);
				void (async () => {
					await applyColorToItems(selected, color, this.timelineId, this.app, this.cacheService);
					this.component?.refreshItems?.(this.timelineItems);
				})();
			},
			onDelete: () => this.handleDeleteCard(),
			onRemoveTimelineCard: (tlId) => this.handleRemoveTimelineCard(tlId),
		});
	}

	// ── Delete / Remove ─────────────────────────────────────

	private handleRemoveTimelineCard(timelineId: string): void {
		new DeleteConfirmModal(
			this.app,
			null,
			(action: DeleteAction) => {
				if (action === 'remove-from-timeline') {
					void this.removeTimelineCard(timelineId);
				}
			},
			'Remove timeline from view?',
			1,
			'This will remove the timeline card from the current view but will not delete the timeline itself.',
			false,
		).open();
	}

	private handleDeleteCard(): void {
		const noteItems = this.selection.getSelectedNoteItems(this.timelineItems);
		if (noteItems.length === 0) {
			new Notice('Timeline cards cannot be deleted - use remove instead');
			return;
		}

		new DeleteConfirmModal(this.app, noteItems[0]!.file, (action: DeleteAction) => {
			const files = noteItems.map(i => i.file);
			const doDelete = async () => {
				switch (action) {
					case 'remove-from-timeline':
						await removeCardsFromTimeline(files, this.timelineId, this.app, this.cacheService);
						break;
					case 'move-to-trash':
						await moveCardsToTrash(files, this.timelineId, this.app, this.cacheService);
						break;
				}
				this.clearSelection();
				await this.refreshTimeline();
			};
			void doDelete();
		}, undefined, noteItems.length).open();
	}

	async removeTimelineCard(timelineId: string): Promise<void> {
		this.cacheService?.removeTimelineCard(this.timelineId, timelineId);
		this.clearSelection();
		await this.refreshTimeline();
		new Notice('Timeline removed from view');
	}

	// ── Add timeline card ───────────────────────────────────

	async addTimelineCard(timelineId: string, timelineName: string): Promise<void> {
		if (!this.cacheService || !this.pluginCtx) {
			new Notice('Timeline cache service not available');
			return;
		}
		const added = await addTimelineCardService(
			this.timelineItems, this.timelineId, timelineId, this.timeScale,
			this.app, this.cacheService, this.pluginCtx
		);
		if (added) {
			await this.refreshTimeline();
		}
	}

	// ── Fit selected cards to view ──────────────────────────

	private fitSelectedCardsToView(): void {
		if (this.selection.selectedIndices.size === 0) return;
		const selectedItems = this.selection.getSelectedItems(this.timelineItems);
		if (selectedItems.length === 0) return;

		let minStartDay = Infinity;
		let maxEndDay = -Infinity;
		const centerDays: number[] = [];

		for (const item of selectedItems) {
			const sd = TimeScaleManager.worldXToDay(item.x, this.timeScale);
			const ed = TimeScaleManager.worldXToDay(item.x + item.width, this.timeScale);
			minStartDay = Math.min(minStartDay, sd);
			maxEndDay = Math.max(maxEndDay, ed);
			centerDays.push((sd + ed) / 2);
		}

		centerDays.sort((a, b) => a - b);
		const mid = Math.floor(centerDays.length / 2);
		const medianCenter = centerDays.length % 2 === 0
			? (centerDays[mid - 1]! + centerDays[mid]!) / 2
			: centerDays[mid]!;

		this.component?.fitTimeRange?.(minStartDay, maxEndDay, medianCenter);
	}

	// ── Undo / Redo (unified) ───────────────────────────────

	private async applyHistoryEntry(entry: HistoryEntry, state: TimelineState): Promise<boolean> {
		try {
			await FileService.updateFileDatesStatic(this.app, entry.file, state.dateStart, state.dateEnd);

			if (this.cacheService && state.layer !== undefined) {
				const noteId = this.cacheService.getNoteId(entry.file);
				if (noteId) {
					this.cacheService.setNoteLayer(this.timelineId, noteId, state.layer, entry.file.path);
				}
			}

			this.expectedFileStates.set(entry.file.path, {
				dateStart: state.dateStart,
				dateEnd: state.dateEnd,
				timestamp: Date.now(),
			});

			const itemIndex = this.timelineItems.findIndex(
				item => item.type === 'note' && item.file.path === entry.file.path
			);
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				const ds = TimelineDate.fromString(state.dateStart)!;
				const de = TimelineDate.fromString(state.dateEnd)!;
				const newX = ds.getDaysFromEpoch() * this.timeScale;
				const dur = de.getDaysFromEpoch() - ds.getDaysFromEpoch();
				const newWidth = Math.max(dur, 1) * this.timeScale;
				const newY = LayerManager.layerToY(state.layer);

				this.timelineItems[itemIndex] = {
					...item, dateStart: state.dateStart, dateEnd: state.dateEnd,
					layer: state.layer, x: newX, y: newY, width: newWidth,
				};
				this.component?.refreshItems?.(this.timelineItems);
			}

			this.scheduleTimelineCardRefresh();
			return true;
		} catch (error) {
			console.error(`Timeline: Failed to apply history for ${entry.file.basename}:`, error);
			return false;
		}
	}

	async undo(): Promise<boolean> {
		const entry = this.historyManager.undo();
		if (!entry) return false;
		return this.applyHistoryEntry(entry, entry.previousState);
	}

	async redo(): Promise<boolean> {
		const entry = this.historyManager.redo();
		if (!entry) return false;
		return this.applyHistoryEntry(entry, entry.newState);
	}

	// ── Navigation ──────────────────────────────────────────

	goToItem(item: TimelineItem): void {
		let index: number;
		if (item.type === 'note') {
			index = this.timelineItems.findIndex(i => i.type === 'note' && i.file.path === item.file.path);
		} else if (item.type === 'timeline') {
			index = this.timelineItems.findIndex(i => i.type === 'timeline' && i.timelineId === item.timelineId);
		} else {
			return;
		}
		if (index === -1) return;
		this.component?.centerOnItem?.(index);
		this.selectCard(index);
	}

	fitToCardByPath(filePath: string): void {
		const index = this.timelineItems.findIndex(i => i.type === 'note' && i.file.path === filePath);
		if (index === -1) return;
		const item = this.timelineItems[index]!;
		this.selectCard(index);
		this.component?.fitCardWidth?.(item.x, item.width);
	}

	// ── Refresh helpers ─────────────────────────────────────

	/**
	 * Schedule a refresh of the timeline (debounced to avoid rapid refresh spam)
	 * Called externally when files are created/deleted
	 */
	scheduleRefresh(): void {
		if (this.fileChangeRefreshTimeout) clearTimeout(this.fileChangeRefreshTimeout);
		this.fileChangeRefreshTimeout = setTimeout(() => {
			void this.refreshTimeline();
		}, 200);
	}

	private async refreshTimeline(): Promise<void> {
		const oldItems = this.timelineItems;
		this.timelineItems = await this.collectTimelineItems();
		this.remapSelection(oldItems);
		this.component?.refreshItems?.(this.timelineItems);
	}

	private scheduleTimelineCardRefresh(): void {
		if (this.timelineCardRefreshTimeout) clearTimeout(this.timelineCardRefreshTimeout);
		this.timelineCardRefreshTimeout = setTimeout(() => {
			const cache = this.cacheService;
			const ctx = this.pluginCtx;
			if (cache && ctx) {
				void (async () => {
					const updated = await refreshTimelineCards(
						this.timelineItems, this.timelineId, this.timeScale,
						this.app, cache, ctx
					);
					if (updated) this.component?.refreshItems?.(this.timelineItems);
				})();
			}
		}, 300);
	}

	// ── Viewport persistence (debounced) ────────────────────

	private scheduleViewportSave(): void {
		if (this.viewportSaveTimeout) clearTimeout(this.viewportSaveTimeout);
		this.viewportSaveTimeout = setTimeout(() => { this.saveViewport(); }, 500);
	}

	private saveViewport(): void {
		if (!this.timelineId || !this.cacheService || !this.component) return;
		const viewport = this.component.getViewport?.();
		if (!viewport) return;
		this.cacheService.setViewport(this.timelineId, viewport);
	}

	// ── Render ──────────────────────────────────────────────

	async render() {
		if (this.hasRendered) return;
		if (!this.configReady) return;
		this.hasRendered = true;

		await new Promise(resolve => requestAnimationFrame(resolve));
		if (!this.contentEl) { console.error("contentEl is null!"); return; }

		this.contentEl.empty();
		this.timelineItems = await this.collectTimelineItems();

		const savedViewport = this.cacheService?.getViewport(this.timelineId) ?? null;
		if (savedViewport) this.timeScale = savedViewport.timeScale;

		try {
			this.component = mount(Timeline, {
				target: this.contentEl,
				props: {
					items: this.timelineItems,
					selectedIndices: this.selection.selectedIndices,
					activeIndex: this.selection.activeIndex,
					selectedCard: this.selection.selectedCardData,
					initialViewport: savedViewport,
					timelineName: this.timelineName,
					onItemResize: (index: number, edge: 'left' | 'right', deltaX: number) => {
						void this.updateItemsResize(index, edge, deltaX);
					},
					onItemMove: (index: number, deltaX: number, deltaY: number) => {
						void this.updateItemsMove(index, deltaX, deltaY);
					},
					onItemLayerChange: (index: number, newLayer: number, newX: number, newWidth: number) => {
						void this.updateItemLayer(index, newLayer, newX, newWidth);
					},
					onItemClick: (index: number, event: MouseEvent) => {
						if (event.shiftKey) {
							this.toggleSelection(index);
						} else {
							this.clearSelection();
							void this.openFile(index);
						}
					},
					onItemSelect: (index: number) => { this.selectCard(index); },
					onUpdateSelectionData: (startX: number, endX: number, startDate: string, endDate: string) => {
						if (this.selection.activeIndex !== null && this.selection.selectedCardData) {
							const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
							const daysStart = Math.round(TimeScaleManager.worldXToDay(startX, this.timeScale));
							const daysEnd = Math.round(TimeScaleManager.worldXToDay(endX, this.timeScale));
							this.selection.selectedCardData = {
								...this.selection.selectedCardData,
								startX, endX,
								startDate: TimeScaleManager.formatDateForLevel(daysStart, scaleLevel),
								endDate: TimeScaleManager.formatDateForLevel(daysEnd, scaleLevel),
							};
							this.pushSelectionToComponent();
						}
					},
					onTimeScaleChange: (timeScale: number) => {
						this.timeScale = timeScale;
						this.recalculateItemPositions();
						this.component?.refreshItems?.(this.timelineItems);
						this.scheduleViewportSave();
					},
					onCanvasClick: (event: { screenX: number; screenY: number; worldX: number; worldY: number }) => {
						if (this.selection.selectedIndices.size > 0) {
							this.clearSelection();
							return;
						}
						void this.createNoteFromClick(event);
					},
					onItemContextMenu: (index: number, event: MouseEvent) => {
						this.handleCardContextMenu(index, event);
					},
					onViewportChange: () => { this.scheduleViewportSave(); },
				}
			});
		} catch (error) {
			console.error("Error mounting Timeline component:", error);
			this.contentEl.createDiv({ text: "Error loading timeline: " + String(error) });
		}
	}

	// ── Obsidian lifecycle ──────────────────────────────────

	async onOpen() {
		if (this.configReady) {
			await this.render();
		}

		// File rename
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				this.cacheService?.handleFileRename(oldPath, file.path);

				const idx = this.timelineItems.findIndex(
					i => i.type === 'note' && (i.file.path === file.path || i.file.path === oldPath)
				);
				if (idx !== -1) {
					const item = this.timelineItems[idx]!;
					if (item.type === 'note') {
						this.timelineItems[idx] = { ...item, file, title: file.basename };
						this.component?.refreshItems?.(this.timelineItems);
					}
				}
			})
		);

		// Metadata change
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!(file instanceof TFile)) return;

				const isInTimeline = this.timelineItems.some(i => i.type === 'note' && i.file.path === file.path);
				const metadata = this.app.metadataCache.getFileCache(file);
				const hasFlag = metadata?.frontmatter?.timeline === true;
				if (!isInTimeline && !hasFlag) return;

				const expected = this.expectedFileStates.get(file.path);
				if (expected) {
					const curStart = String(metadata?.frontmatter?.['date-start'] ?? '');
					const curEnd = String(metadata?.frontmatter?.['date-end'] ?? '');
					if (curStart === expected.dateStart && curEnd === expected.dateEnd) {
						this.expectedFileStates.delete(file.path);
						return;
					}
					if (Date.now() - expected.timestamp > 5000) {
						this.expectedFileStates.delete(file.path);
					}
				}

				if (this.metadataChangeTimeout) clearTimeout(this.metadataChangeTimeout);
				this.metadataChangeTimeout = setTimeout(() => {
					void (async () => {
						const oldItems = this.timelineItems;
						this.timelineItems = await this.collectTimelineItems();
						this.remapSelection(oldItems);
						this.component?.refreshItems?.(this.timelineItems);
						this.scheduleTimelineCardRefresh();
					})();
				}, 300);
			})
		);

		// Keyboard shortcuts
		const keydownHandler = (event: KeyboardEvent) => {
			const active = document.activeElement;
			const isEditorFocused = active?.closest('.cm-editor') !== null
				|| active?.closest('.markdown-source-view') !== null
				|| active?.tagName === 'TEXTAREA'
				|| active?.tagName === 'INPUT';
			if (isEditorFocused) return;

			const activeView = this.app.workspace.getActiveViewOfType(TimelineView);
			if (activeView !== this) return;
			if (!this.contentEl.isConnected) return;

			const isDelete = event.key === 'Delete'
				|| (event.key === 'Backspace' && (event.ctrlKey || event.metaKey));
			if (isDelete && this.selection.selectedIndices.size > 0) {
				event.preventDefault();
				event.stopPropagation();
				this.handleDeleteCard();
				return;
			}

			const isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
			const isRedo = ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z')
				|| ((event.ctrlKey || event.metaKey) && event.key === 'y');
			if (!isUndo && !isRedo) return;

			event.preventDefault();
			event.stopPropagation();
			if (isUndo) void this.undo();
			else void this.redo();
		};

		if (!this.keydownHandlerRegistered) {
			this.registerDomEvent(window, 'keydown', keydownHandler, true);
			this.keydownHandlerRegistered = true;
		}
	}

	onClose(): Promise<void> {
		this.saveViewport();

		if (this.metadataChangeTimeout) { clearTimeout(this.metadataChangeTimeout); this.metadataChangeTimeout = null; }
		if (this.viewportSaveTimeout) { clearTimeout(this.viewportSaveTimeout); this.viewportSaveTimeout = null; }
		if (this.timelineCardRefreshTimeout) { clearTimeout(this.timelineCardRefreshTimeout); this.timelineCardRefreshTimeout = null; }
		if (this.fileChangeRefreshTimeout) { clearTimeout(this.fileChangeRefreshTimeout); this.fileChangeRefreshTimeout = null; }
		if (this.component) { void unmount(this.component); this.component = null; }
		return Promise.resolve();
	}
}
