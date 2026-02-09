<script lang="ts">
	import { onMount } from "svelte";

	interface Props {
		x: number;
		y: number;
		width: number;
		title: string;
		scale: number;
		translateX: number;
		layer: number;
		color?: 'red' | 'blue' | 'green' | 'yellow';
		onResize?: (newX: number, newWidth: number, finished: boolean) => void;
		onMove?: (newX: number, newY: number, finished: boolean) => void;
		onLayerChange?: (newLayer: number, newX: number, newWidth: number, finished: boolean) => void;
		onClick?: () => void;
	}

	let { x, y, width, title, scale, translateX, layer, color, onResize, onMove, onLayerChange, onClick }: Props = $props();

	const GRID_SPACING = 50;
	const PIXELS_PER_DAY = 10;
	const EDGE_ZONE = 8; // px from edge to trigger resize handle
	const MIN_WIDTH_DAYS = 1;
	const MIN_WIDTH_PX = MIN_WIDTH_DAYS * PIXELS_PER_DAY;

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
	let canMove = $state(false);
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

	function handleMouseMove(event: MouseEvent) {
		// Check if we should start moving (threshold: 3 pixels)
		if (isMouseDown && !isMoving && !dragThresholdMet && 
			(Math.abs(event.clientX - startMouseX) > 3 || Math.abs(event.clientY - startMouseY) > 3)) {
			dragThresholdMet = true;
			isMoving = true;
			console.log('Move started - drag threshold met');
		}
		
		if (isResizing) {
			const mouseDelta = event.clientX - startMouseX;
			const worldDelta = mouseDelta / scale;
			
			if (resizeEdge === 'right') {
				// Right edge: change width
				let newWidth = dragStartWidth + worldDelta;
				// Snap to whole days and enforce minimum
				let days = Math.round(newWidth / PIXELS_PER_DAY);
				days = Math.max(days, MIN_WIDTH_DAYS);
				newWidth = days * PIXELS_PER_DAY;
				
				// Update local display state directly
				displayWidth = newWidth;
				
				console.log('Resize right:', { dragStartX, newWidth, worldDelta });
				
				// Notify parent for optimistic updates, but don't wait for response
				if (onResize) {
					onResize(dragStartX, newWidth, false);
				}
			} else if (resizeEdge === 'left') {
				// Left edge: change position and width
				let newWidth = dragStartWidth - worldDelta;
				
				// Snap to whole days and enforce minimum
				let days = Math.round(newWidth / PIXELS_PER_DAY);
				days = Math.max(days, MIN_WIDTH_DAYS);
				newWidth = days * PIXELS_PER_DAY;
				
				// Calculate new X based on new width to keep end date constant
				let newX = (dragStartX + dragStartWidth) - newWidth;
				
				// Update local display state directly
				displayX = newX;
				displayWidth = newWidth;
				
				console.log('Resize left:', { dragStartX, newX, newWidth, worldDelta });
				
				// Notify parent for optimistic updates, but don't wait for response
				if (onResize) {
					onResize(newX, newWidth, false);
				}
			}
		} else if (isMoving) {
			// Move entire card
			const mouseDeltaX = event.clientX - startMouseX;
			const mouseDeltaY = event.clientY - startMouseY;
			const worldDeltaX = mouseDeltaX / scale;
			const worldDeltaY = mouseDeltaY / scale;
			
			// Calculate new X position
			let newX = dragStartX + worldDeltaX;
			// Snap to whole days
			let days = Math.round(newX / PIXELS_PER_DAY);
			newX = days * PIXELS_PER_DAY;
			
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
			
			console.log('Move:', { dragStartX, newX, dragStartY, newY, layer: calculatedLayer, worldDeltaX, worldDeltaY });
			
			// Notify parent for optimistic updates
			if (onMove) {
				onMove(newX, newSnappedY, false);
			}
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
			
			console.log('Resize start:', { edge: resizeEdge, x: displayX, width: displayWidth, scale });
			
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
			
			console.log('Mouse down - waiting for drag threshold');
			
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
			console.log('Click detected - opening file');
			onClick();
		}
		
		if (isResizing && onResize) {
			// Signal resize is finished - use local display state
			onResize(displayX, displayWidth, true);
		}
		
		// Check if we have a layer change
		const hasLayerChange = isMoving && targetLayer !== null && targetLayer !== layer;
		
		if (hasLayerChange && onLayerChange) {
			// Layer change handles both position AND layer atomically
			// Safe to use non-null assertion because we checked targetLayer !== null above
			console.log('Layer change:', { from: layer, to: targetLayer, x: displayX, width: displayWidth });
			onLayerChange(targetLayer!, displayX, displayWidth, true);
		} else if (isMoving && onMove) {
			// Regular move (same layer) - only position changed
			console.log('Move finished:', { x: displayX, y: snappedY() });
			onMove(displayX, snappedY(), true);
		}
		
		// Reset ghost state
		showGhost = false;
		targetLayer = null;
		
		isResizing = false;
		isMoving = false;
		isMouseDown = false;
		resizeEdge = null;
		canMove = false;
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
		
		if (localX <= EDGE_ZONE) {
			resizeEdge = 'left';
			canMove = false;
		} else if (localX >= rect.width - EDGE_ZONE) {
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

	style="left: {displayX}px; top: {snappedY()}px; width: {displayWidth}px;"
	bind:this={cardRef}
	onmousemove={handleCardMouseMove}
	onmouseleave={handleCardMouseLeave}
	onmousedown={handleMouseDown}
	role="button"
	tabindex="0"
	aria-label="Timeline card: {title}"
>
	<!-- Colored line at top -->
	<div class="color-line" aria-hidden="true"></div>
	
	<!-- Left resize handle -->
	<div class="resize-handle resize-handle-left" aria-hidden="true"></div>
	
	<!-- Right resize handle -->
	<div class="resize-handle resize-handle-right" aria-hidden="true"></div>
	
	<div class="card-content">
		<h3>{title}</h3>
	</div>
</div>

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
</style>
