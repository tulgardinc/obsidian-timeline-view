import { ItemView, WorkspaceLeaf, TFile, Notice, Menu } from "obsidian";
import Timeline from "../components/Timeline.svelte";
import { mount, unmount } from "svelte";
import { LayerManager, type LayerableItem, type TimelineColor } from "../utils/LayerManager";
import { TimelineHistoryManager, type TimelineState } from "../utils/TimelineHistoryManager";
import { TimeScaleManager } from "../utils/TimeScaleManager";
import { TimelineDate } from "../utils/TimelineDate";
import type { TimelineItem } from "../stores/timelineStore";
import { DeleteConfirmModal, type DeleteAction } from "../modals/DeleteConfirmModal";
import type { TimelineViewConfig } from "../settings";
import { FileService } from "../services/FileService";
import type { TimelineCacheService, ViewportState } from "../services/TimelineCacheService";

export const VIEW_TYPE_TIMELINE = "timeline-view";

/**
 * State stored in the view's leaf for persistence
 */
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
		setViewport?: (viewport: ViewportState) => void;
		getViewport?: () => ViewportState | null;
		[key: string]: unknown;
	} | null = null;
	timelineItems: TimelineItem[] = [];
	private historyManager: TimelineHistoryManager;
	private expectedFileStates = new Map<string, ExpectedFileState>(); // Track expected states to filter our own changes
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null; // Store for cleanup

	// Selection state - persists across view updates
	private selectedIndices: Set<number> = new Set(); // Multi-selection support
	private activeIndex: number | null = null; // Most recently selected item (for primary selection display)
	private selectedCardData: { startX: number; endX: number; startDate: string; endDate: string; title: string } | null = null;
	
	// Time scale - pixels per day (default 10, but will load from cache)
	private timeScale: number = 10;

	// Timeline configuration - set via view state
	private timelineId: string = "";
	private timelineName: string = "Timeline";
	private rootPath: string = "";

	// Cache service reference (set by plugin)
	private cacheService: TimelineCacheService | null = null;

	// Viewport save timeout for debouncing
	private viewportSaveTimeout: ReturnType<typeof setTimeout> | null = null;

	// Track if we've rendered (to avoid double-render)
	private hasRendered: boolean = false;
	
	// Track if config has been set (render waits for this)
	private configReady: boolean = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.historyManager = new TimelineHistoryManager();
	}

	/**
	 * Set the cache service reference
	 */
	setCacheService(cacheService: TimelineCacheService): void {
		this.cacheService = cacheService;
	}

	/**
	 * Set the timeline configuration for this view
	 * This triggers render if not already rendered
	 */
	setTimelineConfig(config: TimelineViewConfig): void {
		console.log(`Timeline View: Setting config for ${config.name} (${config.id})`);
		this.timelineId = config.id;
		this.timelineName = config.name;
		this.rootPath = config.rootPath;
		
		// Load viewport from cache (if exists)
		if (this.cacheService) {
			const viewport = this.cacheService.getViewport(this.timelineId);
			if (viewport) {
				this.timeScale = viewport.timeScale;
				console.log(`Timeline View: Loaded viewport from cache: timeScale=${viewport.timeScale}, scale=${viewport.scale ?? 1}`);
			} else {
				console.log(`Timeline View: No cached viewport, using default timeScale: ${this.timeScale}`);
			}
		}
		
		// Mark config as ready
		this.configReady = true;
		
		// Render now if we haven't already (onOpen was waiting for config)
		if (!this.hasRendered) {
			console.log('Timeline View: Config ready, triggering render');
			void this.render();
		}
	}

	/**
	 * Get the timeline ID for this view
	 */
	getTimelineId(): string {
		return this.timelineId;
	}

	/**
	 * Get the root path for this view
	 */
	getRootPath(): string {
		return this.rootPath;
	}

	getViewType(): string {
		return VIEW_TYPE_TIMELINE;
	}

	getDisplayText(): string {
		return this.timelineName || "Timeline";
	}

	getIcon(): string {
		return "calendar";
	}

	/**
	 * Get the view state for persistence
	 */
	getState(): Record<string, unknown> {
		return {
			timelineId: this.timelineId
		};
	}

	/**
	 * Restore view state - called by Obsidian when restoring workspace
	 */
	async setState(state: Record<string, unknown>, result: { history: boolean }): Promise<void> {
		if (state && typeof state.timelineId === 'string') {
			this.timelineId = state.timelineId;
			// The config will be loaded by the plugin when this view opens
		}
		await super.setState(state, result);
	}

	private parseDate(dateStr: string): TimelineDate | null {
		return TimelineDate.fromString(dateStr);
	}

	private daysBetween(start: TimelineDate, end: TimelineDate): number {
		return end.getDaysFromEpoch() - start.getDaysFromEpoch();
	}

	/**
	 * Check if a file path is within the configured root path
	 */
	private isFileInScope(filePath: string): boolean {
		if (this.rootPath === "") {
			return true;
		}
		return filePath === this.rootPath || filePath.startsWith(this.rootPath + "/");
	}

	/**
	 * Create a FileService instance for this timeline
	 */
	private createFileService(): FileService | null {
		if (!this.cacheService) return null;
		
		return new FileService({
			app: this.app,
			timeScale: this.timeScale,
			rootPath: this.rootPath,
			timelineId: this.timelineId,
			cacheService: this.cacheService
		});
	}

	async collectTimelineItems(): Promise<TimelineItem[]> {
		const fileService = this.createFileService();
		if (!fileService) return [];
		
		return await fileService.collectTimelineItems();
	}

	private pixelsToDate(pixels: number): string {
		const days = Math.round(TimeScaleManager.worldXToDay(pixels, this.timeScale));
		const date = TimelineDate.fromDaysFromEpoch(days);
		return date.toISOString();
	}

	private recalculateItemPositions(): void {
		for (let i = 0; i < this.timelineItems.length; i++) {
			const item = this.timelineItems[i]!;
			
			const dateStart = this.parseDate(item.dateStart);
			if (!dateStart) continue;
			const daysFromStart = dateStart.getDaysFromEpoch();
			const newX = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);
			
			const dateEnd = this.parseDate(item.dateEnd);
			if (!dateEnd) continue;
			const duration = dateEnd.getDaysFromEpoch() - dateStart.getDaysFromEpoch();
			const newWidth = Math.max(duration, 1) * this.timeScale;
			
			this.timelineItems[i] = {
				...item,
				x: newX,
				width: newWidth
			};
		}
		
		// Update selection data for active item when time scale changes
		if (this.activeIndex !== null && this.selectedCardData) {
			const item = this.timelineItems[this.activeIndex];
			if (item) {
				const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
				const daysStart = Math.round(TimeScaleManager.worldXToDay(item.x, this.timeScale));
				const daysEnd = Math.round(TimeScaleManager.worldXToDay(item.x + item.width, this.timeScale));
				
				this.selectedCardData = {
					...this.selectedCardData,
					startX: item.x,
					endX: item.x + item.width,
					startDate: TimeScaleManager.formatDateForLevel(daysStart, scaleLevel),
					endDate: TimeScaleManager.formatDateForLevel(daysEnd, scaleLevel)
				};
				
				this.updateSelectionInComponent();
			}
		}
	}

	private async updateItemDates(index: number, newX: number, newWidth: number): Promise<void> {
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		
		const newDateStart = this.pixelsToDate(newX);
		const endPixels = newX + newWidth;
		const newDateEnd = this.pixelsToDate(endPixels);
		
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		try {
			const content = await this.app.vault.read(item.file);
			
			const newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
			
			await this.app.vault.modify(item.file, newContent);
			
			this.timelineItems[index] = {
				...item,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				x: newX,
				width: newWidth
			};
			
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0
			};
			this.historyManager.record(item.file, previousState, newState, 'resize');
			
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				timestamp: Date.now()
			});
		} catch (error) {
			console.error(`Timeline: Failed to update ${item.file.basename}:`, error);
			new Notice(`Failed to update ${item.file.basename}: ${error}`);
		}
	}

	private async updateItemPosition(index: number, newX: number, newY: number): Promise<void> {
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		
		const newDateStart = this.pixelsToDate(newX);
		const endPixels = newX + item.width;
		const newDateEnd = this.pixelsToDate(endPixels);
		
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		try {
			const content = await this.app.vault.read(item.file);
			
			const newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
			
			await this.app.vault.modify(item.file, newContent);
			
			this.timelineItems[index] = {
				...item,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				x: newX,
				y: newY
			};
			
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0
			};
			this.historyManager.record(item.file, previousState, newState, 'move');
			
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				timestamp: Date.now()
			});
		} catch (error) {
			console.error(`Timeline: Failed to move ${item.file.basename}:`, error);
			new Notice(`Failed to move ${item.file.basename}: ${error}`);
		}
	}

	private async updateItemLayer(index: number, targetLayer: number, newX: number, newWidth: number): Promise<void> {
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		const newDateStart = this.pixelsToDate(newX);
		const newDateEnd = this.pixelsToDate(newX + newWidth);
		const dateStart = this.parseDate(newDateStart);
		const dateEnd = this.parseDate(newDateEnd);
		
		if (!dateStart || !dateEnd) {
			console.error(`Timeline: Invalid dates for ${item.file.basename}`);
			return;
		}
		
		let finalLayer = targetLayer;
		let hasCollision = false;
		
		for (const otherItem of this.timelineItems) {
			if (otherItem.file.path === item.file.path) continue;
			if (otherItem.layer !== targetLayer) continue;
			
			const otherDateStart = this.parseDate(otherItem.dateStart);
			const otherDateEnd = this.parseDate(otherItem.dateEnd);
			
			if (!otherDateStart || !otherDateEnd) continue;
			
			if (LayerManager.rangesOverlap(dateStart, dateEnd, otherDateStart, otherDateEnd)) {
				hasCollision = true;
				break;
			}
		}
		
		if (hasCollision) {
			const maxSearch = Math.max(this.timelineItems.length * 2, 100);
			let found = false;
			
			for (let i = 1; i < maxSearch && !found; i++) {
				const layerAbove = targetLayer + i;
				let layerBusy = false;
				
				for (const otherItem of this.timelineItems) {
					if (otherItem.file.path === item.file.path) continue;
					if (otherItem.layer !== layerAbove) continue;
					
					const otherDateStart = this.parseDate(otherItem.dateStart);
					const otherDateEnd = this.parseDate(otherItem.dateEnd);
					
					if (!otherDateStart || !otherDateEnd) continue;
					
					if (LayerManager.rangesOverlap(dateStart, dateEnd, otherDateStart, otherDateEnd)) {
						layerBusy = true;
						break;
					}
				}
				
				if (!layerBusy) {
					finalLayer = layerAbove;
					found = true;
					break;
				}
				
				const layerBelow = targetLayer - i;
				layerBusy = false;
				
				for (const otherItem of this.timelineItems) {
					if (otherItem.file.path === item.file.path) continue;
					if (otherItem.layer !== layerBelow) continue;
					
					const otherDateStart = this.parseDate(otherItem.dateStart);
					const otherDateEnd = this.parseDate(otherItem.dateEnd);
					
					if (!otherDateStart || !otherDateEnd) continue;
					
					if (LayerManager.rangesOverlap(dateStart, dateEnd, otherDateStart, otherDateEnd)) {
						layerBusy = true;
						break;
					}
				}
				
				if (!layerBusy) {
					finalLayer = layerBelow;
					found = true;
					break;
				}
			}
			
			if (!found) {
				console.warn(`Timeline: No available layer found for ${item.file.basename}, using target layer ${targetLayer} with overlap`);
			}
		}
		
		const newY = LayerManager.layerToY(finalLayer);
		
		try {
			// Update dates in file (layer is now in cache only)
			const content = await this.app.vault.read(item.file);
			const newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
			
			await this.app.vault.modify(item.file, newContent);
			
			// Update layer in cache
			if (this.cacheService) {
				const noteId = this.cacheService.getNoteId(item.file);
				if (noteId) {
					this.cacheService.setNoteLayer(this.timelineId, noteId, finalLayer, item.file.path);
				}
			}
			
			this.timelineItems[index] = {
				...item,
				x: newX,
				width: newWidth,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: finalLayer,
				y: newY
			};
			
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: finalLayer
			};
			this.historyManager.record(item.file, previousState, newState, 'layer-change');
			
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				timestamp: Date.now()
			});
			
			if (this.component && this.component.refreshItems) {
				this.component.refreshItems(this.timelineItems);
			}
		} catch (error) {
			console.error(`Timeline: Failed to update layer for ${item.file.basename}:`, error);
			new Notice(`Failed to update layer for ${item.file.basename}: ${error}`);
		}
	}

	/**
	 * Multi-select move: Move all selected items by the same delta
	 */
	private async updateItemsMove(activeIndex: number, deltaX: number, deltaY: number): Promise<void> {
		// Get all selected items including the active one
		const indicesToMove = Array.from(this.selectedIndices).filter(index => 
			index >= 0 && index < this.timelineItems.length
		);
		
		if (indicesToMove.length === 0) return;
		
		// Move all selected items by the same delta
		for (const index of indicesToMove) {
			const item = this.timelineItems[index]!;
			const newX = item.x + deltaX;
			const newY = item.y + deltaY;
			
			const newDateStart = this.pixelsToDate(newX);
			const endPixels = newX + item.width;
			const newDateEnd = this.pixelsToDate(endPixels);
			
			const previousState: TimelineState = {
				dateStart: item.dateStart,
				dateEnd: item.dateEnd,
				layer: item.layer ?? 0
			};
			
			try {
				const content = await this.app.vault.read(item.file);
				
				const newContent = content
					.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
					.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
				
				await this.app.vault.modify(item.file, newContent);
				
				this.timelineItems[index] = {
					...item,
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					x: newX,
					y: newY
				};
				
				const newState: TimelineState = {
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					layer: item.layer ?? 0
				};
				this.historyManager.record(item.file, previousState, newState, 'move');
				
				this.expectedFileStates.set(item.file.path, {
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					timestamp: Date.now()
				});
			} catch (error) {
				console.error(`Timeline: Failed to move ${item.file.basename}:`, error);
				new Notice(`Failed to move ${item.file.basename}: ${error}`);
			}
		}
		
		if (this.component && this.component.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
		
		// Update selection data for the active item
		if (this.activeIndex !== null) {
			this.updateSelectedCardData(this.activeIndex);
			this.updateSelectionInComponent();
		}
	}

	/**
	 * Multi-select resize: Resize all selected items by the same edge delta
	 * Each card is clamped independently to the minimum width for the current scale level
	 */
	private async updateItemsResize(activeIndex: number, edge: 'left' | 'right', deltaX: number): Promise<void> {
		// Get all selected items including the active one
		const indicesToResize = Array.from(this.selectedIndices).filter(index => 
			index >= 0 && index < this.timelineItems.length
		);
		
		if (indicesToResize.length === 0) return;
		
		// Minimum width is based on the current scale level's unit
		// (e.g., 1 day, 1 month, 1 year, etc. depending on zoom)
		const MIN_WIDTH = TimeScaleManager.getMinResizeWidth(this.timeScale);
		
		// Resize all selected items by the same delta on the same edge
		// Each card clamps independently - cards that would go below minimum stay at minimum
		for (const index of indicesToResize) {
			const item = this.timelineItems[index]!;
			
			let newX = item.x;
			let newWidth = item.width;
			
			if (edge === 'left') {
				// Moving left edge: adjust x and width by delta
				newX = item.x + deltaX;
				newWidth = item.width - deltaX;
			} else {
				// Moving right edge: adjust width by delta
				newWidth = item.width + deltaX;
			}
			
			// Per-card minimum width enforcement: clamp to scale-appropriate minimum
			// This allows multi-select resize where some cards may hit minimum while others continue
			if (newWidth < MIN_WIDTH) {
				newWidth = MIN_WIDTH;
				if (edge === 'left') {
					// For left edge resize, adjust x to keep right edge fixed when clamping
					newX = item.x + item.width - MIN_WIDTH;
				}
				// Note: We don't prevent the resize operation - other cards may still resize normally
			}
			
			const newDateStart = this.pixelsToDate(newX);
			const endPixels = newX + newWidth;
			const newDateEnd = this.pixelsToDate(endPixels);
			
			const previousState: TimelineState = {
				dateStart: item.dateStart,
				dateEnd: item.dateEnd,
				layer: item.layer ?? 0
			};
			
			try {
				const content = await this.app.vault.read(item.file);
				
				const newContent = content
					.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
					.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
				
				await this.app.vault.modify(item.file, newContent);
				
				this.timelineItems[index] = {
					...item,
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					x: newX,
					width: newWidth
				};
				
				const newState: TimelineState = {
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					layer: item.layer ?? 0
				};
				this.historyManager.record(item.file, previousState, newState, 'resize');
				
				this.expectedFileStates.set(item.file.path, {
					dateStart: newDateStart,
					dateEnd: newDateEnd,
					timestamp: Date.now()
				});
			} catch (error) {
				console.error(`Timeline: Failed to resize ${item.file.basename}:`, error);
				new Notice(`Failed to resize ${item.file.basename}: ${error}`);
			}
		}
		
		if (this.component && this.component.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
		
		// Update selection data for the active item
		if (this.activeIndex !== null) {
			this.updateSelectedCardData(this.activeIndex);
			this.updateSelectionInComponent();
		}
	}

	private async openFile(index: number): Promise<void> {
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index for open', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		
		try {
			const file = this.app.vault.getAbstractFileByPath(item.file.path);
			if (file && file instanceof TFile) {
				let existingLeaf: WorkspaceLeaf | null = null;
				
				this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
					const view = leaf.view as { 
						file?: { path: string }; 
						getState?: () => { file?: string }; 
					};
					
					const leafFilePath = view?.file?.path || 
									 view?.getState?.()?.file;
					
					if (leafFilePath === item.file.path) {
						existingLeaf = leaf;
						return true;
					}
					return false;
				});
				
				if (existingLeaf) {
					this.app.workspace.setActiveLeaf(existingLeaf);
				} else {
					const leaf = this.app.workspace.getLeaf('tab');
					await leaf.openFile(file);
				}
			} else {
				console.error(`Timeline: Could not find file ${item.file.path}`);
				new Notice(`Could not find file: ${item.file.basename}`);
			}
		} catch (error) {
			console.error(`Timeline: Failed to open ${item.file.basename}:`, error);
			new Notice(`Failed to open ${item.file.basename}: ${error}`);
		}
	}

	private selectCard(index: number): void {
		if (this.leaf !== this.app.workspace.activeLeaf) {
			this.app.workspace.setActiveLeaf(this.leaf);
		}

		// Click without modifier: select only this card, clear all others
		this.selectedIndices.clear();
		this.selectedIndices.add(index);
		this.activeIndex = index;
		
		this.updateSelectedCardData(index);
		this.updateSelectionInComponent();
	}

	private toggleSelection(index: number): void {
		if (this.leaf !== this.app.workspace.activeLeaf) {
			this.app.workspace.setActiveLeaf(this.leaf);
		}

		// Shift+click: toggle this card in selection
		if (this.selectedIndices.has(index)) {
			this.selectedIndices.delete(index);
			if (this.activeIndex === index) {
				// If we removed the active item, set active to last selected or null
				const lastSelected = Array.from(this.selectedIndices).pop();
				this.activeIndex = lastSelected ?? null;
			}
		} else {
			this.selectedIndices.add(index);
			this.activeIndex = index;
		}
		
		// Update primary selection data for display
		if (this.activeIndex !== null) {
			this.updateSelectedCardData(this.activeIndex);
		} else {
			this.selectedCardData = null;
		}
		
		this.updateSelectionInComponent();
	}

	private clearSelection(): void {
		this.selectedIndices.clear();
		this.activeIndex = null;
		this.selectedCardData = null;
		this.updateSelectionInComponent();
	}

	private updateSelectedCardData(index: number): void {
		if (index >= 0 && index < this.timelineItems.length) {
			const item = this.timelineItems[index]!;
			
			const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
			const daysStart = Math.round(TimeScaleManager.worldXToDay(item.x, this.timeScale));
			const daysEnd = Math.round(TimeScaleManager.worldXToDay(item.x + item.width, this.timeScale));
			
			this.selectedCardData = {
				startX: item.x,
				endX: item.x + item.width,
				startDate: TimeScaleManager.formatDateForLevel(daysStart, scaleLevel),
				endDate: TimeScaleManager.formatDateForLevel(daysEnd, scaleLevel),
				title: item.title
			};
		}
	}

	private showCardContextMenu(index: number, event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		if (index < 0 || index >= this.timelineItems.length) {
			return;
		}

		const item = this.timelineItems[index]!;

		const menu = new Menu();
		menu.setUseNativeMenu(false);

		menu.addItem((itemMenu) => {
			itemMenu
				.setTitle("Fit to View")
				.setIcon("maximize")
				.onClick(() => {
					this.selectCard(index);
					if (this.component && 'fitCardWidth' in this.component) {
						(this.component as { fitCardWidth: (x: number, width: number) => void }).fitCardWidth(item.x, item.width);
					}
				});
		});

		menu.addSeparator();

		menu.addItem((itemMenu) => {
			itemMenu
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => {
					this.selectCard(index);
					this.handleDeleteCard();
				});
		});

		menu.showAtMouseEvent(event);
	}

	private handleDeleteCard(): void {
		// Get all selected items
		const selectedItems = Array.from(this.selectedIndices)
			.filter(index => index >= 0 && index < this.timelineItems.length)
			.map(index => this.timelineItems[index]!);
		
		if (selectedItems.length === 0) {
			return;
		}
		
		// For single selection, use existing modal; for multi, create a summary
		if (selectedItems.length === 1) {
			const file = selectedItems[0]!.file;
			new DeleteConfirmModal(this.app, file, async (action: DeleteAction) => {
				switch (action) {
					case 'remove-from-timeline':
						await this.removeCardsFromTimeline(selectedItems.map(item => item.file));
						break;
					case 'move-to-trash':
						await this.moveCardsToTrash(selectedItems.map(item => item.file));
						break;
					case 'cancel':
					default:
						break;
				}
			}).open();
		} else {
			// Multi-delete confirmation
			const fileNames = selectedItems.map(item => item.file.basename).join(', ');
			new DeleteConfirmModal(this.app, selectedItems[0]!.file, async (action: DeleteAction) => {
				switch (action) {
					case 'remove-from-timeline':
						await this.removeCardsFromTimeline(selectedItems.map(item => item.file));
						break;
					case 'move-to-trash':
						await this.moveCardsToTrash(selectedItems.map(item => item.file));
						break;
					case 'cancel':
					default:
						break;
				}
			}, `Delete ${selectedItems.length} cards (${fileNames.substring(0, 50)}${fileNames.length > 50 ? '...' : ''})?`).open();
		}
	}

	private async removeCardFromTimeline(file: TFile): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				delete frontmatter['timeline'];
			});
			new Notice(`Removed "${file.basename}" from timeline`);
			
			// Remove from cache
			if (this.cacheService) {
				const noteId = this.cacheService.getNoteId(file);
				if (noteId) {
					this.cacheService.removeNoteFromTimeline(this.timelineId, noteId);
				}
			}
			
			this.clearSelection();
			await this.refreshTimeline();
		} catch (error) {
			console.error('Error removing card from timeline:', error);
			new Notice(`Failed to remove "${file.basename}" from timeline`);
		}
	}

	private async moveCardToTrash(file: TFile): Promise<void> {
		try {
			await this.app.vault.trash(file, false);
			new Notice(`Moved "${file.basename}" to trash`);
			
			// Remove from cache
			if (this.cacheService) {
				const noteId = this.cacheService.getNoteId(file);
				if (noteId) {
					this.cacheService.removeNoteFromTimeline(this.timelineId, noteId);
				}
			}
			
			this.clearSelection();
			await this.refreshTimeline();
		} catch (error) {
			console.error('Error moving card to trash:', error);
			new Notice(`Failed to move "${file.basename}" to trash`);
		}
	}

	private async removeCardsFromTimeline(files: TFile[]): Promise<void> {
		let successCount = 0;
		let failCount = 0;
		
		for (const file of files) {
			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					delete frontmatter['timeline'];
				});
				successCount++;
				
				// Remove from cache
				if (this.cacheService) {
					const noteId = this.cacheService.getNoteId(file);
					if (noteId) {
						this.cacheService.removeNoteFromTimeline(this.timelineId, noteId);
					}
				}
			} catch (error) {
				console.error(`Error removing "${file.basename}" from timeline:`, error);
				failCount++;
			}
		}
		
		if (successCount > 0) {
			new Notice(`Removed ${successCount} card${successCount > 1 ? 's' : ''} from timeline`);
		}
		if (failCount > 0) {
			new Notice(`Failed to remove ${failCount} card${failCount > 1 ? 's' : ''}`);
		}
		
		this.clearSelection();
		await this.refreshTimeline();
	}

	private async moveCardsToTrash(files: TFile[]): Promise<void> {
		let successCount = 0;
		let failCount = 0;
		
		for (const file of files) {
			try {
				await this.app.vault.trash(file, false);
				successCount++;
				
				// Remove from cache
				if (this.cacheService) {
					const noteId = this.cacheService.getNoteId(file);
					if (noteId) {
						this.cacheService.removeNoteFromTimeline(this.timelineId, noteId);
					}
				}
			} catch (error) {
				console.error(`Error moving "${file.basename}" to trash:`, error);
				failCount++;
			}
		}
		
		if (successCount > 0) {
			new Notice(`Moved ${successCount} card${successCount > 1 ? 's' : ''} to trash`);
		}
		if (failCount > 0) {
			new Notice(`Failed to move ${failCount} card${failCount > 1 ? 's' : ''} to trash`);
		}
		
		this.clearSelection();
		await this.refreshTimeline();
	}

	private async refreshTimeline(): Promise<void> {
		this.timelineItems = await this.collectTimelineItems();
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}

	goToItem(item: TimelineItem): void {
		const index = this.timelineItems.findIndex(i => i.file.path === item.file.path);
		if (index === -1) {
			console.error('Timeline: Item not found in timeline', item.file.path);
			return;
		}

		if (this.component?.centerOnItem) {
			this.component.centerOnItem(index);
		}

		this.selectCard(index);
	}

	fitToCardByPath(filePath: string): void {
		const index = this.timelineItems.findIndex(i => i.file.path === filePath);
		if (index === -1) {
			return;
		}

		const item = this.timelineItems[index]!;
		this.selectCard(index);

		if (this.component && 'fitCardWidth' in this.component) {
			(this.component as { fitCardWidth: (x: number, width: number) => void }).fitCardWidth(item.x, item.width);
		}
	}

	private updateSelectionInComponent(): void {
		if (this.component?.setSelection) {
			this.component.setSelection(this.selectedIndices, this.activeIndex, this.selectedCardData);
		}
	}

	/**
	 * Schedule a viewport save (debounced)
	 */
	private scheduleViewportSave(): void {
		if (this.viewportSaveTimeout) {
			clearTimeout(this.viewportSaveTimeout);
		}
		
		this.viewportSaveTimeout = setTimeout(() => {
			void this.saveViewport();
		}, 500);
	}

	/**
	 * Save current viewport to cache
	 */
	private async saveViewport(): Promise<void> {
		// Don't save without a valid timeline ID
		if (!this.timelineId || !this.cacheService || !this.component) return;
		
		const getViewport = this.component.getViewport;
		if (!getViewport) return;
		
		const viewport = getViewport();
		if (!viewport) return;
		
		this.cacheService.setViewport(this.timelineId, viewport);
	}

	async render() {
		// Prevent double-render
		if (this.hasRendered) {
			console.log('Timeline View: render() skipped - already rendered');
			return;
		}
		
		// Don't render without config (would use wrong timelineId)
		if (!this.configReady) {
			console.log('Timeline View: render() skipped - waiting for config');
			return;
		}
		
		this.hasRendered = true;
		
		await new Promise(resolve => requestAnimationFrame(resolve));
		
		if (!this.contentEl) {
			console.error("contentEl is null!");
			return;
		}

		this.contentEl.empty();

		this.timelineItems = await this.collectTimelineItems();
		
		// Load viewport from cache (may be null if first time)
		const savedViewport = this.cacheService?.getViewport(this.timelineId) ?? null;
		console.log(`Timeline View: render() - timelineId=${this.timelineId}, savedViewport:`, savedViewport);
		if (savedViewport) {
			this.timeScale = savedViewport.timeScale;
		}

		try {
			this.component = mount(Timeline, {
				target: this.contentEl,
				props: {
					items: this.timelineItems,
					selectedIndices: this.selectedIndices,
					activeIndex: this.activeIndex,
					selectedCard: this.selectedCardData,
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
							void this.openFile(index);
						}
					},
					onItemSelect: (index: number) => {
						this.selectCard(index);
					},
					onUpdateSelectionData: (startX: number, endX: number, startDate: string, endDate: string) => {
						if (this.activeIndex !== null && this.selectedCardData) {
							const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
							const daysStart = Math.round(TimeScaleManager.worldXToDay(startX, this.timeScale));
							const daysEnd = Math.round(TimeScaleManager.worldXToDay(endX, this.timeScale));
							
							this.selectedCardData = {
								...this.selectedCardData,
								startX,
								endX,
								startDate: TimeScaleManager.formatDateForLevel(daysStart, scaleLevel),
								endDate: TimeScaleManager.formatDateForLevel(daysEnd, scaleLevel)
							};
							if (this.component && this.component.setSelection) {
								this.component.setSelection(this.selectedIndices, this.activeIndex, this.selectedCardData);
							}
						}
					},
					onTimeScaleChange: (timeScale: number) => {
						this.timeScale = timeScale;
						this.recalculateItemPositions();
						if (this.component && this.component.refreshItems) {
							this.component.refreshItems(this.timelineItems);
						}
						this.scheduleViewportSave();
					},
					onCanvasClick: () => {
						this.clearSelection();
					},
					onItemContextMenu: (index: number, event: MouseEvent) => {
						this.showCardContextMenu(index, event);
					},
					onViewportChange: () => {
						this.scheduleViewportSave();
					}
				}
			});
			console.log("Timeline component mounted with", this.timelineItems.length, "items");
		} catch (error) {
			console.error("Error mounting Timeline component:", error);
			this.contentEl.createDiv({ text: "Error loading timeline: " + String(error) });
		}
	}

	private metadataChangeTimeout: ReturnType<typeof setTimeout> | null = null;

	async undo(): Promise<boolean> {
		const entry = this.historyManager.undo();
		if (!entry) {
			console.log('Timeline: Nothing to undo');
			return false;
		}

		console.log(`Timeline: Undoing ${entry.operationType} for ${entry.file.basename}`);

		try {
			const content = await this.app.vault.read(entry.file);
			
			let newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${entry.previousState.dateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${entry.previousState.dateEnd}`);
			
			await this.app.vault.modify(entry.file, newContent);
			
			// Update layer in cache
			if (this.cacheService && entry.previousState.layer !== undefined) {
				const noteId = this.cacheService.getNoteId(entry.file);
				if (noteId) {
					this.cacheService.setNoteLayer(this.timelineId, noteId, entry.previousState.layer, entry.file.path);
				}
			}
			
			this.expectedFileStates.set(entry.file.path, {
				dateStart: entry.previousState.dateStart,
				dateEnd: entry.previousState.dateEnd,
				timestamp: Date.now()
			});
			
			const itemIndex = this.timelineItems.findIndex(item => item.file.path === entry.file.path);
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				
				const prevDateStart = this.parseDate(entry.previousState.dateStart)!;
				const prevDateEnd = this.parseDate(entry.previousState.dateEnd)!;
				const daysFromStart = prevDateStart.getDaysFromEpoch();
				const newX = daysFromStart * this.timeScale;
				const duration = prevDateEnd.getDaysFromEpoch() - prevDateStart.getDaysFromEpoch();
				const newWidth = Math.max(duration, 1) * this.timeScale;
				const newY = LayerManager.layerToY(entry.previousState.layer);
				
				this.timelineItems[itemIndex] = {
					...item,
					dateStart: entry.previousState.dateStart,
					dateEnd: entry.previousState.dateEnd,
					layer: entry.previousState.layer,
					x: newX,
					y: newY,
					width: newWidth
				};
				
				if (this.component && this.component.refreshItems) {
					this.component.refreshItems(this.timelineItems);
				}
			}
			
			return true;
		} catch (error) {
			console.error(`Timeline: Failed to undo ${entry.operationType} for ${entry.file.basename}:`, error);
			return false;
		}
	}

	async redo(): Promise<boolean> {
		const entry = this.historyManager.redo();
		if (!entry) {
			console.log('Timeline: Nothing to redo');
			return false;
		}

		console.log(`Timeline: Redoing ${entry.operationType} for ${entry.file.basename}`);

		try {
			const content = await this.app.vault.read(entry.file);
			
			let newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${entry.newState.dateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${entry.newState.dateEnd}`);
			
			await this.app.vault.modify(entry.file, newContent);
			
			// Update layer in cache
			if (this.cacheService && entry.newState.layer !== undefined) {
				const noteId = this.cacheService.getNoteId(entry.file);
				if (noteId) {
					this.cacheService.setNoteLayer(this.timelineId, noteId, entry.newState.layer, entry.file.path);
				}
			}
			
			this.expectedFileStates.set(entry.file.path, {
				dateStart: entry.newState.dateStart,
				dateEnd: entry.newState.dateEnd,
				timestamp: Date.now()
			});
			
			const itemIndex = this.timelineItems.findIndex(item => item.file.path === entry.file.path);
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				
				const newDateStart = this.parseDate(entry.newState.dateStart)!;
				const newDateEnd = this.parseDate(entry.newState.dateEnd)!;
				const daysFromStart = newDateStart.getDaysFromEpoch();
				const newX = daysFromStart * this.timeScale;
				const duration = newDateEnd.getDaysFromEpoch() - newDateStart.getDaysFromEpoch();
				const newWidth = Math.max(duration, 1) * this.timeScale;
				const newY = LayerManager.layerToY(entry.newState.layer);
				
				this.timelineItems[itemIndex] = {
					...item,
					dateStart: entry.newState.dateStart,
					dateEnd: entry.newState.dateEnd,
					layer: entry.newState.layer,
					x: newX,
					y: newY,
					width: newWidth
				};
				
				if (this.component && this.component.refreshItems) {
					this.component.refreshItems(this.timelineItems);
				}
			}
			
			return true;
		} catch (error) {
			console.error(`Timeline: Failed to redo ${entry.operationType} for ${entry.file.basename}:`, error);
			return false;
		}
	}

	async onOpen() {
		// Only render if config is already set (e.g., from setState restoration)
		// Otherwise, setTimelineConfig() will trigger the render
		if (this.configReady) {
			console.log('Timeline View: onOpen - config already ready, rendering');
			await this.render();
		} else {
			console.log('Timeline View: onOpen - waiting for config before rendering');
		}
		
		// Register for file rename events
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				
				// Update cache with new path
				if (this.cacheService) {
					this.cacheService.handleFileRename(oldPath, file.path);
				}
				
				const itemIndex = this.timelineItems.findIndex(item => 
					item.file.path === file.path || item.file.path === oldPath
				);
				
				if (itemIndex !== -1) {
					console.log(`Timeline: File renamed from ${this.timelineItems[itemIndex]!.file.basename} to ${file.basename}`);
					
					this.timelineItems[itemIndex] = {
						...this.timelineItems[itemIndex]!,
						file: file,
						title: file.basename
					};
					
					if (this.component && this.component.refreshItems) {
						this.component.refreshItems(this.timelineItems);
					}
				}
			})
		);
		
		// Register for metadata changes
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!(file instanceof TFile)) return;
				
				const isInTimeline = this.timelineItems.some(item => item.file.path === file.path);
				const metadata = this.app.metadataCache.getFileCache(file);
				const hasTimelineFlag = metadata?.frontmatter?.timeline === true;
				
				if (!isInTimeline && !hasTimelineFlag) {
					return;
				}
				
				const expectedState = this.expectedFileStates.get(file.path);
				if (expectedState) {
					const currentDateStart = String(metadata?.frontmatter?.['date-start'] ?? '');
					const currentDateEnd = String(metadata?.frontmatter?.['date-end'] ?? '');
					
					if (currentDateStart === expectedState.dateStart &&
					    currentDateEnd === expectedState.dateEnd) {
						this.expectedFileStates.delete(file.path);
						return;
					}
					
					if (Date.now() - expectedState.timestamp > 5000) {
						this.expectedFileStates.delete(file.path);
					}
				}
				
				if (this.metadataChangeTimeout) {
					clearTimeout(this.metadataChangeTimeout);
				}
				
				this.metadataChangeTimeout = setTimeout(async () => {
					this.timelineItems = await this.collectTimelineItems();
					
					if (this.component && this.component.refreshItems) {
						this.component.refreshItems(this.timelineItems);
					}
				}, 300);
			})
		);
		
		// Register keyboard shortcuts
		const keydownHandler = (event: KeyboardEvent) => {
			const activeElement = document.activeElement;
			const isEditorFocused = activeElement?.closest('.cm-editor') !== null ||
			                       activeElement?.closest('.markdown-source-view') !== null ||
			                       activeElement?.tagName === 'TEXTAREA' ||
			                       activeElement?.tagName === 'INPUT';

			if (isEditorFocused) return;
			
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || activeLeaf.view !== this) return;
			
			if (!this.contentEl.isConnected) return;
			
			const isDelete = event.key === 'Delete' ||
			                (event.key === 'Backspace' && (event.ctrlKey || event.metaKey));

			if (isDelete && this.selectedIndices.size > 0) {
				event.preventDefault();
				event.stopPropagation();
				this.handleDeleteCard();
				return;
			}
			
			const isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
			const isRedo = ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z') || 
			               ((event.ctrlKey || event.metaKey) && event.key === 'y');
			
			if (!isUndo && !isRedo) return;
			
			if (isUndo) {
				event.preventDefault();
				event.stopPropagation();
				void this.undo();
			} else if (isRedo) {
				event.preventDefault();
				event.stopPropagation();
				void this.redo();
			}
		};
		
		window.addEventListener('keydown', keydownHandler, true);
		this.keydownHandler = keydownHandler;
	}

	async onClose() {
		// Save viewport before closing
		await this.saveViewport();
		
		// Clear any pending timeouts
		if (this.metadataChangeTimeout) {
			clearTimeout(this.metadataChangeTimeout);
			this.metadataChangeTimeout = null;
		}
		
		if (this.viewportSaveTimeout) {
			clearTimeout(this.viewportSaveTimeout);
			this.viewportSaveTimeout = null;
		}
		
		if (this.keydownHandler) {
			window.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}
		
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
