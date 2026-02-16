import { App, type FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";

/**
 * Modal for picking a Lucide icon from the full set available in Obsidian.
 * Uses FuzzySuggestModal for built-in fuzzy search.
 */
export class IconPickerModal extends FuzzySuggestModal<string> {
	private icons: string[];
	private onSelect: (iconId: string) => void;

	constructor(app: App, onSelect: (iconId: string) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Search for an icon...");

		// Get all available icon IDs and strip the "lucide-" prefix for display
		this.icons = getIconIds()
			.filter(id => id.startsWith("lucide-"))
			.map(id => id.slice(7));
	}

	getItems(): string[] {
		return this.icons;
	}

	getItemText(iconId: string): string {
		return iconId;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		super.renderSuggestion(match, el);

		// Prepend an icon preview before the text
		const iconEl = el.createDiv({ cls: "suggestion-icon" });
		setIcon(iconEl, match.item);
		el.prepend(iconEl);
	}

	onChooseItem(iconId: string, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(iconId);
	}
}
