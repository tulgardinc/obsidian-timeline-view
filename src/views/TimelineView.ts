import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import Timeline from "../components/Timeline.svelte";
import { mount, unmount } from "svelte";
import { LayerManager, type LayerableItem, type LayerAssignment, type TimelineColor } from "../utils/LayerManager";
import { TimelineHistoryManager, type TimelineState } from "../utils/TimelineHistoryManager";
import { TimeScaleManager } from "../utils/TimeScaleManager";
import { TimelineDate } from "../utils/TimelineDate";

export const VIEW_TYPE_TIMELINE = "timeline-view";

export interface TimelineFile {
	file: TFile;
	title: string;
}

export interface TimelineItem {
	file: TFile;
	title: string;
	x: number;
	y: number;
	width: number;
	dateStart: string;
	dateEnd: string;
	layer?: number;
	color?: TimelineColor;
}

interface ExpectedFileState {
	dateStart: string;
	dateEnd: string;
	layer: number;
	timestamp: number;
}

export class TimelineView extends ItemView {
	private component: { 
		refreshItems?: (items: TimelineItem[]) => void;
		setSelection?: (index: number | null, cardData: { startX: number; endX: number; startDate: string; endDate: string; title: string } | null) => void;
		[key: string]: unknown;
	} | null = null;
	timelineItems: TimelineItem[] = [];
	private historyManager: TimelineHistoryManager;
	private expectedFileStates = new Map<string, ExpectedFileState>(); // Track expected states to filter our own changes
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null; // Store for cleanup

	// Selection state - persists across view updates
	private selectedIndex: number | null = null;
	private selectedCardData: { startX: number; endX: number; startDate: string; endDate: string; title: string } | null = null;
	
	// Time scale - pixels per day (default 10)
	private timeScale: number = 10;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.historyManager = new TimelineHistoryManager();
	}

	getViewType(): string {
		return VIEW_TYPE_TIMELINE;
	}

	getDisplayText(): string {
		return "Timeline";
	}

	getIcon(): string {
		return "calendar";
	}

	private parseDate(dateStr: string): TimelineDate | null {
		// Use TimelineDate for arbitrary year range support (up to 10 billion years)
		return TimelineDate.fromString(dateStr);
	}

	private daysBetween(start: TimelineDate, end: TimelineDate): number {
		return end.getDaysFromEpoch() - start.getDaysFromEpoch();
	}

	async collectTimelineItems(): Promise<TimelineItem[]> {
		// First pass: collect all items with their data
		const layerableItems: LayerableItem[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();
		
		for (const file of allFiles) {
			const metadata = this.app.metadataCache.getFileCache(file);
			
			// Check if file has timeline: true
			if (metadata?.frontmatter?.timeline !== true) {
				continue;
			}
			
			// Check for date-start and date-end
			const dateStartRaw = metadata.frontmatter['date-start'];
			const dateEndRaw = metadata.frontmatter['date-end'];
			
			if (!dateStartRaw || !dateEndRaw) {
				console.log(`Timeline: Skipping ${file.basename} - missing date-start or date-end`);
				continue;
			}
			
			// Convert to strings (frontmatter can have various types)
			const dateStartStr = String(dateStartRaw);
			const dateEndStr = String(dateEndRaw);
			
			// Parse dates
			const dateStart = this.parseDate(dateStartStr);
			const dateEnd = this.parseDate(dateEndStr);
			
			if (!dateStart || !dateEnd) {
				console.log(`Timeline: Skipping ${file.basename} - invalid date format (expected yyyy-mm-dd)`);
				continue;
			}
			
			// Get layer from frontmatter if it exists
			const layerRaw = metadata.frontmatter['layer'];
			const frontmatterLayer = layerRaw !== undefined ? parseInt(String(layerRaw), 10) : undefined;
			
			// Get color from frontmatter (enum validation)
			const colorRaw = metadata.frontmatter['color'];
			const validColors: TimelineColor[] = ['red', 'blue', 'green', 'yellow'];
			const color: TimelineColor = validColors.includes(colorRaw) ? colorRaw : undefined;
			
			layerableItems.push({
				file,
				dateStart,
				dateEnd,
				frontmatterLayer: !isNaN(frontmatterLayer ?? NaN) ? frontmatterLayer : undefined,
				color
			});
		}
		
		// Sort items by date for consistent layer assignment
		const sortedItems = LayerManager.sortByDate(layerableItems);
		
		// Assign layers
		const layerAssignments = LayerManager.assignLayers(sortedItems);
		
		// Batch write layer assignments to files
		if (layerAssignments.length > 0) {
			await this.batchUpdateLayers(layerAssignments);
		}
		
		// Convert to TimelineItems with calculated positions
		const items: TimelineItem[] = [];
		for (const item of sortedItems) {
			// Calculate x position (days from epoch start) using unified coordinate function
			// TimelineDate stores days from epoch internally, so we can get it directly
			const daysFromStart = item.dateStart.getDaysFromEpoch();
			const x = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);
			
			// Calculate width (duration in days) using unified coordinate function
			const duration = item.dateEnd.getDaysFromEpoch() - item.dateStart.getDaysFromEpoch();
			const width = Math.max(duration, 1) * this.timeScale;
			
			// Calculate Y position from assigned layer
			const layer = item.layer ?? 0;
			const y = LayerManager.layerToY(layer);
			
			items.push({
				file: item.file,
				title: item.file.basename,
				x,
				y,
				width,
				dateStart: item.dateStart.toISOString(),
				dateEnd: item.dateEnd.toISOString(),
				layer,
				color: item.color
			});
			
			console.log(`Timeline: Added ${item.file.basename} at x=${x}, y=${y}, layer=${layer}, width=${width}`);
		}
		
		return items;
	}

	private async batchUpdateLayers(assignments: LayerAssignment[]): Promise<void> {
		if (assignments.length === 0) return;
		
		console.log(`Timeline: Batch updating ${assignments.length} layer assignments`);
		
		for (const assignment of assignments) {
			try {
				const content = await this.app.vault.read(assignment.file);
				
				// Check if layer property already exists
				const layerRegex = /^layer:\s*\S+/m;
				let newContent: string;
				
				if (layerRegex.test(content)) {
					// Update existing layer property
					newContent = content.replace(layerRegex, `layer: ${assignment.layer}`);
				} else {
					// Add layer property after timeline: true
					newContent = content.replace(
						/(timeline:\s*true.*\n)/,
						`$1layer: ${assignment.layer}\n`
					);
				}
				
				await this.app.vault.modify(assignment.file, newContent);
				console.log(`Timeline: Updated ${assignment.file.basename} layer to ${assignment.layer}`);
				
				// Track expected state for this file
				const metadata = this.app.metadataCache.getFileCache(assignment.file);
				if (metadata?.frontmatter) {
					this.expectedFileStates.set(assignment.file.path, {
						dateStart: String(metadata.frontmatter['date-start'] ?? ''),
						dateEnd: String(metadata.frontmatter['date-end'] ?? ''),
						layer: assignment.layer,
						timestamp: Date.now()
					});
				}
			} catch (error) {
				console.error(`Timeline: Failed to update layer for ${assignment.file.basename}:`, error);
			}
		}
	}

	private pixelsToDate(pixels: number): string {
		// Use unified coordinate function to convert world X to days
		const days = Math.round(TimeScaleManager.worldXToDay(pixels, this.timeScale));
		// Create TimelineDate from days from epoch (handles arbitrary date ranges)
		const date = TimelineDate.fromDaysFromEpoch(days);
		
		console.log(`pixelsToDate: pixels=${pixels}, days=${days}, result=${date.toISOString()}`);
		
		// Return ISO format: YYYY-MM-DD (astronomical year numbering)
		return date.toISOString();
	}

	private recalculateItemPositions(): void {
		// Recalculate x and width for all items based on current time scale
		for (let i = 0; i < this.timelineItems.length; i++) {
			const item = this.timelineItems[i]!;
			
			// Calculate days from epoch for start date using unified coordinate function
			const dateStart = this.parseDate(item.dateStart);
			if (!dateStart) continue;
			const daysFromStart = dateStart.getDaysFromEpoch();
			const newX = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);
			
			// Calculate duration and width
			const dateEnd = this.parseDate(item.dateEnd);
			if (!dateEnd) continue;
			const duration = dateEnd.getDaysFromEpoch() - dateStart.getDaysFromEpoch();
			const newWidth = Math.max(duration, 1) * this.timeScale;
			
			// Update item with new positions
			this.timelineItems[i] = {
				...item,
				x: newX,
				width: newWidth
			};
		}
		
		// Update selection data if a card is selected
		if (this.selectedIndex !== null && this.selectedCardData) {
			const item = this.timelineItems[this.selectedIndex];
			if (item) {
				// Update positions and reformat dates for current scale level
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
				
				// Push updated selection data to the component so boundary lines update
				this.updateSelectionInComponent();
			}
		}
		
		console.log(`Timeline: Recalculated positions with timeScale=${this.timeScale}`);
	}

	private async updateItemDates(index: number, newX: number, newWidth: number): Promise<void> {
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		
		// Calculate new dates from position and width
		const newDateStart = this.pixelsToDate(newX);
		const endPixels = newX + newWidth;
		const newDateEnd = this.pixelsToDate(endPixels);
		
		console.log(`Timeline: Updating ${item.file.basename}: ${newDateStart} to ${newDateEnd}`);
		
		// Capture previous state for history
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		try {
			// Read current content
			const content = await this.app.vault.read(item.file);
			
			// Update frontmatter
			const newContent = content.replace(
				/date-start:\s*\S+/,
				`date-start: ${newDateStart}`
			).replace(
				/date-end:\s*\S+/,
				`date-end: ${newDateEnd}`
			);
			
			// Write back to file
			await this.app.vault.modify(item.file, newContent);
			
			// Update local item immutably to trigger reactivity
			this.timelineItems[index] = {
				...item,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				x: newX,
				width: newWidth
			};
			
			// Record in history after successful modification
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0
			};
			this.historyManager.record(item.file, previousState, newState, 'resize');
			
			// Track expected state to filter out our own metadata change events
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0,
				timestamp: Date.now()
			});
			
			console.log(`Timeline: Successfully updated ${item.file.basename}`);
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
		
		// Calculate new dates from position shift
		const newDateStart = this.pixelsToDate(newX);
		const endPixels = newX + item.width;
		const newDateEnd = this.pixelsToDate(endPixels);
		
		console.log(`Timeline: Moving ${item.file.basename}: ${newDateStart} to ${newDateEnd}, y=${newY}`);
		
		// Capture previous state for history
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		try {
			// Read current content
			const content = await this.app.vault.read(item.file);
			
			// Update frontmatter
			const newContent = content.replace(
				/date-start:\s*\S+/,
				`date-start: ${newDateStart}`
			).replace(
				/date-end:\s*\S+/,
				`date-end: ${newDateEnd}`
			);
			
			// Write back to file
			await this.app.vault.modify(item.file, newContent);
			
			// Update local item immutably to trigger reactivity
			this.timelineItems[index] = {
				...item,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				x: newX,
				y: newY
			};
			
			// Record in history after successful modification
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0
			};
			this.historyManager.record(item.file, previousState, newState, 'move');
			
			// Track expected state to filter out our own metadata change events
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: item.layer ?? 0,
				timestamp: Date.now()
			});
			
			console.log(`Timeline: Successfully moved ${item.file.basename}`);
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
		
		// Capture previous state for history (before any modifications)
		const previousState: TimelineState = {
			dateStart: item.dateStart,
			dateEnd: item.dateEnd,
			layer: item.layer ?? 0
		};
		
		// Use the NEW dates from the drag operation for collision detection
		// This ensures we check collision with the correct time range after horizontal move
		const newDateStart = this.pixelsToDate(newX);
		const newDateEnd = this.pixelsToDate(newX + newWidth);
		const dateStart = this.parseDate(newDateStart);
		const dateEnd = this.parseDate(newDateEnd);
		
		if (!dateStart || !dateEnd) {
			console.error(`Timeline: Invalid dates for ${item.file.basename}`);
			return;
		}
		
		console.log(`Timeline: Checking collision for ${item.file.basename} at layer ${targetLayer} with dates ${newDateStart} to ${newDateEnd}`);
		
		// Check if target layer has collision
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
				console.log(`Timeline: Collision detected at layer ${targetLayer} with ${otherItem.file.basename} (${otherItem.dateStart} to ${otherItem.dateEnd})`);
				break;
			}
		}
		
		// If collision detected, find first available layer using alternating search
		if (hasCollision) {
			console.log(`Timeline: Collision detected at layer ${targetLayer} for ${item.file.basename}, searching for alternative...`);
			
			const maxSearch = Math.max(this.timelineItems.length * 2, 100);
			let found = false;
			
			for (let i = 1; i < maxSearch && !found; i++) {
				// Try +i (above)
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
				
				// Try -i (below)
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
		
		// Calculate new Y position from layer
		const newY = LayerManager.layerToY(finalLayer);
		
		console.log(`Timeline: Updating ${item.file.basename} layer from ${item.layer} to ${finalLayer} (y=${newY})`);
		
		try {
			// Read current content
			const content = await this.app.vault.read(item.file);
			
			// Update layer property and dates
			const layerRegex = /^layer:\s*\S+/m;
			let newContent: string;
			
			if (layerRegex.test(content)) {
				// Update existing layer property
				newContent = content.replace(layerRegex, `layer: ${finalLayer}`);
			} else {
				// Add layer property after timeline: true
				newContent = content.replace(
					/(timeline:\s*true.*\n)/,
					`$1layer: ${finalLayer}\n`
				);
			}
			
			// Also update dates (these changed during horizontal drag)
			newContent = newContent
				.replace(/date-start:\s*\S+/, `date-start: ${newDateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${newDateEnd}`);
			
			// Write back to file
			await this.app.vault.modify(item.file, newContent);
			
			// Update local item immutably to trigger reactivity
			// Include the new x, width, and dates from the drag operation
			this.timelineItems[index] = {
				...item,
				x: newX,
				width: newWidth,
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: finalLayer,
				y: newY
			};
			
			// Record in history after successful modification
			const newState: TimelineState = {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: finalLayer
			};
			this.historyManager.record(item.file, previousState, newState, 'layer-change');
			
			// Track expected state to filter out our own metadata change events
			this.expectedFileStates.set(item.file.path, {
				dateStart: newDateStart,
				dateEnd: newDateEnd,
				layer: finalLayer,
				timestamp: Date.now()
			});
			
			// Update component props to reflect changes in UI immediately
			if (this.component && this.component.refreshItems) {
				this.component.refreshItems(this.timelineItems);
			}
			
			console.log(`Timeline: Successfully updated ${item.file.basename} layer to ${finalLayer}`);
		} catch (error) {
			console.error(`Timeline: Failed to update layer for ${item.file.basename}:`, error);
			new Notice(`Failed to update layer for ${item.file.basename}: ${error}`);
		}
	}

	private async openFile(index: number): Promise<void> {
		console.log('Timeline: Click detected on card', index);
		
		if (index < 0 || index >= this.timelineItems.length) {
			console.error('Timeline: Invalid item index for open', index);
			return;
		}
		
		const item = this.timelineItems[index]!;
		console.log('Timeline: Opening/focusing file', item.file.basename, 'at path', item.file.path);
		
		try {
			// Open the file in the workspace
			const file = this.app.vault.getAbstractFileByPath(item.file.path);
			if (file && file instanceof TFile) {
				// Check if file is already open in an existing leaf
				let existingLeaf: WorkspaceLeaf | null = null;
				
				// Search through ALL leaves to find if file is already open
				// This includes markdown, deferred views, and restored tabs
				this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
					const view = leaf.view as { 
						file?: { path: string }; 
						getState?: () => { file?: string }; 
					};
					
					// Check multiple properties where file path might be stored
					const leafFilePath = view?.file?.path || 
										 view?.getState?.()?.file;
					
					if (leafFilePath === item.file.path) {
						existingLeaf = leaf;
						return true; // Stop iteration
					}
					return false; // Continue iteration
				});
				
				if (existingLeaf) {
					// File is already open, just focus the existing leaf
					this.app.workspace.setActiveLeaf(existingLeaf);
					console.log(`Timeline: Focused existing tab for ${item.file.basename}`);
				} else {
					// File not open, create new leaf and open file
					const leaf = this.app.workspace.getLeaf('tab');
					await leaf.openFile(file);
					console.log(`Timeline: Opened ${item.file.basename} in new tab`);
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

	/**
	 * Select a card (without toggling - always select)
	 */
	private selectCard(index: number): void {
		console.log('TimelineView: selectCard CALLED for index:', index, 'current:', this.selectedIndex);
		
		// If already selected, do nothing
		if (this.selectedIndex === index) {
			console.log('TimelineView: Card already selected, no change needed');
			return;
		}
		
		// Select the card
		this.selectedIndex = index;
		
		// Calculate and store boundary data for the selected card
		if (index >= 0 && index < this.timelineItems.length) {
			const item = this.timelineItems[index]!;
			
			// Calculate dates from positions using unified coordinate functions
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
			console.log('TimelineView: selectedCardData calculated:', this.selectedCardData);
		}
		
		// Update the component with new selection state
		this.updateSelectionInComponent();
	}

	/**
	 * Toggle selection of a card (select if not selected, deselect if already selected)
	 */
	private toggleSelection(index: number): void {
		console.log('TimelineView: toggleSelection CALLED for index:', index, 'current:', this.selectedIndex);
		
		// If clicking the same card, deselect it (toggle off)
		if (this.selectedIndex === index) {
			console.log('TimelineView: Deselecting (toggle off)');
			this.selectedIndex = null;
			this.selectedCardData = null;
		} else {
			// Select the new card
			console.log('TimelineView: Selecting new card');
			this.selectedIndex = index;
			
			// Calculate and store boundary data for the selected card
			if (index >= 0 && index < this.timelineItems.length) {
				const item = this.timelineItems[index]!;
				
				// Calculate dates from positions using unified coordinate functions
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
				console.log('TimelineView: selectedCardData calculated:', this.selectedCardData);
			} else {
				console.log('TimelineView: ERROR - Invalid index:', index, 'items length:', this.timelineItems.length);
			}
		}
		
		console.log('TimelineView: About to call updateSelectionInComponent');
		// Update the component with new selection state
		this.updateSelectionInComponent();
		console.log('TimelineView: toggleSelection COMPLETE');
	}

	/**
	 * Clear selection (deselect all cards)
	 */
	private clearSelection(): void {
		this.selectedIndex = null;
		this.selectedCardData = null;
		this.updateSelectionInComponent();
	}

	/**
	 * Update the Svelte component with current selection state
	 */
	private updateSelectionInComponent(): void {
		console.log('TimelineView: updateSelectionInComponent CALLED');
		console.log('TimelineView: this.component exists?', !!this.component);
		
		if (this.component) {
			console.log('TimelineView: this.component.setSelection exists?', !!this.component.setSelection);
			if (this.component.setSelection) {
				console.log('TimelineView: Calling setSelection with:', this.selectedIndex, this.selectedCardData);
				this.component.setSelection(this.selectedIndex, this.selectedCardData);
				console.log('TimelineView: setSelection call COMPLETE');
			} else {
				console.error('TimelineView: ERROR - setSelection method not found on component!');
				console.log('TimelineView: Available methods on component:', Object.keys(this.component));
			}
		} else {
			console.error('TimelineView: ERROR - Component is null!');
		}
	}

	async render() {
		// Wait for DOM to be ready
		await new Promise(resolve => requestAnimationFrame(resolve));
		
		if (!this.contentEl) {
			console.error("contentEl is null!");
			return;
		}

		// Clear previous content
		this.contentEl.empty();

		// Collect timeline items with dates
		this.timelineItems = await this.collectTimelineItems();

		// Mount the Svelte component with items and selection state
		try {
			this.component = mount(Timeline, {
				target: this.contentEl,
				props: {
					items: this.timelineItems,
					selectedIndex: this.selectedIndex,
					selectedCard: this.selectedCardData,
					onItemResize: (index: number, newX: number, newWidth: number) => {
						this.updateItemDates(index, newX, newWidth);
					},
					onItemMove: (index: number, newX: number, newY: number) => {
						this.updateItemPosition(index, newX, newY);
					},
					onItemLayerChange: (index: number, newLayer: number, newX: number, newWidth: number) => {
						this.updateItemLayer(index, newLayer, newX, newWidth);
					},
					onItemClick: (index: number) => {
						// Toggle selection and open file
						this.toggleSelection(index);
						this.openFile(index);
					},
					onItemSelect: (index: number) => {
						// Select the card after move/resize (do not open file)
						this.selectCard(index);
					},
						onUpdateSelectionData: (startX: number, endX: number, startDate: string, endDate: string) => {
						// Update selection data during drag/resize so indicators follow the card
						if (this.selectedIndex !== null && this.selectedCardData) {
							// Reformat dates using unified coordinate functions
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
							// Update the component immediately
							if (this.component && this.component.setSelection) {
								this.component.setSelection(this.selectedIndex, this.selectedCardData);
							}
						}
					},
					onTimeScaleChange: (timeScale: number) => {
						// Update time scale and recalculate all item positions
						this.timeScale = timeScale;
						// Recalculate all item positions with new time scale
						this.recalculateItemPositions();
						// Refresh UI
						if (this.component && this.component.refreshItems) {
							this.component.refreshItems(this.timelineItems);
						}
					},
					onCanvasClick: () => {
						this.clearSelection();
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

	/**
	 * Undo the last timeline operation
	 */
	async undo(): Promise<boolean> {
		const entry = this.historyManager.undo();
		if (!entry) {
			console.log('Timeline: Nothing to undo');
			return false;
		}

		console.log(`Timeline: Undoing ${entry.operationType} for ${entry.file.basename}`);

		try {
			// Read current file content
			const content = await this.app.vault.read(entry.file);
			
			// Restore previous state
			let newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${entry.previousState.dateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${entry.previousState.dateEnd}`);
			
			// Handle layer restoration
			const layerRegex = /^layer:\s*\S+/m;
			if (entry.previousState.layer !== undefined) {
				if (layerRegex.test(newContent)) {
					newContent = newContent.replace(layerRegex, `layer: ${entry.previousState.layer}`);
				} else {
					// Add layer if it was missing
					newContent = newContent.replace(
						/(timeline:\s*true.*\n)/,
						`$1layer: ${entry.previousState.layer}\n`
					);
				}
			}
			
			// Write back to file
			await this.app.vault.modify(entry.file, newContent);
			
			// Track expected state to filter out our own metadata change events
			this.expectedFileStates.set(entry.file.path, {
				dateStart: entry.previousState.dateStart,
				dateEnd: entry.previousState.dateEnd,
				layer: entry.previousState.layer,
				timestamp: Date.now()
			});
			
			// Find the item in timelineItems and update it
			const itemIndex = this.timelineItems.findIndex(item => item.file.path === entry.file.path);
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				
				// Calculate new position values from restored dates
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
				
				// Refresh UI
				if (this.component && this.component.refreshItems) {
					this.component.refreshItems(this.timelineItems);
				}
			}
			
			console.log(`Timeline: Successfully undid ${entry.operationType} for ${entry.file.basename}`);
			return true;
		} catch (error) {
			console.error(`Timeline: Failed to undo ${entry.operationType} for ${entry.file.basename}:`, error);
			return false;
		}
	}

	/**
	 * Redo the last undone timeline operation
	 */
	async redo(): Promise<boolean> {
		const entry = this.historyManager.redo();
		if (!entry) {
			console.log('Timeline: Nothing to redo');
			return false;
		}

		console.log(`Timeline: Redoing ${entry.operationType} for ${entry.file.basename}`);

		try {
			// Read current file content
			const content = await this.app.vault.read(entry.file);
			
			// Restore new state (the state we had after the original operation)
			let newContent = content
				.replace(/date-start:\s*\S+/, `date-start: ${entry.newState.dateStart}`)
				.replace(/date-end:\s*\S+/, `date-end: ${entry.newState.dateEnd}`);
			
			// Handle layer restoration
			const layerRegex = /^layer:\s*\S+/m;
			if (entry.newState.layer !== undefined) {
				if (layerRegex.test(newContent)) {
					newContent = newContent.replace(layerRegex, `layer: ${entry.newState.layer}`);
				} else {
					// Add layer if it was missing
					newContent = newContent.replace(
						/(timeline:\s*true.*\n)/,
						`$1layer: ${entry.newState.layer}\n`
					);
				}
			}
			
			// Write back to file
			await this.app.vault.modify(entry.file, newContent);
			
			// Track expected state to filter out our own metadata change events
			this.expectedFileStates.set(entry.file.path, {
				dateStart: entry.newState.dateStart,
				dateEnd: entry.newState.dateEnd,
				layer: entry.newState.layer,
				timestamp: Date.now()
			});
			
			// Find the item in timelineItems and update it
			const itemIndex = this.timelineItems.findIndex(item => item.file.path === entry.file.path);
			if (itemIndex !== -1) {
				const item = this.timelineItems[itemIndex]!;
				
				// Calculate new position values from restored dates
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
				
				// Refresh UI
				if (this.component && this.component.refreshItems) {
					this.component.refreshItems(this.timelineItems);
				}
			}
			
			console.log(`Timeline: Successfully redid ${entry.operationType} for ${entry.file.basename}`);
			return true;
		} catch (error) {
			console.error(`Timeline: Failed to redo ${entry.operationType} for ${entry.file.basename}:`, error);
			return false;
		}
	}

	async onOpen() {
		console.log("TimelineView onOpen");
		await this.render();
		
		// Register for file rename events to update card titles in real-time
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				// Only process if it's a markdown file
				if (!(file instanceof TFile)) return;
				// Check if this is a timeline item
				const itemIndex = this.timelineItems.findIndex(item => 
					item.file.path === file.path || item.file.path === oldPath
				);
				
				if (itemIndex !== -1) {
					console.log(`Timeline: File renamed from ${this.timelineItems[itemIndex]!.file.basename} to ${file.basename}`);
					
					// Update the timeline item with new file info
					this.timelineItems[itemIndex] = {
						...this.timelineItems[itemIndex]!,
						file: file,
						title: file.basename
					};
					
					// Refresh UI to show new name
					if (this.component && this.component.refreshItems) {
						this.component.refreshItems(this.timelineItems);
					}
					
					console.log(`Timeline: Updated card title to ${file.basename}`);
				}
			})
		);
		
		// Register for metadata changes to update timeline in real-time
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				// Only process markdown files
				if (!(file instanceof TFile)) return;
				
				// Check if this file is relevant to the timeline
				// Either currently in timeline OR has timeline: true
				const isInTimeline = this.timelineItems.some(item => item.file.path === file.path);
				const metadata = this.app.metadataCache.getFileCache(file);
				const hasTimelineFlag = metadata?.frontmatter?.timeline === true;
				
				if (!isInTimeline && !hasTimelineFlag) {
					return; // Not relevant, skip
				}
				
				// Check if this change matches our expected state (i.e., it's our own change)
				const expectedState = this.expectedFileStates.get(file.path);
				if (expectedState) {
					const currentDateStart = String(metadata?.frontmatter?.['date-start'] ?? '');
					const currentDateEnd = String(metadata?.frontmatter?.['date-end'] ?? '');
					const currentLayer = parseInt(String(metadata?.frontmatter?.['layer'] ?? '0'), 10);
					
					// Check if the change matches what we expect
					if (currentDateStart === expectedState.dateStart &&
					    currentDateEnd === expectedState.dateEnd &&
					    currentLayer === expectedState.layer) {
						// This is our own change, remove from expected states and skip
						this.expectedFileStates.delete(file.path);
						return;
					}
					
					// Remove old expected states (older than 5 seconds)
					if (Date.now() - expectedState.timestamp > 5000) {
						this.expectedFileStates.delete(file.path);
					}
				}
				
				console.log(`Timeline: Metadata changed for ${file.basename} (inTimeline: ${isInTimeline}, hasFlag: ${hasTimelineFlag})`);
				
				// Debounce rapid changes (e.g., user typing in properties)
				if (this.metadataChangeTimeout) {
					clearTimeout(this.metadataChangeTimeout);
				}
				
				this.metadataChangeTimeout = setTimeout(async () => {
					console.log(`Timeline: Re-collecting items after metadata change`);
					
					// Re-collect all timeline items (handles add/remove/update with validation)
					this.timelineItems = await this.collectTimelineItems();
					
					// Refresh the UI
					if (this.component && this.component.refreshItems) {
						this.component.refreshItems(this.timelineItems);
					}
					
					console.log(`Timeline: Updated timeline with ${this.timelineItems.length} items`);
				}, 300); // 300ms debounce
			})
		);
		
		// Register keyboard shortcuts for undo/redo in CAPTURE phase
		// This intercepts events BEFORE they reach Obsidian's handlers
		const keydownHandler = (event: KeyboardEvent) => {
			// Only handle Ctrl/Cmd + Z/Y
			const isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
			const isRedo = ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z') || 
			               ((event.ctrlKey || event.metaKey) && event.key === 'y');
			
			if (!isUndo && !isRedo) return;
			
			// Check if any text editor currently has focus
			const activeElement = document.activeElement;
			const isEditorFocused = activeElement?.closest('.cm-editor') !== null ||
			                       activeElement?.closest('.markdown-source-view') !== null ||
			                       activeElement?.tagName === 'TEXTAREA' ||
			                       activeElement?.tagName === 'INPUT';
			
			// If an editor has focus, let Obsidian handle it
			if (isEditorFocused) return;
			
			// Check if this timeline view is visible/active
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || activeLeaf.view !== this) return;
			
			// Check if our view container is actually visible in the DOM
			if (!this.contentEl.isConnected) return;
			
			// We have the timeline focused and no editor has focus - intercept!
			if (isUndo) {
				event.preventDefault();
				event.stopPropagation();
				this.undo();
			} else if (isRedo) {
				event.preventDefault();
				event.stopPropagation();
				this.redo();
			}
		};
		
		// Add listener in capture phase (true = capture)
		window.addEventListener('keydown', keydownHandler, true);
		
		// Store handler for cleanup
		this.keydownHandler = keydownHandler;
	}

	async onClose() {
		console.log("TimelineView onClose");
		
		// Clear any pending metadata change timeout
		if (this.metadataChangeTimeout) {
			clearTimeout(this.metadataChangeTimeout);
			this.metadataChangeTimeout = null;
		}
		
		// Remove keyboard handler
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
