import { getContext, setContext } from 'svelte';

export interface ViewportContext {
	getScale: () => number;
	getTranslateX: () => number;
	getTranslateY: () => number;
	getViewportWidth: () => number;
	getViewportHeight: () => number;
	getTimeScale: () => number;
}

const VIEWPORT_CONTEXT_KEY = Symbol('viewport');

export function setViewportContext(context: ViewportContext): void {
	setContext(VIEWPORT_CONTEXT_KEY, context);
}

export function getViewportContext(): ViewportContext | undefined {
	return getContext<ViewportContext>(VIEWPORT_CONTEXT_KEY);
}
