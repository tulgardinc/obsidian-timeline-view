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
		fitTimeRange?: (startDay: number, endDay: number, centerDay: number) => void;
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
	
	// Timeline card refresh timeout for debouncing
	private timelineCardRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

	// Track if we've rendered (to avoid double-render)
	private hasRendered: boolean = false;
	
	// Track if config has been set (render waits for this)
	private configReady: boolean = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.historyManager = new TimelineHistoryManager();
	}

	/**
	 * Type guard to check if a TimelineItem is a note card
	 */
	private isNoteItem(item: TimelineItem): item is { type: 'note'; file: TFile; title: string; x: number; y: number; width: number; dateStart: string; dateEnd: string; layer?: number; color?: TimelineColor } {
		return item.type === 'note';
	}

	/**
	 * Type guard to check if a TimelineItem is a timeline reference card
	 */
	private isTimelineItem(item: TimelineItem): item is { type: 'timeline'; timelineId: string; timelineName: string; title: string; x: number; y: number; width: number; dateStart: string; dateEnd: string; layer?: number; color?: TimelineColor } {
		return item.type === 'timeline';
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
	 * Convert pixel position to date string
	 */
	private pixelsToDate(pixels: number): string {
		const days = Math.round(TimeScaleManager.worldXToDay(pixels, this.timeScale));
		const date = TimelineDate.fromDaysFromEpoch(days);
		return date.toISOString();
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
		
		// Collect note cards from files
		const noteItems = await fileService.collectTimelineItems();
		
		// Collect timeline cards from cache
		const timelineCardItems: TimelineItem[] = [];
		if (this.cacheService) {
			const timelineCards = this.cacheService.getTimelineCards(this.timelineId);
			if (timelineCards) {
				for (const [referencedTimelineId, cardData] of Object.entries(timelineCards)) {
					// Find the referenced timeline config
					const plugin = (this.app as any).plugins?.plugins?.['timeline'];
					const timelineConfig = plugin?.settings?.timelineViews?.find(
						(t: { id: string }) => t.id === referencedTimelineId
					);
					
					if (!timelineConfig) {
						console.warn(`Timeline: Referenced timeline ${referencedTimelineId} not found, removing card`);
						this.cacheService.removeTimelineCard(this.timelineId, referencedTimelineId);
						continue;
					}
					
					// Calculate the span of the referenced timeline
					const span = await this.calculateTimelineSpan(referencedTimelineId, timelineConfig.rootPath);
					if (!span) {
						console.warn(`Timeline: Could not calculate span for ${timelineConfig.name}, skipping card`);
						continue;
					}
					
					// Create timeline card item
					const startX = TimeScaleManager.dayToWorldX(span.startDay, this.timeScale);
					const endX = TimeScaleManager.dayToWorldX(span.endDay, this.timeScale);
					const width = endX - startX;
					const y = LayerManager.layerToY(cardData.layer);
					
					const timelineItem: TimelineItem = {
						type: 'timeline',
						timelineId: referencedTimelineId,
						timelineName: timelineConfig.name,
						title: `Timeline: ${timelineConfig.name}`,
						x: startX,
						y: y,
						width: width,
						dateStart: TimelineDate.fromDaysFromEpoch(span.startDay).toISOString(),
						dateEnd: TimelineDate.fromDaysFromEpoch(span.endDay).toISOString(),
						layer: cardData.layer
					};
					
					// Apply cached color if present
					if (cardData.color) {
						timelineItem.color = cardData.color;
					}
					
					timelineCardItems.push(timelineItem);
				}
			}
		}
		
		// Combine note items and timeline cards
		return [...noteItems, ...timelineCardItems];
	}
	
	/**
	 * Calculate the time span of a timeline (min start date, max end date)
	 */
	private async calculateTimelineSpan(timelineId: string, rootPath: string): Promise<{ startDay: number; endDay: number } | null> {
		// Create a temporary file service to collect items from the referenced timeline
		const tempService = new FileService({
			app: this.app,
			timeScale: this.timeScale,
			rootPath: rootPath,
			timelineId: timelineId,
			cacheService: this.cacheService!
		});
		
		try {
			const items = await tempService.collectTimelineItems();
			if (items.length === 0) return null;
			
			// Find min start and max end
			let minStartDay = Infinity;
			let maxEndDay = -Infinity;
			
			for (const item of items) {
				const startDate = this.parseDate(item.dateStart);
				const endDate = this.parseDate(item.dateEnd);
				
				if (!startDate || !endDate) continue;
				
				const startDay = startDate.getDaysFromEpoch();
				const endDay = endDate.getDaysFromEpoch();
				
				if (startDay < minStartDay) minStartDay = startDay;
				if (endDay > maxEndDay) maxEndDay = endDay;
			}
			
			if (minStartDay === Infinity || maxEndDay === -Infinity) return null;
			
			return { startDay: minStartDay, endDay: maxEndDay };
		} catch (error) {
			console.error(`Timeline: Error calculating span for ${timelineId}:`, error);
			return null;
		}
	}
	
	/**
	 * Refresh timeline card spans asynchronously
	 * This checks if any referenced timelines have changed their span and updates the cards
	 */
	private async refreshTimelineCardsAsync(): Promise<void> {
		if (!this.cacheService) return;
		
		// Get current timeline cards from items
		const currentTimelineCards = this.timelineItems.filter(item => this.isTimelineItem(item));
		if (currentTimelineCards.length === 0) return;
		
		console.log(`Timeline: Refreshing ${currentTimelineCards.length} timeline card(s) asynchronously`);
		
		// Recalculate spans for all timeline cards concurrently
		const updatePromises = currentTimelineCards.map(async (card) => {
			const timelineCard = card as { type: 'timeline'; timelineId: string; timelineName: string; layer?: number; dateStart: string; dateEnd: string; x: number; y: number; width: number; title: string };
			
			// Find the referenced timeline config
			const plugin = (this.app as any).plugins?.plugins?.['timeline'];
			const timelineConfig = plugin?.settings?.timelineViews?.find(
				(t: { id: string }) => t.id === timelineCard.timelineId
			);
			
			if (!timelineConfig) {
				console.warn(`Timeline: Referenced timeline ${timelineCard.timelineId} not found during refresh`);
				return null;
			}
			
			// Recalculate span
			const span = await this.calculateTimelineSpan(timelineCard.timelineId, timelineConfig.rootPath);
			if (!span) {
				console.warn(`Timeline: Could not recalculate span for ${timelineConfig.name}`);
				return null;
			}
			
			// Check if span changed
			const oldStartDay = TimelineDate.fromString(timelineCard.dateStart)?.getDaysFromEpoch();
			const oldEndDay = TimelineDate.fromString(timelineCard.dateEnd)?.getDaysFromEpoch();
			
			if (oldStartDay === span.startDay && oldEndDay === span.endDay) {
				// No change needed
				return null;
			}
			
			// Calculate new position
			const startX = TimeScaleManager.dayToWorldX(span.startDay, this.timeScale);
			const endX = TimeScaleManager.dayToWorldX(span.endDay, this.timeScale);
			const width = endX - startX;
			
			return {
				timelineId: timelineCard.timelineId,
				newDateStart: TimelineDate.fromDaysFromEpoch(span.startDay).toISOString(),
				newDateEnd: TimelineDate.fromDaysFromEpoch(span.endDay).toISOString(),
				newX: startX,
				newWidth: width
			};
		});
		
		// Wait for all calculations to complete
		const updates = (await Promise.all(updatePromises)).filter(update => update !== null);
		
		if (updates.length === 0) {
			console.log('Timeline: No timeline card updates needed');
			return;
		}
		
		console.log(`Timeline: Updating ${updates.length} timeline card(s) with new spans`);
		
		// Apply updates to timelineItems
		for (const update of updates) {
			const itemIndex = this.timelineItems.findIndex(
				item => this.isTimelineItem(item) && item.timelineId === update.timelineId
			);
			
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				if (this.isTimelineItem(item)) {
					this.timelineItems[itemIndex] = {
						...item,
						x: update.newX,
						width: update.newWidth,
						dateStart: update.newDateStart,
						dateEnd: update.newDateEnd
					};
				}
			}
		}
		
		// Refresh the component to show updates
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}
	
	/**
	 * Schedule a debounced refresh of timeline cards
	 */
	private scheduleTimelineCardRefresh(): void {
		if (this.timelineCardRefreshTimeout) {
			clearTimeout(this.timelineCardRefreshTimeout);
		}
		
		this.timelineCardRefreshTimeout = setTimeout(() => {
			void this.refreshTimelineCardsAsync();
		}, 300); // 300ms debounce
	}

	/**
	 * Recalculate item positions when time scale changes
	 */
	private recalculateItemPositions(): void {
		for (let i = 0; i < this.timelineItems.length; i++) {
			const item = this.timelineItems[i]!;
			
			const dateStart = this.parseDate(item.dateStart);
			if (!dateStart) continue;
			
			const daysFromStart = dateStart.getDaysFromEpoch();
			const newX = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);
			const duration = this.daysBetween(dateStart, this.parseDate(item.dateEnd) || dateStart);
			const newWidth = Math.max(duration, 1) * this.timeScale;
			
			this.timelineItems[i] = {
				...item,
				x: newX,
				width: newWidth
			};
		}
	}

	/**
	 * Handle multi-select resize operation
	 */
	private async updateItemsResize(index: number, edge: 'left' | 'right', deltaX: number): Promise<void> {
		// For now, just handle single item resize
		// This is a simplified implementation
		const item = this.timelineItems[index];
		if (!item) return;
		
		// Only note cards can be resized
		if (!this.isNoteItem(item)) return;
		
		// Get current values
		let newX = item.x;
		let newWidth = item.width;
		
		if (edge === 'left') {
			newX = item.x + deltaX;
			newWidth = item.width - deltaX;
		} else {
			newWidth = item.width + deltaX;
		}
		
		// Calculate new dates
		const newDateStart = this.pixelsToDate(newX);
		const newDateEnd = this.pixelsToDate(newX + newWidth);
		
		// Update the item
		this.timelineItems[index] = {
			...item,
			x: newX,
			width: newWidth,
			dateStart: newDateStart,
			dateEnd: newDateEnd
		};
		
		// Update file if it's a note
		if (this.isNoteItem(item)) {
			try {
				const content = await this.app.vault.read(item.file);
				const newContent = content
					.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
					.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
				await this.app.vault.modify(item.file, newContent);
			} catch (error) {
				console.error(`Timeline: Failed to update file:`, error);
			}
		}
		
		// Refresh component
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}

	/**
	 * Handle multi-select move operation
	 */
	private async updateItemsMove(index: number, deltaX: number, deltaY: number): Promise<void> {
		const item = this.timelineItems[index];
		if (!item) return;
		
		// Calculate new position
		const newX = item.x + deltaX;
		const newY = item.y + deltaY;
		
		// Calculate new dates from X position
		const newDateStart = this.pixelsToDate(newX);
		const newDateEnd = this.pixelsToDate(newX + item.width);
		
		// Calculate new layer from Y position
		const newLayer = LayerManager.yToLayer(newY);
		const snappedY = LayerManager.layerToY(newLayer);
		
		// Update the item
		this.timelineItems[index] = {
			...item,
			x: newX,
			y: snappedY,
			dateStart: newDateStart,
			dateEnd: newDateEnd,
			layer: newLayer
		};
		
		// Update file if it's a note
		if (this.isNoteItem(item)) {
			try {
				const content = await this.app.vault.read(item.file);
				const newContent = content
					.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
					.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
				await this.app.vault.modify(item.file, newContent);
				
				// Update layer in cache
				if (this.cacheService) {
					const noteId = this.cacheService.getNoteId(item.file);
					if (noteId) {
						this.cacheService.setNoteLayer(this.timelineId, noteId, newLayer, item.file.path);
					}
				}
			} catch (error) {
				console.error(`Timeline: Failed to update file:`, error);
			}
		}
		
		// Refresh component
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}

	/**
	 * Handle layer change operation
	 */
	private async updateItemLayer(index: number, newLayer: number, newX: number, newWidth: number): Promise<void> {
		const item = this.timelineItems[index];
		if (!item) return;
		
		const newY = LayerManager.layerToY(newLayer);
		const newDateStart = this.pixelsToDate(newX);
		const newDateEnd = this.pixelsToDate(newX + newWidth);
		
		// Update the item
		this.timelineItems[index] = {
			...item,
			x: newX,
			y: newY,
			width: newWidth,
			dateStart: newDateStart,
			dateEnd: newDateEnd,
			layer: newLayer
		};
		
		// Update cache based on item type
		if (this.isNoteItem(item) && this.cacheService) {
			const noteId = this.cacheService.getNoteId(item.file);
			if (noteId) {
				this.cacheService.setNoteLayer(this.timelineId, noteId, newLayer, item.file.path);
			}
			
			// Update file
			try {
				const content = await this.app.vault.read(item.file);
				const newContent = content
					.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
					.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
				await this.app.vault.modify(item.file, newContent);
			} catch (error) {
				console.error(`Timeline: Failed to update file:`, error);
			}
		} else if (this.isTimelineItem(item) && this.cacheService) {
			this.cacheService.setTimelineCardLayer(this.timelineId, item.timelineId, newLayer);
		}
		
		// Refresh component
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}

	/**
	 * Open a file or timeline
	 */
	private async openFile(index: number): Promise<void> {
		const item = this.timelineItems[index];
		if (!item) return;
		
		if (this.isTimelineItem(item)) {
			// Open referenced timeline
			const plugin = (this.app as any).plugins?.plugins?.['timeline'];
			if (!plugin) {
				new Notice('Timeline plugin not available');
				return;
			}
			
			const timelineConfig = plugin.settings?.timelineViews?.find(
				(t: { id: string }) => t.id === item.timelineId
			);
			
			if (!timelineConfig) {
				new Notice(`Timeline "${item.timelineName}" not found`);
				return;
			}
			
			await plugin.openTimelineView(timelineConfig);
		} else if (this.isNoteItem(item)) {
			// Open file
			const file = this.app.vault.getAbstractFileByPath(item.file.path);
			if (file && file instanceof TFile) {
				// Check if already open
				let existingLeaf: WorkspaceLeaf | null = null;
				this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
					const view = leaf.view as { file?: { path: string } };
					if (view?.file?.path === item.file.path) {
						existingLeaf = leaf;
					}
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

	/**
	 * Create a new note from a canvas click
	 * The card will have 3 time units duration at current zoom level, default color, and be placed on the clicked layer
	 */
	private async createNoteFromClick(event: { worldX: number; worldY: number }): Promise<void> {
		if (!this.cacheService) {
			new Notice('Timeline cache service not available');
			return;
		}

		try {
			// 1. Calculate start time: snap to closest marker
			const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
			const dayAtClick = TimeScaleManager.worldXToDay(event.worldX, this.timeScale);
			const snappedStartDay = TimeScaleManager.snapToNearestMarker(Math.round(dayAtClick), scaleLevel);

			// 2. Calculate duration: 3 time units at current scale level
			const daysPerUnit = this.getDaysPerUnitAtLevel(scaleLevel);
			const durationDays = daysPerUnit * 3;
			const endDay = snappedStartDay + durationDays;

			// 3. Create dates
			const startDate = TimelineDate.fromDaysFromEpoch(snappedStartDay);
			const endDate = TimelineDate.fromDaysFromEpoch(endDay);
			const startDateStr = startDate.toISOString();
			const endDateStr = endDate.toISOString();

			// 4. Calculate layer from Y position
			const targetLayer = LayerManager.yToLayer(event.worldY);

			// 5. Find available layer (use collision detection)
			const finalLayer = this.findAvailableLayer(targetLayer, startDate, endDate);

			// 6. Create unique filename
			const rootPath = this.rootPath === '' ? '/' : this.rootPath;
			let baseName = `Timeline note ${startDate.getYMD().year}-${String(startDate.getYMD().month).padStart(2, '0')}-${String(startDate.getYMD().day).padStart(2, '0')}`;
			let fileName = `${baseName}.md`;
			let filePath = `${rootPath === '/' ? '' : rootPath}/${fileName}`;

			// Ensure unique filename
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(filePath)) {
				fileName = `${baseName} ${counter}.md`;
				filePath = `${rootPath === '/' ? '' : rootPath}/${fileName}`;
				counter++;
			}

			// 7. Create file with frontmatter
			const content = `---
timeline: true
date-start: ${startDateStr}
date-end: ${endDateStr}
---

# Timeline Note

Created from timeline view.
`;
			const newFile = await this.app.vault.create(filePath, content);

			// 8. Generate note ID and set layer in cache
			const noteId = await this.cacheService.getOrCreateNoteId(newFile);
			this.cacheService.setNoteLayer(this.timelineId, noteId, finalLayer, newFile.path);

			// 9. Create TimelineItem
			const startX = TimeScaleManager.dayToWorldX(snappedStartDay, this.timeScale);
			const width = Math.max(durationDays, 1) * this.timeScale;
			const y = LayerManager.layerToY(finalLayer);

			const newItem: TimelineItem = {
				type: 'note',
				file: newFile,
				title: newFile.basename,
				x: startX,
				y: y,
				width: width,
				dateStart: startDateStr,
				dateEnd: endDateStr,
				layer: finalLayer
			};

			// 10. Add to items list and refresh
			this.timelineItems.push(newItem);
			if (this.component && this.component.refreshItems) {
				this.component.refreshItems(this.timelineItems);
			}

			// 11. Select the new card and open the note
			const newIndex = this.timelineItems.length - 1;
			this.selectCard(newIndex);
			await this.openFile(newIndex);

			new Notice(`Created note: ${newFile.basename}`);
		} catch (error) {
			console.error('Timeline: Failed to create note from click:', error);
			new Notice(`Failed to create note: ${error}`);
		}
	}

	/**
	 * Get the number of days per unit at a given scale level
	 */
	private getDaysPerUnitAtLevel(level: number): number {
		switch (level) {
			case 0: return 1; // Days
			case 1: return 30; // Months (avg)
			case 2: return 365; // Years
			case 3: return 3650; // Decades
			case 4: return 36500; // Centuries
			default: return 365 * Math.pow(10, level - 2); // Millennia and larger
		}
	}

	/**
	 * Find an available layer for a new note at the given time range
	 * Uses alternating search: +1, -1, +2, -2, etc.
	 */
	private findAvailableLayer(targetLayer: number, dateStart: TimelineDate, dateEnd: TimelineDate): number {
		// Try target layer first
		if (!this.isLayerBusy(targetLayer, dateStart, dateEnd)) {
			return targetLayer;
		}

		// Alternating search
		const maxSearch = Math.max(this.timelineItems.length * 2, 100);
		for (let i = 1; i < maxSearch; i++) {
			// Try layer above (+i)
			if (!this.isLayerBusy(targetLayer + i, dateStart, dateEnd)) {
				return targetLayer + i;
			}
			// Try layer below (-i)
			if (!this.isLayerBusy(targetLayer - i, dateStart, dateEnd)) {
				return targetLayer - i;
			}
		}

		// Fallback to target layer (will overlap)
		return targetLayer;
	}

	/**
	 * Check if a layer is busy at the given time range
	 */
	private isLayerBusy(layer: number, dateStart: TimelineDate, dateEnd: TimelineDate): boolean {
		for (const item of this.timelineItems) {
			if (item.layer !== layer) continue;
			
			const itemStart = this.parseDate(item.dateStart);
			const itemEnd = this.parseDate(item.dateEnd);
			
			if (!itemStart || !itemEnd) continue;
			
			if (LayerManager.rangesOverlap(dateStart, dateEnd, itemStart, itemEnd)) {
				return true;
			}
		}
		return false;
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
					// If the clicked card is not in the current selection, select only that card
					// Otherwise, keep the existing multi-selection
					if (!this.selectedIndices.has(index)) {
						this.selectCard(index);
					} else {
						// Just ensure this is the active item for context
						this.activeIndex = index;
						this.updateSelectedCardData(index);
					}
					
					// Check if we have a multi-selection (more than 1 card selected)
					if (this.selectedIndices.size > 1) {
						// Multi-select: fit to the range of all selected cards
						this.fitSelectedCardsToView();
					} else {
						// Single card: use the existing single-card fit
						if (this.component && 'fitCardWidth' in this.component) {
							(this.component as { fitCardWidth: (x: number, width: number) => void }).fitCardWidth(item.x, item.width);
						}
					}
				});
		});

		menu.addSeparator();

		// Color submenu
		menu.addItem((itemMenu) => {
			itemMenu
				.setTitle("Color")
				.setIcon("palette");
			
			// Use setSubmenu (undocumented but functional Obsidian API)
			const colorMenu = itemMenu.setSubmenu();
			
			// IMPORTANT: Set submenu to use non-native menu (Obsidian styled, not macOS native)
			colorMenu.setUseNativeMenu(false);
			
			// Define color options with their CSS class names
			const colorOptions: Array<{color: 'red' | 'blue' | 'green' | 'yellow' | null; label: string; cssClass: string}> = [
				{ color: 'red', label: 'Red', cssClass: 'timeline-color-red' },
				{ color: 'blue', label: 'Blue', cssClass: 'timeline-color-blue' },
				{ color: 'green', label: 'Green', cssClass: 'timeline-color-green' },
				{ color: 'yellow', label: 'Yellow', cssClass: 'timeline-color-yellow' },
				{ color: null, label: 'Clear color', cssClass: 'timeline-color-clear' }
			];
			
			for (const option of colorOptions) {
				colorMenu.addItem((colorItem) => {
					colorItem
						.setTitle(option.label)
						.onClick(() => {
							// If the clicked card is not in the current selection, select only that card
							// Otherwise, keep the existing multi-selection
							if (!this.selectedIndices.has(index)) {
								this.selectCard(index);
							} else {
								// Just ensure this is the active item for context
								this.activeIndex = index;
								this.updateSelectedCardData(index);
							}
							this.applyColorToSelection(option.color);
						});
					
					// Use a small delay to ensure the DOM is rendered before manipulating it
					requestAnimationFrame(() => {
						// Access the internal dom property (now properly typed)
						if (colorItem.dom) {
							const iconSpan = colorItem.dom.querySelector('.menu-item-icon');
							if (iconSpan) {
								iconSpan.className = `menu-item-icon ${option.cssClass}`;
								iconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>';
							}
						}
					});
				});
			}
		});

		menu.addSeparator();

		// For timeline cards, show "Remove" instead of "Delete"
		if (this.isTimelineItem(item)) {
			menu.addItem((itemMenu) => {
				itemMenu
					.setTitle("Remove from view")
					.setIcon("trash")
					.onClick(() => {
						this.handleRemoveTimelineCard(item.timelineId);
					});
			});
		} else {
			menu.addItem((itemMenu) => {
				itemMenu
					.setTitle("Delete")
					.setIcon("trash")
					.onClick(() => {
						// If the clicked card is not in the current selection, select only that card
						// Otherwise, keep the existing multi-selection
						if (!this.selectedIndices.has(index)) {
							this.selectCard(index);
						} else {
							// Just ensure this is the active item for context
							this.activeIndex = index;
							this.updateSelectedCardData(index);
						}
						this.handleDeleteCard();
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	private handleRemoveTimelineCard(timelineId: string): void {
		// Confirm removal
		const modal = new DeleteConfirmModal(
			this.app, 
			null as any, // No file for timeline cards
			async (action: DeleteAction) => {
				if (action === 'remove-from-timeline') {
					await this.removeTimelineCard(timelineId);
				}
			},
			'Remove timeline from view?',
			1,
			'This will remove the timeline card from the current view but will not delete the timeline itself.',
			false // Don't show trash option
		);
		modal.open();
	}

	private handleDeleteCard(): void {
		// Get all selected items that are note cards (not timeline cards)
		const selectedItems = Array.from(this.selectedIndices)
			.filter(index => index >= 0 && index < this.timelineItems.length)
			.map(index => this.timelineItems[index]!)
			.filter(item => this.isNoteItem(item));
		
		if (selectedItems.length === 0) {
			// If only timeline cards are selected, nothing to delete
			new Notice('Timeline cards cannot be deleted - use Remove instead');
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
			// Multi-delete confirmation - just show count
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
			}, undefined, selectedItems.length).open();
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

	/**
	 * Add a timeline card to the current timeline
	 */
	async addTimelineCard(timelineId: string, timelineName: string): Promise<void> {
		if (!this.cacheService) {
			new Notice('Timeline cache service not available');
			return;
		}
		
		// Check if this timeline card already exists
		const existingCards = this.cacheService.getTimelineCards(this.timelineId);
		if (existingCards?.[timelineId]) {
			new Notice(`Timeline "${timelineName}" is already added to this view`);
			return;
		}
		
		// Find the referenced timeline config
		const plugin = (this.app as any).plugins?.plugins?.['timeline'];
		const timelineConfig = plugin?.settings?.timelineViews?.find(
			(t: { id: string }) => t.id === timelineId
		);
		
		if (!timelineConfig) {
			new Notice(`Timeline "${timelineName}" configuration not found`);
			return;
		}
		
		// Calculate the span of the referenced timeline
		const span = await this.calculateTimelineSpan(timelineId, timelineConfig.rootPath);
		if (!span) {
			new Notice(`Could not calculate span for timeline "${timelineName}"`);
			return;
		}
		
		// Convert to TimelineDate objects for overlap checking
		const startDate = TimelineDate.fromDaysFromEpoch(span.startDay);
		const endDate = TimelineDate.fromDaysFromEpoch(span.endDay);
		
		// Find an available layer using the same overlap test as note cards
		const targetLayer = 0;
		const finalLayer = this.findAvailableLayerForTimelineSpan(startDate, endDate, targetLayer);
		
		// Add to cache
		this.cacheService.addTimelineCard(this.timelineId, timelineId, finalLayer);
		
		// Refresh to show the new timeline card
		await this.refreshTimeline();
		
		new Notice(`Added timeline "${timelineName}" to view`);
	}
	
	/**
	 * Find an available layer for a timeline card (checks overlap with ALL cards)
	 */
	private findAvailableLayerForTimelineSpan(startDate: TimelineDate, endDate: TimelineDate, targetLayer: number): number {
		// Check if target layer is available (no overlap with any card)
		if (!this.isLayerBusyForTimelineSpan(startDate, endDate, targetLayer)) {
			return targetLayer;
		}
		
		// Try alternating layers (+1, -1, +2, -2, etc.) like note cards
		const maxSearch = Math.max(this.timelineItems.length * 2, 100);
		for (let i = 1; i < maxSearch; i++) {
			// Try above
			if (!this.isLayerBusyForTimelineSpan(startDate, endDate, targetLayer + i)) {
				return targetLayer + i;
			}
			// Try below
			if (!this.isLayerBusyForTimelineSpan(startDate, endDate, targetLayer - i)) {
				return targetLayer - i;
			}
		}
		
		// Fallback to target layer (will overlap)
		return targetLayer;
	}
	
	/**
	 * Check if a layer is busy for a timeline card (checks overlap with ALL cards, not just timeline cards)
	 */
	private isLayerBusyForTimelineSpan(startDate: TimelineDate, endDate: TimelineDate, layer: number): boolean {
		// Check all existing timeline items (both notes and timeline cards)
		for (const item of this.timelineItems) {
			if (item.layer !== layer) continue;
			
			const itemStart = this.parseDate(item.dateStart);
			const itemEnd = this.parseDate(item.dateEnd);
			
			if (!itemStart || !itemEnd) continue;
			
			// Check for date overlap using the same logic as note cards
			if (LayerManager.rangesOverlap(startDate, endDate, itemStart, itemEnd)) {
				return true;
			}
		}
		
		return false;
	}
	
	/**
	 * Remove a timeline card from the current view
	 */
	async removeTimelineCard(timelineId: string): Promise<void> {
		if (!this.cacheService) {
			new Notice('Timeline cache service not available');
			return;
		}
		
		this.cacheService.removeTimelineCard(this.timelineId, timelineId);
		this.clearSelection();
		await this.refreshTimeline();
		
		new Notice('Timeline removed from view');
	}

	/**
	 * Apply color to all selected cards (both note cards and timeline cards)
	 */
	private async applyColorToSelection(color: 'red' | 'blue' | 'green' | 'yellow' | null): Promise<void> {
		const selectedItems = Array.from(this.selectedIndices)
			.filter(index => index >= 0 && index < this.timelineItems.length)
			.map(index => this.timelineItems[index]!);
		
		if (selectedItems.length === 0) return;
		
		let successCount = 0;
		let failCount = 0;
		
		for (const item of selectedItems) {
			if (this.isNoteItem(item)) {
				// Apply to note cards via frontmatter
				try {
					await this.app.fileManager.processFrontMatter(item.file, (frontmatter) => {
						if (color) {
							frontmatter['color'] = color;
						} else {
							delete frontmatter['color'];
						}
					});
					successCount++;
					
					// Update the local item for immediate UI feedback
					item.color = color ?? undefined;
				} catch (error) {
					console.error(`Error applying color to "${item.file.basename}":`, error);
					failCount++;
				}
			} else if (this.isTimelineItem(item)) {
				// Apply to timeline cards via cache
				if (this.cacheService) {
					this.cacheService.setTimelineCardColor(this.timelineId, item.timelineId, color);
					item.color = color ?? undefined;
					successCount++;
				} else {
					failCount++;
				}
			}
		}
		
		// Refresh the component to show updated colors
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
		
		// Show feedback
		if (successCount > 0) {
			const colorLabel = color ? color.charAt(0).toUpperCase() + color.slice(1) : 'cleared';
			new Notice(`Applied ${colorLabel} color to ${successCount} card${successCount > 1 ? 's' : ''}`);
		}
		if (failCount > 0) {
			new Notice(`Failed to apply color to ${failCount} card${failCount > 1 ? 's' : ''}`);
		}
	}

	private async refreshTimeline(): Promise<void> {
		this.timelineItems = await this.collectTimelineItems();
		if (this.component?.refreshItems) {
			this.component.refreshItems(this.timelineItems);
		}
	}

	goToItem(item: TimelineItem): void {
		let index: number;
		
		if (this.isNoteItem(item)) {
			index = this.timelineItems.findIndex(i => this.isNoteItem(i) && i.file.path === item.file.path);
		} else if (this.isTimelineItem(item)) {
			index = this.timelineItems.findIndex(i => this.isTimelineItem(i) && i.timelineId === item.timelineId);
		} else {
			console.error('Timeline: Unknown item type');
			return;
		}
		
		if (index === -1) {
			console.error('Timeline: Item not found in timeline');
			return;
		}

		if (this.component?.centerOnItem) {
			this.component.centerOnItem(index);
		}

		this.selectCard(index);
	}

	fitToCardByPath(filePath: string): void {
		// Only note cards have file paths
		const index = this.timelineItems.findIndex(i => this.isNoteItem(i) && i.file.path === filePath);
		if (index === -1) {
			return;
		}

		const item = this.timelineItems[index]!;
		this.selectCard(index);

		if (this.component && 'fitCardWidth' in this.component) {
			(this.component as { fitCardWidth: (x: number, width: number) => void }).fitCardWidth(item.x, item.width);
		}
	}

	/**
	 * Fit all selected cards to the viewport
	 * Centers on the median of all selected cards and sets timeScale to fit the min/max range
	 */
	private fitSelectedCardsToView(): void {
		if (this.selectedIndices.size === 0) return;
		
		// Get all selected items
		const selectedItems = Array.from(this.selectedIndices)
			.filter(index => index >= 0 && index < this.timelineItems.length)
			.map(index => this.timelineItems[index]!);
		
		if (selectedItems.length === 0) return;
		
		// Calculate the time range across all selected cards
		// Convert world X coordinates to days from epoch
		let minStartDay = Infinity;
		let maxEndDay = -Infinity;
		const centerDays: number[] = [];
		
		for (const item of selectedItems) {
			const startDay = TimeScaleManager.worldXToDay(item.x, this.timeScale);
			const endDay = TimeScaleManager.worldXToDay(item.x + item.width, this.timeScale);
			const centerDay = (startDay + endDay) / 2;
			
			minStartDay = Math.min(minStartDay, startDay);
			maxEndDay = Math.max(maxEndDay, endDay);
			centerDays.push(centerDay);
		}
		
		// Calculate median center day
		centerDays.sort((a, b) => a - b);
		let medianCenterDay: number;
		const midIndex = Math.floor(centerDays.length / 2);
		
		if (centerDays.length % 2 === 0) {
			// Even number of cards: average of two middle centers
			medianCenterDay = (centerDays[midIndex - 1]! + centerDays[midIndex]!) / 2;
		} else {
			// Odd number of cards: middle center
			medianCenterDay = centerDays[midIndex]!;
		}
		
		// Call fitTimeRange on the component
		if (this.component && 'fitTimeRange' in this.component) {
			(this.component as { fitTimeRange: (startDay: number, endDay: number, centerDay: number) => void })
				.fitTimeRange(minStartDay, maxEndDay, medianCenterDay);
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
					onCanvasClick: (event: { screenX: number; screenY: number; worldX: number; worldY: number }) => {
						// Only create a note if no cards are currently selected
						// First click clears selection, second click creates note
						if (this.selectedIndices.size > 0) {
							this.clearSelection();
							return;
						}
						void this.createNoteFromClick(event);
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
			
			// Only look for note items (timeline cards don't have files)
			const itemIndex = this.timelineItems.findIndex(item => 
				this.isNoteItem(item) && item.file.path === entry.file.path
			);
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
			
			// After undo, check if timeline cards need updating
			this.scheduleTimelineCardRefresh();
			
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
			
			// Only look for note items (timeline cards don't have files)
			const itemIndex = this.timelineItems.findIndex(item => 
				this.isNoteItem(item) && item.file.path === entry.file.path
			);
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
			
			// After undo, check if timeline cards need updating
			this.scheduleTimelineCardRefresh();
			
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
					this.isNoteItem(item) && (item.file.path === file.path || item.file.path === oldPath)
				);
				
				if (itemIndex !== -1) {
					const item = this.timelineItems[itemIndex]!;
					if (this.isNoteItem(item)) {
						console.log(`Timeline: File renamed from ${item.file.basename} to ${file.basename}`);
						
						this.timelineItems[itemIndex] = {
							...item,
							file: file,
							title: file.basename
						};
						
						if (this.component && this.component.refreshItems) {
							this.component.refreshItems(this.timelineItems);
						}
					}
				}
			})
		);
		
		// Register for metadata changes
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!(file instanceof TFile)) return;
				
				const isInTimeline = this.timelineItems.some(item => this.isNoteItem(item) && item.file.path === file.path);
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
					
					// After the main refresh, async check if timeline cards need updating
					// This handles cases where a referenced timeline's span changed
					this.scheduleTimelineCardRefresh();
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
