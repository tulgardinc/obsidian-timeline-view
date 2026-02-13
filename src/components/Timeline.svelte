<script lang="ts">
	import type { TFile } from "obsidian";
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
		selectedIndices?: Set<number>;
		activeIndex?: number | null;
		selectedCard?: CardHoverData | null;
		timelineName?: string;
		onItemResize: (index: number, edge: 'left' | 'right', deltaX: number) => void;
		onItemMove: (index: number, deltaX: number, deltaY: number) => void;
		onItemLayerChange: (index: number, newLayer: number, newX: number, newWidth: number) => void;
		onItemClick: (index: number, event: MouseEvent) => void;
		onItemSelect: (index: number) => void;
		onUpdateSelectionData: (startX: number, endX: number, startDate: string, endDate: string) => void;
		onTimeScaleChange: (timeScale: number) => void;
		onCanvasClick?: () => void;
		// Callback to refresh items from parent
		onRefreshItems?: () => TimelineItem[];
		// Callback for context menu - parent uses Obsidian Menu API
		onItemContextMenu?: (index: number, event: MouseEvent) => void;
		// Viewport persistence
		initialViewport?: { centerX: number; centerY: number; timeScale: number; scale?: number } | null;
		onViewportChange?: () => void;
	}

	let { items: initialItems, selectedIndices: initialSelectedIndices = new Set(), activeIndex: initialActiveIndex = null, selectedCard: initialSelectedCard = null, timelineName = "Timeline", onItemResize, onItemMove, onItemLayerChange, onItemClick, onItemSelect, onUpdateSelectionData, onTimeScaleChange, onCanvasClick, onRefreshItems, onItemContextMenu, initialViewport = null, onViewportChange }: Props = $props();

	// Create local reactive state from props for optimistic updates during drag/resize
	let items = $state<TimelineItem[]>([...initialItems]);
	
	// Local reactive state for multi-selection (can be updated from parent via setSelection)
	let selectedIndices = $state<Set<number>>(new Set(initialSelectedIndices));
	let activeIndex = $state<number | null>(initialActiveIndex);
	let selectedCard = $state<CardHoverData | null>(initialSelectedCard);

	// Export a function that TimelineView can call to refresh items
	export function refreshItems(newItems: TimelineItem[]) {
		items = [...newItems];
	}
	
	// Export a function that TimelineView can call to update selection
	export function setSelection(newSelectedIndices: Set<number>, newActiveIndex: number | null, cardData: CardHoverData | null) {
		selectedIndices = new Set(newSelectedIndices);
		activeIndex = newActiveIndex;
		selectedCard = cardData;
	}

	// Export a function to center the viewport on a specific item
	export function centerOnItem(index: number) {
		if (index >= 0 && index < items.length) {
			const item = items[index];
			if (item && infiniteCanvasRef) {
				// Center on the middle of the card
				infiniteCanvasRef.centerOn(item.x + item.width / 2, item.y);
			}
		}
	}

	// Export a function to get the center time (days from epoch)
	export function getCenterTime(): number | null {
		return infiniteCanvasRef?.getCenterTime() ?? null;
	}

	// Export a function to center on a specific time (days from epoch)
	export function centerOnTime(days: number) {
		infiniteCanvasRef?.centerOnTime(days);
	}

	// Export a function to fit a card width to the viewport (edge-to-edge)
	export function fitCardWidth(cardStartX: number, cardWidth: number) {
		infiniteCanvasRef?.fitCardWidth(cardStartX, cardWidth);
	}

	// Export function to get current viewport state
	export function getViewport(): { centerX: number; centerY: number; timeScale: number } | null {
		return infiniteCanvasRef?.getViewport() ?? null;
	}

	// Export function to set viewport state
	export function setViewport(viewport: { centerX: number; centerY: number; timeScale: number }) {
		infiniteCanvasRef?.setViewport(viewport);
	}

	// Track if any card is being dragged or resized
	let isAnyCardDragging = $state(false);
	let isAnyCardResizing = $state(false);
	let activeResizeEdge = $state<'left' | 'right' | null>(null);

	// Reference to InfiniteCanvas for viewport control
	let infiniteCanvasRef: InfiniteCanvas;

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

	function handleResize(index: number, edge: 'left' | 'right', deltaX: number, finished: boolean) {
		// Get the item being resized
		if (index < 0 || index >= items.length) return;
		
		const item = items[index];
		if (!item) return;
		
		// Calculate new position and size based on edge
		let newX = item.x;
		let newWidth = item.width;
		
		if (edge === 'left') {
			newX = item.x + deltaX;
			newWidth = item.width - deltaX;
		} else {
			newWidth = item.width + deltaX;
		}
		
		// Update the item optimistically by creating new object for reactivity
		items[index] = {
			...item,
			x: newX,
			width: newWidth
		};
		
		// If finished, notify parent with the delta for multi-select support
		if (finished) {
			onItemResize(index, edge, deltaX);
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

	function handleMove(index: number, deltaX: number, deltaY: number, finished: boolean) {
		// Get the item being moved
		if (index < 0 || index >= items.length) return;
		
		const item = items[index];
		if (!item) return;
		
		// Calculate new position
		const newX = item.x + deltaX;
		const newY = item.y + deltaY;
		
		// Update the item optimistically by creating new object for reactivity
		items[index] = {
			...item,
			x: newX,
			y: newY
		};
		
		// If finished, notify parent with the delta for multi-select support
		if (finished) {
			onItemMove(index, deltaX, deltaY);
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

	/**
	 * Handle context menu on card
	 * Passes event to parent which uses Obsidian Menu API
	 */
	function handleContextMenu(index: number, event: MouseEvent) {
		onItemContextMenu?.(index, event);
	}
</script>

<div class="timeline-view" tabindex="-1">
		<InfiniteCanvas
			bind:this={infiniteCanvasRef}
			onTimeScaleChange={handleTimeScaleChange}
			selectedCard={selectedCard}
			onCanvasClick={handleCanvasClick}
			isAnyCardDragging={isAnyCardDragging}
			isAnyCardResizing={isAnyCardResizing}
			activeResizeEdge={activeResizeEdge}
			initialViewport={initialViewport}
			onViewportChanged={onViewportChange}
			timelineName={timelineName}
		>
		{#each items as item, index (item.file.path)}
			{@const isCardSelected = selectedIndices.has(index)}
			<TimelineCard 
				x={item.x} 
				y={item.y} 
				width={item.width}
				title={item.title}
				layer={item.layer ?? 0}
				color={item.color}
				isSelected={isCardSelected}
				onResize={(edge, deltaX, finished) => handleResize(index, edge, deltaX, finished)}
				onMove={(deltaX, deltaY, finished) => handleMove(index, deltaX, deltaY, finished)}
				onLayerChange={(newLayer, newX, newWidth, finished) => handleLayerChange(index, newLayer, newX, newWidth, finished)}
				onClick={(event) => onItemClick(index, event)}
				onSelect={() => onItemSelect(index)}
				onUpdateSelection={(startX, endX, startDate, endDate) => onUpdateSelectionData(startX, endX, startDate, endDate)}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				onResizeStart={handleResizeStart}
				onResizeEnd={handleResizeEnd}
				onContextMenu={(event) => handleContextMenu(index, event)}
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
