import { Modal, App, TFile } from "obsidian";

export type DeleteAction = 'remove-from-timeline' | 'move-to-trash' | 'cancel';

export class DeleteConfirmModal extends Modal {
	private file: TFile | null;
	private onAction: (action: DeleteAction) => void;
	private customTitle?: string;
	private customDescription?: string;
	private itemCount?: number;
	private showTrashOption: boolean;

	constructor(
		app: App, 
		file: TFile | null, 
		onAction: (action: DeleteAction) => void, 
		customTitle?: string, 
		itemCount?: number,
		customDescription?: string,
		showTrashOption: boolean = true
	) {
		super(app);
		this.file = file;
		this.onAction = onAction;
		this.customTitle = customTitle;
		this.itemCount = itemCount;
		this.customDescription = customDescription;
		this.showTrashOption = showTrashOption;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.empty();
		contentEl.addClass('delete-confirm-modal');

		// Title
		const count = this.itemCount ?? 1;
		let title: string;
		if (this.customTitle) {
			title = this.customTitle;
		} else if (count > 1) {
			title = `Delete ${count} cards?`;
		} else if (this.file) {
			title = `Delete "${this.file.basename}"?`;
		} else {
			title = 'Remove from view?';
		}
		contentEl.createEl('h2', { text: title });

		// Description
		let descriptionText: string;
		if (this.customDescription) {
			descriptionText = this.customDescription;
		} else if (count > 1) {
			descriptionText = `Choose what to do with these ${count} timeline cards:`;
		} else {
			descriptionText = 'Choose what to do with this timeline card:';
		}
		contentEl.createEl('p', { text: descriptionText });

		// Button container
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		// Remove from timeline button (primary)
		const removeBtn = buttonContainer.createEl('button', {
			text: 'Remove from timeline',
			cls: 'mod-cta'
		});
		removeBtn.addEventListener('click', () => {
			this.onAction('remove-from-timeline');
			this.close();
		});

		// Move to trash button (warning) - only if showing trash option
		if (this.showTrashOption) {
			const trashBtn = buttonContainer.createEl('button', {
				text: 'Remove and move to trash',
				cls: 'mod-warning'
			});
			trashBtn.addEventListener('click', () => {
				this.onAction('move-to-trash');
				this.close();
			});
		}

		// Cancel button
		const cancelBtn = buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		cancelBtn.addEventListener('click', () => {
			this.onAction('cancel');
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
