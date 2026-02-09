import type { App, TFile } from 'obsidian';
import { LayerManager, type LayerAssignment, type LayerableItem } from '../utils/LayerManager';
import { TimeScaleManager } from '../utils/TimeScaleManager';
import { TimelineDate } from '../utils/TimelineDate';
import type { TimelineItem } from '../stores/timelineStore';

export interface FileServiceDependencies {
	app: App;
	timeScale: number;
}

export class FileService {
	private app: App;
	private timeScale: number;

	constructor(deps: FileServiceDependencies) {
		this.app = deps.app;
		this.timeScale = deps.timeScale;
	}

	setTimeScale(timeScale: number): void {
		this.timeScale = timeScale;
	}

	/**
	 * Collect all timeline items from markdown files
	 */
	async collectTimelineItems(): Promise<TimelineItem[]> {
		const layerableItems: LayerableItem[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();

		for (const file of allFiles) {
			const metadata = this.app.metadataCache.getFileCache(file);

			if (metadata?.frontmatter?.timeline !== true) {
				continue;
			}

			const dateStartRaw = metadata.frontmatter['date-start'];
			const dateEndRaw = metadata.frontmatter['date-end'];

			if (!dateStartRaw || !dateEndRaw) {
				console.log(`Timeline: Skipping ${file.basename} - missing date-start or date-end`);
				continue;
			}

			const dateStart = TimelineDate.fromString(String(dateStartRaw));
			const dateEnd = TimelineDate.fromString(String(dateEndRaw));

			if (!dateStart || !dateEnd) {
				console.log(`Timeline: Skipping ${file.basename} - invalid date format`);
				continue;
			}

			const layerRaw = metadata.frontmatter['layer'];
			const frontmatterLayer = layerRaw !== undefined ? parseInt(String(layerRaw), 10) : undefined;

			const colorRaw = metadata.frontmatter['color'];
			const validColors = ['red', 'blue', 'green', 'yellow'] as const;
			const color = validColors.includes(colorRaw) ? colorRaw : undefined;

			layerableItems.push({
				file,
				dateStart,
				dateEnd,
				frontmatterLayer: !isNaN(frontmatterLayer ?? NaN) ? frontmatterLayer : undefined,
				color
			});
		}

		const sortedItems = LayerManager.sortByDate(layerableItems);
		const layerAssignments = LayerManager.assignLayers(sortedItems);

		if (layerAssignments.length > 0) {
			await this.batchUpdateLayers(layerAssignments);
		}

		return this.convertToTimelineItems(sortedItems);
	}

	/**
	 * Update file with new layer assignments
	 */
	async batchUpdateLayers(assignments: LayerAssignment[]): Promise<void> {
		for (const assignment of assignments) {
			try {
				const content = await this.app.vault.read(assignment.file);
				const layerRegex = /^layer:\s*\S+/m;
				let newContent: string;

				if (layerRegex.test(content)) {
					newContent = content.replace(layerRegex, `layer: ${assignment.layer}`);
				} else {
					newContent = content.replace(
						/(timeline:\s*true.*\n)/,
						`$1layer: ${assignment.layer}\n`
					);
				}

				await this.app.vault.modify(assignment.file, newContent);
			} catch (error) {
				console.error(`Timeline: Failed to update layer for ${assignment.file.basename}:`, error);
			}
		}
	}

	/**
	 * Update file dates
	 */
	async updateFileDates(file: TFile, dateStart: string, dateEnd: string): Promise<void> {
		const content = await this.app.vault.read(file);
		const newContent = content
			.replace(/date-start:\s*\S+/, `date-start: ${dateStart}`)
			.replace(/date-end:\s*\S+/, `date-end: ${dateEnd}`);
		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Update file layer
	 */
	async updateFileLayer(file: TFile, layer: number, dateStart?: string, dateEnd?: string): Promise<void> {
		let content = await this.app.vault.read(file);

		// Update layer
		const layerRegex = /^layer:\s*\S+/m;
		if (layerRegex.test(content)) {
			content = content.replace(layerRegex, `layer: ${layer}`);
		} else {
			content = content.replace(
				/(timeline:\s*true.*\n)/,
				`$1layer: ${layer}\n`
			);
		}

		// Update dates if provided
		if (dateStart) {
			content = content.replace(/date-start:\s*\S+/, `date-start: ${dateStart}`);
		}
		if (dateEnd) {
			content = content.replace(/date-end:\s*\S+/, `date-end: ${dateEnd}`);
		}

		await this.app.vault.modify(file, content);
	}

	/**
	 * Convert LayerableItems to TimelineItems with positions
	 */
	private convertToTimelineItems(items: LayerableItem[]): TimelineItem[] {
		return items.map(item => {
			const daysFromStart = item.dateStart.getDaysFromEpoch();
			const x = TimeScaleManager.dayToWorldX(daysFromStart, this.timeScale);

			const duration = item.dateEnd.getDaysFromEpoch() - item.dateStart.getDaysFromEpoch();
			const width = Math.max(duration, 1) * this.timeScale;

			const layer = item.layer ?? 0;
			const y = LayerManager.layerToY(layer);

			return {
				file: item.file,
				title: item.file.basename,
				x,
				y,
				width,
				dateStart: item.dateStart.toISOString(),
				dateEnd: item.dateEnd.toISOString(),
				layer,
				color: item.color
			};
		});
	}
}
