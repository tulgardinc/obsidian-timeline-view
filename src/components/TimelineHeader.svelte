<script lang="ts">
	const PIXELS_PER_DAY = 10;
	const START_DATE = new Date('1970-01-01');

	interface Props {
		scale: number;
		translateX: number;
		viewportWidth: number;
		mouseX: number | null;
		isHovering: boolean;
	}

	let { scale, translateX, viewportWidth, mouseX, isHovering }: Props = $props();

	// Calculate visible day markers with proper viewport culling
	let visibleMarkers = $derived(() => {
		const markers: Array<{ screenX: number; day: number }> = [];
		
		// Calculate the day range that could potentially be visible
		// Start from the left edge of the viewport
		const startDay = Math.floor((-translateX / scale) / PIXELS_PER_DAY);
		// End at the right edge of the viewport
		const endDay = Math.ceil(((-translateX + viewportWidth) / scale) / PIXELS_PER_DAY);
		
		for (let day = startDay; day <= endDay; day++) {
			// Calculate screen position for this marker
			const worldX = day * PIXELS_PER_DAY;
			const screenX = worldX * scale + translateX;
			
			// Cull markers that are outside the viewport
			// Allow 1px buffer on each side for partially visible markers
			if (screenX >= -1 && screenX <= viewportWidth + 1) {
				markers.push({
					screenX,
					day
				});
			}
		}
		
		return markers;
	});

	// Calculate date from mouse position
	let hoverDate = $derived(() => {
		if (mouseX === null || !isHovering) return null;
		
		// Convert mouse X to world coordinates
		const worldX = (mouseX - translateX) / scale;
		const days = Math.floor(worldX / PIXELS_PER_DAY);
		
		// Calculate date
		const date = new Date(START_DATE.getTime() + days * 24 * 60 * 60 * 1000);
		
		// Format as dd/mm/yyyy
		const day = date.getDate().toString().padStart(2, '0');
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const year = date.getFullYear();
		
		return {
			formatted: `${day}/${month}/${year}`,
			worldX,
			days
		};
	});
</script>

<div class="timeline-container">
	<div class="timeline-layer">
		<!-- Day markers - positioned individually in screen space -->
		{#each visibleMarkers() as marker (marker.day)}
			<div
				class="day-marker"
				style="left: {Math.round(marker.screenX)}px;"
			></div>
		{/each}
		
		<!-- Base horizontal line - spans the viewport width -->
		<div class="timeline-line" style="width: {viewportWidth}px;"></div>
	</div>
	
	<!-- Hover overlay (stays at mouse position) -->
	{#if isHovering && mouseX !== null}
		{@const hoverInfo = hoverDate()}
		{#if hoverInfo}
			{@const screenX = hoverInfo.worldX * scale + translateX}
			<div
				class="hover-indicator"
				style="left: {screenX}px;"
			>
				<div class="date-label">{hoverInfo.formatted}</div>
				<div class="vertical-bar"></div>
			</div>
		{/if}
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

	.day-marker {
		position: absolute;
		bottom: 0;
		width: 1px;
		height: 8px;
		background-color: var(--text-muted);
		transform: translateX(-0.5px);
	}

	.hover-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		pointer-events: none;
		z-index: 101;
	}

	.vertical-bar {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 1px;
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
</style>
