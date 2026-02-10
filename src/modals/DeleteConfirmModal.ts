import { Modal, App, TFile, Notice } from "obsidian";

export type DeleteAction = 'remove-from-timeline' | 'move-to-trash' | 'cancel';

export class DeleteConfirmModal extends Modal {
	private file: TFile;
	private onAction: (action: DeleteAction) => void;

	constructor(app: App, file: TFile, onAction: (action: DeleteAction) => void) {
		super(app);
		this.file = file;
		this.onAction = onAction;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.empty();
		contentEl.addClass('delete-confirm-modal');

		// Title
		contentEl.createEl('h2', { text: `Delete "${this.file.basename}"?` });

		// Description
		contentEl.createEl('p', { 
			text: 'Choose what to do with this timeline card:' 
		});

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
