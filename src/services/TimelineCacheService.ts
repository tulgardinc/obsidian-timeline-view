import { type App, TFile } from 'obsidian';
import { LayerManager, type LayerableItem, type LayerAssignment } from '../utils/LayerManager';

/**
 * Viewport state for a timeline (camera position and zoom)
 * centerDay is preferred (time-scale independent), centerX is kept for backward compatibility
 */
export interface ViewportState {
	centerX: number;  // Legacy: worldX coordinate (deprecated, use centerDay instead)
	centerDay: number; // Preferred: days from epoch at viewport center (time-scale independent)
	centerY: number;
	timeScale: number;
	scale?: number; // Y-axis zoom level (0.5 to 2.0), defaults to 1 if not present
}

/**
 * Note data stored per timeline
 */
export interface TimelineNoteData {
	layer: number;
	lastPath: string;
	lastModified: number;
}

/**
 * Timeline card data - references another timeline
 */
export interface TimelineCardData {
	layer: number;
	color?: 'red' | 'blue' | 'green' | 'yellow';
}

/**
 * Data for a single timeline
 */
export interface TimelineData {
	viewport: ViewportState;
	notes: Record<string, TimelineNoteData>; // Key is note ID
	timelineCards?: Record<string, TimelineCardData>; // Key is referenced timeline ID
}

/**
 * Root cache structure
 */
export interface TimelineCache {
	version: number;
	timelines: Record<string, TimelineData>; // Key is timeline ID
}

const CACHE_VERSION = 1;
const CACHE_FILE_PATH = './timelines/timelines.json';
const VIEWPORT_SAVE_DEBOUNCE = 500; // ms

/**
 * Service for managing per-timeline data including:
 * - Viewport state (camera position, zoom)
 * - Note layer assignments per timeline
 * - Note ID management for move-safe identification
 */
export class TimelineCacheService {
	private app: App;
	private cache: TimelineCache;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private isLoaded = false;

	constructor(app: App) {
		this.app = app;
		this.cache = {
			version: CACHE_VERSION,
			timelines: {}
		};
	}

	/**
	 * Initialize the cache service - load existing cache or create new
	 */
	async initialize(): Promise<void> {
		await this.loadCache();
		this.isLoaded = true;
	}

	/**
	 * Load cache from disk
	 */
	private async loadCache(): Promise<void> {
		try {
			// Use adapter.exists() and adapter.read() to bypass vault metadata cache
			// (vault cache may not be fully populated during plugin onload)
			const fileExists = await this.app.vault.adapter.exists(CACHE_FILE_PATH);
			if (fileExists) {
				const content = await this.app.vault.adapter.read(CACHE_FILE_PATH);
				const parsed = JSON.parse(content) as TimelineCache;
				
				// Validate version
				if (parsed.version === CACHE_VERSION) {
					this.cache = parsed;
					console.log('Timeline Cache: Loaded cache from disk:', Object.keys(this.cache.timelines).length, 'timelines');
					for (const [id, data] of Object.entries(this.cache.timelines)) {
						console.log(`  - Timeline ${id}: viewport=`, data.viewport, `notes=${Object.keys(data.notes).length}`);
					}
				} else {
					console.log(`Timeline Cache: Version mismatch (${parsed.version} vs ${CACHE_VERSION}), resetting`);
					this.cache = { version: CACHE_VERSION, timelines: {} };
				}
			} else {
				console.log('Timeline Cache: No cache file found at', CACHE_FILE_PATH);
			}
		} catch (error) {
			// Cache doesn't exist yet or is corrupted - start fresh
			console.log('Timeline Cache: No existing cache found or error loading, creating new:', error);
			this.cache = { version: CACHE_VERSION, timelines: {} };
		}
	}

	/**
	 * Save cache to disk (debounced)
	 */
	private scheduleSave(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		
		this.saveTimeout = setTimeout(() => {
			void this.saveCache();
		}, VIEWPORT_SAVE_DEBOUNCE);
	}

	/**
	 * Save cache to disk immediately
	 */
	async saveCache(): Promise<void> {
		if (!this.isLoaded) return;
		
		try {
			// Ensure the timelines directory exists
			const dirPath = './timelines';
			const dirExists = await this.app.vault.adapter.exists(dirPath);
			if (!dirExists) {
				console.log('Timeline Cache: Creating timelines directory');
				await this.app.vault.adapter.mkdir(dirPath);
			}
			
			// Write the cache file
			const content = JSON.stringify(this.cache, null, 2);
			console.log('Timeline Cache: Saving cache to disk');
			
			// Check if file exists using adapter (more reliable than getAbstractFileByPath)
			const fileExists = await this.app.vault.adapter.exists(CACHE_FILE_PATH);
			
			if (fileExists) {
				// File exists - get the TFile and modify it
				const file = this.app.vault.getAbstractFileByPath(CACHE_FILE_PATH);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, content);
				} else {
					// File exists but not in vault cache - use adapter write
					await this.app.vault.adapter.write(CACHE_FILE_PATH, content);
				}
			} else {
				// File doesn't exist - create it
				await this.app.vault.create(CACHE_FILE_PATH, content);
			}
			console.log('Timeline Cache: Save complete');
		} catch (error) {
			console.error('Timeline: Failed to save cache:', error);
		}
	}

	/**
	 * Get timeline data if it exists (does NOT create new data)
	 */
	private getTimelineData(timelineId: string): TimelineData | null {
		return this.cache.timelines[timelineId] ?? null;
	}

	/**
	 * Get or create timeline data (creates with defaults if missing)
	 */
	private getOrCreateTimelineData(timelineId: string): TimelineData {
		if (!this.cache.timelines[timelineId]) {
			console.log(`Timeline Cache: Creating new timeline data for ${timelineId}`);
			this.cache.timelines[timelineId] = {
				viewport: {
					centerX: 0,
					centerDay: 0,
					centerY: 0,
					timeScale: 10, // Default time scale
					scale: 1 // Default Y-axis zoom (100%)
				},
				notes: {}
			};
		}
		return this.cache.timelines[timelineId]!;
	}

	/**
	 * Get viewport state for a timeline (returns null if no saved state)
	 */
	getViewport(timelineId: string): ViewportState | null {
		const data = this.getTimelineData(timelineId);
		if (!data) {
			console.log(`Timeline Cache: No cached viewport for timeline ${timelineId}`);
			return null;
		}
		console.log(`Timeline Cache: Loaded viewport for ${timelineId}:`, data.viewport);
		return { ...data.viewport };
	}

	/**
	 * Set viewport state for a timeline (debounced save)
	 */
	setViewport(timelineId: string, viewport: ViewportState): void {
		const data = this.getOrCreateTimelineData(timelineId);
		data.viewport = { ...viewport };
		console.log(`Timeline Cache: Saving viewport for ${timelineId}:`, viewport);
		this.scheduleSave();
	}

	/**
	 * Get note ID from file frontmatter, generating and injecting one if missing
	 */
	async getOrCreateNoteId(file: TFile): Promise<string> {
		const metadata = this.app.metadataCache.getFileCache(file);
		const existingId = metadata?.frontmatter?.['timeline-id'];
		
		if (existingId && typeof existingId === 'string') {
			return existingId;
		}
		
		// Generate new ID
		const newId = crypto.randomUUID();
		
		// Inject into file frontmatter
		try {
			const content = await this.app.vault.read(file);
			const idRegex = /^timeline-id:\s*\S+/m;
			
			let newContent: string;
			if (idRegex.test(content)) {
				// Update existing (shouldn't happen but handle it)
				newContent = content.replace(idRegex, `timeline-id: ${newId}`);
			} else {
				// Add after timeline: true
				newContent = content.replace(
					/(timeline:\s*true.*\n)/,
					`$1timeline-id: ${newId}\n`
				);
			}
			
			await this.app.vault.modify(file, newContent);
		} catch (error) {
			console.error(`Timeline: Failed to inject ID into ${file.basename}:`, error);
		}
		
		return newId;
	}

	/**
	 * Get note ID without creating one (for checking existence)
	 */
	getNoteId(file: TFile): string | undefined {
		const metadata = this.app.metadataCache.getFileCache(file);
		const id = metadata?.frontmatter?.['timeline-id'];
		return typeof id === 'string' ? id : undefined;
	}

	/**
	 * Get layer for a note in a specific timeline
	 */
	getNoteLayer(timelineId: string, noteId: string): number | undefined {
		const data = this.cache.timelines[timelineId];
		if (!data) return undefined;
		return data.notes[noteId]?.layer;
	}

	/**
	 * Set layer for a note in a specific timeline
	 */
	setNoteLayer(timelineId: string, noteId: string, layer: number, filePath: string): void {
		const data = this.getOrCreateTimelineData(timelineId);
		data.notes[noteId] = {
			layer,
			lastPath: filePath,
			lastModified: Date.now()
		};
		this.scheduleSave();
	}

	/**
	 * Remove note data from a timeline
	 */
	removeNoteFromTimeline(timelineId: string, noteId: string): void {
		const data = this.cache.timelines[timelineId];
		if (data && data.notes[noteId]) {
			delete data.notes[noteId];
			this.scheduleSave();
		}
	}

	/**
	 * Get timeline cards for a specific timeline
	 */
	getTimelineCards(timelineId: string): Record<string, TimelineCardData> | undefined {
		const data = this.cache.timelines[timelineId];
		return data?.timelineCards;
	}

	/**
	 * Add a timeline card to a timeline
	 */
	addTimelineCard(timelineId: string, referencedTimelineId: string, layer: number): void {
		const data = this.getOrCreateTimelineData(timelineId);
		if (!data.timelineCards) {
			data.timelineCards = {};
		}
		data.timelineCards[referencedTimelineId] = { layer };
		this.scheduleSave();
	}

	/**
	 * Set color for a timeline card
	 */
	setTimelineCardColor(timelineId: string, referencedTimelineId: string, color: 'red' | 'blue' | 'green' | 'yellow' | null): void {
		const data = this.cache.timelines[timelineId];
		if (data?.timelineCards?.[referencedTimelineId]) {
			if (color) {
				data.timelineCards[referencedTimelineId].color = color;
			} else {
				delete data.timelineCards[referencedTimelineId].color;
			}
			this.scheduleSave();
		}
	}

	/**
	 * Remove a timeline card from a timeline
	 */
	removeTimelineCard(timelineId: string, referencedTimelineId: string): void {
		const data = this.cache.timelines[timelineId];
		if (data?.timelineCards?.[referencedTimelineId]) {
			delete data.timelineCards[referencedTimelineId];
			this.scheduleSave();
		}
	}

	/**
	 * Set layer for a timeline card
	 */
	setTimelineCardLayer(timelineId: string, referencedTimelineId: string, layer: number): void {
		const data = this.cache.timelines[timelineId];
		if (data?.timelineCards?.[referencedTimelineId]) {
			data.timelineCards[referencedTimelineId].layer = layer;
			this.scheduleSave();
		}
	}

	/**
	 * Clean up notes that are no longer in scope for a timeline
	 * Call this when refreshing the timeline
	 */
	cleanupOutOfScopeNotes(timelineId: string, validNoteIds: Set<string>): void {
		const data = this.cache.timelines[timelineId];
		if (!data) return;
		
		let hasChanges = false;
		for (const noteId of Object.keys(data.notes)) {
			if (!validNoteIds.has(noteId)) {
				delete data.notes[noteId];
				hasChanges = true;
			}
		}
		
		if (hasChanges) {
			this.scheduleSave();
		}
	}

	/**
	 * Assign layers to items for a timeline using cached layers when available
	 * This replaces LayerManager.assignLayers with cache-aware version
	 */
	assignLayersWithCache(
		timelineId: string,
		items: LayerableItem[],
		getNoteId: (file: TFile) => string | undefined
	): LayerAssignment[] {
		// First, set layers from cache where available
		for (const item of items) {
			const noteId = getNoteId(item.file);
			if (noteId) {
				const cachedLayer = this.getNoteLayer(timelineId, noteId);
				if (cachedLayer !== undefined) {
					// Mark this as a preferred layer for the item
					(item as LayerableItem & { cachedLayer?: number }).cachedLayer = cachedLayer;
				}
			}
		}

		// Now use LayerManager to assign, respecting cached layers
		const assignments: LayerAssignment[] = [];
		const processedItems: LayerableItem[] = [];

		for (const item of items) {
			// Try cached layer first, then default to 0
			const cachedLayer = (item as LayerableItem & { cachedLayer?: number }).cachedLayer;
			const preferredLayer = cachedLayer ?? 0;
			const previousLayer = item.layer;

			// Check if preferred layer is available
			if (!LayerManager.isLayerBusy(preferredLayer, item.dateStart, item.dateEnd, processedItems)) {
				item.layer = preferredLayer;
			} else {
				// Use alternating search from LayerManager
				let assigned = false;
				const maxSearch = Math.max(items.length * 2, 100);

				for (let i = 1; i < maxSearch && !assigned; i++) {
					// Try +i (above)
					const layerAbove = preferredLayer + i;
					if (!LayerManager.isLayerBusy(layerAbove, item.dateStart, item.dateEnd, processedItems, item.file)) {
						item.layer = layerAbove;
						assigned = true;
						break;
					}

					// Try -i (below)
					const layerBelow = preferredLayer - i;
					if (!LayerManager.isLayerBusy(layerBelow, item.dateStart, item.dateEnd, processedItems, item.file)) {
						item.layer = layerBelow;
						assigned = true;
						break;
					}
				}

				// Fallback: use preferred and let it overlap
				if (!assigned) {
					item.layer = preferredLayer;
				}
			}

			// Record the assignment if layer changed or is new
			if (item.layer !== previousLayer || item.layer !== cachedLayer) {
				assignments.push({
					file: item.file,
					layer: item.layer!,
					previousLayer: previousLayer !== item.layer ? previousLayer : undefined
				});
			}

			// Update cache with the assigned layer
			const noteId = getNoteId(item.file);
			if (noteId) {
				this.setNoteLayer(timelineId, noteId, item.layer!, item.file.path);
			}

			processedItems.push(item);
		}

		return assignments;
	}

	/**
	 * Delete all data for a timeline (when timeline is deleted)
	 */
	deleteTimeline(timelineId: string): void {
		if (this.cache.timelines[timelineId]) {
			delete this.cache.timelines[timelineId];
			this.scheduleSave();
		}
	}

	/**
	 * Handle file rename - update paths in cache
	 */
	handleFileRename(oldPath: string, newPath: string): void {
		// Update lastPath for all notes across all timelines
		for (const timelineData of Object.values(this.cache.timelines)) {
			for (const noteData of Object.values(timelineData.notes)) {
				if (noteData.lastPath === oldPath) {
					noteData.lastPath = newPath;
					this.scheduleSave();
				}
			}
		}
	}

	/**
	 * Force immediate save (useful when closing)
	 */
	async forceSave(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		await this.saveCache();
	}
}
