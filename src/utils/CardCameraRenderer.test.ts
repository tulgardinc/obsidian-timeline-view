import { describe, it, expect } from 'vitest';
import { 
  CardCameraRenderer, 
  type CardWorldData,
  type CardRenderData 
} from './CardCameraRenderer';
import type { ViewportState } from './CameraSystem';

describe('CardCameraRenderer', () => {
  const VIEWPORT_WIDTH = 800;
  const VIEWPORT_HEIGHT = 600;

  describe('basic rendering without camera offset', () => {
    it('should render card at world position when viewport is at origin', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.x).toBe(100);
      expect(render.y).toBe(100);
      expect(render.width).toBe(200);
      expect(render.visible).toBe(true);
    });

    it('should apply scale to card dimensions', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 2
      };

      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.x).toBe(200); // 100 * 2
      expect(render.y).toBe(200);
      expect(render.width).toBe(400); // 200 * 2
    });
  });

  describe('camera offset handling', () => {
    it('should subtract camera offset from card position', () => {
      // Camera centered on (500, 400)
      const cameraCenterX = 500;
      const cameraCenterY = 400;
      
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -cameraCenterX + VIEWPORT_WIDTH / 2, // -500 + 400 = -100
        translateY: -cameraCenterY + VIEWPORT_HEIGHT / 2, // -400 + 300 = -100
        scale: 1
      };

      // Card at camera center should appear at viewport center
      const card: CardWorldData = {
        x: cameraCenterX,
        y: cameraCenterY,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // X should be at viewport center (includes translateX for absolute screen positioning)
      expect(render.x).toBe(VIEWPORT_WIDTH / 2);
      // Y should be the world Y scaled (relative to content-layer, not including translateY)
      // Content-layer has translateY applied via CSS, so card Y is just the scaled world position
      expect(render.y).toBe(cameraCenterY);
    });

    it('should keep coordinates in safe range for extreme positions', () => {
      // Extreme world position
      const extremeX = 10000000;
      const extremeY = 5000000;
      
      // Camera centered on extreme position
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -extremeX + 400,
        translateY: -extremeY + 300,
        scale: 1
      };

      const card: CardWorldData = {
        x: extremeX,
        y: extremeY,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // X should be at viewport center (includes translateX for absolute positioning)
      expect(render.x).toBe(400);
      // Y should be the scaled world position (relative to content-layer, not including translateY)
      expect(render.y).toBe(extremeY);
      expect(render.x).toBeGreaterThanOrEqual(0);
      expect(render.x).toBeLessThan(VIEWPORT_WIDTH);
    });

    it('should handle zoom at extreme positions', () => {
      const extremeX = 10000000;
      
      // Camera centered on extreme position with high zoom
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -extremeX * 10 + 400, // Account for scale
        translateY: 0,
        scale: 10 // High zoom
      };

      const card: CardWorldData = {
        x: extremeX,
        y: 100,
        width: 50,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // Even with extreme position and high zoom, should be at viewport center
      expect(render.x).toBe(400);
      expect(render.y).toBe(1000); // 100 * 10
      expect(render.width).toBe(500); // 50 * 10
      
      // All coordinates should be within safe browser range
      expect(Math.abs(render.x)).toBeLessThan(1000000);
      expect(Math.abs(render.y)).toBeLessThan(1000000);
    });
  });

  describe('visibility culling', () => {
    it('should mark cards outside viewport as not visible', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      // Card far outside viewport
      const card: CardWorldData = {
        x: 10000,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.visible).toBe(false);
    });

    it('should mark cards inside viewport as visible', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      // Card inside viewport
      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.visible).toBe(true);
    });

    it('should handle partially visible cards at edges', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      // Card partially off right edge
      const card: CardWorldData = {
        x: 700,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.visible).toBe(true);
      // Should clamp to viewport
      expect(render.clampedRight).toBe(true);
    });
  });

  describe('clamping at edges', () => {
    it('should clamp card extending beyond left edge', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -100, // Panned right by 100
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: -50,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // Card at worldX=-50 with translateX=-100:
      // screenX = -50 + (-100) = -150
      // screenRight = -150 + 200 = 50
      // Visible: 0 to 50 = 50 pixels
      expect(render.clampedLeft).toBe(true);
      expect(render.x).toBe(0); // Clamped to left edge
      expect(render.width).toBe(50); // Only portion from 0 to 50 is visible
    });

    it('should clamp card extending beyond right edge', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: 700,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.clampedRight).toBe(true);
      expect(render.x).toBe(700);
      expect(render.width).toBe(100); // Only 100px visible (800 - 700)
    });

    it('should clamp both sides when card spans entire viewport', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -100,
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: -200,
        y: 100,
        width: 1200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.clampedLeft).toBe(true);
      expect(render.clampedRight).toBe(true);
      expect(render.x).toBe(0);
      expect(render.width).toBe(VIEWPORT_WIDTH);
    });
  });

  describe('extreme coordinate scenarios', () => {
    it('should handle the billion-year timeline scenario', () => {
      // Timeline spanning billions of years BCE to present
      // Let's say we're viewing 1 billion years BCE (represented as -365 billion days)
      const billionYearsDays = 365000000000; // ~1 billion years in days
      const viewportCenterX = -billionYearsDays; // 1B years ago
      
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -viewportCenterX * 0.1 + 400, // At timeScale=0.1
        translateY: 0,
        scale: 0.1 // Zoomed out to see large time spans
      };

      // Card at 1 billion years ago
      const card: CardWorldData = {
        x: viewportCenterX,
        y: 0,
        width: 1000, // 1000 days wide
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // Should be visible at viewport center, not at extreme coordinate
      expect(render.visible).toBe(true);
      expect(render.x).toBeCloseTo(400, 0);
      expect(Math.abs(render.x)).toBeLessThan(VIEWPORT_WIDTH);
    });

    it('should handle high zoom at extreme coordinates', () => {
      // Month-level zoom at 100 million years BCE
      const millionYearsDays = 36500000000;
      const viewportCenterX = -millionYearsDays;
      
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -viewportCenterX * 10 + 400, // High zoom (scale=10)
        translateY: 0,
        scale: 10
      };

      const card: CardWorldData = {
        x: viewportCenterX,
        y: 0,
        width: 30, // 30 days
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // Should still be visible within viewport
      expect(render.visible).toBe(true);
      expect(render.x).toBeCloseTo(400, 0);
      expect(render.width).toBe(300); // 30 * 10
    });

    it('should prevent coordinate overflow at browser limits', () => {
      // The critical test: coordinates that would overflow 16M limit
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: -16000000 + 400, // At browser limit
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: 16000000, // At 16M boundary
        y: 0,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      // Should still be at safe viewport coordinate
      expect(render.x).toBe(400);
      expect(render.x).toBeLessThan(16000000); // Well under browser limit
    });
  });

  describe('edge cases', () => {
    it('should handle zero width card', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 1
      };

      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 0,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.width).toBe(0);
      expect(render.visible).toBe(false); // Cards with width < 15px are not visible
    });

    it('should handle zero scale', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: 0
      };

      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.x).toBe(0);
      expect(render.y).toBe(0);
      expect(render.width).toBe(0);
    });

    it('should handle negative scale', () => {
      const viewport: ViewportState = {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        translateX: 0,
        translateY: 0,
        scale: -1
      };

      const card: CardWorldData = {
        x: 100,
        y: 100,
        width: 200,
        height: 50
      };

      const render = CardCameraRenderer.calculateRenderData(card, viewport);
      
      expect(render.x).toBe(-100);
      expect(render.y).toBe(-100);
      expect(render.width).toBe(-200); // Negative width (flipped)
    });
  });
});
