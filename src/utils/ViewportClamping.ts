export interface ClampedBounds {
	visualX: number;
	visualWidth: number;
	isClampedLeft: boolean;
	isClampedRight: boolean;
	isClampedBoth: boolean;
	isCompletelyOutside: boolean;
}

/**
 * Calculate viewport-clamped bounds for timeline cards.
 * When cards extend beyond the viewport edges, they are visually clamped
 * while maintaining their actual world coordinates for interactions.
 * 
 * This implementation performs all visibility checks in world coordinates
 * to avoid floating-point precision loss when worldX is large and scale is high.
 * The key insight is that converting viewport bounds to world space (division)
 * is more numerically stable than converting card bounds to screen space (multiplication).
 */
export function calculateClampedBounds(
	worldX: number,
	worldWidth: number,
	scale: number,
	translateX: number,
	viewportWidth: number
): ClampedBounds {
	// Viewport edges in world coordinates
	// Derived from: screenX = worldX * scale + translateX
	// Solving for worldX when screenX = 0 (left edge):
	//   0 = worldX * scale + translateX
	//   worldX = -translateX / scale
	const viewportLeftWorld = -translateX / scale;
	
	// Solving for worldX when screenX = viewportWidth (right edge):
	//   viewportWidth = worldX * scale + translateX
	//   worldX = (viewportWidth - translateX) / scale
	const viewportRightWorld = (viewportWidth - translateX) / scale;

	// Card boundaries
	const cardLeft = worldX;
	const cardRight = worldX + worldWidth;

	// Visibility checks in WORLD coordinates (avoids large multiplications)
	// A card is clamped on the left if its left edge is left of the viewport's left edge
	const isClampedLeft = cardLeft < viewportLeftWorld;
	
	// A card is clamped on the right if its right edge is right of the viewport's right edge
	const isClampedRight = cardRight > viewportRightWorld;
	
	// A card is clamped on both sides if it spans the entire viewport
	const isClampedBoth = isClampedLeft && isClampedRight;

	// A card is completely outside if it's entirely to the left or right of the viewport
	// This check is crucial for culling - it determines if the card should be rendered at all
	const isCompletelyOutside = cardRight < viewportLeftWorld || cardLeft > viewportRightWorld;

	// Calculate visual bounds in WORLD coordinates (what we actually render)
	// These are the portions of the card that fall within the viewport
	let visualX: number;
	let visualWidth: number;

	if (isCompletelyOutside) {
		// Card is not visible at all - still return valid (though empty) bounds
		// to prevent downstream errors. The caller should check isCompletelyOutside
		// and skip rendering when true.
		visualX = worldX;
		visualWidth = 0;
	} else if (isClampedBoth) {
		// Card spans entire viewport - visual bounds are the viewport itself
		visualX = viewportLeftWorld;
		visualWidth = viewportRightWorld - viewportLeftWorld;
	} else if (isClampedRight) {
		// Card extends beyond right edge - clamp to viewport right
		visualX = worldX;
		visualWidth = viewportRightWorld - worldX;
	} else if (isClampedLeft) {
		// Card extends beyond left edge - clamp to viewport left
		visualX = viewportLeftWorld;
		visualWidth = cardRight - viewportLeftWorld;
	} else {
		// Card fully visible - use original bounds
		visualX = worldX;
		visualWidth = worldWidth;
	}

	return {
		visualX,
		visualWidth,
		isClampedLeft,
		isClampedRight,
		isClampedBoth,
		isCompletelyOutside
	};
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(
	screenX: number,
	screenY: number,
	scale: number,
	translateX: number,
	translateY: number
): { worldX: number; worldY: number } {
	return {
		worldX: (screenX - translateX) / scale,
		worldY: (screenY - translateY) / scale
	};
}

/**
 * Convert world coordinates to screen coordinates
 * 
 * Note: This function may suffer from floating-point precision loss
 * when worldX is very large and scale is high. Use sparingly for
 * coordinate conversion, and prefer world-coordinate calculations
 * for visibility/clamping logic.
 */
export function worldToScreen(
	worldX: number,
	worldY: number,
	scale: number,
	translateX: number,
	translateY: number
): { screenX: number; screenY: number } {
	return {
		screenX: worldX * scale + translateX,
		screenY: worldY * scale + translateY
	};
}
