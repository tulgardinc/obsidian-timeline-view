// Type declarations for undocumented Obsidian APIs
// These are internal APIs that work but aren't officially supported

import "obsidian";

declare module "obsidian" {
  interface MenuItem {
    /**
     * Undocumented/internal API for creating submenus
     * @returns A new Menu instance for the submenu
     */
    setSubmenu(): Menu;
    
    /**
     * Internal DOM element reference
     */
    dom?: HTMLElement;
  }
}
