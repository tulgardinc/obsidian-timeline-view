// Time scale level definitions
// Level 0: Days (small), Weeks/Monday (large)
// Level 1: Weeks (small), Months (large)  
// Level 2: Months (small), Years (large)
// Level 3: Years (small), Decades (large)
// Level 4: Decades (small), Centuries (large)
// Level 5+: Centuries (small), Millennia (large), etc.

export type ScaleLevel = 0 | 1 | 2 | 3 | 4 | number;

export interface Marker {
	screenX: number;
	unitIndex: number; // Day number, week number, month number, etc.
	isLarge: boolean;
	label?: string;
}

export interface ScaleInfo {
	level: ScaleLevel;
	unitName: string;
	largeUnitName: string;
	pixelsPerUnit: number;
}

// Epoch start - all calculations based on days since this date
const EPOCH = new Date('1970-01-01');
const EPOCH_DAY_OF_WEEK = 4; // Thursday (0=Sunday, 4=Thursday)

// Thresholds for switching scale levels (pixels per unit)
// When markers would be closer than MIN_MARKER_SPACING pixels, switch to next level
const MIN_MARKER_SPACING = 8;
const MAX_MARKER_SPACING = 100;

// Base time scales (pixels per unit at scale=1) for each level
const BASE_TIME_SCALES = [
	1,      // Level 0: 1 px/day
	7,      // Level 1: 7 px/week  
	30,     // Level 2: ~30 px/month (avg)
	365,    // Level 3: 365 px/year
	3650,   // Level 4: 3650 px/decade
	36500,  // Level 5: 36500 px/century
];

export class TimeScaleManager {
	/**
	 * Determine the appropriate scale level based on effective visual density
	 * Effective density = timeScale * scale (canvas zoom factor)
	 * When small markers would be closer than MIN_MARKER_SPACING, go to next level
	 */
	static getScaleLevel(timeScale: number, scale: number = 1): ScaleLevel {
		// Calculate effective visual density combining both zoom factors
		const effectiveDensity = timeScale * scale;
		
		// Start from level 0 and find the appropriate level
		for (let level = 0; level < 20; level++) {
			const baseScale = this.getBaseScaleForLevel(level);
			const pixelsPerSmallUnit = effectiveDensity * baseScale;
			
			// If small markers would be at least MIN_MARKER_SPACING apart, this level is good
			if (pixelsPerSmallUnit >= MIN_MARKER_SPACING) {
				return level;
			}
		}
		return 20; // Max level
	}
	
	/**
	 * Get the base scale (pixels per unit at timeScale=1) for a given level
	 */
	static getBaseScaleForLevel(level: ScaleLevel): number {
		if (level <= 5) {
			return BASE_TIME_SCALES[level] ?? 36500;
		}
		// For levels > 5: centuries, millennia, 10k years, etc.
		// Level 5: century (100 years)
		// Level 6: millennia (1000 years) = 365,000 px
		// Level 7: 10k years = 3,650,000 px
		// Pattern: 36500 * 10^(level-5)
		return 36500 * Math.pow(10, level - 5);
	}
	
	/**
	 * Get information about the current scale level
	 */
	static getScaleInfo(level: ScaleLevel): ScaleInfo {
		const unitNames = [
			{ unit: 'day', large: 'week' },
			{ unit: 'week', large: 'month' },
			{ unit: 'month', large: 'year' },
			{ unit: 'year', large: 'decade' },
			{ unit: 'decade', large: 'century' },
		];
		
		if (level < 5) {
			const names = unitNames[level];
			if (!names) {
				// Fallback for any edge case
				return {
					level,
					unitName: 'year',
					largeUnitName: 'decade',
					pixelsPerUnit: BASE_TIME_SCALES[level] ?? 3650
				};
			}
			return {
				level,
				unitName: names.unit,
				largeUnitName: names.large,
				pixelsPerUnit: BASE_TIME_SCALES[level] ?? 3650
			};
		}
		
		// For higher levels
		const yearUnit = Math.pow(10, level - 3); // decade=10, century=100, millennia=1000, etc.
		let unitLabel: string;
		
		if (yearUnit === 100) unitLabel = 'century';
		else if (yearUnit === 1000) unitLabel = 'millennium';
		else if (yearUnit < 1000000) unitLabel = `${yearUnit / 1000}k years`;
		else if (yearUnit < 1000000000) unitLabel = `${yearUnit / 1000000}M years`;
		else unitLabel = `${yearUnit / 1000000000}B years`;
		
		const largeYearUnit = yearUnit * 10;
		let largeUnitLabel: string;
		
		if (largeYearUnit === 1000) largeUnitLabel = 'millennium';
		else if (largeYearUnit < 1000000) largeUnitLabel = `${largeYearUnit / 1000}k years`;
		else if (largeYearUnit < 1000000000) largeUnitLabel = `${largeYearUnit / 1000000}M years`;
		else largeUnitLabel = `${largeYearUnit / 1000000000}B years`;
		
		return {
			level,
			unitName: unitLabel,
			largeUnitName: largeUnitLabel,
			pixelsPerUnit: this.getBaseScaleForLevel(level)
		};
	}
	
	/**
	 * Calculate visible markers for the current viewport
	 */
	static getVisibleMarkers(
		level: ScaleLevel,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Calculate visible world coordinate range first (same space as cards)
		// worldX = (screenX - translateX) / scale, but for viewport bounds:
		const worldStartX = (-translateX) / scale;
		const worldEndX = (-translateX + viewportWidth) / scale;
		
		// Calculate visible day range from world coordinates
		const startDay = Math.floor(worldStartX / timeScale);
		const endDay = Math.ceil(worldEndX / timeScale);
		
		switch (level) {
			case 0:
				return this.getDayMarkers(startDay, endDay, timeScale, scale, translateX, viewportWidth);
			case 1:
				return this.getWeekMarkers(startDay, endDay, timeScale, scale, translateX, viewportWidth);
			case 2:
				return this.getMonthMarkers(startDay, endDay, timeScale, scale, translateX, viewportWidth);
			case 3:
				return this.getYearMarkers(startDay, endDay, timeScale, scale, translateX, viewportWidth);
			default:
				return this.getLargeUnitMarkers(level, startDay, endDay, timeScale, scale, translateX, viewportWidth);
		}
	}
	
	/**
	 * Level 0: Day markers, Mondays as large markers
	 */
	private static getDayMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		for (let day = startDay; day <= endDay; day++) {
			const worldX = day * timeScale;
			const screenX = worldX * scale + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				// Monday is when (day + 4) % 7 === 0 (since 1970-01-01 was Thursday)
				const isMonday = (day + 4) % 7 === 0;
				markers.push({
					screenX,
					unitIndex: day,
					isLarge: isMonday
				});
			}
		}
		
		return markers;
	}
	
	/**
	 * Level 1: Week markers, month starts as large markers
	 */
	private static getWeekMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Find first week start (Monday) in range
		const startWeek = Math.floor((startDay + 4) / 7);
		const endWeek = Math.ceil((endDay + 4) / 7);
		
		for (let week = startWeek; week <= endWeek; week++) {
			const day = week * 7 - 4; // Convert week number to Monday's day number
			const worldX = day * timeScale;
			const screenX = worldX * scale + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				// Check if this week contains a month start
				const date = new Date(EPOCH.getTime() + day * 24 * 60 * 60 * 1000);
				const isMonthStart = date.getDate() <= 7; // First week of month
				
				markers.push({
					screenX,
					unitIndex: week,
					isLarge: isMonthStart
				});
			}
		}
		
		return markers;
	}
	
	/**
	 * Level 2: Month markers, year starts as large markers
	 */
	private static getMonthMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Get start and end dates
		const startDate = new Date(EPOCH.getTime() + startDay * 24 * 60 * 60 * 1000);
		const endDate = new Date(EPOCH.getTime() + endDay * 24 * 60 * 60 * 1000);
		
		// Start from the first day of the start month
		const currentYear = startDate.getFullYear();
		const currentMonth = startDate.getMonth();
		
		// Iterate through months
		let year = currentYear;
		let month = currentMonth;
		
		while (true) {
			const monthDate = new Date(year, month, 1);
			const day = Math.floor((monthDate.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
			
			if (day > endDay) break;
			
			const worldX = day * timeScale;
			const screenX = worldX * scale + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				const isYearStart = month === 0;
				markers.push({
					screenX,
					unitIndex: year * 12 + month,
					isLarge: isYearStart
				});
			}
			
			// Move to next month
			month++;
			if (month > 11) {
				month = 0;
				year++;
			}
			
			// Safety check
			if (year > endDate.getFullYear() + 1) break;
		}
		
		return markers;
	}
	
	/**
	 * Level 3: Year markers, decade starts as large markers
	 */
	private static getYearMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		const startDate = new Date(EPOCH.getTime() + startDay * 24 * 60 * 60 * 1000);
		const endDate = new Date(EPOCH.getTime() + endDay * 24 * 60 * 60 * 1000);
		
		let year = startDate.getFullYear();
		
		while (year <= endDate.getFullYear() + 1) {
			const yearDate = new Date(year, 0, 1);
			const day = Math.floor((yearDate.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
			
			const worldX = day * timeScale;
			const screenX = worldX * scale + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				const isDecadeStart = year % 10 === 0;
				markers.push({
					screenX,
					unitIndex: year,
					isLarge: isDecadeStart
				});
			}
			
			year++;
		}
		
		return markers;
	}
	
	/**
	 * Level 4+: Decades, centuries, millennia, etc.
	 */
	private static getLargeUnitMarkers(
		level: ScaleLevel,
		startDay: number,
		endDay: number,
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Years per unit at this level
		const yearsPerUnit = Math.pow(10, level - 3); // 10, 100, 1000, 10000, etc.
		const yearsPerLargeUnit = yearsPerUnit * 10;
		
		const startDate = new Date(EPOCH.getTime() + startDay * 24 * 60 * 60 * 1000);
		const endDate = new Date(EPOCH.getTime() + endDay * 24 * 60 * 60 * 1000);
		
		// Find the first unit boundary
		const startYear = startDate.getFullYear();
		const firstUnit = Math.floor(startYear / yearsPerUnit) * yearsPerUnit;
		
		let currentUnit = firstUnit;
		
		while (currentUnit <= endDate.getFullYear() + yearsPerUnit) {
			const unitDate = new Date(currentUnit, 0, 1);
			const day = Math.floor((unitDate.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
			
			const worldX = day * timeScale;
			const screenX = worldX * scale + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				const isLargeUnitStart = currentUnit % yearsPerLargeUnit === 0;
				markers.push({
					screenX,
					unitIndex: currentUnit,
					isLarge: isLargeUnitStart
				});
			}
			
			currentUnit += yearsPerUnit;
		}
		
		return markers;
	}
	
	/**
	 * Format a date for display at the given scale level
	 */
	static formatDateForLevel(day: number, level: ScaleLevel): string {
		const date = new Date(EPOCH.getTime() + day * 24 * 60 * 60 * 1000);
		const year = date.getFullYear();
		
		switch (level) {
			case 0: // Days
			case 1: // Weeks
				// Full date: dd/mm/yyyy
				const day_num = date.getDate().toString().padStart(2, '0');
				const month = (date.getMonth() + 1).toString().padStart(2, '0');
				return `${day_num}/${month}/${Math.abs(year)}${year < 0 ? ' BC' : ''}`;
				
			case 2: // Months
				// mm/yyyy
				const month_name = (date.getMonth() + 1).toString().padStart(2, '0');
				return `${month_name}/${Math.abs(year)}${year < 0 ? ' BC' : ''}`;
				
			case 3: // Years
				// Year with BC/AD
				if (year === 0) return '1 AD';
				return `${Math.abs(year)}${year < 0 ? ' BC' : ' AD'}`;
				
			default: // Decades, centuries, etc.
				const yearsPerUnit = Math.pow(10, level - 3);
				const unitStart = Math.floor(year / yearsPerUnit) * yearsPerUnit;
				
				// Format large numbers with K, M, B suffixes
				const absYear = Math.abs(unitStart);
				let yearStr: string;
				
				if (absYear >= 1000000000) {
					yearStr = `${(absYear / 1000000000).toFixed(absYear % 1000000000 === 0 ? 0 : 1)}B`;
				} else if (absYear >= 1000000) {
					yearStr = `${(absYear / 1000000).toFixed(absYear % 1000000 === 0 ? 0 : 1)}M`;
				} else if (absYear >= 1000) {
					yearStr = `${(absYear / 1000).toFixed(absYear % 1000 === 0 ? 0 : 1)}K`;
				} else {
					yearStr = absYear.toString();
				}
				
				return `${yearStr}${unitStart < 0 ? ' BC' : ''}`;
		}
	}
	
	/**
	 * Get the day number at a given screen position
	 */
	static screenToDay(screenX: number, timeScale: number, scale: number, translateX: number): number {
		const worldX = (screenX - translateX) / scale;
		return Math.floor(worldX / timeScale);
	}
	
	/**
	 * Snap a day to the nearest marker day based on scale level
	 * This ensures resizing snaps to the actual small marker positions visible in the timeline
	 */
	static snapToNearestMarker(day: number, level: ScaleLevel): number {
		const date = new Date(EPOCH.getTime() + day * 24 * 60 * 60 * 1000);
		
		switch (level) {
			case 0: // Days - snap to nearest day (every day is a marker)
				return Math.round(day);
				
			case 1: // Weeks - snap to nearest Monday (week start)
				// Find the nearest Monday
				// Monday is when (day + 4) % 7 === 0
				const dayOfWeek = (day + 4) % 7;
				return day - dayOfWeek;
				
			case 2: // Months - snap to nearest month start
				const year2 = date.getFullYear();
				const month2 = date.getMonth();
				const monthStart2 = new Date(year2, month2, 1);
				return Math.floor((monthStart2.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
				
			case 3: // Years - snap to nearest year start (January 1)
				const year3 = date.getFullYear();
				const yearStart3 = new Date(year3, 0, 1);
				return Math.floor((yearStart3.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
				
			default: // Decades, centuries, etc. - snap to unit start
				const yearsPerUnit = Math.pow(10, level - 3);
				const year = date.getFullYear();
				const unitStartYear = Math.floor(year / yearsPerUnit) * yearsPerUnit;
				const unitStart = new Date(unitStartYear, 0, 1);
				return Math.floor((unitStart.getTime() - EPOCH.getTime()) / (24 * 60 * 60 * 1000));
		}
	}
	
	// ============================================================================
	// UNIFIED COORDINATE TRANSFORMATION FUNCTIONS
	// All timeline coordinate calculations should go through these functions
	// to ensure consistency across the application
	// ============================================================================
	
	/**
	 * Calculate world X coordinate from day index
	 * World coordinates are the base coordinate space (unaffected by zoom/pan)
	 */
	static dayToWorldX(day: number, timeScale: number): number {
		return day * timeScale;
	}
	
	/**
	 * Calculate day index from world X coordinate
	 */
	static worldXToDay(worldX: number, timeScale: number): number {
		return worldX / timeScale;
	}
	
	/**
	 * Calculate screen X coordinate from world X coordinate
	 * Applies the zoom (scale) and pan (translateX) transform
	 */
	static worldXToScreen(worldX: number, scale: number, translateX: number): number {
		return worldX * scale + translateX;
	}
	
	/**
	 * Calculate screen X coordinate from day index
	 * Combines day->world->screen conversion
	 */
	static dayToScreen(day: number, timeScale: number, scale: number, translateX: number): number {
		const worldX = this.dayToWorldX(day, timeScale);
		return this.worldXToScreen(worldX, scale, translateX);
	}
	
	/**
	 * Calculate world X coordinate from screen X coordinate
	 * Inverse of worldXToScreen
	 */
	static screenToWorldX(screenX: number, scale: number, translateX: number): number {
		return (screenX - translateX) / scale;
	}
	
	/**
	 * Calculate rounded screen X coordinate from world X coordinate
	 * Use this for rendering elements that need pixel-perfect alignment
	 */
	static worldXToScreenRounded(worldX: number, scale: number, translateX: number): number {
		return Math.round(this.worldXToScreen(worldX, scale, translateX));
	}
	
	/**
	 * Calculate rounded screen X coordinate from day index
	 * Use this for rendering cards, markers, and boundary lines
	 */
	static dayToScreenRounded(day: number, timeScale: number, scale: number, translateX: number): number {
		const worldX = this.dayToWorldX(day, timeScale);
		return this.worldXToScreenRounded(worldX, scale, translateX);
	}
	
	/**
	 * Convert a screen X coordinate to a day index (for mouse interactions)
	 */
	static screenXToDay(screenX: number, timeScale: number, scale: number, translateX: number): number {
		const worldX = this.screenToWorldX(screenX, scale, translateX);
		return this.worldXToDay(worldX, timeScale);
	}
	
	/**
	 * Calculate the visible world X range from viewport parameters
	 * Returns [worldStartX, worldEndX]
	 */
	static getVisibleWorldRange(
		scale: number,
		translateX: number,
		viewportWidth: number
	): [number, number] {
		const worldStartX = this.screenToWorldX(0, scale, translateX);
		const worldEndX = this.screenToWorldX(viewportWidth, scale, translateX);
		return [worldStartX, worldEndX];
	}
	
	/**
	 * Calculate the visible day range from viewport parameters
	 * Returns [startDay, endDay] (floored/ceiled for marker generation)
	 */
	static getVisibleDayRange(
		timeScale: number,
		scale: number,
		translateX: number,
		viewportWidth: number
	): [number, number] {
		const [worldStartX, worldEndX] = this.getVisibleWorldRange(scale, translateX, viewportWidth);
		const startDay = Math.floor(this.worldXToDay(worldStartX, timeScale));
		const endDay = Math.ceil(this.worldXToDay(worldEndX, timeScale));
		return [startDay, endDay];
	}
}
