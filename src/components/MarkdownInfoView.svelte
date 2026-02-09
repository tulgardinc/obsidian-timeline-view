<script lang="ts">
	import type { CachedMetadata, TFile } from "obsidian";

	export let file: TFile;
	export let content: string;
	export let metadata: CachedMetadata | null;

	let wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
	let lineCount = content.split("\n").length;
	let charCount = content.length;

	$: frontmatter = metadata?.frontmatter || {};
	$: tags = metadata?.tags?.map(tag => tag.tag) || [];
	$: headings = metadata?.headings || [];

	function formatDate(date: Date): string {
		return date.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}
</script>

<div class="custom-svelte-view">
	<header class="file-header">
		<h1>{file.basename}</h1>
		<div class="file-meta">
			<span class="meta-item">📄 {wordCount} words</span>
			<span class="meta-item">📊 {lineCount} lines</span>
			<span class="meta-item">📝 {charCount} chars</span>
		</div>
	</header>

	{#if Object.keys(frontmatter).length > 0}
		<section class="frontmatter-section">
			<h2>Frontmatter</h2>
			<div class="frontmatter-grid">
				{#each Object.entries(frontmatter) as [key, value]}
					<div class="frontmatter-item">
						<span class="frontmatter-key">{key}:</span>
						<span class="frontmatter-value">{value}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if tags.length > 0}
		<section class="tags-section">
			<h2>Tags</h2>
			<div class="tags-list">
				{#each tags as tag}
					<span class="tag">{tag}</span>
				{/each}
			</div>
		</section>
	{/if}

	{#if headings.length > 0}
		<section class="outline-section">
			<h2>Outline</h2>
			<ul class="outline-list">
				{#each headings as heading}
					<li class="outline-item level-{heading.level}">
						{heading.heading}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="content-section">
		<h2>Content Preview</h2>
		<div class="content-preview">
			{content.slice(0, 500)}{content.length > 500 ? "..." : ""}
		</div>
	</section>
</div>

<style>
	.custom-svelte-view {
		padding: 24px;
		max-width: 800px;
		margin: 0 auto;
		font-family: var(--font-interface);
		color: var(--text-normal);
	}

	.file-header {
		margin-bottom: 32px;
		padding-bottom: 16px;
		border-bottom: 2px solid var(--background-modifier-border);
	}

	.file-header h1 {
		margin: 0 0 12px 0;
		font-size: 2em;
		color: var(--text-normal);
	}

	.file-meta {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}

	.meta-item {
		font-size: 0.9em;
		color: var(--text-muted);
		background: var(--background-secondary);
		padding: 4px 12px;
		border-radius: 12px;
	}

	section {
		margin-bottom: 28px;
	}

	section h2 {
		font-size: 1.2em;
		margin-bottom: 12px;
		color: var(--text-normal);
		border-bottom: 1px solid var(--background-modifier-border);
		padding-bottom: 8px;
	}

	.frontmatter-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 8px;
	}

	.frontmatter-item {
		background: var(--background-primary-alt);
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.9em;
	}

	.frontmatter-key {
		font-weight: 600;
		color: var(--text-muted);
	}

	.frontmatter-value {
		color: var(--text-normal);
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.tag {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 0.85em;
	}

	.outline-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.outline-item {
		padding: 6px 0;
		border-bottom: 1px solid var(--background-modifier-border-hover);
	}

	.outline-item.level-1 { padding-left: 0; font-weight: 600; }
	.outline-item.level-2 { padding-left: 16px; }
	.outline-item.level-3 { padding-left: 32px; }
	.outline-item.level-4 { padding-left: 48px; }
	.outline-item.level-5 { padding-left: 64px; }
	.outline-item.level-6 { padding-left: 80px; }

	.content-preview {
		background: var(--background-primary-alt);
		padding: 16px;
		border-radius: 8px;
		font-family: var(--font-monospace);
		font-size: 0.9em;
		line-height: 1.6;
		white-space: pre-wrap;
		word-wrap: break-word;
		max-height: 300px;
		overflow-y: auto;
	}
</style>
