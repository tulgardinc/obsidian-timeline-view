import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import Timeline from "../components/Timeline.svelte";
import { mount, unmount } from "svelte";
import { LayerManager, type LayerableItem, type LayerAssignment, type TimelineColor } from "../utils/LayerManager";

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

const PIXELS_PER_DAY = 10;
const START_DATE = new Date('1970-01-01');

export class TimelineView extends ItemView {
	private component: { $set?: (props: Record<string, unknown>) => void; refreshItems?: (items: TimelineItem[]) => void } | null = null;
	timelineItems: TimelineItem[] = [];

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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

	private parseDate(dateStr: string): Date | null {
		// Expected format: yyyy-mm-dd
		const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match || !match[1] || !match[2] || !match[3]) return null;
		
		const year = parseInt(match[1]);
		const month = parseInt(match[2]) - 1; // JS months are 0-indexed
		const day = parseInt(match[3]);
		
		const date = new Date(year, month, day);
		
		// Validate the date is real
		if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
			return null;
		}
		
		return date;
	}

	private daysBetween(start: Date, end: Date): number {
		const msPerDay = 24 * 60 * 60 * 1000;
		return Math.round((end.getTime() - start.getTime()) / msPerDay);
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
			// Calculate x position (days from epoch start)
			const daysFromStart = this.daysBetween(START_DATE, item.dateStart);
			const x = daysFromStart * PIXELS_PER_DAY;
			
			// Calculate width (duration in days)
			const duration = this.daysBetween(item.dateStart, item.dateEnd);
			const width = Math.max(duration, 1) * PIXELS_PER_DAY;
			
			// Calculate Y position from assigned layer
			const layer = item.layer ?? 0;
			const y = LayerManager.layerToY(layer);
			
			items.push({
				file: item.file,
				title: item.file.basename,
				x,
				y,
				width,
				dateStart: this.formatDate(item.dateStart),
				dateEnd: this.formatDate(item.dateEnd),
				layer,
				color: item.color
			});
			
			console.log(`Timeline: Added ${item.file.basename} at x=${x}, y=${y}, layer=${layer}, width=${width}`);
		}
		
		return items;
	}

	private formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private async batchUpdateLayers(assignments: LayerAssignment[]): Promise<void> {
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
			} catch (error) {
				console.error(`Timeline: Failed to update layer for ${assignment.file.basename}:`, error);
			}
		}
	}

	private pixelsToDate(pixels: number): string {
		const days = Math.round(pixels / PIXELS_PER_DAY);
		const msOffset = days * 24 * 60 * 60 * 1000;
		const date = new Date(START_DATE.getTime() + msOffset);
		
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		
		console.log(`pixelsToDate: pixels=${pixels}, days=${days}, msOffset=${msOffset}, result=${year}-${month}-${day}`);
		
		return `${year}-${month}-${day}`;
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
			
			// Check if layer property already exists
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
			
			// Update component props to reflect changes in UI immediately
			if (this.component && this.component.refreshItems) {
				this.component.refreshItems(this.timelineItems);
			}
			
			console.log(`Timeline: Successfully updated ${item.file.basename} layer to ${finalLayer}`);
			
			if (hasCollision && finalLayer !== targetLayer) {
				new Notice(`${item.file.basename}: moved to layer ${finalLayer} due to collision at layer ${targetLayer}`);
			}
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

		// Mount the Svelte component with items
		try {
			this.component = mount(Timeline, {
				target: this.contentEl,
				props: {
					items: this.timelineItems,
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
						this.openFile(index);
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
	}

	async onClose() {
		console.log("TimelineView onClose");
		
		// Clear any pending metadata change timeout
		if (this.metadataChangeTimeout) {
			clearTimeout(this.metadataChangeTimeout);
			this.metadataChangeTimeout = null;
		}
		
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
