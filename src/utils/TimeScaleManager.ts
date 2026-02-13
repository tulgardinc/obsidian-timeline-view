/**
 * TimeScaleManager - X-axis / Time Coordinate Utilities
 * 
 * This module handles all X-axis coordinate transformations related to time.
 * It is the primary utility for converting between days, world X coordinates,
 * and screen X coordinates.
 * 
 * Use TimeScaleManager for:
 * - Day ↔ World X conversions (dayToWorldX, worldXToDay)
 * - World X ↔ Screen X conversions (worldXToScreen, screenToWorldX)
 * - Day ↔ Screen X conversions (dayToScreen, screenXToDay)
 * - Time scale level detection and marker generation
 * - Centering calculations for X-axis
 * 
 * Use CameraSystem (see CameraSystem.ts) for:
 * - Full 2D viewport transformations (X and Y together)
 * - Viewport visibility checks
 * - Card rendering positions
 * 
 * Time scale level definitions:
 * - Level 0: Days (small), Month starts (large)
 * - Level 1: Months (small), Years (large)
 * - Level 2: Years (small), Decades (large)
 * - Level 3: Decades (small), Centuries (large)
 * - Level 4: Centuries (small), Millennia (large)
 * - Level 5+: Millennia and larger units
 *
 * COORDINATE SYSTEM:
 * - X-axis: screenX = worldX + translateX  (NO scale multiplier)
 *   where worldX = days * timeScale
 * - Y-axis: screenY = worldY * scale + translateY
 *   (scale only affects vertical zoom)
 */

import { TimelineDate } from "./TimelineDate";

export type ScaleLevel = 0 | 1 | 2 | 3 | 4 | number;

export interface Marker {
	screenX: number;
	unitIndex: number; // Day number, month number, year number, etc.
	isLarge: boolean;
	label?: string;
}

export interface ScaleInfo {
	level: ScaleLevel;
	unitName: string;
	largeUnitName: string;
	pixelsPerUnit: number;
}

// Thresholds for switching scale levels (pixels per unit)
// When markers would be closer than MIN_MARKER_SPACING pixels, switch to next level
const MIN_MARKER_SPACING = 8;
const MAX_MARKER_SPACING = 100;

// Base time scales (pixels per unit at scale=1) for each level
const BASE_TIME_SCALES = [
	1,      // Level 0: 1 px/day
	30,     // Level 1: ~30 px/month (avg)
	365,    // Level 2: 365 px/year
	3650,   // Level 3: 3650 px/decade
	36500,  // Level 4: 36500 px/century
];

export class TimeScaleManager {
	/**
	 * Determine the appropriate scale level based on marker spacing.
	 * We want markers to be at least MIN_MARKER_SPACING pixels apart.
	 * 
	 * Since scale no longer affects X-axis, pixel density is just timeScale.
	 * pixelsPerDay = timeScale
	 * spacing = pixelsPerDay * daysPerUnit
	 */
	static getScaleLevel(timeScale: number): ScaleLevel {
		// Calculate pixels per day at current zoom (scale no longer affects X)
		const pixelsPerDay = timeScale;
		
		// Days per unit for each level
		const daysPerUnit = [1, 30, 365, 3650, 36500];
		
		// Find the first level where marker spacing is at least MIN_MARKER_SPACING
		for (let level = 0; level < daysPerUnit.length; level++) {
			const daysInUnit = daysPerUnit[level]!;  // Safe: level < array length
			const spacing = pixelsPerDay * daysInUnit;
			
			// If markers would be at least MIN_MARKER_SPACING apart, this level is good
			if (spacing >= MIN_MARKER_SPACING) {
				return level;
			}
		}
		
		// For levels beyond the array, use the exponential pattern
		// Level N: daysPerUnit = 365 * 10^(N-2) for N >= 2
		for (let level = daysPerUnit.length; level < 20; level++) {
			const daysInUnit = 365 * Math.pow(10, level - 2);
			const spacing = pixelsPerDay * daysInUnit;
			
			if (spacing >= MIN_MARKER_SPACING) {
				return level;
			}
		}
		
		return 20; // Max level
	}
	
	/**
	 * Get the base scale (pixels per unit at timeScale=1) for a given level
	 */
	static getBaseScaleForLevel(level: ScaleLevel): number {
		if (level < BASE_TIME_SCALES.length) {
			return BASE_TIME_SCALES[level] ?? 36500;
		}
		// For levels >= 5: centuries, millennia, 10k years, etc.
		// Level 4: century (100 years)
		// Level 5: millennia (1000 years) = 365,000 px
		// Level 6: 10k years = 3,650,000 px
		// Pattern: 36500 * 10^(level-4)
		return 36500 * Math.pow(10, level - 4);
	}

	/**
	 * Get the minimum resize width in pixels for the current timeScale.
	 * The minimum is the "small" unit at the current scale level:
	 * - Level 0 (Days): minimum = 1 day = timeScale pixels
	 * - Level 1 (Months): minimum = ~30 days = 30 * timeScale pixels
	 * - Level 2 (Years): minimum = 365 days = 365 * timeScale pixels
	 * - Level 3+ (Decades+): minimum follows the scale unit
	 * 
	 * This ensures cards cannot be resized smaller than the current scale unit,
	 * making resize operations align with the visible grid.
	 */
	static getMinResizeWidth(timeScale: number): number {
		const level = this.getScaleLevel(timeScale);
		const baseScale = this.getBaseScaleForLevel(level);
		// The minimum width is the base scale unit (small unit at current level)
		// At timeScale=1, this is the baseScale. We multiply by timeScale to get pixels.
		return baseScale * timeScale;
	}
	
	/**
	 * Get information about the current scale level
	 */
	static getScaleInfo(level: ScaleLevel): ScaleInfo {
		const unitNames = [
			{ unit: 'day', large: 'month' },
			{ unit: 'month', large: 'year' },
			{ unit: 'year', large: 'decade' },
			{ unit: 'decade', large: 'century' },
			{ unit: 'century', large: 'millennium' },
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
		const yearUnit = Math.pow(10, level - 2); // century=100, millennia=1000, etc.
		let unitLabel: string;
		
		if (yearUnit === 1000) unitLabel = 'millennium';
		else if (yearUnit < 1000000) unitLabel = `${yearUnit / 1000}k years`;
		else if (yearUnit < 1000000000) unitLabel = `${yearUnit / 1000000}M years`;
		else unitLabel = `${yearUnit / 1000000000}B years`;
		
		const largeYearUnit = yearUnit * 10;
		let largeUnitLabel: string;
		
		if (largeYearUnit < 1000000) largeUnitLabel = `${largeYearUnit / 1000}k years`;
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
	 * Note: scale is NOT used for X-axis calculations
	 */
	static getVisibleMarkers(
		level: ScaleLevel,
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Calculate visible world coordinate range
		// screenX = worldX + translateX, so worldX = screenX - translateX
		const worldStartX = -translateX;
		const worldEndX = -translateX + viewportWidth;
		
		// Calculate visible day range from world coordinates
		const startDay = Math.floor(worldStartX / timeScale);
		const endDay = Math.ceil(worldEndX / timeScale);
		
		let result: Marker[];
		switch (level) {
			case 0:
				result = this.getDayMarkers(startDay, endDay, timeScale, translateX, viewportWidth);
				break;
			case 1:
				result = this.getMonthMarkers(startDay, endDay, timeScale, translateX, viewportWidth);
				break;
			case 2:
				result = this.getYearMarkers(startDay, endDay, timeScale, translateX, viewportWidth);
				break;
			default:
				result = this.getLargeUnitMarkers(level, startDay, endDay, timeScale, translateX, viewportWidth);
		}
		
		return result;
	}
	
	/**
	 * Level 0: Day markers, month starts as large markers
	 */
	private static getDayMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		for (let day = startDay; day <= endDay; day++) {
			const worldX = day * timeScale;
			const screenX = worldX + translateX;
			
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				// Check if this day is the first day of a month
				const date = TimelineDate.fromDaysFromEpoch(day);
				const isMonthStart = date.getDay() === 1;
				
				markers.push({
					screenX,
					unitIndex: day,
					isLarge: isMonthStart
				});
			}
		}
		
		return markers;
	}
	
	/**
	 * Level 1: Month markers, year starts as large markers
	 */
	private static getMonthMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Get start and end dates using TimelineDate
		const startDate = TimelineDate.fromDaysFromEpoch(startDay);
		const endDate = TimelineDate.fromDaysFromEpoch(endDay);
		
		// Start from the first day of the start month
		let currentYear = startDate.getYear();
		let currentMonth = startDate.getMonth();
		
		// Iterate through months
		let safetyCounter = 0;
		const maxIterations = 10000; // Prevent infinite loops at extreme scales
		
		while (safetyCounter < maxIterations) {
			safetyCounter++;
			
			// Calculate day number for first day of current month/year
			const monthStr = String(currentMonth).padStart(2, '0');
			const dateStr = `${currentYear}-${monthStr}-01`;
			const monthDate = TimelineDate.fromString(dateStr);
			
			if (!monthDate) {
				break;
			}
			
			const day = monthDate.getDaysFromEpoch();
			
			if (day > endDay) {
				break;
			}
			
			const worldX = day * timeScale;
			const screenX = worldX + translateX;
			
			const inViewport = screenX >= -1 && screenX <= viewportWidth + 1;
			
			if (inViewport) {
				const isYearStart = currentMonth === 1;
				markers.push({
					screenX,
					unitIndex: currentYear * 12 + currentMonth,
					isLarge: isYearStart
				});
			}
			
			// Move to next month
			currentMonth++;
			if (currentMonth > 12) {
				currentMonth = 1;
				currentYear++;
			}
		}
		
		return markers;
	}
	
	/**
	 * Level 2: Year markers, decade starts as large markers
	 */
	private static getYearMarkers(
		startDay: number,
		endDay: number,
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		const startDate = TimelineDate.fromDaysFromEpoch(startDay);
		const endDate = TimelineDate.fromDaysFromEpoch(endDay);
		
		let year = startDate.getYear();
		
		let safetyCounter = 0;
		const maxIterations = 10000;
		
		while (safetyCounter < maxIterations) {
			safetyCounter++;
			
			if (year > endDate.getYear() + 1) {
				break;
			}
			
			// Create date for January 1st of this year
			const yearDate = TimelineDate.fromString(`${year}-01-01`);
			if (!yearDate) {
				year++;
				continue;
			}
			
			const day = yearDate.getDaysFromEpoch();
			
			const worldX = day * timeScale;
			const screenX = worldX + translateX;
			
			const inViewport = screenX >= -1 && screenX <= viewportWidth + 1;
			
			if (inViewport) {
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
	 * Level 3+: Decades, centuries, millennia, etc.
	 */
	private static getLargeUnitMarkers(
		level: ScaleLevel,
		startDay: number,
		endDay: number,
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): Marker[] {
		const markers: Marker[] = [];
		
		// Years per unit at this level
		const yearsPerUnit = Math.pow(10, level - 2); // 10, 100, 1000, 10000, etc.
		const yearsPerLargeUnit = yearsPerUnit * 10;
		
		const startDate = TimelineDate.fromDaysFromEpoch(startDay);
		const endDate = TimelineDate.fromDaysFromEpoch(endDay);
		
		// Find the first unit boundary
		const startYear = startDate.getYear();
		const firstUnit = Math.floor(startYear / yearsPerUnit) * yearsPerUnit;
		
		let currentUnit = firstUnit;
		
		let safetyCounter = 0;
		const maxIterations = 10000;
		
		while (safetyCounter < maxIterations) {
			safetyCounter++;
			
			if (currentUnit > endDate.getYear() + yearsPerUnit) break;
			
			// Create date for start of this unit
			const unitDate = TimelineDate.fromString(`${currentUnit}-01-01`);
			if (!unitDate) {
				currentUnit += yearsPerUnit;
				continue;
			}
			
			const day = unitDate.getDaysFromEpoch();
			
			const worldX = day * timeScale;
			const screenX = worldX + translateX;
			
			const inViewport = screenX >= -1 && screenX <= viewportWidth + 1;
			
			if (inViewport) {
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
	 * Format a day number for display at the given scale level
	 * Uses TimelineDate for arbitrary date range support
	 */
	static formatDateForLevel(day: number, level: ScaleLevel): string {
		const date = TimelineDate.fromDaysFromEpoch(day);
		return date.formatForLevel(level);
	}
	
	/**
	 * Get the day number at a given screen position
	 * screenX = worldX + translateX, so worldX = screenX - translateX
	 * worldX = day * timeScale, so day = worldX / timeScale
	 */
	static screenToDay(screenX: number, timeScale: number, translateX: number): number {
		const worldX = screenX - translateX;
		return Math.floor(worldX / timeScale);
	}
	
	/**
	 * Snap a day to the nearest marker day based on scale level
	 * This ensures resizing snaps to the actual small marker positions visible in the timeline
	 */
	static snapToNearestMarker(day: number, level: ScaleLevel): number {
		const date = TimelineDate.fromDaysFromEpoch(day);
		const ymd = date.getYMD();
		
		switch (level) {
			case 0: // Days - snap to nearest day (every day is a marker)
				return Math.round(day);
				
			case 1: // Months - snap to nearest month start
				// Create date for first day of this month
				const monthStart = TimelineDate.fromString(`${ymd.year}-${String(ymd.month).padStart(2, '0')}-01`);
				return monthStart?.getDaysFromEpoch() ?? day;
				
			case 2: // Years - snap to nearest year start (January 1)
				const yearStart = TimelineDate.fromString(`${ymd.year}-01-01`);
				return yearStart?.getDaysFromEpoch() ?? day;
				
			default: // Decades, centuries, etc. - snap to unit start
				const yearsPerUnit = Math.pow(10, level - 2);
				const unitStartYear = Math.floor(ymd.year / yearsPerUnit) * yearsPerUnit;
				const unitStart = TimelineDate.fromString(`${unitStartYear}-01-01`);
				return unitStart?.getDaysFromEpoch() ?? day;
		}
	}
	
	// ============================================================================
	// UNIFIED COORDINATE TRANSFORMATION FUNCTIONS
	// All timeline coordinate calculations should go through these functions
	// to ensure consistency across the application
	//
	// X-axis: screenX = worldX + translateX  (NO scale)
	// Y-axis: screenY = worldY * scale + translateY
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
	 * X-axis uses only translateX for panning (no scale multiplier)
	 */
	static worldXToScreen(worldX: number, translateX: number): number {
		return worldX + translateX;
	}
	
	/**
	 * Calculate screen X coordinate from day index
	 * Combines day->world->screen conversion
	 */
	static dayToScreen(day: number, timeScale: number, translateX: number): number {
		const worldX = this.dayToWorldX(day, timeScale);
		return this.worldXToScreen(worldX, translateX);
	}
	
	/**
	 * Calculate world X coordinate from screen X coordinate
	 * Inverse of worldXToScreen
	 */
	static screenToWorldX(screenX: number, translateX: number): number {
		return screenX - translateX;
	}
	
	/**
	 * Calculate rounded screen X coordinate from world X coordinate
	 * Use this for rendering elements that need pixel-perfect alignment
	 */
	static worldXToScreenRounded(worldX: number, translateX: number): number {
		return Math.round(this.worldXToScreen(worldX, translateX));
	}
	
	/**
	 * Calculate rounded screen X coordinate from day index
	 * Use this for rendering cards, markers, and boundary lines
	 */
	static dayToScreenRounded(day: number, timeScale: number, translateX: number): number {
		const worldX = this.dayToWorldX(day, timeScale);
		return this.worldXToScreenRounded(worldX, translateX);
	}
	
	/**
	 * Convert a screen X coordinate to a day index (for mouse interactions)
	 */
	static screenXToDay(screenX: number, timeScale: number, translateX: number): number {
		const worldX = this.screenToWorldX(screenX, translateX);
		return this.worldXToDay(worldX, timeScale);
	}
	
	/**
	 * Calculate the visible world X range from viewport parameters
	 * Returns [worldStartX, worldEndX]
	 */
	static getVisibleWorldRange(
		translateX: number,
		viewportWidth: number
	): [number, number] {
		const worldStartX = this.screenToWorldX(0, translateX);
		const worldEndX = this.screenToWorldX(viewportWidth, translateX);
		return [worldStartX, worldEndX];
	}
	
	/**
	 * Calculate the visible day range from viewport parameters
	 * Returns [startDay, endDay] (floored/ceiled for marker generation)
	 */
	static getVisibleDayRange(
		timeScale: number,
		translateX: number,
		viewportWidth: number
	): [number, number] {
		const [worldStartX, worldEndX] = this.getVisibleWorldRange(translateX, viewportWidth);
		const startDay = Math.floor(this.worldXToDay(worldStartX, timeScale));
		const endDay = Math.ceil(this.worldXToDay(worldEndX, timeScale));
		return [startDay, endDay];
	}
	
	/**
	 * Calculate the translation needed to center a world X coordinate in the viewport
	 * Returns the new translateX value
	 * 
	 * Since screenX = worldX + translateX, to center:
	 * worldX + translateX = viewportWidth / 2
	 * translateX = viewportWidth / 2 - worldX
	 */
	static calculateTranslateXToCenterWorldX(
		worldX: number,
		viewportWidth: number
	): number {
		return viewportWidth / 2 - worldX;
	}
	
	/**
	 * Calculate the translation needed to center a world Y coordinate in the viewport
	 * Returns the new translateY value
	 */
	static calculateTranslateYToCenterWorldY(
		worldY: number,
		scale: number,
		viewportHeight: number
	): number {
		// To center: worldY * scale + translateY = viewportHeight / 2
		// Solving for translateY: translateY = viewportHeight / 2 - worldY * scale
		return viewportHeight / 2 - worldY * scale;
	}
}
