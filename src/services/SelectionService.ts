import type { TimelineItem, CardSelection } from '../stores/timelineStore';
import { timelineStore } from '../stores/timelineStore';
import { TimeScaleManager } from '../utils/TimeScaleManager';

export interface SelectionServiceDependencies {
	timeScale: number;
}

export class SelectionService {
	private timeScale: number;
	private selectedIndex: number | null = null;
	private selectedCardData: CardSelection | null = null;

	constructor(deps: SelectionServiceDependencies) {
		this.timeScale = deps.timeScale;
	}

	setTimeScale(timeScale: number): void {
		this.timeScale = timeScale;
	}

	/**
	 * Select a card by index
	 */
	selectCard(index: number, items: TimelineItem[]): void {
		if (index < 0 || index >= items.length) return;
		
		const item = items[index];
		if (!item) return;
		
		this.selectedIndex = index;
		this.selectedCardData = {
			index,
			startX: item.x,
			endX: item.x + item.width,
			startDate: item.dateStart,
			endDate: item.dateEnd,
			title: item.title
		};

		timelineStore.selectCard(index, item);
	}

	/**
	 * Toggle selection (select if not selected, deselect if already selected)
	 */
	toggleSelection(index: number, items: TimelineItem[]): void {
		if (this.selectedIndex === index) {
			this.clearSelection();
		} else {
			this.selectCard(index, items);
		}
	}

	/**
	 * Clear selection
	 */
	clearSelection(): void {
		this.selectedIndex = null;
		this.selectedCardData = null;
		timelineStore.selectCard(null);
	}

	/**
	 * Update selection data during drag/resize
	 */
	updateSelectionData(startX: number, endX: number, items: TimelineItem[]): void {
		if (this.selectedIndex === null || !this.selectedCardData) return;

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

		timelineStore.updateSelectionData({
			startX,
			endX,
			startDate: this.selectedCardData.startDate,
			endDate: this.selectedCardData.endDate
		});
	}

	/**
	 * Update selection after time scale change
	 */
	updateSelectionAfterScaleChange(items: TimelineItem[]): void {
		if (this.selectedIndex === null) return;

		const item = items[this.selectedIndex];
		if (!item) return;

		const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
		const daysStart = Math.round(TimeScaleManager.worldXToDay(item.x, this.timeScale));
		const daysEnd = Math.round(TimeScaleManager.worldXToDay(item.x + item.width, this.timeScale));

		this.selectedCardData = {
			...this.selectedCardData!,
			startX: item.x,
			endX: item.x + item.width,
			startDate: TimeScaleManager.formatDateForLevel(daysStart, scaleLevel),
			endDate: TimeScaleManager.formatDateForLevel(daysEnd, scaleLevel)
		};

		timelineStore.updateSelectionData({
			startX: item.x,
			endX: item.x + item.width,
			startDate: this.selectedCardData.startDate,
			endDate: this.selectedCardData.endDate
		});
	}

	getSelectedIndex(): number | null {
		return this.selectedIndex;
	}

	getSelectedCardData(): CardSelection | null {
		return this.selectedCardData;
	}

	isSelected(index: number): boolean {
		return this.selectedIndex === index;
	}
}
