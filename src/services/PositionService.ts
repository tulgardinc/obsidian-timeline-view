import { TimeScaleManager } from '../utils/TimeScaleManager';
import { TimelineDate } from '../utils/TimelineDate';
import type { TimelineItem } from '../stores/timelineStore';

export interface PositionServiceDependencies {
	timeScale: number;
}

export class PositionService {
	private timeScale: number;

	constructor(deps: PositionServiceDependencies) {
		this.timeScale = deps.timeScale;
	}

	setTimeScale(timeScale: number): void {
		this.timeScale = timeScale;
	}

	/**
	 * Recalculate all item positions based on current time scale
	 */
	recalculatePositions(items: TimelineItem[]): TimelineItem[] {
		return items.map(item => {
			const dateStart = TimelineDate.fromString(item.dateStart);
			const dateEnd = TimelineDate.fromString(item.dateEnd);
			
			if (!dateStart || !dateEnd) return item;

			const daysFromStart = dateStart.getDaysFromEpoch();
			const newX = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);

			const duration = dateEnd.getDaysFromEpoch() - dateStart.getDaysFromEpoch();
			const newWidth = Math.max(duration, 1) * this.timeScale;

			return {
				...item,
				x: newX,
				width: newWidth
			};
		});
	}

	/**
	 * Convert world X position to date string
	 */
	worldXToDate(worldX: number): string {
		const days = Math.round(TimeScaleManager.worldXToDay(worldX, this.timeScale));
		const date = TimelineDate.fromDaysFromEpoch(days);
		return date.toISOString();
	}

	/**
	 * Calculate new dates from position shift
	 */
	calculateDatesFromPosition(item: TimelineItem, newX: number): { dateStart: string; dateEnd: string } {
		const newDateStart = this.worldXToDate(newX);
		const endWorldX = newX + item.width;
		const newDateEnd = this.worldXToDate(endWorldX);
		
		return { dateStart: newDateStart, dateEnd: newDateEnd };
	}

	/**
	 * Calculate new dates from resize
	 */
	calculateDatesFromResize(newX: number, newWidth: number): { dateStart: string; dateEnd: string } {
		const newDateStart = this.worldXToDate(newX);
		const endWorldX = newX + newWidth;
		const newDateEnd = this.worldXToDate(endWorldX);
		
		return { dateStart: newDateStart, dateEnd: newDateEnd };
	}

	/**
	 * Format date for current scale level
	 */
	formatDateForLevel(day: number): string {
		const scaleLevel = TimeScaleManager.getScaleLevel(this.timeScale);
		return TimeScaleManager.formatDateForLevel(day, scaleLevel);
	}

	/**
	 * Get scale level for current time scale
	 */
	getCurrentScaleLevel(): number {
		return TimeScaleManager.getScaleLevel(this.timeScale);
	}
}
