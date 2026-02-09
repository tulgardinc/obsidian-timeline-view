import type { TFile } from "obsidian";

export interface TimelineState {
	dateStart: string;
	dateEnd: string;
	layer: number;
}

export interface HistoryEntry {
	file: TFile;
	previousState: TimelineState;
	newState: TimelineState;
	operationType: 'resize' | 'move' | 'layer-change';
	timestamp: number;
}

export class TimelineHistoryManager {
	private history: HistoryEntry[] = [];
	private currentIndex: number = -1;
	private readonly maxHistory: number = 50;

	/**
	 * Record a state change in history
	 */
	record(
		file: TFile,
		previousState: TimelineState,
		newState: TimelineState,
		operationType: 'resize' | 'move' | 'layer-change'
	): void {
		// Remove any future history if we're not at the end
		if (this.currentIndex < this.history.length - 1) {
			this.history = this.history.slice(0, this.currentIndex + 1);
		}

		// Add new entry
		this.history.push({
			file,
			previousState,
			newState,
			operationType,
			timestamp: Date.now()
		});

		// Move to new entry
		this.currentIndex++;

		// Enforce max history limit
		if (this.history.length > this.maxHistory) {
			this.history.shift();
			this.currentIndex--;
		}
	}

	/**
	 * Get the next entry to undo
	 */
	peekUndo(): HistoryEntry | null {
		if (this.currentIndex >= 0) {
			return this.history[this.currentIndex] ?? null;
		}
		return null;
	}

	/**
	 * Get the next entry to redo
	 */
	peekRedo(): HistoryEntry | null {
		if (this.currentIndex < this.history.length - 1) {
			return this.history[this.currentIndex + 1] ?? null;
		}
		return null;
	}

	/**
	 * Move back one step in history and return the entry to undo
	 */
	undo(): HistoryEntry | null {
		if (this.currentIndex >= 0) {
			const entry = this.history[this.currentIndex] ?? null;
			if (entry) {
				this.currentIndex--;
			}
			return entry;
		}
		return null;
	}

	/**
	 * Move forward one step in history and return the entry to redo
	 */
	redo(): HistoryEntry | null {
		if (this.currentIndex < this.history.length - 1) {
			this.currentIndex++;
			const entry = this.history[this.currentIndex] ?? null;
			return entry;
		}
		return null;
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.currentIndex >= 0;
	}

	/**
	 * Check if redo is available
	 */
	canRedo(): boolean {
		return this.currentIndex < this.history.length - 1;
	}

	/**
	 * Clear all history
	 */
	clear(): void {
		this.history = [];
		this.currentIndex = -1;
	}

	/**
	 * Get current history stats for debugging
	 */
	getStats(): { size: number; currentIndex: number; canUndo: boolean; canRedo: boolean } {
		return {
			size: this.history.length,
			currentIndex: this.currentIndex,
			canUndo: this.canUndo(),
			canRedo: this.canRedo()
		};
	}
}
