import { Modal, App, TFile, Notice } from "obsidian";

export type DeleteAction = 'remove-from-timeline' | 'move-to-trash' | 'cancel';

export class DeleteConfirmModal extends Modal {
	private file: TFile;
	private onAction: (action: DeleteAction) => void;
	private customTitle?: string;
	private itemCount?: number;

	constructor(app: App, file: TFile, onAction: (action: DeleteAction) => void, customTitle?: string, itemCount?: number) {
		super(app);
		this.file = file;
		this.onAction = onAction;
		this.customTitle = customTitle;
		this.itemCount = itemCount;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.empty();
		contentEl.addClass('delete-confirm-modal');

		// Title
		const count = this.itemCount ?? 1;
		const title = this.customTitle ?? (count > 1 
			? `Delete ${count} cards?`
			: `Delete "${this.file.basename}"?`);
		contentEl.createEl('h2', { text: title });

		// Description
		const descriptionText = count > 1
			? `Choose what to do with these ${count} timeline cards:`
			: 'Choose what to do with this timeline card:';
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

		// Move to trash button (warning)
		const trashBtn = buttonContainer.createEl('button', {
			text: 'Remove and move to trash',
			cls: 'mod-warning'
		});
		trashBtn.addEventListener('click', () => {
			this.onAction('move-to-trash');
			this.close();
		});

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
