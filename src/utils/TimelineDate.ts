/**
 * TimelineDate - Handles arbitrary date ranges from 10 billion years BCE to present
 * 
 * Uses Julian Day Number (JDN) algorithms for date calculations without JavaScript Date limitations
 * JavaScript Date only supports years -271,821 to +275,761
 * This class supports years -10,000,000,000 to +10,000,000,000 (20 billion year span)
 * 
 * All calculations use days from epoch (1970-01-01) stored as numbers (max safe integer: 9 quadrillion)
 * 10 billion years = 3.65 trillion days, well within safe integer range
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ParsedDate {
	year: number;
	month: number; // 1-12
	day: number;   // 1-31
}

export type DateFormatStyle = "DD/MM/YYYY" | "MM/DD/YYYY";

export class TimelineDate {
	private daysFromEpoch: number;
	private cachedDate: ParsedDate | null = null;

	/** Plugin-wide date format for day-level display */
	private static dateFormat: DateFormatStyle = "DD/MM/YYYY";

	static setDateFormat(format: DateFormatStyle): void {
		TimelineDate.dateFormat = format;
	}

	static getDateFormat(): DateFormatStyle {
		return TimelineDate.dateFormat;
	}

	private constructor(daysFromEpoch: number) {
		this.daysFromEpoch = Math.round(daysFromEpoch);
	}

	/**
	 * Parse a date string in format: YYYY-MM-DD or YYYY-MM-DD BCE/BC/CE/AD
	 * Supports arbitrary year lengths (e.g., -5000000000-01-01 or 5000000000 BCE-01-01)
	 */
	static fromString(dateStr: string): TimelineDate | null {
		// Trim whitespace
		dateStr = dateStr.trim();

		// Try extended format: [+-]?YYYY...-MM-DD [BCE|BC|CE|AD]?
		// Examples:
		//   2024-03-15           (2024 AD)
		//   -5000000000-01-01   (5 billion BCE)
		//   5000000000 BCE-01-01 (5 billion BCE with explicit era)
		//   10000-06-15          (10,000 AD)
		
		const extendedMatch = dateStr.match(/^([+-]?\d+)(?:\s+(BCE|BC|CE|AD))?-(\d{1,2})-(\d{1,2})$/i);
		if (extendedMatch && extendedMatch[1] && extendedMatch[3] && extendedMatch[4]) {
			let year = parseInt(extendedMatch[1], 10);
			const era = extendedMatch[2]?.toUpperCase();
			const month = parseInt(extendedMatch[3], 10);
			const day = parseInt(extendedMatch[4], 10);

			// Handle era suffixes
			if (era === 'BCE' || era === 'BC') {
				// Historical year numbering: 1 BCE = year 0 in astronomical system
				// This makes calculations easier
				year = -year + 1;
			}
			// CE/AD or no era = positive year (astronomical system has year 0)
			
			if (!this.isValidDate(year, month, day)) {
				return null;
			}

			const daysFromEpoch = this.dateToDaysFromEpoch(year, month, day);
			return new TimelineDate(daysFromEpoch);
		}

		// Try standard format with optional era: YYYY-MM-DD [BCE|BC|CE|AD]
		const standardMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(BCE|BC|CE|AD))?$/i);
		if (standardMatch && standardMatch[1] && standardMatch[2] && standardMatch[3]) {
			let year = parseInt(standardMatch[1], 10);
			const month = parseInt(standardMatch[2], 10);
			const day = parseInt(standardMatch[3], 10);
			const era = standardMatch[4]?.toUpperCase();

			if (era === 'BCE' || era === 'BC') {
				year = -year + 1;
			}

			if (!this.isValidDate(year, month, day)) {
				return null;
			}

			const daysFromEpoch = this.dateToDaysFromEpoch(year, month, day);
			return new TimelineDate(daysFromEpoch);
		}

		return null;
	}

	/**
	 * Create from days from epoch (internal use)
	 */
	static fromDaysFromEpoch(daysFromEpoch: number): TimelineDate {
		return new TimelineDate(daysFromEpoch);
	}

	/**
	 * Create from JavaScript Date (for backward compatibility, limited range)
	 */
	static fromDate(date: Date): TimelineDate {
		// Calculate days from epoch directly
		const msFromEpoch = date.getTime();
		const daysFromEpoch = Math.floor(msFromEpoch / MS_PER_DAY);
		return new TimelineDate(daysFromEpoch);
	}

	/**
	 * Get days from epoch
	 */
	getDaysFromEpoch(): number {
		return this.daysFromEpoch;
	}

	/**
	 * Get the year/month/day as a ParsedDate object
	 * Uses Julian Day Number algorithm for accuracy at extreme dates
	 */
	getYMD(): ParsedDate {
		if (this.cachedDate) {
			return this.cachedDate;
		}

		// Convert days from epoch to JDN, then to YMD
		const jdn = this.daysFromEpoch + 2440588; // 1970-01-01 = JDN 2440588
		this.cachedDate = TimelineDate.jdnToDate(jdn);
		return this.cachedDate;
	}

	/**
	 * Get just the year (useful for scale levels >= 3)
	 */
	getYear(): number {
		return this.getYMD().year;
	}

	/**
	 * Get the month (1-12)
	 */
	getMonth(): number {
		return this.getYMD().month;
	}

	/**
	 * Get the day of month (1-31)
	 */
	getDay(): number {
		return this.getYMD().day;
	}

	/**
	 * Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
	 * Based on JDN algorithm
	 */
	getDayOfWeek(): number {
		const jdn = this.daysFromEpoch + 2440588;
		return (jdn + 1) % 7; // JDN 0 was a Monday, so +1 adjustment
	}

	/**
	 * Format the date based on scale level
	 * Level 0: Days - Full date with day
	 * Level 1: Months - Month/Year
	 * Level 2+: Years and larger - Year only with appropriate notation
	 */
	formatForLevel(level: number): string {
		const ymd = this.getYMD();
		const year = ymd.year;

		switch (level) {
			case 0: // Days - Full date: DD/MM/YYYY or MM/DD/YYYY depending on setting
				const dayStr = String(ymd.day).padStart(2, '0');
				const monthStr = String(ymd.month).padStart(2, '0');
				const yearAbs = Math.abs(year);
				const usFormat = TimelineDate.dateFormat === "MM/DD/YYYY";
				const datePart = usFormat ? `${monthStr}/${dayStr}` : `${dayStr}/${monthStr}`;
				
				// For recent history (within ±10,000 years), use BC/AD notation
				if (Math.abs(year) < 10000) {
					const displayYear = year <= 0 ? Math.abs(year - 1) : year;
					return `${datePart}/${displayYear}${year < 1 ? ' BCE' : ''}`;
				}
				
				// For distant history, use astronomical notation
				if (year < 0) {
					return `${datePart}/${yearAbs} BCE`;
				}
				return `${datePart}/${year}`;

			case 1: // Months - Month/Year format
				const monthStr2 = String(ymd.month).padStart(2, '0');
				const yearAbs2 = Math.abs(year);
				
				if (Math.abs(year) < 10000) {
					const displayYear = year <= 0 ? Math.abs(year - 1) : year;
					return `${monthStr2}/${displayYear}${year < 1 ? ' BCE' : ''}`;
				}
				
				if (year < 0) {
					return `${monthStr2}/${yearAbs2} BCE`;
				}
				return `${monthStr2}/${year}`;

			default: // Years and larger units
				return this.formatYear(year);
		}
	}

	/**
	 * Format just the year with appropriate notation
	 */
	formatYear(year: number = this.getYear()): string {
		const absYear = Math.abs(year);
		
		// Historical notation for recent years
		if (absYear < 10000) {
			if (year <= 0) {
				// Year 0 = 1 BCE, year -1 = 2 BCE in astronomical system
				const displayYear = Math.abs(year - 1);
				return `${displayYear} BCE`;
			}
			return `${year} CE`;
		}

		// Scientific notation for large numbers
		if (absYear >= 1000000000) {
			const billions = absYear / 1000000000;
			return year < 0 
				? `${billions.toFixed(billions % 1 === 0 ? 0 : 1)}B BCE`
				: `${billions.toFixed(billions % 1 === 0 ? 0 : 1)}B`;
		}
		
		if (absYear >= 1000000) {
			const millions = absYear / 1000000;
			return year < 0 
				? `${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M BCE`
				: `${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
		}
		
		if (absYear >= 1000) {
			const thousands = absYear / 1000;
			return year < 0 
				? `${thousands.toFixed(thousands % 1 === 0 ? 0 : 1)}k BCE`
				: `${thousands.toFixed(thousands % 1 === 0 ? 0 : 1)}k`;
		}

		return year < 0 ? `${absYear} BCE` : `${year}`;
	}

	/**
	 * Format to ISO-like string: YYYY-MM-DD (for storage)
	 * Uses astronomical year numbering (year 0 exists, negative for BCE)
	 */
	toISOString(): string {
		const ymd = this.getYMD();
		const yearStr = String(ymd.year);
		const monthStr = String(ymd.month).padStart(2, '0');
		const dayStr = String(ymd.day).padStart(2, '0');
		return `${yearStr}-${monthStr}-${dayStr}`;
	}

	/**
	 * Format to human-readable string with era suffix
	 */
	toString(): string {
		const ymd = this.getYMD();
		const dayStr = String(ymd.day).padStart(2, '0');
		const monthStr = String(ymd.month).padStart(2, '0');
		
		if (Math.abs(ymd.year) < 10000) {
			const displayYear = ymd.year <= 0 ? Math.abs(ymd.year - 1) : ymd.year;
			const era = ymd.year < 1 ? ' BCE' : ' CE';
			return `${displayYear}-${monthStr}-${dayStr}${era}`;
		}
		
		const absYear = Math.abs(ymd.year);
		const era = ymd.year < 0 ? ' BCE' : ' CE';
		return `${absYear}-${monthStr}-${dayStr}${era}`;
	}

	/**
	 * Calculate difference in days between two dates
	 */
	daysBetween(other: TimelineDate): number {
		return other.daysFromEpoch - this.daysFromEpoch;
	}

	/**
	 * Add days to this date
	 */
	addDays(days: number): TimelineDate {
		return new TimelineDate(this.daysFromEpoch + days);
	}

	/**
	 * Check if this date is before another
	 */
	isBefore(other: TimelineDate): boolean {
		return this.daysFromEpoch < other.daysFromEpoch;
	}

	/**
	 * Check if this date is after another
	 */
	isAfter(other: TimelineDate): boolean {
		return this.daysFromEpoch > other.daysFromEpoch;
	}

	/**
	 * Check if two dates are equal
	 */
	equals(other: TimelineDate): boolean {
		return this.daysFromEpoch === other.daysFromEpoch;
	}

	// ============================================================================
	// PRIVATE STATIC METHODS - Julian Day Number algorithms
	// ============================================================================

	/**
	 * Convert year, month, day to days from epoch using Julian Day Number algorithm
	 * This algorithm works for any year (positive or negative)
	 * Based on the Fliegel-Van Flandern algorithm
	 */
	private static dateToDaysFromEpoch(year: number, month: number, day: number): number {
		// Convert to JDN using the algorithm
		const jdn = this.dateToJDN(year, month, day);
		// Convert JDN to days from epoch (1970-01-01 = JDN 2440588)
		return jdn - 2440588;
	}

	/**
	 * Convert year, month, day to Julian Day Number
	 * Algorithm works for any Gregorian calendar date
	 * Based on "Calendrical Calculations" by Dershowitz and Reingold
	 */
	private static dateToJDN(year: number, month: number, day: number): number {
		// Adjust month and year for January and February
		// In this algorithm, March = 1, ..., February = 12
		let adjustedYear = year;
		let adjustedMonth = month;
		
		if (month <= 2) {
			adjustedYear = year - 1;
			adjustedMonth = month + 12;
		}

		// Calculate JDN using the formula
		// This works for both positive and negative years
		const a = Math.floor(adjustedYear / 100);
		const b = 2 - a + Math.floor(a / 4);
		
		const jdn = Math.floor(365.25 * (adjustedYear + 4716)) +
			           Math.floor(30.6001 * (adjustedMonth + 1)) +
			           day + b - 1524.5;
		
		return Math.floor(jdn + 0.5); // Round to nearest integer
	}

	/**
	 * Convert Julian Day Number to year, month, day
	 * Inverse of dateToJDN using the Fliegel-Van Flandern algorithm
	 */
	private static jdnToDate(jdn: number): ParsedDate {
		// Fliegel-Van Flandern algorithm for JDN to Gregorian date
		const L = jdn + 68569;
		const N = Math.floor(4 * L / 146097);
		const L2 = L - Math.floor((146097 * N + 3) / 4);
		const I = Math.floor(4000 * (L2 + 1) / 1461001);
		const L3 = L2 - Math.floor(1461 * I / 4) + 31;
		const J = Math.floor(80 * L3 / 2447);
		const day = L3 - Math.floor(2447 * J / 80);
		const L4 = Math.floor(J / 11);
		const month = J + 2 - 12 * L4;
		const year = 100 * (N - 49) + I + L4;

		return { year, month, day };
	}

	/**
	 * Check if a year is a leap year in the Gregorian calendar
	 */
	private static isLeapYear(year: number): boolean {
		// Year 0 is a leap year (astronomical system)
		if (year === 0) return true;
		// Gregorian leap year rules
		if (year % 400 === 0) return true;
		if (year % 100 === 0) return false;
		return year % 4 === 0;
	}

	/**
	 * Get number of days in a month
	 */
	private static daysInMonth(year: number, month: number): number {
		const daysInMonthArr = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		if (month === 2 && this.isLeapYear(year)) {
			return 29;
		}
		const days = daysInMonthArr[month - 1];
		return days ?? 31; // Default to 31 if out of bounds
	}

	/**
	 * Validate a date
	 */
	private static isValidDate(year: number, month: number, day: number): boolean {
		// Check month range
		if (month < 1 || month > 12) return false;
		
		// Check day range
		const maxDay = this.daysInMonth(year, month);
		if (day < 1 || day > maxDay) return false;
		
		// Check reasonable year bounds (±20 billion years is plenty)
		if (Math.abs(year) > 20000000000) return false;
		
		return true;
	}

	/**
	 * Get epoch start date as TimelineDate
	 */
	static getEpoch(): TimelineDate {
		return new TimelineDate(0);
	}

	/**
	 * Get current date as TimelineDate
	 */
	static now(): TimelineDate {
		return TimelineDate.fromDate(new Date());
	}
}
