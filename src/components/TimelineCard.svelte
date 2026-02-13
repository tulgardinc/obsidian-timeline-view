<script lang="ts">
	import { onMount } from "svelte";
	import { tweened } from "svelte/motion";
	import { cubicOut } from "svelte/easing";
	import { TimeScaleManager } from "../utils/TimeScaleManager";
	import { getViewportContext } from "../contexts/ViewportContext";
	import { CardCameraRenderer, type CardWorldData } from "../utils/CardCameraRenderer";
	import type { ViewportState } from "../utils/CameraSystem";

	interface Props {
		type: 'note' | 'timeline';
		x: number;
		y: number;
		width: number;
		title: string;
		layer: number;
		color?: 'red' | 'blue' | 'green' | 'yellow';
		isSelected?: boolean;
		onResize?: (edge: 'left' | 'right', deltaX: number, finished: boolean) => void;
		onMove?: (deltaX: number, deltaY: number, finished: boolean) => void;
		onLayerChange?: (newLayer: number, newX: number, newWidth: number, finished: boolean) => void;
		onClick?: (event: MouseEvent) => void;
		onSelect?: () => void;
		onUpdateSelection?: (startX: number, endX: number, startDate: string, endDate: string) => void;
		onDragStart?: () => void;
		onDragEnd?: () => void;
		onResizeStart?: (edge: 'left' | 'right') => void;
		onResizeEnd?: () => void;
		onContextMenu?: (event: MouseEvent) => void;
	}

	let { type, x, y, width, title, layer, color, isSelected = false, onResize, onMove, onLayerChange, onClick, onSelect, onUpdateSelection, onDragStart, onDragEnd, onResizeStart, onResizeEnd, onContextMenu }: Props = $props();
	
	// Derived: is this a timeline card?
	const isTimelineCard = $derived(type === 'timeline');
	const isNoteCard = $derived(type === 'note');

	const GRID_SPACING = 50;
	const START_DATE = new Date('1970-01-01');
	const EDGE_ZONE = 8; // px from edge to trigger resize handle

	// Get viewport context (provided by InfiniteCanvas parent)
	const viewport = getViewportContext();

	// Get viewport values from context (fallback to defaults if no context)
	let scale = $derived(viewport?.getScale() ?? 1);
	let timeScale = $derived(viewport?.getTimeScale() ?? 10);
	let translateX = $derived(viewport?.getTranslateX() ?? 0);
	let translateY = $derived(viewport?.getTranslateY() ?? 0);
	let viewportWidth = $derived(viewport?.getViewportWidth() ?? 0);
	let viewportHeight = $derived(viewport?.getViewportHeight() ?? 0);

	// Get current scale level for marker-based snapping (based on timeScale pixel density)
	let scaleLevel = $derived(() => TimeScaleManager.getScaleLevel(timeScale));

	// Local world coordinate state - used during drag operations
	// These are WORLD coordinates, not screen coordinates
	let worldX = $state(x);
	let worldY = $state(y);
	let worldWidth = $state(width);
	
	// Animated world coordinates for smooth snapping during resize/move
	// These tween toward the target snapped positions
	const animatedX = tweened(x, { duration: 200, easing: cubicOut });
	const animatedY = tweened(y, { duration: 200, easing: cubicOut });
	const animatedWidth = tweened(width, { duration: 200, easing: cubicOut });
	
	// Sync props to local state when NOT dragging
	$effect(() => {
		if (!isResizing && !isMoving) {
			worldX = x;
			worldY = y;
			worldWidth = width;
			animatedX.set(x, { duration: 0 });
			animatedY.set(y, { duration: 0 });
			animatedWidth.set(width, { duration: 0 });
		}
	});

	// Snap y to grid lines (position card between lines)
	let snappedY = $derived(() => {
		return Math.round(worldY / GRID_SPACING) * GRID_SPACING;
	});

	// Build viewport state for camera system
	let viewportState = $derived<ViewportState>({
		width: viewportWidth,
		height: viewportHeight,
		translateX,
		translateY,
		scale
	});

	// Card data for rendering - uses animated coordinates for smooth visual updates
	// During resize/move, these smoothly interpolate to the snapped target positions
	// Height is GRID_SPACING in world coordinates
	let cardData = $derived<CardWorldData>({
		x: $animatedX,
		y: $animatedY,
		width: $animatedWidth,
		height: GRID_SPACING
	});

	// Visual height scales with zoom to fill the grid cell
	let visualHeight = $derived(() => GRID_SPACING * scale);

	// Use Camera System to calculate render data
	// This keeps coordinates in safe viewport-relative range
	let renderData = $derived(() => CardCameraRenderer.calculateRenderData(
		cardData,
		viewportState
	));

	// Extract render properties
	let visualX = $derived(() => renderData().x);
	let visualY = $derived(() => renderData().y);
	let visualWidth = $derived(() => renderData().width);
	let isClampedLeft = $derived(() => renderData().clampedLeft);
	let isClampedRight = $derived(() => renderData().clampedRight);
	let isClampedBoth = $derived(() => isClampedLeft() && isClampedRight());
	let isCompletelyOutside = $derived(() => !renderData().visible);

	// Resize and move state
	let isResizing = $state(false);
	let isMoving = $state(false);
	let isMouseDown = $state(false);
	let resizeEdge: 'left' | 'right' | null = $state(null);
	let canMove = $state(true);
	let startMouseX = $state(0);
	let startMouseY = $state(0);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let dragStartWidth = $state(0);
	let dragThresholdMet = $state(false);
	let lastClickEvent = $state<MouseEvent | null>(null);

	let cardRef: HTMLDivElement;

	// Calculate layer from Y position
	function yToLayer(yPos: number): number {
		return -Math.round(yPos / GRID_SPACING);
	}

	// Calculate Y position from layer
	function layerToY(layerNum: number): number {
		return -layerNum * GRID_SPACING;
	}

	// Calculate date from X position using unified coordinate functions
	function xToDate(xPos: number): string {
		// Convert world X to day using unified function
		const days = TimeScaleManager.worldXToDay(xPos, timeScale);
		const level = TimeScaleManager.getScaleLevel(timeScale);
		return TimeScaleManager.formatDateForLevel(Math.round(days), level);
	}

	// Update selection boundary data during drag/resize
	function updateSelectionData() {
		if (isSelected && onUpdateSelection) {
			const startX = worldX;
			const endX = worldX + worldWidth;
			const startDate = xToDate(startX);
			const endDate = xToDate(endX);
			onUpdateSelection(startX, endX, startDate, endDate);
		}
	}

	function handleMouseMove(event: MouseEvent) {
		// Check if we should start moving (threshold: 3 pixels)
		if (isMouseDown && !isMoving && !dragThresholdMet && 
			(Math.abs(event.clientX - startMouseX) > 3 || Math.abs(event.clientY - startMouseY) > 3)) {
			dragThresholdMet = true;
			isMoving = true;
			
			// Notify parent that drag has started
			if (onDragStart) {
				onDragStart();
			}
			
			// Select the card immediately when move starts
			if (onSelect) {
				onSelect();
			}
		}
		
		if (isResizing) {
			const mouseDelta = event.clientX - startMouseX;
			// X-axis: screen pixels = world pixels (no scale on X)
			const worldDelta = mouseDelta;
			
			if (resizeEdge === 'right') {
				// Right edge: change width
				// Calculate the target end position in world coordinates
				const targetEndX = dragStartX + dragStartWidth + worldDelta;
				// Convert to day and snap to nearest marker
				const targetEndDay = TimeScaleManager.worldXToDay(targetEndX, timeScale);
				const snappedEndDay = TimeScaleManager.snapToNearestMarker(Math.round(targetEndDay), scaleLevel());
				// Convert back to world coordinate
				const snappedEndX = TimeScaleManager.dayToWorldX(snappedEndDay, timeScale);
				// Calculate new width (no minimum constraint)
				let newWidth = snappedEndX - dragStartX;
				if (newWidth < 0) {
					newWidth = 0;
				}
				
				// Calculate delta from original width
				const deltaWidth = newWidth - dragStartWidth;
				
				// Update logical state
				worldWidth = newWidth;
				// Animate to new width
				animatedWidth.set(newWidth);
				
				// Notify parent for optimistic updates with delta, but don't wait for response
				if (onResize) {
					onResize('right', deltaWidth, false);
				}
				
				// Update selection data so indicators follow the card
				updateSelectionData();
			} else if (resizeEdge === 'left') {
				// Left edge: change position and width
				// Calculate the target start position in world coordinates
				const targetStartX = dragStartX + worldDelta;
				// Convert to day and snap to nearest marker
				const targetStartDay = TimeScaleManager.worldXToDay(targetStartX, timeScale);
				const snappedStartDay = TimeScaleManager.snapToNearestMarker(Math.round(targetStartDay), scaleLevel());
				// Convert back to world coordinate
				const snappedStartX = TimeScaleManager.dayToWorldX(snappedStartDay, timeScale);
				
				// Calculate new width based on snapped start (keeping end position fixed)
				const endX = dragStartX + dragStartWidth;
				let newWidth = endX - snappedStartX;
				if (newWidth < 0) {
					newWidth = 0;
				}
				const newX = endX - newWidth;
				
				// Calculate delta from original position
				const deltaX = newX - dragStartX;
				
				// Update logical state
				worldX = newX;
				worldWidth = newWidth;
				// Animate to new position and width
				animatedX.set(newX);
				animatedWidth.set(newWidth);
				
				// Notify parent for optimistic updates with delta, but don't wait for response
				if (onResize) {
					onResize('left', deltaX, false);
				}
				
				// Update selection data so indicators follow the card
				updateSelectionData();
			}
		} else if (isMoving) {
			// Move entire card
			const mouseDeltaX = event.clientX - startMouseX;
			const mouseDeltaY = event.clientY - startMouseY;
			// X-axis: screen pixels = world pixels (no scale on X)
			const worldDeltaX = mouseDeltaX;
			// Y-axis: scale affects vertical zoom
			const worldDeltaY = mouseDeltaY / scale;
			
			// Calculate new X position
			let newX = dragStartX + worldDeltaX;
			
			// For note cards: snap to nearest marker position (like resizing does)
			// For timeline cards: don't change X position - they're locked in time
			if (isNoteCard) {
				const targetDay = TimeScaleManager.worldXToDay(newX, timeScale);
				const snappedDay = TimeScaleManager.snapToNearestMarker(Math.round(targetDay), scaleLevel());
				newX = TimeScaleManager.dayToWorldX(snappedDay, timeScale);
			} else {
				// Timeline cards: keep original X position
				newX = dragStartX;
			}
			
			// Calculate new Y position and snap to layer grid
			let newY = dragStartY + worldDeltaY;
			let calculatedLayer = yToLayer(newY);
			let newSnappedY = layerToY(calculatedLayer);
			
			// Calculate deltas from original position
			const deltaX = newX - dragStartX;
			const deltaY = newSnappedY - dragStartY;
			
			// Update logical state
			worldX = newX;
			worldY = newSnappedY;
			// Animate to new position
			animatedX.set(newX);
			animatedY.set(newSnappedY);
			
			// Notify parent for optimistic updates with deltas
			if (onMove) {
				onMove(deltaX, deltaY, false);
			}
			
			// Update selection data so indicators follow the card
			updateSelectionData();
		}
	}

	function handleMouseDown(event: MouseEvent) {
		if (event.button !== 0) return;
		
		if (resizeEdge) {
			// Start resize immediately
			event.preventDefault();
			event.stopPropagation();
			
			isResizing = true;
			startMouseX = event.clientX;
			dragStartX = worldX; // Use local world coordinate state
			dragStartWidth = worldWidth; // Use local world coordinate state
			
			// Notify parent that resize has started (with edge info)
			if (onResizeStart && resizeEdge) {
				onResizeStart(resizeEdge);
			}
			
			// Select the card immediately when resize starts, but only if not already selected
			// This preserves multi-selection when resizing a selected card
			if (onSelect && !isSelected) {
				onSelect();
			}
			
			// Add global listeners
			window.addEventListener('mousemove', handleWindowMouseMove);
			window.addEventListener('mouseup', handleMouseUp);
		} else if (canMove) {
			// Just mark mouse down - don't start move yet
			// Wait for mousemove to exceed threshold
			// Stop propagation to prevent InfiniteCanvas from panning
			event.preventDefault();
			event.stopPropagation();
			
			isMouseDown = true;
			startMouseX = event.clientX;
			startMouseY = event.clientY;
			dragStartX = worldX; // Use local world coordinate state
			dragStartY = worldY; // Use local world coordinate state
			dragThresholdMet = false;
			lastClickEvent = event; // Store event for onClick callback
			
			// Add global listeners
			window.addEventListener('mousemove', handleWindowMouseMove);
			window.addEventListener('mouseup', handleMouseUp);
		}
	}

	function handleWindowMouseMove(event: MouseEvent) {
		handleMouseMove(event);
	}

	function handleMouseUp() {
		// Note: onClick is now called in handleClick to ensure proper event handling
		// We don't call it here to avoid double-firing
		
		if (isResizing && onResize && resizeEdge) {
			// Signal resize is finished - calculate final delta
			let deltaX: number;
			if (resizeEdge === 'left') {
				deltaX = worldX - dragStartX;
			} else {
				deltaX = worldWidth - dragStartWidth;
			}
			onResize(resizeEdge, deltaX, true);
		}
		
		// Notify parent that resize has ended
		if (isResizing && onResizeEnd) {
			onResizeEnd();
		}
		
		if (isMoving && onMove) {
			// Calculate final deltas
			const deltaX = worldX - dragStartX;
			const deltaY = worldY - dragStartY;
			onMove(deltaX, deltaY, true);
		}
		
		// Notify parent that drag has ended
		if (isMoving && onDragEnd) {
			onDragEnd();
		}
		
		isResizing = false;
		isMoving = false;
		isMouseDown = false;
		resizeEdge = null;
		canMove = true;
		dragThresholdMet = false;
		
		// Remove global listeners
		window.removeEventListener('mousemove', handleWindowMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	function handleCardMouseMove(event: MouseEvent) {
		if (isResizing || isMoving) return;
		
		// Timeline cards cannot be resized - skip edge detection
		if (isTimelineCard) {
			resizeEdge = null;
			canMove = true;
			return;
		}
		
		// Check if mouse is in edge zones
		const rect = cardRef?.getBoundingClientRect();
		if (!rect) return;
		
		const localX = event.clientX - rect.left;
		
		// Check left edge - disabled if clamped on left (real edge is outside viewport)
		if (localX <= EDGE_ZONE && !isClampedLeft()) {
			resizeEdge = 'left';
			canMove = false;
		// Check right edge - disabled if clamped on right (real edge is outside viewport)
		} else if (localX >= rect.width - EDGE_ZONE && !isClampedRight()) {
			resizeEdge = 'right';
			canMove = false;
		} else {
			resizeEdge = null;
			canMove = true;
		}
	}

	function handleCardMouseLeave() {
		if (!isResizing && !isMoving) {
			resizeEdge = null;
			canMove = false;
		}
	}

	function handleClick(event: MouseEvent) {
		// Stop click from bubbling to canvas (prevents deselection)
		event.stopPropagation();
		
		// Only call onClick if this wasn't a drag/resize operation
		// (handleMouseUp already calls onClick if there was no drag)
		if (!isMoving && !isResizing && !dragThresholdMet) {
			onClick?.(event);
		}
	}

	function handleContextMenu(event: MouseEvent) {
		// Prevent default browser context menu
		event.preventDefault();
		event.stopPropagation();

		// Select the card when opening context menu, but only if not already selected
		// This preserves multi-selection when right-clicking a selected card
		if (onSelect && !isSelected) {
			onSelect();
		}

		// Emit event to parent - parent will use Obsidian Menu API
		onContextMenu?.(event);
	}

	onMount(() => {
		return () => {
			// Cleanup
			window.removeEventListener('mousemove', handleWindowMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});
</script>

<!-- Only render if card is at least partially visible in viewport and width >= 15px -->
{#if !isCompletelyOutside() && visualWidth() >= 15}
	<div
		class="timeline-card"
		class:is-timeline-card={isTimelineCard}
		class:is-note-card={isNoteCard}
		class:color-red={color === 'red'}
		class:color-blue={color === 'blue'}
		class:color-green={color === 'green'}
		class:color-yellow={color === 'yellow'}
		class:resizing={isResizing}
		class:moving={isMoving}
		class:resize-left={resizeEdge === 'left'}
		class:resize-right={resizeEdge === 'right'}
		class:selected={isSelected}
		class:clamped-left={isClampedLeft()}
		class:clamped-right={isClampedRight()}
		class:clamped-both={isClampedBoth()}

		style="left: {visualX()}px; top: {visualY()}px; width: {visualWidth()}px; height: {visualHeight()}px;"
		bind:this={cardRef}
		onmousemove={handleCardMouseMove}
		onmouseleave={handleCardMouseLeave}
		onmousedown={handleMouseDown}
		onclick={handleClick}
		oncontextmenu={handleContextMenu}
		role="button"
		tabindex="0"
		aria-label="Timeline card: {title}"
	>
		<!-- Colored line at top - only for note cards -->
		{#if isNoteCard}
			<div class="color-line" aria-hidden="true"></div>
		{/if}
		
		<!-- Left resize handle - only show if not clamped AND not a timeline card -->
		{#if isNoteCard && !isClampedLeft()}
			<div class="resize-handle resize-handle-left" aria-hidden="true"></div>
		{/if}
		
		<!-- Right resize handle - only show if not clamped AND not a timeline card -->
		{#if isNoteCard && !isClampedRight()}
			<div class="resize-handle resize-handle-right" aria-hidden="true"></div>
		{/if}
		
		<!-- Clamp indicator for left edge -->
		{#if isClampedLeft()}
			<div class="clamp-indicator clamp-indicator-left" aria-hidden="true">
				<span class="clamp-arrow">&#9664;</span>
			</div>
		{/if}
		
		<!-- Clamp indicator for right edge -->
		{#if isClampedRight()}
			<div class="clamp-indicator clamp-indicator-right" aria-hidden="true">
				<span class="clamp-arrow">&#9654;</span>
			</div>
		{/if}
		
		<div class="card-content" class:clamped-content-left={isClampedLeft()} class:clamped-content-right={isClampedRight()}>
			<h3>{title}</h3>
		</div>
	</div>
{/if}

<style>
	.timeline-card {
		position: absolute;
		transform: translate3d(0, 0, 0);
		background: var(--background-secondary);
		border: 2px solid var(--color-base-40);
		border-radius: 4px;
		padding: 4px 4px;
		min-width: 0;
		box-sizing: border-box;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		cursor: pointer;
		transition: box-shadow 0.2s, background-color 0.2s;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		image-rendering: -webkit-optimize-contrast;
		image-rendering: crisp-edges;
		/* Force GPU layer creation */
		will-change: transform;
		display: flex;
		align-items: center;
		overflow: hidden;
	}

	/* Color line at the top of the card */
	.color-line {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: transparent;
		border-radius: 4px 4px 0 0;
		z-index: 1;
	}

	.timeline-card.color-red .color-line {
		background: var(--color-red);
	}

	.timeline-card.color-blue .color-line {
		background: var(--color-blue);
	}

	.timeline-card.color-green .color-line {
		background: var(--color-green);
	}

	.timeline-card.color-yellow .color-line {
		background: var(--color-yellow);
	}

	/* Timeline card specific styling */
	.timeline-card.is-timeline-card {
		background: var(--background-modifier-accent);
		border: 3px solid var(--interactive-accent);
		border-style: dashed;
		cursor: grab;
	}

	.timeline-card.is-timeline-card:hover {
		background: var(--background-modifier-active-hover);
		box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
	}

	.timeline-card.is-timeline-card.selected {
		border-color: var(--interactive-accent-hover);
		background: var(--background-modifier-active);
	}

	/* Timeline card color backgrounds (dimmed versions) */
	.timeline-card.is-timeline-card.color-red {
		background: color-mix(in srgb, var(--color-red) 20%, var(--background-secondary) 80%);
	}

	.timeline-card.is-timeline-card.color-blue {
		background: color-mix(in srgb, var(--color-blue) 20%, var(--background-secondary) 80%);
	}

	.timeline-card.is-timeline-card.color-green {
		background: color-mix(in srgb, var(--color-green) 20%, var(--background-secondary) 80%);
	}

	.timeline-card.is-timeline-card.color-yellow {
		background: color-mix(in srgb, var(--color-yellow) 20%, var(--background-secondary) 80%);
	}

	.timeline-card:hover {
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
		background: var(--background-modifier-hover);
	}

	.timeline-card.resizing {
		box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	.timeline-card.moving {
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
		z-index: 20;
		opacity: 0.8;
	}

	.timeline-card.selected {
		border: 2px solid var(--interactive-accent);
		box-shadow: 0 0 0 2px var(--interactive-accent-hover);
		z-index: 30;
	}

	.timeline-card.resize-left,
	.timeline-card.resize-right {
		cursor: col-resize;
	}

	.resize-handle {
		position: absolute;
		top: 25%;
		bottom: 25%;
		width: 3px;
		background-color: var(--text-muted);
		opacity: 0;
		transition: opacity 0.2s, background-color 0.2s;
		border-radius: 1px;
	}

	.resize-handle-left {
		left: 4px;
	}

	.resize-handle-right {
		right: 4px;
	}

	.timeline-card:hover .resize-handle,
	.timeline-card.resize-left .resize-handle-left,
	.timeline-card.resize-right .resize-handle-right {
		opacity: 0.6;
	}

	.timeline-card.resize-left .resize-handle-left,
	.timeline-card.resize-right .resize-handle-right {
		background-color: var(--interactive-accent);
		opacity: 1;
	}

	:global(.timeline-card.force-crisp) {
		transform: translate3d(0, 0, 0) scale3d(1.0001, 1.0001, 1);
	}

	.card-content {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-left: 6px;
		margin-right: 6px;
	}

	.card-content h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Clamp indicator styles */
	.timeline-card.clamped-left {
		border-left: 2px dashed var(--text-muted);
	}

	.timeline-card.clamped-right {
		border-right: 2px dashed var(--text-muted);
	}

	.timeline-card.clamped-both {
		border-left: 2px dashed var(--text-muted);
		border-right: 2px dashed var(--text-muted);
	}

	.clamp-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 2;
	}

	.clamp-indicator-left {
		left: 0;
		background: linear-gradient(to right, var(--background-secondary) 30%, transparent 100%);
	}

	.clamp-indicator-right {
		right: 0;
		background: linear-gradient(to left, var(--background-secondary) 30%, transparent 100%);
	}

	.clamp-arrow {
		font-size: 10px;
		color: var(--text-muted);
		opacity: 0.7;
	}

	.card-content.clamped-content-left {
		margin-left: 18px;
	}

	.card-content.clamped-content-right {
		margin-right: 18px;
	}
</style>
