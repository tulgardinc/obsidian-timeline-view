<script lang="ts">
	import type { TimelineItem } from "../stores/timelineStore";
	import InfiniteCanvas from "./InfiniteCanvas.svelte";
	import TimelineCard from "./TimelineCard.svelte";

	interface CardHoverData {
		startX: number;
		endX: number;
		startDate: string;
		endDate: string;
		title: string;
	}

	interface Props {
		items: TimelineItem[];
		selectedIndex?: number | null;
		selectedCard?: CardHoverData | null;
		onItemResize: (index: number, newX: number, newWidth: number) => void;
		onItemMove: (index: number, newX: number, newY: number) => void;
		onItemLayerChange: (index: number, newLayer: number, newX: number, newWidth: number) => void;
		onItemClick: (index: number) => void;
		onItemSelect: (index: number) => void;
		onUpdateSelectionData: (startX: number, endX: number, startDate: string, endDate: string) => void;
		onTimeScaleChange: (timeScale: number) => void;
		onCanvasClick?: () => void;
		// Callback to refresh items from parent
		onRefreshItems?: () => TimelineItem[];
	}

	let { items: initialItems, selectedIndex: initialSelectedIndex = null, selectedCard: initialSelectedCard = null, onItemResize, onItemMove, onItemLayerChange, onItemClick, onItemSelect, onUpdateSelectionData, onTimeScaleChange, onCanvasClick, onRefreshItems }: Props = $props();

	// Create local reactive state from props for optimistic updates during drag/resize
	let items = $state<TimelineItem[]>([...initialItems]);
	
	// Local reactive state for selection (can be updated from parent via setSelection)
	let selectedIndex = $state<number | null>(initialSelectedIndex);
	let selectedCard = $state<CardHoverData | null>(initialSelectedCard);

	// Export a function that TimelineView can call to refresh items
	export function refreshItems(newItems: TimelineItem[]) {
		items = [...newItems];
	}
	
	// Export a function that TimelineView can call to update selection
	export function setSelection(index: number | null, cardData: CardHoverData | null) {
		selectedIndex = index;
		selectedCard = cardData;
	}

	// Track if any card is being dragged or resized
	let isAnyCardDragging = $state(false);
	let isAnyCardResizing = $state(false);
	let activeResizeEdge = $state<'left' | 'right' | null>(null);

	function handleTimeScaleChange(timeScale: number) {
		// Notify parent to recalculate items with new time scale
		if (onTimeScaleChange) {
			onTimeScaleChange(timeScale);
		}
	}

	function handleCanvasClick() {
		// Call parent's onCanvasClick if provided
		if (onCanvasClick) {
			onCanvasClick();
		}
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

	function handleResizeStart(edge: 'left' | 'right') {
		isAnyCardResizing = true;
		activeResizeEdge = edge;
	}

	function handleResizeEnd() {
		isAnyCardResizing = false;
		activeResizeEdge = null;
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

	function handleDragStart() {
		isAnyCardDragging = true;
	}

	function handleDragEnd() {
		isAnyCardDragging = false;
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

<div class="timeline-view" tabindex="-1">
		<InfiniteCanvas 
			onTimeScaleChange={handleTimeScaleChange}
			selectedCard={selectedCard}
			onCanvasClick={handleCanvasClick}
			isAnyCardDragging={isAnyCardDragging}
			isAnyCardResizing={isAnyCardResizing}
			activeResizeEdge={activeResizeEdge}
		>
			{#each items as item, index (item.file.path)}
				{@const isCardSelected = selectedIndex === index}
				<TimelineCard 
					x={item.x} 
					y={item.y} 
					width={item.width}
					title={item.title}
					layer={item.layer ?? 0}
					color={item.color}
					isSelected={isCardSelected}
					onResize={(newX, newWidth, finished) => handleResize(index, newX, newWidth, finished)}
					onMove={(newX, newY, finished) => handleMove(index, newX, newY, finished)}
					onLayerChange={(newLayer, newX, newWidth, finished) => handleLayerChange(index, newLayer, newX, newWidth, finished)}
					onClick={() => onItemClick(index)}
					onSelect={() => onItemSelect(index)}
					onUpdateSelection={(startX, endX, startDate, endDate) => onUpdateSelectionData(startX, endX, startDate, endDate)}
					onDragStart={handleDragStart}
					onDragEnd={handleDragEnd}
					onResizeStart={handleResizeStart}
					onResizeEnd={handleResizeEnd}
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
