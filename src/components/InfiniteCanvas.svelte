<script lang="ts">
	import { onMount } from "svelte";
	import GridLines from "./GridLines.svelte";
	import TimelineHeader from "./TimelineHeader.svelte";

	// Transform state
	let scale = $state(1);
	let translateX = $state(0);
	let translateY = $state(0);

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

	// Touch state for pinch zoom
	let lastTouchDistance = $state(0);

	// Debounce timer for forcing crisp render after zoom
	let zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let forceRender = $state(0);

	let viewportRef: HTMLDivElement;

	interface Props {
		children: import('svelte').Snippet;
		onScaleChange?: (scale: number, translateX: number) => void;
	}

	let { children, onScaleChange }: Props = $props();

	// Notify parent of scale changes
	$effect(() => {
		if (onScaleChange) {
			onScaleChange(scale, translateX);
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

		if (event.ctrlKey || event.metaKey) {
			// Zoom
			const zoomFactor = 0.1;
			const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
			const newScale = Math.max(0.1, Math.min(5, scale * (1 + delta)));
			
			// Zoom towards mouse position
			const rect = viewportRef.getBoundingClientRect();
			const mouseX = event.clientX - rect.left;
			const mouseY = event.clientY - rect.top;
			
			// Calculate world coordinates before zoom
			const worldX = (mouseX - translateX) / scale;
			const worldY = (mouseY - translateY) / scale;
			
			// Apply new scale
			scale = newScale;
			
			// Adjust translation to keep mouse over same world point
			translateX = mouseX - worldX * scale;
			translateY = mouseY - worldY * scale;
			
			// Trigger crisp render after zoom
			triggerCrispRender();
		} else {
			// Pan
			translateX -= event.deltaX;
			translateY -= event.deltaY;
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
		
		translateX += deltaX;
		translateY += deltaY;
		
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
	}

	function handleMouseDown(event: MouseEvent) {
		if (event.button !== 0) return; // Only left click
		isPanning = true;
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
			// Pinch zoom
			const touch1 = event.touches[0];
			const touch2 = event.touches[1];
			if (!touch1 || !touch2) return;
			
			const newDistance = getTouchDistance(touch1, touch2);
			const scaleFactor = newDistance / lastTouchDistance;
			
			const rect = viewportRef.getBoundingClientRect();
			const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
			const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
			
			// Calculate world coordinates before zoom
			const worldX = (centerX - translateX) / scale;
			const worldY = (centerY - translateY) / scale;
			
			// Apply new scale
			scale = Math.max(0.1, Math.min(5, scale * scaleFactor));
			
			// Adjust translation to keep center over same world point
			translateX = centerX - worldX * scale;
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
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	ontouchcancel={handleTouchEnd}
>
	<TimelineHeader
		scale={scale}
		translateX={translateX}
		viewportWidth={viewportWidth}
		mouseX={mouseX}
		isHovering={isHovering}
	/>
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
		<div class="zoom-level">{Math.round(scale * 100)}%</div>
		<button onclick={resetZoom}>Reset Zoom</button>
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
</style>
