<script lang="ts">
	import { onMount } from "svelte";
	import { TimeScaleManager } from "../utils/TimeScaleManager";
	import { getViewportContext } from "../contexts/ViewportContext";
	import { calculateClampedBounds } from "../utils/ViewportClamping";

	interface Props {
		x: number;
		y: number;
		width: number;
		title: string;
		layer: number;
		color?: 'red' | 'blue' | 'green' | 'yellow';
		isSelected?: boolean;
		onResize?: (newX: number, newWidth: number, finished: boolean) => void;
		onMove?: (newX: number, newY: number, finished: boolean) => void;
		onLayerChange?: (newLayer: number, newX: number, newWidth: number, finished: boolean) => void;
		onClick?: () => void;
		onSelect?: () => void;
		onUpdateSelection?: (startX: number, endX: number, startDate: string, endDate: string) => void;
		onDragStart?: () => void;
		onDragEnd?: () => void;
		onResizeStart?: (edge: 'left' | 'right') => void;
		onResizeEnd?: () => void;
	}

	let { x, y, width, title, layer, color, isSelected = false, onResize, onMove, onLayerChange, onClick, onSelect, onUpdateSelection, onDragStart, onDragEnd, onResizeStart, onResizeEnd }: Props = $props();

	const GRID_SPACING = 50;
	const START_DATE = new Date('1970-01-01');
	const EDGE_ZONE = 8; // px from edge to trigger resize handle

	// Get viewport context (provided by InfiniteCanvas parent)
	const viewport = getViewportContext();

	// Get viewport values from context (fallback to defaults if no context)
	let scale = $derived(viewport?.getScale() ?? 1);
	let timeScale = $derived(viewport?.getTimeScale() ?? 10);
	let translateX = $derived(viewport?.getTranslateX() ?? 0);
	let viewportWidth = $derived(viewport?.getViewportWidth() ?? 0);

	// Viewport clamping calculations using utility function
	let clampedBounds = $derived(() => calculateClampedBounds(
		displayX,
		displayWidth,
		scale,
		translateX,
		viewportWidth
	));

	let visualX = $derived(() => clampedBounds().visualX);
	let visualWidth = $derived(() => clampedBounds().visualWidth);
	let isClampedLeft = $derived(() => clampedBounds().isClampedLeft);
	let isClampedRight = $derived(() => clampedBounds().isClampedRight);
	let isClampedBoth = $derived(() => clampedBounds().isClampedBoth);
	let isCompletelyOutside = $derived(() => clampedBounds().isCompletelyOutside);

	// Get current scale level for marker-based snapping (uses effective density = timeScale * scale)
	let scaleLevel = $derived(() => TimeScaleManager.getScaleLevel(timeScale, scale));

	// Local display state - used during drag operations
	let displayX = $state(x);
	let displayY = $state(y);
	let displayWidth = $state(width);
	
	// Sync props to local state when NOT dragging
	$effect(() => {
		if (!isResizing && !isMoving) {
			displayX = x;
			displayY = y;
			displayWidth = width;
		}
	});

	// Snap y to grid lines (position card between lines)
	let snappedY = $derived(() => {
		return Math.round(displayY / GRID_SPACING) * GRID_SPACING;
	});

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

	// Ghost/Preview state for layer dragging
	let targetLayer = $state<number | null>(null);
	let showGhost = $state(false);

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
		const scaleLevel = TimeScaleManager.getScaleLevel(timeScale, scale);
		return TimeScaleManager.formatDateForLevel(Math.round(days), scaleLevel);
	}

	// Update selection boundary data during drag/resize
	function updateSelectionData() {
		if (isSelected && onUpdateSelection) {
			const startX = displayX;
			const endX = displayX + displayWidth;
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
			const worldDelta = mouseDelta / scale;
			
			if (resizeEdge === 'right') {
				// Right edge: change width
				// Calculate the target end position in world coordinates
				const targetEndX = dragStartX + dragStartWidth + worldDelta;
				// Convert to day and snap to nearest marker
				const targetEndDay = TimeScaleManager.worldXToDay(targetEndX, timeScale);
				const snappedEndDay = TimeScaleManager.snapToNearestMarker(Math.round(targetEndDay), scaleLevel());
				// Convert back to world coordinate
				const snappedEndX = TimeScaleManager.dayToWorldX(snappedEndDay, timeScale);
				// Calculate new width (ensure minimum 1 day)
				let newWidth = snappedEndX - dragStartX;
				const minWidth = TimeScaleManager.dayToWorldX(1, timeScale);
				if (newWidth < minWidth) {
					newWidth = minWidth;
				}
				
				// Update local display state directly
				displayWidth = newWidth;
				
				// Notify parent for optimistic updates, but don't wait for response
				if (onResize) {
					onResize(dragStartX, newWidth, false);
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
				const minWidth = TimeScaleManager.dayToWorldX(1, timeScale);
				if (newWidth < minWidth) {
					// If would be too small, push the end instead
					newWidth = minWidth;
				}
				const newX = endX - newWidth;
				
				// Update local display state directly
				displayX = newX;
				displayWidth = newWidth;
				
				// Notify parent for optimistic updates, but don't wait for response
				if (onResize) {
					onResize(newX, newWidth, false);
				}
				
				// Update selection data so indicators follow the card
				updateSelectionData();
			}
		} else if (isMoving) {
			// Move entire card
			const mouseDeltaX = event.clientX - startMouseX;
			const mouseDeltaY = event.clientY - startMouseY;
			const worldDeltaX = mouseDeltaX / scale;
			const worldDeltaY = mouseDeltaY / scale;
			
			// Calculate new X position
			let newX = dragStartX + worldDeltaX;
			// Snap to nearest marker position (like resizing does)
			const targetDay = TimeScaleManager.worldXToDay(newX, timeScale);
			const snappedDay = TimeScaleManager.snapToNearestMarker(Math.round(targetDay), scaleLevel());
			newX = TimeScaleManager.dayToWorldX(snappedDay, timeScale);
			
			// Calculate new Y position and target layer
			let newY = dragStartY + worldDeltaY;
			let calculatedLayer = yToLayer(newY);
			let newSnappedY = layerToY(calculatedLayer);
			
			// Update ghost preview
			targetLayer = calculatedLayer;
			showGhost = true;
			
			// Update local display state directly
			displayX = newX;
			displayY = newSnappedY;
			
			// Notify parent for optimistic updates
			if (onMove) {
				onMove(newX, newSnappedY, false);
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
			dragStartX = displayX; // Use local display state
			dragStartWidth = displayWidth; // Use local display state
			
			// Notify parent that resize has started (with edge info)
			if (onResizeStart && resizeEdge) {
				onResizeStart(resizeEdge);
			}
			
			// Select the card immediately when resize starts
			if (onSelect) {
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
			dragStartX = displayX; // Use local display state
			dragStartY = displayY; // Use local display state
			dragThresholdMet = false;
			
			// Add global listeners
			window.addEventListener('mousemove', handleWindowMouseMove);
			window.addEventListener('mouseup', handleMouseUp);
		}
	}

	function handleWindowMouseMove(event: MouseEvent) {
		handleMouseMove(event);
	}

	function handleMouseUp() {
		// Check if this was a click (mouse down but never started moving)
		if (isMouseDown && !isMoving && !dragThresholdMet && onClick) {
			onClick();
		}
		
		if (isResizing && onResize) {
			// Signal resize is finished - use local display state
			onResize(displayX, displayWidth, true);
		}
		
		// Notify parent that resize has ended
		if (isResizing && onResizeEnd) {
			onResizeEnd();
		}
		
		// Check if we have a layer change
		const hasLayerChange = isMoving && targetLayer !== null && targetLayer !== layer;
		
		if (hasLayerChange && onLayerChange) {
			// Layer change handles both position AND layer atomically
			// Safe to use non-null assertion because we checked targetLayer !== null above
			onLayerChange(targetLayer!, displayX, displayWidth, true);
		} else if (isMoving && onMove) {
			// Regular move (same layer) - only position changed
			onMove(displayX, snappedY(), true);
		}
		
		// Notify parent that drag has ended
		if (isMoving && onDragEnd) {
			onDragEnd();
		}
		
		// Reset ghost state
		showGhost = false;
		targetLayer = null;
		
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
	}

	onMount(() => {
		return () => {
			// Cleanup
			window.removeEventListener('mousemove', handleWindowMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});
</script>

<!-- Ghost element showing target layer position -->
{#if showGhost && targetLayer !== null}
	<div
		class="timeline-card ghost"
		style="left: {displayX}px; top: {layerToY(targetLayer)}px; width: {displayWidth}px;"
		aria-hidden="true"
	>
		<div class="card-content">
			<h3>{title}</h3>
		</div>
	</div>
{/if}

<!-- Only render if card is at least partially visible in viewport -->
{#if !isCompletelyOutside()}
	<div
		class="timeline-card"
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

		style="left: {visualX()}px; top: {snappedY()}px; width: {visualWidth()}px;"
		bind:this={cardRef}
		onmousemove={handleCardMouseMove}
		onmouseleave={handleCardMouseLeave}
		onmousedown={handleMouseDown}
		onclick={handleClick}
		role="button"
		tabindex="0"
		aria-label="Timeline card: {title}"
	>
		<!-- Colored line at top -->
		<div class="color-line" aria-hidden="true"></div>
		
		<!-- Left resize handle - only show if not clamped -->
		{#if !isClampedLeft()}
			<div class="resize-handle resize-handle-left" aria-hidden="true"></div>
		{/if}
		
		<!-- Right resize handle - only show if not clamped -->
		{#if !isClampedRight()}
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
		min-width: 50px;
		height: 50px; /* Exact grid spacing */
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

	.timeline-card.ghost {
		background: var(--interactive-accent);
		border: 2px dashed var(--interactive-accent-hover);
		opacity: 0.5;
		z-index: 5;
		pointer-events: none;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
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
