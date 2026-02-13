<script lang="ts">
	import { onMount, tick } from "svelte";
	import GridLines from "./GridLines.svelte";
	import TimelineHeader from "./TimelineHeader.svelte";
	import { setViewportContext } from "../contexts/ViewportContext";
	import { TimeScaleManager } from "../utils/TimeScaleManager";

	interface CardHoverData {
		startX: number;
		endX: number;
		startDate: string;
		endDate: string;
		title: string;
	}

	const PIXELS_PER_DAY = 10;

	// Clamp limits: viewport cannot show beyond ±20B years
	const MAX_YEAR = 20_000_000_000; // ±20 billion years
	const DAYS_PER_YEAR = 365.2425; // Gregorian calendar average
	const MAX_DAYS_FROM_EPOCH = MAX_YEAR * DAYS_PER_YEAR;

	// Y-axis zoom limits: 50% to 200%
	const MIN_SCALE = 0.5;
	const MAX_SCALE = 2.0;

	/**
	 * Calculate the minimum timeScale to ensure viewport never exceeds ±20B years
	 * Minimum timeScale = viewportWidth / (2 * MAX_DAYS_FROM_EPOCH)
	 * This ensures the left edge can't go beyond -20B and right edge beyond +20B
	 */
	function getMinTimeScale(): number {
		if (viewportWidth <= 0) return 0.001; // Fallback for zero-width
		return viewportWidth / (2 * MAX_DAYS_FROM_EPOCH);
	}

	/**
	 * Clamp timeScale to minimum value
	 */
	function clampTimeScale(newTimeScale: number): number {
		const minTimeScale = getMinTimeScale();
		return Math.max(minTimeScale, newTimeScale);
	}

	/**
	 * Get allowed translateX range
	 * Returns [minTranslateX, maxTranslateX]
	 * At minimum zoom, left edge = -MAX_DAYS_FROM_EPOCH, right edge = +MAX_DAYS_FROM_EPOCH
	 */
	function getTranslateXRange(): [number, number] {
		const minTimeScale = getMinTimeScale();
		// Ensure we're at minimum zoom level for clamping calculation
		// At min timeScale: viewport spans 2*MAX_DAYS_FROM_EPOCH days
		// translateX = 0 means left edge of viewport is at day 0 (year 1970)
		// To show -20B BCE on left edge: translateX must be <= 0 (0 - 0 = 0)
		// To show +20B CE on right edge: viewportWidth / timeScale = rightEdgeDay
		// At min timeScale: viewportWidth / minTimeScale = 2*MAX_DAYS_FROM_EPOCH
		// Right edge = -translateX / timeScale + viewportWidth / timeScale
		// For right edge to be MAX_DAYS_FROM_EPOCH:
		// -translateX / timeScale + 2*MAX_DAYS_FROM_EPOCH = MAX_DAYS_FROM_EPOCH
		// => -translateX / timeScale = -MAX_DAYS_FROM_EPOCH
		// => translateX = MAX_DAYS_FROM_EPOCH * timeScale
		
		// Actually simpler: when translateX = 0, left edge is at worldX = 0
		// To show -MAX_DAYS on left edge: worldX = 0 + translateX, so need translateX >= 0 (wait no)
		// screenX = worldX + translateX, so left edge (screenX=0) means worldX = -translateX
		// We want left edge worldX >= -MAX_DAYS_FROM_EPOCH
		// -translateX >= -MAX_DAYS_FROM_EPOCH => translateX <= MAX_DAYS_FROM_EPOCH * timeScale
		// We want right edge worldX <= MAX_DAYS_FROM_EPOCH
		// Right edge: screenX = viewportWidth, worldX = viewportWidth - translateX
		// viewportWidth - translateX <= MAX_DAYS_FROM_EPOCH * timeScale
		// -translateX <= MAX_DAYS_FROM_EPOCH * timeScale - viewportWidth
		// translateX >= viewportWidth - MAX_DAYS_FROM_EPOCH * timeScale
		
		const maxWorldWidth = MAX_DAYS_FROM_EPOCH * 2 * minTimeScale; // At min zoom, spans full range
		const currentWorldWidth = Math.min(viewportWidth, maxWorldWidth);
		
		// Left edge constraint: worldX at screenX=0 must be >= -MAX_DAYS_FROM_EPOCH
		// worldX = screenX - translateX = -translateX (at left edge)
		// -translateX >= -MAX_DAYS_FROM_EPOCH * timeScale => translateX <= MAX_DAYS_FROM_EPOCH * timeScale
		const maxTranslateX = MAX_DAYS_FROM_EPOCH * timeScale;
		
		// Right edge constraint: worldX at screenX=viewportWidth must be <= MAX_DAYS_FROM_EPOCH
		// worldX = viewportWidth - translateX <= MAX_DAYS_FROM_EPOCH * timeScale
		// -translateX <= MAX_DAYS_FROM_EPOCH * timeScale - viewportWidth
		// translateX >= viewportWidth - MAX_DAYS_FROM_EPOCH * timeScale
		const minTranslateX = viewportWidth - MAX_DAYS_FROM_EPOCH * timeScale;
		
		return [minTranslateX, maxTranslateX];
	}

	/**
	 * Clamp translateX to keep viewport within ±20B years
	 */
	function clampTranslateX(newTranslateX: number): number {
		const [minTranslateX, maxTranslateX] = getTranslateXRange();
		return Math.max(minTranslateX, Math.min(maxTranslateX, newTranslateX));
	}

	/**
	 * Clamp scale (Y-axis zoom) to keep within 50% to 200%
	 */
	function clampScale(newScale: number): number {
		return Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
	}

	/**
	 * Check if dimensions are valid (non-zero)
	 * Used to guard against operations that need real viewport dimensions
	 */
	function hasValidDimensions(rect: { width: number; height: number }): boolean {
		return rect.width > 0 && rect.height > 0;
	}

	// Calculate cursor screen X position for the dashed line
	// X-axis: screenX = worldX + translateX (no scale)
	// Since mouseX is already in screen space, just return it
	let cursorScreenX = $derived(() => {
		if (mouseX === null || !isHovering) return null;
		return mouseX;
	});

	// Transform state
	let scale = $state(1);
	let translateX = $state(0);
	let translateY = $state(0);
	
	// Time scale - pixels per day (default 10, no limits)
	let timeScale = $state(10);

	// Viewport dimensions
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	
	// Track previous dimensions to detect resize and maintain world center
	let previousViewportWidth = $state(0);
	let previousViewportHeight = $state(0);
	
	// Track whether we had valid dimensions in the last resize check
	// This is used to detect when dimensions transition from zero to valid
	let hadValidDimensions = $state(false);

	// Mouse tracking for timeline hover
	let mouseX = $state<number | null>(null);
	let isHovering = $state(false);

	// Panning state
	let isPanning = $state(false);
	let lastMouseX = $state(0);
	let lastMouseY = $state(0);
	let panStartX = $state(0);
	let panStartY = $state(0);
	let totalPanDelta = $state(0);
	const PAN_THRESHOLD = 5; // pixels - movement above this is considered a pan, not a click

	// Touch state for pinch zoom
	let lastTouchDistance = $state(0);

	// Debounce timer for forcing crisp render after zoom
	let zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let forceRender = $state(0);
	
	// Debounce timer for viewport change notifications
	let viewportChangeTimer: ReturnType<typeof setTimeout> | null = null;

	// Track if viewport has been successfully restored (not just initialized)
	// This is only true after setViewport() or centerView() has actually run with valid dimensions
	let viewportRestored = $state(false);

	// Store pending viewport when setViewport() is called with zero dimensions
	// Will be applied when dimensions become valid
	let pendingViewport: { centerX: number; centerDay?: number; centerY: number; timeScale: number; scale?: number } | null = null;

	let viewportRef: HTMLDivElement;

	interface Props {
		children: import('svelte').Snippet;
		onScaleChange?: (scale: number, translateX: number, translateY: number) => void;
		onViewportChange?: (width: number, height: number) => void;
		onTimeScaleChange?: (timeScale: number) => void;
		selectedCard?: CardHoverData | null;
		onCanvasClick?: (event: { screenX: number; screenY: number; worldX: number; worldY: number }) => void;
		isAnyCardDragging?: boolean;
		isAnyCardResizing?: boolean;
		activeResizeEdge?: 'left' | 'right' | null;
		initialViewport?: { centerX: number; centerDay?: number; centerY: number; timeScale: number } | null;
		onViewportChanged?: () => void;
		timelineName?: string;
	}

	let { children, onScaleChange, onViewportChange, onTimeScaleChange, selectedCard = null, onCanvasClick, isAnyCardDragging = false, isAnyCardResizing = false, activeResizeEdge = null, initialViewport = null, onViewportChanged, timelineName = "Timeline" }: Props = $props();

	// Set viewport context for child components
	// Use a getter function to always get current values
	setViewportContext({
		getScale: () => scale,
		getTranslateX: () => translateX,
		getTranslateY: () => translateY,
		getViewportWidth: () => viewportWidth,
		getViewportHeight: () => viewportHeight,
		getTimeScale: () => timeScale
	});

	// Notify parent of scale changes (for backward compatibility)
	$effect(() => {
		// Only notify after viewport is fully restored to avoid spurious saves
		// This prevents saveViewport from being called with wrong/default values
		// before setViewport() or centerView() has properly positioned the camera
		if (onScaleChange && viewportRestored) {
			onScaleChange(scale, translateX, translateY);
		}
	});
	
	// Notify parent of viewport size changes (for backward compatibility)
	$effect(() => {
		if (onViewportChange) {
			onViewportChange(viewportWidth, viewportHeight);
		}
	});
	
	// Notify parent of time scale changes (for backward compatibility)
	$effect(() => {
		// Only notify after viewport is fully restored to avoid spurious saves
		// This prevents saveViewport from being called with wrong/default values
		// before setViewport() or centerView() has properly positioned the camera
		if (onTimeScaleChange && viewportRestored) {
			onTimeScaleChange(timeScale);
		}
	});

	function forceReflow(element: HTMLElement) {
		// Force browser to recalculate layout by reading layout properties
		void element.offsetHeight;
		void element.offsetWidth;
	}

	function forceRepaint(element: HTMLElement) {
		// Toggle the force-crisp class to apply blur(0px) filter
		element.classList.add('force-crisp');
		// Force reflow
		void element.offsetHeight;
		// Remove the class after 150ms
		setTimeout(() => {
			element.classList.remove('force-crisp');
		}, 150);
	}

	function triggerCrispRender() {
		// Cancel existing timer
		if (zoomDebounceTimer) {
			clearTimeout(zoomDebounceTimer);
		}
		// Set a new timer to force crisp render after zoom stops
		zoomDebounceTimer = setTimeout(() => {
			forceRender += 1;
			// Query all timeline cards and force individual repaints
			const cards = viewportRef?.querySelectorAll('.timeline-card') as NodeListOf<HTMLElement>;
			cards?.forEach((card) => {
				forceRepaint(card);
			});
		}, 150);
	}
	
	function notifyViewportChanged(source: string) {
		// Debounce viewport change notifications to avoid excessive saves
		if (viewportChangeTimer) {
			clearTimeout(viewportChangeTimer);
		}
		viewportChangeTimer = setTimeout(() => {
			onViewportChanged?.();
		}, 300);
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();

		// Detect trackpad vs mouse wheel
		// Trackpad: deltaMode = 0 (pixels), usually has deltaX and significant deltaY
		// Mouse wheel: deltaMode = 1 (lines), typically only deltaY
		const isTrackpad = event.deltaMode === 0 && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 50);
		
		// Check if this is a pinch gesture (ctrlKey is set on macOS trackpad pinch)
		// Pinch can be identified by ctrlKey=true but metaKey=false (Cmd not held)
		const isPinch = event.ctrlKey && !event.metaKey;
		// Check if Cmd is held (for modified trackpad gestures)
		const isCmdHeld = event.metaKey;
		
		if (isTrackpad) {
			// Trackpad behavior
			if (isPinch) {
				// Pinch gesture = Unified zoom (scale + timeScale together to preserve aspect ratio)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const zoomMultiplier = 1 + delta;
				
				// Calculate new values for both scale and timeScale
				const newScale = clampScale(scale * zoomMultiplier);
				const newTimeScale = clampTimeScale(timeScale * zoomMultiplier);
				
				// Zoom towards center of viewport
				const rect = viewportRef.getBoundingClientRect();
				const centerX = rect.width / 2;
				const centerY = rect.height / 2;
				
				// Calculate world coordinates before zoom using centralized utilities
				const worldCenterTime = TimeScaleManager.screenXToDay(centerX, timeScale, translateX);
				const worldY = (centerY - translateY) / scale;
				
				// Apply new scale values
				scale = newScale;
				timeScale = newTimeScale;
				
				// Adjust translation to keep center stable using centralized utilities
				translateX = centerX - TimeScaleManager.dayToWorldX(worldCenterTime, timeScale);
				translateY = centerY - worldY * scale;
				
				// Clamp translation to keep viewport within bounds
				translateX = clampTranslateX(translateX);
				
				// Trigger crisp render after zoom
				triggerCrispRender();
			} else if (isCmdHeld) {
				// Cmd + two-finger scroll = Time-scale zoom (zoom toward last known mouse position)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const newTimeScale = clampTimeScale(timeScale * (1 + delta));
				
				// Use last known mouse position, or center if mouse not in viewport
				const rect = viewportRef.getBoundingClientRect();
				const zoomCenterX = mouseX !== null ? mouseX : rect.width / 2;
				
				// Calculate world time coordinate at zoom center before zoom using centralized utilities
				const worldCenterTime = TimeScaleManager.screenXToDay(zoomCenterX, timeScale, translateX);
				
				// Apply new time scale
				timeScale = newTimeScale;
				
				// Adjust translation to keep zoom center over same world time
				translateX = zoomCenterX - TimeScaleManager.dayToWorldX(worldCenterTime, timeScale);
				
				// Clamp translation to keep viewport within bounds
				translateX = clampTranslateX(translateX);
			} else {
				// Two-finger scroll without modifier = Pan
				translateX -= event.deltaX;
				translateY -= event.deltaY;
			}
		} else {
			// Mouse wheel behavior (unchanged)
			if (event.ctrlKey || event.metaKey) {
				// Ctrl/Cmd + wheel = Time-scale zoom (zoom toward mouse cursor)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const newTimeScale = clampTimeScale(timeScale * (1 + delta));
				
				// Get mouse position within viewport
				const rect = viewportRef.getBoundingClientRect();
				const mouseXPos = event.clientX - rect.left;
				
				// Calculate world time coordinate at mouse position before zoom using centralized utilities
				const worldMouseTime = TimeScaleManager.screenXToDay(mouseXPos, timeScale, translateX);
				
				// Apply new time scale
				timeScale = newTimeScale;
				
				// Adjust translation to keep mouse position over same world time
				translateX = mouseXPos - TimeScaleManager.dayToWorldX(worldMouseTime, timeScale);
				
				// Clamp translation to keep viewport within bounds
				translateX = clampTranslateX(translateX);
			} else {
				// Mouse wheel alone = Unified zoom (scale + timeScale together to preserve aspect ratio)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const zoomMultiplier = 1 + delta;
				
				// Calculate new values for both scale and timeScale
				const newScale = clampScale(scale * zoomMultiplier);
				const newTimeScale = clampTimeScale(timeScale * zoomMultiplier);
				
				// Zoom towards mouse position
				const rect = viewportRef.getBoundingClientRect();
				const mouseXPos = event.clientX - rect.left;
				const mouseYPos = event.clientY - rect.top;
				
				// Calculate world coordinates before zoom using centralized utilities
				const worldCenterTime = TimeScaleManager.screenXToDay(mouseXPos, timeScale, translateX);
				const worldY = (mouseYPos - translateY) / scale;
				
				// Apply new scale values
				scale = newScale;
				timeScale = newTimeScale;
				
				// Adjust translation to keep mouse over same world point using centralized utilities
				translateX = mouseXPos - TimeScaleManager.dayToWorldX(worldCenterTime, timeScale);
				translateY = mouseYPos - worldY * scale;
				
				// Clamp translation to keep viewport within bounds
				translateX = clampTranslateX(translateX);
				
				// Trigger crisp render after zoom
				triggerCrispRender();
			}
		}
		
		// Notify of viewport change after any wheel interaction
		notifyViewportChanged('wheel');
	}

	function handleMouseMove(event: MouseEvent) {
		// Update mouse position for timeline hover
		const rect = viewportRef?.getBoundingClientRect();
		if (rect) {
			mouseX = event.clientX - rect.left;
		}
		
		if (!isPanning) return;
		
		const deltaX = event.clientX - lastMouseX;
		const deltaY = event.clientY - lastMouseY;
		
		// Track total movement to distinguish click from pan
		totalPanDelta += Math.abs(deltaX) + Math.abs(deltaY);
		
		translateX += deltaX;
		translateY += deltaY;
		
		// Clamp translation to keep viewport within bounds during panning
		translateX = clampTranslateX(translateX);
		
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
		
		// Notify of viewport change (debounced) - only during actual panning
		notifyViewportChanged('pan-move');
	}

	function handleMouseDown(event: MouseEvent) {
		if (event.button !== 0) return; // Only left click
		isPanning = true;
		panStartX = event.clientX;
		panStartY = event.clientY;
		totalPanDelta = 0;
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
	}

	function handleMouseUp() {
		isPanning = false;
		// Notify of viewport change (debounced) - pan ended
		notifyViewportChanged('pan-end');
	}

	function handleMouseLeave() {
		isPanning = false;
		isHovering = false;
		mouseX = null;
	}

	function handleMouseEnter(event: MouseEvent) {
		isHovering = true;
		const rect = viewportRef?.getBoundingClientRect();
		if (rect) {
			mouseX = event.clientX - rect.left;
		}
	}

	function getTouchDistance(touch1: Touch, touch2: Touch): number {
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function handleTouchStart(event: TouchEvent) {
		if (event.touches.length === 1) {
			// Single touch - start panning
			const touch = event.touches[0];
			if (!touch) return;
			isPanning = true;
			lastMouseX = touch.clientX;
			lastMouseY = touch.clientY;
		} else if (event.touches.length === 2) {
			// Two touches - start pinch
			isPanning = false;
			const touch1 = event.touches[0];
			const touch2 = event.touches[1];
			if (touch1 && touch2) {
				lastTouchDistance = getTouchDistance(touch1, touch2);
			}
		}
	}

	function handleTouchMove(event: TouchEvent) {
		event.preventDefault();
		
		if (event.touches.length === 1 && isPanning) {
			// Pan
			const touch = event.touches[0];
			if (!touch) return;
			
			const deltaX = touch.clientX - lastMouseX;
			const deltaY = touch.clientY - lastMouseY;
			
			translateX += deltaX;
			translateY += deltaY;
			
			// Clamp translation to keep viewport within bounds during touch panning
			translateX = clampTranslateX(translateX);
			
			lastMouseX = touch.clientX;
			lastMouseY = touch.clientY;
			
			// Notify of viewport change during touch pan (debounced)
			notifyViewportChanged('touch-pan');
		} else if (event.touches.length === 2) {
			// Pinch zoom = Unified zoom (scale + timeScale together to preserve aspect ratio)
			const touch1 = event.touches[0];
			const touch2 = event.touches[1];
			if (!touch1 || !touch2) return;
			
			const newDistance = getTouchDistance(touch1, touch2);
			const scaleFactor = newDistance / lastTouchDistance;
			
			const rect = viewportRef.getBoundingClientRect();
			const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
			const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
			
			// Calculate world coordinates before zoom using centralized utilities
			const worldCenterTime = TimeScaleManager.screenXToDay(centerX, timeScale, translateX);
			const worldY = (centerY - translateY) / scale;
			
			// Apply new scale values (both scale and timeScale together) with clamping
			scale = clampScale(scale * scaleFactor);
			timeScale = clampTimeScale(timeScale * scaleFactor);
			
			// Adjust translation to keep center over same world position using centralized utilities
			translateX = centerX - TimeScaleManager.dayToWorldX(worldCenterTime, timeScale);
			translateY = centerY - worldY * scale;
			
			// Clamp translation to keep viewport within bounds
			translateX = clampTranslateX(translateX);
			
			lastTouchDistance = newDistance;
			
				// Trigger crisp render after zoom
				triggerCrispRender();
				// Notify of viewport change (debounced)
				notifyViewportChanged('touch-pinch');
		}
	}

	function handleTouchEnd() {
		isPanning = false;
		lastTouchDistance = 0;
		// Trigger crisp render after touch gesture ends
		triggerCrispRender();
		// Notify of viewport change (debounced)
		notifyViewportChanged('touch-end');
	}

	function resetZoom() {
		scale = 1;
	}

	function centerView() {
		const rect = viewportRef?.getBoundingClientRect();
		if (rect && rect.width > 0 && rect.height > 0) {
			translateX = rect.width / 2;
			translateY = rect.height / 2;
			// Mark as restored since we successfully positioned the view
			viewportRestored = true;
		}
	}

	// Center the viewport on a specific world coordinate
	export function centerOn(worldX: number, worldY: number) {
		const rect = viewportRef?.getBoundingClientRect();
		if (rect) {
			// X: screenX = worldX + translateX, center means screenX = width/2
			// So translateX = width/2 - worldX
			translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(worldX, rect.width);
			// Y: screenY = worldY * scale + translateY, center means screenY = height/2
			translateY = TimeScaleManager.calculateTranslateYToCenterWorldY(worldY, scale, rect.height);
		}
	}

	// Get the time (in days from epoch) at the center of the viewport
	export function getCenterTime(): number | null {
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect) return null;
		const centerX = rect.width / 2;
		// Use centralized utility for screen->day conversion
		return TimeScaleManager.screenXToDay(centerX, timeScale, translateX);
	}

	// Center the viewport on a specific time (days from epoch)
	export function centerOnTime(days: number) {
		const rect = viewportRef?.getBoundingClientRect();
		if (rect) {
			// Use centralized utility to calculate translation for centering
			const worldX = TimeScaleManager.dayToWorldX(days, timeScale);
			translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(worldX, rect.width);
		}
	}

	/**
	 * Fit a card to fill the viewport width edge-to-edge
	 * Adjusts timeScale to make the card width match viewport width
	 * Centers horizontally on the card, but does not change Y position or Y scale
	 */
	export function fitCardWidth(cardStartX: number, cardWidth: number) {
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect || cardWidth <= 0) return;

		// Calculate the card's duration in days at the current timeScale
		const cardStartDay = TimeScaleManager.worldXToDay(cardStartX, timeScale);
		const cardEndDay = TimeScaleManager.worldXToDay(cardStartX + cardWidth, timeScale);
		const cardDurationDays = cardEndDay - cardStartDay;

		// Calculate new timeScale: viewportWidth pixels / cardDurationDays
		// This makes the card fill the entire viewport width (edge to edge)
		const newTimeScale = clampTimeScale(rect.width / cardDurationDays);

		// Apply the new timeScale
		timeScale = newTimeScale;

		// Center horizontally on the card's center time
		const cardCenterDay = cardStartDay + cardDurationDays / 2;
		const centerWorldX = TimeScaleManager.dayToWorldX(cardCenterDay, timeScale);
		translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(centerWorldX, rect.width);
		
		// Clamp translation to keep viewport within bounds
		translateX = clampTranslateX(translateX);
	}

	/**
	 * Fit a time range to fill the viewport width edge-to-edge
	 * Adjusts timeScale to make the time range match viewport width
	 * Centers horizontally on the specified center time
	 * Does not change Y position or Y scale
	 */
	export function fitTimeRange(startDay: number, endDay: number, centerDay: number) {
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect) return;

		const durationDays = endDay - startDay;
		if (durationDays <= 0) return;

		// Calculate new timeScale: viewportWidth pixels / durationDays
		// This makes the time range fill the entire viewport width (edge to edge)
		const newTimeScale = clampTimeScale(rect.width / durationDays);

		// Apply the new timeScale
		timeScale = newTimeScale;

		// Center horizontally on the specified center time
		const centerWorldX = TimeScaleManager.dayToWorldX(centerDay, timeScale);
		translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(centerWorldX, rect.width);
		
		// Clamp translation to keep viewport within bounds
		translateX = clampTranslateX(translateX);
	}

	// Update viewport dimensions and maintain world center on resize
	function updateViewportDimensions() {
		if (!viewportRef) return;
		
		const rect = viewportRef.getBoundingClientRect();
		const newWidth = rect.width;
		const newHeight = rect.height;
		
		// Check if dimensions transitioned from zero/invalid to valid
		// This happens when sidebar expands or container becomes visible
		const hasValidNewDimensions = newWidth > 0 && newHeight > 0;
		const dimensionsBecameValid = !hadValidDimensions && hasValidNewDimensions;
		
		// If dimensions just became valid and we have a pending viewport, apply it now
		if (dimensionsBecameValid && pendingViewport) {
			viewportWidth = newWidth;
			viewportHeight = newHeight;
			setViewport(pendingViewport);
			pendingViewport = null;
			hadValidDimensions = true;
			previousViewportWidth = newWidth;
			previousViewportHeight = newHeight;
			return;
		}
		
		// Only maintain world center if viewport has been successfully restored AND dimensions are valid
		// This prevents the resize logic from running with zero dimensions, which would corrupt
		// translateX and translateY values (translateX = width/2 - worldX becomes -worldX when width=0)
		if (viewportRestored && 
		    previousViewportWidth > 0 && previousViewportHeight > 0 && 
		    newWidth > 0 && newHeight > 0 &&
		    (newWidth !== previousViewportWidth || newHeight !== previousViewportHeight)) {
			
			// Calculate current world center before resize
			const centerTime = TimeScaleManager.screenXToDay(previousViewportWidth / 2, timeScale, translateX);
			const centerWorldX = TimeScaleManager.dayToWorldX(centerTime, timeScale);
			const centerScreenY = previousViewportHeight / 2;
			const centerWorldY = (centerScreenY - translateY) / scale;
			
			// Update dimensions
			viewportWidth = newWidth;
			viewportHeight = newHeight;
			
			// Recalculate translateX to keep same world center
			translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(centerWorldX, newWidth);
			translateX = clampTranslateX(translateX);
			
			// Recalculate translateY to keep same world center
			translateY = TimeScaleManager.calculateTranslateYToCenterWorldY(centerWorldY, scale, newHeight);
		} else if (newWidth > 0 && newHeight > 0) {
			// Dimensions are valid but we don't need to maintain center (first initialization or no change)
			viewportWidth = newWidth;
			viewportHeight = newHeight;
		} else {
			// Dimensions are zero (pane collapsed/hidden) - update state but DON'T recalculate transforms
			// Keep previousViewportWidth/Height so we know the last valid dimensions when pane reopens
			viewportWidth = newWidth;
			viewportHeight = newHeight;
			// Mark that we no longer have valid dimensions
			hadValidDimensions = false;
			// DON'T update previousViewportWidth/Height - keep the last valid dimensions
			// This allows proper restoration when pane reopens
			return;
		}
		
		// Store current dimensions for next resize (only if dimensions are valid)
		previousViewportWidth = newWidth;
		previousViewportHeight = newHeight;
		// Mark that we have valid dimensions
		hadValidDimensions = true;
	}

	// Get current viewport state for persistence
	export function getViewport(): { centerX: number; centerDay: number; centerY: number; timeScale: number; scale: number } | null {
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect || !hasValidDimensions(rect)) return null;
		
		const centerTime = getCenterTime();
		if (centerTime === null) return null;
		
		// Calculate centerX (worldX coordinate - legacy, for backward compatibility)
		const centerWorldX = TimeScaleManager.dayToWorldX(centerTime, timeScale);
		
		// Y center is middle of viewport
		const centerScreenY = rect.height / 2;
		const centerWorldY = (centerScreenY - translateY) / scale;
		
		return {
			centerX: centerWorldX,  // Legacy: worldX coordinate
			centerDay: centerTime,   // Preferred: days from epoch (time-scale independent)
			centerY: centerWorldY,
			timeScale: timeScale,
			scale: scale // Include Y-axis zoom level
		};
	}

	// Set viewport state from persistence
	export function setViewport(viewport: { centerX: number; centerDay?: number; centerY: number; timeScale: number; scale?: number }) {
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect) return;
		
		// Guard: if dimensions are zero, defer restoration until container has real dimensions
		// With rect.width = 0, translateX = 0 - centerWorldX = -centerWorldX
		// This would place the center at screen position 0 (left edge) instead of center
		if (!hasValidDimensions(rect)) {
			pendingViewport = viewport;
			return;
		}
		
		// Clear any pending viewport - we're applying this one now
		pendingViewport = null;
		
		// Clamp timeScale to ensure we don't zoom out beyond the 20B year limit
		// Use a local clamp function that uses current rect dimensions to avoid race condition with state
		const getLocalMinTimeScale = () => rect.width / (2 * MAX_DAYS_FROM_EPOCH);
		const localClampTimeScale = (ts: number) => Math.max(getLocalMinTimeScale(), ts);
		timeScale = localClampTimeScale(viewport.timeScale);
		
		// Restore Y-axis zoom level (default to 1 if not present in old caches)
		scale = clampScale(viewport.scale ?? 1);
		
		// Calculate center world X coordinate
		// Prefer centerDay (time-scale independent), fall back to centerX (legacy)
		let centerWorldX: number;
		if (viewport.centerDay !== undefined) {
			centerWorldX = TimeScaleManager.dayToWorldX(viewport.centerDay, timeScale);
		} else {
			// Legacy: centerX was stored as worldX at the SAVED timeScale
			// We need to convert it back to days, then to the NEW worldX
			const savedTimeScale = viewport.timeScale;
			const centerDay = TimeScaleManager.worldXToDay(viewport.centerX, savedTimeScale);
			centerWorldX = TimeScaleManager.dayToWorldX(centerDay, timeScale);
		}
		
		// Calculate translateX to center on the world coordinate
		translateX = TimeScaleManager.calculateTranslateXToCenterWorldX(centerWorldX, rect.width);
		
		// Clamp translation using local function that uses rect.width directly (not state)
		// This avoids race conditions where viewportWidth state hasn't been flushed yet
		const localClampTranslateX = (newTranslateX: number): number => {
			const maxTranslateX = MAX_DAYS_FROM_EPOCH * timeScale;
			const minTranslateX = rect.width - MAX_DAYS_FROM_EPOCH * timeScale;
			return Math.max(minTranslateX, Math.min(maxTranslateX, newTranslateX));
		};
		translateX = localClampTranslateX(translateX);
		
		// Calculate translateY to center on centerY
		translateY = TimeScaleManager.calculateTranslateYToCenterWorldY(viewport.centerY, scale, rect.height);
		
		// Mark viewport as successfully restored
		viewportRestored = true;
	}

	// Center the view initially
	onMount(() => {
		// Wait for DOM to be fully ready using a microtask
		void tick().then(() => {
			updateViewportDimensions();
			
			// Load initial viewport if provided, otherwise center
			if (initialViewport) {
				// Small delay to ensure container has proper dimensions
				setTimeout(() => {
					setViewport(initialViewport);
					// Note: viewportRestored is set inside setViewport if dimensions are valid
				}, 0);
			} else {
				centerView();
				// centerView always has valid dimensions (it's a default positioning)
			}
		});
		
		// Use ResizeObserver to detect ANY viewport size changes
		// This catches dev tools, Obsidian panel resizing, split views, etc.
		let resizeObserver: ResizeObserver | null = null;
		
		if (viewportRef) {
			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (entry.target === viewportRef) {
						updateViewportDimensions();
					}
				}
			});
			resizeObserver.observe(viewportRef);
		}
		
		return () => {
			resizeObserver?.disconnect();
		};
	});
</script>

<div
	class="viewport"
	bind:this={viewportRef}
	class:panning={isPanning}
		role="application"
		aria-label="Timeline canvas"
		onwheel={handleWheel}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseLeave}
		onmouseenter={handleMouseEnter}
		onclick={(event) => {
			// Only treat as click if we didn't pan significantly
			if (totalPanDelta < PAN_THRESHOLD && onCanvasClick) {
				// Guard: ignore clicks on header region (top 40px)
				const rect = viewportRef?.getBoundingClientRect();
				if (!rect) return;
				
				const screenX = event.clientX - rect.left;
				const screenY = event.clientY - rect.top;
				
				// Ignore clicks in the header area
				if (screenY < 40) return;
				
				// Ignore clicks on controls
				if ((event.target as HTMLElement | null)?.closest('.controls')) return;
				
				// Guard: ignore clicks on timeline cards (defensive - events should be stopped by cards)
				if ((event.target as HTMLElement | null)?.closest('.timeline-card')) return;
				
				// Guard: ignore clicks while any card is being dragged or resized
				if (isAnyCardDragging || isAnyCardResizing) return;
				
				// Calculate world coordinates
				const worldX = TimeScaleManager.screenToWorldX(screenX, translateX);
				const worldY = (screenY - translateY) / scale;
				
				onCanvasClick({ screenX, screenY, worldX, worldY });
			}
		}}
>
	<TimelineHeader
		timeScale={timeScale}
		translateX={translateX}
		viewportWidth={viewportWidth}
		mouseX={mouseX}
		isHovering={isHovering}
		selectedCard={selectedCard}
		isAnyCardResizing={isAnyCardResizing}
		activeResizeEdge={activeResizeEdge}
		timelineName={timelineName}
	/>
	
	<!-- Dashed cursor line spanning full viewport height -->
	<!-- Hide cursor line when dragging or resizing a card -->
	{#if cursorScreenX() !== null && !isAnyCardDragging && !isAnyCardResizing}
		{@const screenX = cursorScreenX()}
		{#if screenX !== null}
			<div
				class="cursor-line"
				style="left: {screenX}px;"
			></div>
		{/if}
	{/if}
	
	<!-- Card boundary lines extending up to timeline for selected card -->
	{#if selectedCard !== null}
		{@const startScreenX = TimeScaleManager.worldXToScreenRounded(selectedCard.startX, translateX)}
		{@const endScreenX = TimeScaleManager.worldXToScreenRounded(selectedCard.endX, translateX)}
		<div
			class="card-boundary-line start"
			class:active={activeResizeEdge === 'left'}
			style="left: {startScreenX}px;"
		></div>
		<div
			class="card-boundary-line end"
			class:active={activeResizeEdge === 'right'}
			style="left: {endScreenX}px;"
		></div>
	{/if}
	
	<GridLines
		scale={scale}
		translateX={translateX}
		translateY={translateY}
		viewportWidth={viewportWidth}
		viewportHeight={viewportHeight}
	/>
	<div
		class="content-layer"
		style="transform: translate3d(0px, {Math.round(translateY)}px, 0); --force-render: {forceRender};"
	>
		{@render children()}
	</div>
	
	<div class="controls">
		<div class="zoom-level">Y:{Math.round(scale * 100)}% | Time:{Math.round(timeScale * 10) / 10}</div>
		<button onclick={resetZoom}>Reset Y Zoom</button>
	</div>
</div>

<style>
	.viewport {
		width: 100%;
		height: 100%;
		overflow: hidden;
		position: relative;
		cursor: grab;
		background: var(--background-primary);
		--no-tooltip: true;
	}

	.viewport.panning {
		cursor: grabbing;
	}

	.content-layer {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		will-change: transform;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		/* Force browser to recalculate styles after zoom by referencing the variable */
		counter-reset: force-render var(--force-render, 0);
	}

	.controls {
		position: absolute;
		bottom: 16px;
		right: 16px;
		display: flex;
		gap: 8px;
		align-items: center;
		background: var(--background-secondary);
		padding: 8px 12px;
		border-radius: 6px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.zoom-level {
		font-size: 12px;
		color: var(--text-muted);
		min-width: 50px;
		text-align: center;
	}

	button {
		padding: 6px 12px;
		font-size: 12px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		cursor: pointer;
		transition: opacity 0.2s;
	}

	button:hover {
		opacity: 0.9;
	}

	.cursor-line {
		position: absolute;
		top: 40px; /* Start below the timeline header */
		bottom: 0;
		width: 2px;
		border-left: 2px solid transparent;
		border-image: repeating-linear-gradient(
			to bottom,
			var(--interactive-accent) 0px,
			var(--interactive-accent) 8px,
			transparent 8px,
			transparent 14px
		) 1;
		opacity: 0.4;
		pointer-events: none;
		z-index: 1;
		transform: translateX(-1px);
	}

	.card-boundary-line {
		position: absolute;
		top: 40px; /* Start below the timeline header */
		bottom: 0;
		width: 2px;
		border-left: 2px solid transparent;
		border-image: repeating-linear-gradient(
			to bottom,
			var(--text-normal) 0px,
			var(--text-normal) 8px,
			transparent 8px,
			transparent 14px
		) 1;
		opacity: 0.4;
		pointer-events: none;
		z-index: 1;
		transform: translateX(-1px);
	}

	.card-boundary-line.active {
		border-image: repeating-linear-gradient(
			to bottom,
			var(--interactive-accent) 0px,
			var(--interactive-accent) 8px,
			transparent 8px,
			transparent 14px
		) 1;
		opacity: 0.8;
		z-index: 2;
	}
</style>
