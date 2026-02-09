<script lang="ts">
	import type { TimelineItem } from "../views/TimelineView";
	import InfiniteCanvas from "./InfiniteCanvas.svelte";
	import TimelineCard from "./TimelineCard.svelte";

	interface Props {
		items: TimelineItem[];
		onItemResize: (index: number, newX: number, newWidth: number) => void;
		onItemMove: (index: number, newX: number, newY: number) => void;
		onItemLayerChange: (index: number, newLayer: number, newX: number, newWidth: number) => void;
		onItemClick: (index: number) => void;
		// Callback to refresh items from parent
		onRefreshItems?: () => TimelineItem[];
	}

	let { items: initialItems, onItemResize, onItemMove, onItemLayerChange, onItemClick, onRefreshItems }: Props = $props();

	// Create local reactive state from props for optimistic updates during drag/resize
	let items = $state<TimelineItem[]>([...initialItems]);

	// Export a function that TimelineView can call to refresh items
	export function refreshItems(newItems: TimelineItem[]) {
		items = [...newItems];
	}

	// Track current scale and translateX from InfiniteCanvas
	let currentScale = $state(1);
	let currentTranslateX = $state(0);

	function handleScaleChange(scale: number, translateX: number) {
		currentScale = scale;
		currentTranslateX = translateX;
	}

	function handleResize(index: number, newX: number, newWidth: number, finished: boolean) {
		// Update the item optimistically by creating new object for reactivity
		if (index >= 0 && index < items.length) {
			items[index] = {
				...items[index],
				x: newX,
				width: newWidth
			};
			
			// If finished, notify parent to save
			if (finished) {
				onItemResize(index, newX, newWidth);
			}
		}
	}

	function handleMove(index: number, newX: number, newY: number, finished: boolean) {
		// Update the item optimistically by creating new object for reactivity
		if (index >= 0 && index < items.length) {
			items[index] = {
				...items[index],
				x: newX,
				y: newY
			};
			
			// If finished, notify parent to save
			if (finished) {
				onItemMove(index, newX, newY);
			}
		}
	}

	function handleLayerChange(index: number, newLayer: number, newX: number, newWidth: number, finished: boolean) {
		// Update the layer optimistically
		if (index >= 0 && index < items.length && finished) {
			const newY = -newLayer * 50; // GRID_SPACING = 50
			items[index] = {
				...items[index],
				x: newX,
				width: newWidth,
				layer: newLayer,
				y: newY
			};
			
			onItemLayerChange(index, newLayer, newX, newWidth);
		}
	}
</script>

<div class="timeline-view">
	<InfiniteCanvas onScaleChange={handleScaleChange}>
		{#each items as item, index (item.file.path)}
			<TimelineCard 
				x={item.x} 
				y={item.y} 
				width={item.width}
				title={item.title}
				scale={currentScale}
				translateX={currentTranslateX}
				layer={item.layer ?? 0}
				color={item.color}
				onResize={(newX, newWidth, finished) => handleResize(index, newX, newWidth, finished)}
				onMove={(newX, newY, finished) => handleMove(index, newX, newY, finished)}
				onLayerChange={(newLayer, newX, newWidth, finished) => handleLayerChange(index, newLayer, newX, newWidth, finished)}
				onClick={() => onItemClick(index)}
			/>
		{/each}
	</InfiniteCanvas>
</div>

<style>
	.timeline-view {
		width: 100%;
		height: 100%;
		overflow: hidden;
		position: relative;
	}
</style>
