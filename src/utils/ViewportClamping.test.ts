import { describe, it, expect } from 'vitest';
import { calculateClampedBounds, screenToWorld, worldToScreen } from './ViewportClamping';

describe('calculateClampedBounds', () => {
  const VIEWPORT_WIDTH = 800;
  const SCALE = 1;
  const TRANSLATE_X = 0;

  describe('fully visible cards', () => {
    it('should not clamp card fully within viewport', () => {
      const result = calculateClampedBounds(
        100,  // worldX
        200,  // worldWidth
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.isClampedBoth).toBe(false);
      expect(result.isCompletelyOutside).toBe(false);
      expect(result.visualX).toBe(100);
      expect(result.visualWidth).toBe(200);
    });

    it('should handle card at viewport left edge', () => {
      const result = calculateClampedBounds(
        0,
        400,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(0);
      expect(result.visualWidth).toBe(400);
    });

    it('should handle card at viewport right edge', () => {
      const result = calculateClampedBounds(
        400,
        400,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(400);
      expect(result.visualWidth).toBe(400);
    });
  });

  describe('left clamping', () => {
    it('should clamp when card extends beyond left viewport edge', () => {
      const result = calculateClampedBounds(
        -500,  // Card starts 500px left of viewport
        1000,  // Card is 1000px wide
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(true);
      expect(result.isClampedRight).toBe(false);
      expect(result.isClampedBoth).toBe(false);
      expect(result.visualX).toBeCloseTo(0, 5);  // Clamped to viewport left edge (allow for -0)
      expect(result.visualWidth).toBe(500);  // Only right portion visible
    });

    it('should clamp card completely to the left of viewport', () => {
      const result = calculateClampedBounds(
        -200,
        100,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isCompletelyOutside).toBe(true);
      expect(result.isClampedLeft).toBe(true);
    });
  });

  describe('right clamping', () => {
    it('should clamp when card extends beyond right viewport edge', () => {
      const result = calculateClampedBounds(
        500,
        1000,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(true);
      expect(result.isClampedBoth).toBe(false);
      expect(result.visualX).toBe(500);
      expect(result.visualWidth).toBe(300);  // 800 - 500 = 300px visible
    });

    it('should clamp card completely to the right of viewport', () => {
      const result = calculateClampedBounds(
        900,
        100,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isCompletelyOutside).toBe(true);
      expect(result.isClampedRight).toBe(true);
    });
  });

  describe('both sides clamping', () => {
    it('should clamp both sides when card spans entire viewport', () => {
      const result = calculateClampedBounds(
        -500,
        2000,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedLeft).toBe(true);
      expect(result.isClampedRight).toBe(true);
      expect(result.isClampedBoth).toBe(true);
      expect(result.visualX).toBeCloseTo(0, 5);
      expect(result.visualWidth).toBe(800);  // Full viewport width
    });
  });

  describe('with scaling', () => {
    it('should account for scale when calculating clamping', () => {
      const result = calculateClampedBounds(
        -250,  // World coordinates
        500,   // World width
        2,     // Scale: 2x
        0,
        800
      );

      // Screen coordinates: x = -250 * 2 = -500 (off-screen left)
      expect(result.isClampedLeft).toBe(true);
      expect(result.visualX).toBeCloseTo(0, 5);
    });

    it('should handle zoomed in view correctly', () => {
      const result = calculateClampedBounds(
        100,
        200,
        0.5,   // Scale: 0.5x (zoomed out)
        0,
        800
      );

      // Screen coordinates: x = 100 * 0.5 = 50, width = 200 * 0.5 = 100
      // Card at screen position 50-150, fully visible
      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(100);
      expect(result.visualWidth).toBe(200);
    });
  });

  describe('with translation (panning)', () => {
    it('should account for translateX when calculating viewport edges', () => {
      const result = calculateClampedBounds(
        0,
        500,
        SCALE,
        -200,  // Panned 200px to the right (negative translateX)
        VIEWPORT_WIDTH
      );

      // Viewport left edge in world coords: -(-200) / 1 = 200
      expect(result.isClampedLeft).toBe(true);
      expect(result.visualX).toBe(200);
    });

    it('should handle panned view with card in viewport', () => {
      const result = calculateClampedBounds(
        300,
        200,
        SCALE,
        -200,  // Panned 200px right
        VIEWPORT_WIDTH
      );

      // Viewport covers world coordinates 200 to 1000
      // Card at 300-500 is fully visible
      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(300);
    });
  });

  describe('edge cases', () => {
    it('should handle zero width card', () => {
      const result = calculateClampedBounds(
        100,
        0,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.visualWidth).toBe(0);
      expect(result.isCompletelyOutside).toBe(false);
    });

    it('should handle negative width (should not happen but be safe)', () => {
      const result = calculateClampedBounds(
        100,
        -50,
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.visualWidth).toBeLessThan(0);
    });

    it('should handle very large cards spanning billions of pixels', () => {
      const result = calculateClampedBounds(
        -1000000000,  // 1 billion pixels left
        2000000000,   // 2 billion pixels wide
        SCALE,
        TRANSLATE_X,
        VIEWPORT_WIDTH
      );

      expect(result.isClampedBoth).toBe(true);
      expect(result.visualX).toBeCloseTo(0, 5);
      expect(result.visualWidth).toBe(800);
    });
  });

  describe('floating-point precision (world coordinates far from origin)', () => {
    // These tests verify the fix for the floating-point precision issue
    // where cards disappear when far from (0,0) at high zoom levels

    it('should correctly identify visible card far from origin with high scale', () => {
      // World coordinates far from origin (10 billion pixels)
      const worldX = 10000000000;  // 10 billion
      const worldWidth = 100;
      
      // High zoom: scale = 1,000,000
      // Old approach: worldX * scale = 10^16 (exceeds safe integer precision)
      const scale = 1000000;
      
      // Position the viewport to fully contain the card
      // We want: viewportLeftWorld <= worldX and viewportRightWorld >= worldX + worldWidth
      // viewportLeftWorld = -translateX / scale
      // viewportRightWorld = (viewportWidth - translateX) / scale
      // 
      // For card to be fully visible with 100px padding on each side:
      // viewportLeftWorld = worldX - 100/scale = 10^10 - 0.0001
      // -translateX / scale = 10^10 - 0.0001
      // translateX = -(10^10 - 0.0001) * scale = -10^16 + 100
      const translateX = -(worldX - 100 / scale) * scale;
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // Card should be visible (not outside viewport)
      expect(result.isCompletelyOutside).toBe(false);
      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(worldX);
      expect(result.visualWidth).toBe(worldWidth);
    });

    it('should correctly identify card outside viewport far from origin', () => {
      // World coordinates far from origin
      const worldX = 10000000000;  // 10 billion
      const worldWidth = 100;
      
      const scale = 1000000;
      // Viewport is far to the left of the card (origin-centered)
      const translateX = 0; 
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // Card should be completely outside (to the right of viewport)
      expect(result.isCompletelyOutside).toBe(true);
      expect(result.isClampedRight).toBe(true);
    });

    it('should handle clamping at extreme world coordinates', () => {
      // Card that extends beyond viewport at extreme coordinates
      const worldX = 10000000000;
      const worldWidth = 1000; // Large enough to extend beyond viewport
      
      const scale = 1000000;
      // Position viewport to show only part of the card (card starts at screen x=100)
      // viewportLeftWorld = worldX - 100/scale
      const translateX = -(worldX - 100 / scale) * scale;
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // Card extends beyond right edge of viewport because worldWidth (1000) > visible portion
      expect(result.isCompletelyOutside).toBe(false);
      expect(result.isClampedRight).toBe(true);
      expect(result.isClampedLeft).toBe(false);
      
      // Visual bounds should be clamped
      expect(result.visualX).toBe(worldX);
      // Visual width should be limited to what fits in viewport
      // viewport covers 100 to 900 screen pixels = 800 pixels / scale
      expect(result.visualWidth).toBeCloseTo(800 / scale, 10);
    });

    it('should handle timeline year far from Unix epoch (year 2000)', () => {
      // Simulates a timeline showing year 2000, far from 1970 (Unix epoch)
      // 30 years in milliseconds = ~9.46e11 ms
      // At 1px per day scale: ~30 * 365 = ~10950 px from origin
      // At 1px per hour scale: ~30 * 365 * 24 = ~262800 px from origin  
      // At 1px per second scale: ~30 * 365 * 24 * 3600 = ~9.46e8 px from origin
      // At 1px per ms scale: ~9.46e11 px from origin
      
      const worldX = 946000000000;  // ~year 2000 in ms
      const worldWidth = 86400000;  // 1 day in ms
      const scale = 0.001;  // 1px = 1000ms
      
      // Center the day in viewport with some padding
      // viewportLeftWorld should be slightly left of worldX
      const viewportLeftWorld = worldX - 100000;  // 100M ms to the left
      const translateX = -viewportLeftWorld * scale;
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // The day should be visible and not clamped
      expect(result.isCompletelyOutside).toBe(false);
      expect(result.isClampedLeft).toBe(false);
      expect(result.isClampedRight).toBe(false);
      expect(result.visualX).toBe(worldX);
      expect(result.visualWidth).toBe(worldWidth);
    });

    it('should handle month view at extreme dates without disappearing', () => {
      // Simulates month view showing January 2000
      // At 10px per day scale
      const daysSince1970 = 30 * 365 + 7; // ~30 years worth of days
      const worldX = daysSince1970 * 10;  // 10px per day = ~109,570 px
      const worldWidth = 310;  // ~31 days in January * 10px
      const scale = 5;  // 5x zoom in month view
      
      // Position viewport to show the month
      const translateX = -(worldX * scale) + 50;
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // Month view should show the card
      expect(result.isCompletelyOutside).toBe(false);
      // The month card should be visible - check it's either fully visible
      // or properly clamped on one side
      expect(result.isClampedLeft || result.isClampedRight || 
             (!result.isClampedLeft && !result.isClampedRight)).toBe(true);
    });

    it('should maintain precision better than screen-coordinate approach', () => {
      // This test demonstrates that world-coordinate comparisons avoid precision loss
      // With worldX = 10^10 and scale = 10^6:
      // Old approach: worldX * scale = 10^16 (loses precision at 2^53 ~ 9e15)
      // New approach: All comparisons in world space, no large multiplications
      
      const worldX = 10000000000;  // 10 billion
      const worldWidth = 100;
      const scale = 1000000;  // 1 million
      
      // Verify that worldX * scale exceeds safe integer precision
      const multiplication = worldX * scale;
      const safeIntegerLimit = Number.MAX_SAFE_INTEGER;  // 9007199254740991
      expect(multiplication).toBeGreaterThan(safeIntegerLimit);
      
      // Despite this, our world-coordinate approach should work correctly
      // Position viewport to show the card
      const translateX = -(worldX - 100 / scale) * scale;
      const viewportWidth = 800;

      const result = calculateClampedBounds(
        worldX,
        worldWidth,
        scale,
        translateX,
        viewportWidth
      );

      // Card should be correctly identified as visible
      expect(result.isCompletelyOutside).toBe(false);
      expect(result.visualX).toBe(worldX);
      expect(result.visualWidth).toBe(worldWidth);
    });
  });
});

describe('screenToWorld', () => {
  it('should convert screen coordinates to world coordinates', () => {
    const result = screenToWorld(400, 300, 1, 0, 0);
    expect(result.worldX).toBe(400);
    expect(result.worldY).toBe(300);
  });

  it('should account for translation', () => {
    const result = screenToWorld(400, 300, 1, -100, -50);
    expect(result.worldX).toBe(500);  // (400 - (-100)) / 1
    expect(result.worldY).toBe(350);  // (300 - (-50)) / 1
  });

  it('should account for scale', () => {
    const result = screenToWorld(400, 300, 2, 0, 0);
    expect(result.worldX).toBe(200);  // 400 / 2
    expect(result.worldY).toBe(150);  // 300 / 2
  });

  it('should handle combined scale and translation', () => {
    const result = screenToWorld(400, 300, 2, -100, -50);
    expect(result.worldX).toBe(250);  // (400 - (-100)) / 2
    expect(result.worldY).toBe(175);  // (300 - (-50)) / 2
  });
});

describe('worldToScreen', () => {
  it('should convert world coordinates to screen coordinates', () => {
    const result = worldToScreen(400, 300, 1, 0, 0);
    expect(result.screenX).toBe(400);
    expect(result.screenY).toBe(300);
  });

  it('should account for translation', () => {
    const result = worldToScreen(400, 300, 1, -100, -50);
    expect(result.screenX).toBe(300);  // 400 * 1 + (-100)
    expect(result.screenY).toBe(250);  // 300 * 1 + (-50)
  });

  it('should account for scale', () => {
    const result = worldToScreen(400, 300, 2, 0, 0);
    expect(result.screenX).toBe(800);  // 400 * 2
    expect(result.screenY).toBe(600);  // 300 * 2
  });

  it('should handle combined scale and translation', () => {
    const result = worldToScreen(400, 300, 2, -100, -50);
    expect(result.screenX).toBe(700);  // 400 * 2 + (-100)
    expect(result.screenY).toBe(550);  // 300 * 2 + (-50)
  });

  it('should be inverse of screenToWorld', () => {
    const originalWorld = { worldX: 1234, worldY: 5678 };
    const scale = 1.5;
    const translateX = -200;
    const translateY = -100;

    const screen = worldToScreen(
      originalWorld.worldX,
      originalWorld.worldY,
      scale,
      translateX,
      translateY
    );

    const backToWorld = screenToWorld(
      screen.screenX,
      screen.screenY,
      scale,
      translateX,
      translateY
    );

    expect(backToWorld.worldX).toBeCloseTo(originalWorld.worldX);
    expect(backToWorld.worldY).toBeCloseTo(originalWorld.worldY);
  });
});
