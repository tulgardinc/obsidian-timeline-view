import { writable, derived, type Readable } from 'svelte/store';
import type { TFile } from 'obsidian';
import type { TimelineColor } from '../utils/LayerManager';

export interface TimelineItemBase {
	title: string;
	x: number;
	y: number;
	width: number;
	dateStart: string;
	dateEnd: string;
	layer?: number;
	color?: TimelineColor;
}

export interface NoteTimelineItem extends TimelineItemBase {
	type: 'note';
	file: TFile;
}

export interface TimelineRefItem extends TimelineItemBase {
	type: 'timeline';
	timelineId: string;
	timelineName: string;
}

export type TimelineItem = NoteTimelineItem | TimelineRefItem;

export interface CardSelection {
	index: number | null;
	startX: number;
	endX: number;
	startDate: string;
	endDate: string;
	title: string;
}

interface TimelineState {
	items: TimelineItem[];
	selectedIndex: number | null;
	selectedCard: CardSelection | null;
	timeScale: number;
	isLoading: boolean;
}

function createTimelineStore() {
	const { subscribe, set, update } = writable<TimelineState>({
		items: [],
		selectedIndex: null,
		selectedCard: null,
		timeScale: 10,
		isLoading: false
	});

	return {
		subscribe,
		
		// Actions
		setItems: (items: TimelineItem[]) => {
			update(state => ({ ...state, items }));
		},
		
		updateItem: (index: number, updates: Partial<TimelineItem>) => {
			update(state => {
				if (index < 0 || index >= state.items.length) return state;
				const newItems = [...state.items];
				const currentItem = newItems[index];
				if (!currentItem) return state;
				newItems[index] = { ...currentItem, ...updates } as TimelineItem;
				return { ...state, items: newItems };
			});
		},
		
		selectCard: (index: number | null, item?: TimelineItem) => {
			update(state => {
				if (index === null || !item) {
					return { ...state, selectedIndex: null, selectedCard: null };
				}
				
				return {
					...state,
					selectedIndex: index,
					selectedCard: {
						index,
						startX: item.x,
						endX: item.x + item.width,
						startDate: item.dateStart,
						endDate: item.dateEnd,
						title: item.title
					}
				};
			});
		},
		
		updateSelectionData: (data: Partial<CardSelection>) => {
			update(state => {
				if (!state.selectedCard) return state;
				return {
					...state,
					selectedCard: { ...state.selectedCard, ...data }
				};
			});
		},
		
		setTimeScale: (timeScale: number) => {
			update(state => ({ ...state, timeScale }));
		},
		
		setLoading: (isLoading: boolean) => {
			update(state => ({ ...state, isLoading }));
		},
		
		reset: () => {
			set({
				items: [],
				selectedIndex: null,
				selectedCard: null,
				timeScale: 10,
				isLoading: false
			});
		}
	};
}

export const timelineStore = createTimelineStore();

// Derived stores for convenience
export const selectedItem: Readable<TimelineItem | null> = derived(
	timelineStore,
	$store => $store.selectedIndex !== null ? $store.items[$store.selectedIndex] ?? null : null
);

export const itemCount: Readable<number> = derived(
	timelineStore,
	$store => $store.items.length
);
