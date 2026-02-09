<script lang="ts">
	import { onMount } from "svelte";
	import GridLines from "./GridLines.svelte";
	import TimelineHeader from "./TimelineHeader.svelte";

	interface CardHoverData {
		startX: number;
		endX: number;
		startDate: string;
		endDate: string;
		title: string;
	}

	const PIXELS_PER_DAY = 10;

	// Calculate cursor screen X position for the dashed line
	let cursorScreenX = $derived(() => {
		if (mouseX === null || !isHovering) return null;
		
		// Convert mouse X to world coordinates
		const worldX = (mouseX - translateX) / scale;
		// Convert back to screen coordinates
		const screenX = worldX * scale + translateX;
		return screenX;
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

	let viewportRef: HTMLDivElement;

	interface Props {
		children: import('svelte').Snippet;
		onScaleChange?: (scale: number, translateX: number) => void;
		onTimeScaleChange?: (timeScale: number) => void;
		selectedCard?: CardHoverData | null;
		onCanvasClick?: () => void;
		isAnyCardDragging?: boolean;
		isAnyCardResizing?: boolean;
		activeResizeEdge?: 'left' | 'right' | null;
	}

	let { children, onScaleChange, onTimeScaleChange, selectedCard = null, onCanvasClick, isAnyCardDragging = false, isAnyCardResizing = false, activeResizeEdge = null }: Props = $props();

	// Notify parent of scale changes
	$effect(() => {
		if (onScaleChange) {
			onScaleChange(scale, translateX);
		}
	});
	
	// Notify parent of time scale changes
	$effect(() => {
		if (onTimeScaleChange) {
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
			console.log('Timeline: Triggering crisp render for', cards?.length || 0, 'cards');
			cards?.forEach((card, index) => {
				console.log(`Timeline: Repainting card ${index}`);
				forceRepaint(card);
			});
		}, 150);
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
				const newScale = scale * zoomMultiplier;
				const newTimeScale = timeScale * zoomMultiplier;
				
				// Zoom towards center of viewport
				const rect = viewportRef.getBoundingClientRect();
				const centerX = rect.width / 2;
				const centerY = rect.height / 2;
				
				// Calculate world coordinates before zoom
				// World coordinates are based on the old scale/timeScale
				const worldX = (centerX - translateX) / scale;
				const worldCenterTime = (centerX - translateX) / timeScale;
				const worldY = (centerY - translateY) / scale;
				
				// Apply new scale values
				scale = newScale;
				timeScale = newTimeScale;
				
				// Adjust translation to keep center stable
				// X translation keeps the same world time position
				translateX = centerX - worldCenterTime * timeScale;
				translateY = centerY - worldY * scale;
				
				// Trigger crisp render after zoom
				triggerCrispRender();
			} else if (isCmdHeld) {
				// Cmd + two-finger scroll = Time-scale zoom (zoom toward last known mouse position)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const newTimeScale = timeScale * (1 + delta);
				
				// Use last known mouse position, or center if mouse not in viewport
				const rect = viewportRef.getBoundingClientRect();
				const zoomCenterX = mouseX !== null ? mouseX : rect.width / 2;
				
				// Calculate world time coordinate at zoom center before zoom
				const worldCenterTime = (zoomCenterX - translateX) / timeScale;
				
				// Apply new time scale
				timeScale = newTimeScale;
				
				// Adjust translation to keep zoom center over same world time
				translateX = zoomCenterX - worldCenterTime * timeScale;
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
				const newTimeScale = timeScale * (1 + delta);
				
				// Get mouse position within viewport
				const rect = viewportRef.getBoundingClientRect();
				const mouseXPos = event.clientX - rect.left;
				
				// Calculate world time coordinate at mouse position before zoom
				const worldMouseTime = (mouseXPos - translateX) / timeScale;
				
				// Apply new time scale
				timeScale = newTimeScale;
				
				// Adjust translation to keep mouse position over same world time
				translateX = mouseXPos - worldMouseTime * timeScale;
			} else {
				// Mouse wheel alone = Unified zoom (scale + timeScale together to preserve aspect ratio)
				const zoomFactor = 0.1;
				const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
				const zoomMultiplier = 1 + delta;
				
				// Calculate new values for both scale and timeScale
				const newScale = scale * zoomMultiplier;
				const newTimeScale = timeScale * zoomMultiplier;
				
				// Zoom towards mouse position
				const rect = viewportRef.getBoundingClientRect();
				const mouseXPos = event.clientX - rect.left;
				const mouseYPos = event.clientY - rect.top;
				
				// Calculate world coordinates before zoom
				const worldX = (mouseXPos - translateX) / scale;
				const worldCenterTime = (mouseXPos - translateX) / timeScale;
				const worldY = (mouseYPos - translateY) / scale;
				
				// Apply new scale values
				scale = newScale;
				timeScale = newTimeScale;
				
				// Adjust translation to keep mouse over same world point
				// X translation keeps the same world time position
				translateX = mouseXPos - worldCenterTime * timeScale;
				translateY = mouseYPos - worldY * scale;
				
				// Trigger crisp render after zoom
				triggerCrispRender();
			}
		}
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
		
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
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
			
			lastMouseX = touch.clientX;
			lastMouseY = touch.clientY;
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
			
			// Calculate world coordinates before zoom
			const worldCenterTime = (centerX - translateX) / timeScale;
			const worldY = (centerY - translateY) / scale;
			
			// Apply new scale values (both scale and timeScale together)
			scale = scale * scaleFactor;
			timeScale = timeScale * scaleFactor;
			
			// Adjust translation to keep center over same world time position
			translateX = centerX - worldCenterTime * timeScale;
			translateY = centerY - worldY * scale;
			
			lastTouchDistance = newDistance;
			
			// Trigger crisp render after zoom
			triggerCrispRender();
		}
	}

	function handleTouchEnd() {
		isPanning = false;
		lastTouchDistance = 0;
		// Trigger crisp render after touch gesture ends
		triggerCrispRender();
	}

	function resetZoom() {
		scale = 1;
	}

	function centerView() {
		const rect = viewportRef?.getBoundingClientRect();
		if (rect) {
			translateX = rect.width / 2;
			translateY = rect.height / 2;
		}
	}

	// Update viewport dimensions
	function updateViewportDimensions() {
		if (viewportRef) {
			const rect = viewportRef.getBoundingClientRect();
			viewportWidth = rect.width;
			viewportHeight = rect.height;
		}
	}

	// Center the view initially
	onMount(() => {
		updateViewportDimensions();
		centerView();
		
		// Handle window resize
		window.addEventListener('resize', updateViewportDimensions);
		return () => {
			window.removeEventListener('resize', updateViewportDimensions);
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
		onclick={() => {
			// Only treat as click if we didn't pan significantly
			if (totalPanDelta < PAN_THRESHOLD && onCanvasClick) {
				onCanvasClick();
			}
		}}
>
	<TimelineHeader
		scale={scale}
		timeScale={timeScale}
		translateX={translateX}
		viewportWidth={viewportWidth}
		mouseX={mouseX}
		isHovering={isHovering}
		selectedCard={selectedCard}
		isAnyCardResizing={isAnyCardResizing}
		activeResizeEdge={activeResizeEdge}
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
		{@const startScreenX = Math.round(selectedCard.startX * scale + translateX)}
		{@const endScreenX = Math.round(selectedCard.endX * scale + translateX)}
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
		style="transform: translate3d({Math.round(translateX)}px, {Math.round(translateY)}px, 0) scale3d({scale}, {scale}, 1); --force-render: {forceRender};"
	>
		{@render children()}
	</div>
	
	<div class="controls">
		<div class="zoom-level">Y:{Math.round(scale * 100)}% | Time:{Math.round(timeScale * 10) / 10}</div>
		<button onclick={resetZoom}>Reset Y Zoom</button>
		<button onclick={centerView}>Center</button>
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
