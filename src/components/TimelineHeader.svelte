<script lang="ts">
	import { TimeScaleManager, type ScaleLevel } from "../utils/TimeScaleManager";

	interface CardHoverData {
		startX: number;
		endX: number;
		startDate: string;
		endDate: string;
		title: string;
	}

	interface Props {
		scale: number;
		timeScale: number;
		translateX: number;
		viewportWidth: number;
		mouseX: number | null;
		isHovering: boolean;
		selectedCard?: CardHoverData | null;
		isAnyCardResizing?: boolean;
		activeResizeEdge?: 'left' | 'right' | null;
	}

	let { 
		scale, 
		timeScale, 
		translateX, 
		viewportWidth, 
		mouseX, 
		isHovering, 
		selectedCard = null, 
		isAnyCardResizing = false, 
		activeResizeEdge = null 
	}: Props = $props();

	// Calculate current scale level based on effective density (timeScale * scale)
	let scaleLevel = $derived(() => {
		return TimeScaleManager.getScaleLevel(timeScale, scale);
	});

	// Calculate visible markers using the scale manager
	let visibleMarkers = $derived(() => {
		const level = scaleLevel();
		return TimeScaleManager.getVisibleMarkers(
			level,
			timeScale,
			scale,
			translateX,
			viewportWidth
		);
	});

	// Calculate hover date/position info using unified coordinate functions
	let hoverInfo = $derived(() => {
		if (mouseX === null || !isHovering) return null;
		
		const level = scaleLevel();
		// Use unified screen->day conversion (floored for hover display)
		const day = Math.floor(TimeScaleManager.screenToDay(mouseX, timeScale, scale, translateX));
		
		return {
			day,
			formatted: TimeScaleManager.formatDateForLevel(day, level),
			screenX: mouseX
		};
	});
</script>

<div class="timeline-container">
	<div class="timeline-layer">
		<!-- Dynamic markers based on scale level -->
		{#each visibleMarkers() as marker (marker.unitIndex)}
			<div
				class="time-marker"
				class:large={marker.isLarge}
				style="left: {Math.round(marker.screenX)}px;"
			></div>
		{/each}
		
		<!-- Base horizontal line - spans the viewport width -->
		<div class="timeline-line" style="width: {viewportWidth}px;"></div>
	</div>
	
	<!-- Hover overlay (stays at mouse position) - hidden when resizing -->
	{#if isHovering && mouseX !== null && !isAnyCardResizing}
		{@const info = hoverInfo()}
		{#if info}
			<div
				class="hover-indicator"
				style="left: {info.screenX}px;"
			>
				<div class="date-label">{info.formatted}</div>
				<div class="vertical-bar"></div>
			</div>
		{/if}
	{/if}
	
	<!-- Card boundary lines (when a card is selected) -->
	{#if selectedCard !== null}
		{@const startScreenX = Math.round(selectedCard.startX * scale + translateX)}
		{@const endScreenX = Math.round(selectedCard.endX * scale + translateX)}
		<div
			class="card-boundary-line start"
			class:active={activeResizeEdge === 'left'}
			style="left: {startScreenX}px;"
		>
			<div class="date-label">{selectedCard.startDate}</div>
			<div class="vertical-bar"></div>
		</div>
		<div
			class="card-boundary-line end"
			class:active={activeResizeEdge === 'right'}
			style="left: {endScreenX}px;"
		>
			<div class="date-label">{selectedCard.endDate}</div>
			<div class="vertical-bar"></div>
		</div>
	{/if}
</div>

<style>
	.timeline-container {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 40px;
		background: var(--background-primary);
		border-bottom: 1px solid var(--background-modifier-border);
		z-index: 100;
		overflow: hidden;
	}

	.timeline-layer {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}

	.timeline-line {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 1px;
		background-color: var(--text-muted);
	}

	/* Base marker style */
	.time-marker {
		position: absolute;
		bottom: 0;
		width: 1px;
		height: 8px;
		background-color: var(--text-muted);
		transform: translateX(-0.5px);
	}

	/* Large marker style (Mondays, month starts, year starts, etc.) */
	.time-marker.large {
		width: 2px;
		height: 12px;
		background-color: var(--text-normal);
		transform: translateX(-1px);
	}

	.hover-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		pointer-events: none;
		z-index: 101;
		transform: translateX(-1px);
	}

	.vertical-bar {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 2px;
		background-color: var(--interactive-accent);
		opacity: 0.8;
	}

	.date-label {
		position: absolute;
		top: 4px;
		left: 4px;
		background: var(--background-secondary);
		color: var(--text-normal);
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 11px;
		font-family: var(--font-monospace);
		white-space: nowrap;
		border: 1px solid var(--background-modifier-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.card-boundary-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		pointer-events: none;
		z-index: 102;
		transform: translateX(-1px);
	}

	.card-boundary-line .vertical-bar {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 2px;
		background-color: var(--text-muted);
		opacity: 0.9;
	}

	.card-boundary-line .date-label {
		background: var(--background-secondary);
		color: var(--text-normal);
		border-color: var(--text-muted);
	}

	/* Start date: position label to the LEFT of the line */
	.card-boundary-line.start .date-label {
		left: auto;
		right: 8px;
	}

	/* End date: position label to the RIGHT of the line */
	.card-boundary-line.end .date-label {
		left: 8px;
		right: auto;
	}

	/* Active state - accent color for the edge being resized */
	.card-boundary-line.active .vertical-bar {
		background-color: var(--interactive-accent);
		opacity: 1;
	}

	.card-boundary-line.active .date-label {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border-color: var(--interactive-accent);
	}
</style>
