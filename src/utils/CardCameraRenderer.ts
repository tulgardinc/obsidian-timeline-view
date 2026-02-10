import type { ViewportState } from './CameraSystem';

export interface CardWorldData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardRenderData {
  x: number;
  y: number;
  width: number;
  visible: boolean;
  clampedLeft: boolean;
  clampedRight: boolean;
}

/**
 * CardCameraRenderer handles the transformation of card world coordinates
 * to viewport-relative render coordinates.
 * 
 * This is the key to the camera system - instead of positioning cards at their
 * absolute world coordinates (which can be in the billions), we calculate their
 * position relative to the camera/viewport. This keeps all DOM coordinates within
 * the browser's safe range (0 to ~16 million pixels).
 */
export class CardCameraRenderer {
  /**
   * Calculate render data for a card given the current viewport state
   * 
   * The algorithm:
   * 1. Calculate where the card would appear in screen coordinates
   * 2. Check if it's visible within the viewport
   * 3. Clamp edges if the card extends beyond viewport boundaries
   * 4. Return safe viewport-relative coordinates
   */
  static calculateRenderData(
    card: CardWorldData,
    viewport: ViewportState
  ): CardRenderData {
    // Handle zero scale to avoid division by zero issues
    if (viewport.scale === 0) {
      return {
        x: 0,
        y: 0,
        width: 0,
        visible: false,
        clampedLeft: false,
        clampedRight: false
      };
    }

    // Calculate screen coordinates using the standard transformation
    // screenX = worldX * scale + translateX
    const screenX = card.x * viewport.scale + viewport.translateX;
    // screenY is calculated WITHOUT translateY because cards are positioned
    // relative to the content-layer which already has translateY applied via CSS
    const screenY = card.y * viewport.scale;
    const screenWidth = card.width * viewport.scale;
    const screenRight = screenX + screenWidth;

    // Check visibility - card is visible if any part overlaps with viewport
    // and width is at least 15px (to account for borders and padding)
    // Note: card height scales with zoom to fill the grid cell
    const screenHeight = card.height * viewport.scale;
    // For visibility check, we need absolute screen position including translateY
    const absoluteScreenY = screenY + viewport.translateY;
    const isVisible = !(
      screenRight < 0 ||
      screenX > viewport.width ||
      absoluteScreenY + screenHeight < 0 ||
      absoluteScreenY > viewport.height
    ) && screenWidth >= 15;

    if (!isVisible) {
      return {
        x: screenX,
        y: screenY,
        width: screenWidth,
        visible: false,
        clampedLeft: false,
        clampedRight: false
      };
    }

    // Determine clamping
    const isClampedLeft = screenX < 0;
    const isClampedRight = screenRight > viewport.width;

    // Calculate visual bounds
    let visualX = screenX;
    let visualWidth = screenWidth;

    if (isClampedLeft && isClampedRight) {
      // Card spans entire viewport
      visualX = 0;
      visualWidth = viewport.width;
    } else if (isClampedLeft) {
      // Card extends beyond left edge
      visualX = 0;
      visualWidth = screenRight;
    } else if (isClampedRight) {
      // Card extends beyond right edge
      visualWidth = viewport.width - screenX;
    }

    return {
      x: visualX,
      y: screenY,
      width: visualWidth,
      visible: true,
      clampedLeft: isClampedLeft,
      clampedRight: isClampedRight
    };
  }

  /**
   * Batch process multiple cards for efficient rendering
   * Useful when rendering many cards at once
   */
  static calculateRenderDataBatch(
    cards: CardWorldData[],
    viewport: ViewportState
  ): CardRenderData[] {
    return cards.map(card => this.calculateRenderData(card, viewport));
  }

  /**
   * Get only the visible cards from a batch
   * Useful for filtering before rendering
   */
  static filterVisible(
    renderData: CardRenderData[]
  ): CardRenderData[] {
    return renderData.filter(data => data.visible);
  }
}
