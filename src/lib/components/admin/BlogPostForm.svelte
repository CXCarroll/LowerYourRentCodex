<script lang="ts">
	// Shared blog-post form used by /admin/blog/new and /admin/blog/[id]/edit.
	// Renders identical fields in both modes; the parent decides which form
	// actions are wired up and which submit buttons to show.

	import { untrack } from 'svelte';
	import { slugify } from '$lib/shared/slugify';

	type Status = 'draft' | 'published';

	interface Props {
		post: {
			id?: string;
			title: string;
			slug: string;
			excerpt: string;
			coverImageUrl: string;
			content: string;
			status: Status;
		};
		mode: 'new' | 'edit';
		/** Optional error message rendered above the form. */
		errorMessage?: string | null;
		/** Whether to render an inline "Saved" banner after a successful action. */
		savedFlash?: boolean;
	}

	let { post, mode, errorMessage = null, savedFlash = false }: Props = $props();

	// Local form state — initialized once from the prop. Using `untrack` makes
	// the one-shot capture explicit so Svelte doesn't warn about referencing
	// reactive props in a state initializer. The parent re-renders the page
	// (with new props) after a save round-trip, so a one-shot init is correct.
	let title = $state(untrack(() => post.title));
	let slug = $state(untrack(() => post.slug));
	let excerpt = $state(untrack(() => post.excerpt));
	let coverImageUrl = $state(untrack(() => post.coverImageUrl));
	let content = $state(untrack(() => post.content));

	// Pre-existing slugs (edit mode) are considered "dirty" so the auto-fill
	// from title doesn't clobber them.
	let slugDirty = $state(untrack(() => mode === 'edit' && post.slug.length > 0));

	let slugLocked = $derived(post.status === 'published');

	function onTitleInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		title = v;
		if (!slugLocked && !slugDirty) {
			slug = slugify(v);
		}
	}

	function onSlugInput(e: Event) {
		slug = (e.target as HTMLInputElement).value;
		slugDirty = true;
	}

	function confirmDelete(e: Event) {
		// eslint-disable-next-line no-alert
		if (!confirm('Delete this post permanently? This cannot be undone.')) {
			e.preventDefault();
		}
	}
</script>

<form method="POST" class="card space-y-5 p-6">
	{#if errorMessage}
		<p class="rounded-md bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>
	{/if}
	{#if savedFlash}
		<p class="rounded-md bg-brand-50 p-3 text-sm text-brand-700">Saved ✓</p>
	{/if}

	<div class="space-y-1.5">
		<label for="post-title" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
			Title
		</label>
		<input
			id="post-title"
			name="title"
			class="field-input"
			type="text"
			required
			maxlength="200"
			value={title}
			oninput={onTitleInput}
			placeholder="How to read your lease renewal"
		/>
	</div>

	<div class="space-y-1.5">
		<label for="post-slug" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
			Slug
		</label>
		<div class="flex items-stretch overflow-hidden rounded-[10px] border border-slate-300 focus-within:border-brand-500">
			<span class="bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-500">/learn/</span>
			<input
				id="post-slug"
				name="slug"
				class="flex-1 border-0 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none disabled:bg-slate-50 disabled:text-slate-500"
				type="text"
				required
				maxlength="120"
				pattern="[a-z0-9][a-z0-9\-]*"
				value={slug}
				oninput={onSlugInput}
				disabled={slugLocked}
				readonly={slugLocked}
			/>
		</div>
		<p class="text-xs text-slate-500">
			{#if slugLocked}
				Locked once published so live URLs stay stable.
			{:else}
				Auto-filled from the title. Lowercase letters, numbers, hyphens.
			{/if}
		</p>
	</div>

	<div class="space-y-1.5">
		<label for="post-excerpt" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
			Excerpt <span class="text-slate-400 normal-case">(optional)</span>
		</label>
		<textarea
			id="post-excerpt"
			name="excerpt"
			class="field-input"
			rows="2"
			maxlength="300"
			placeholder="One or two sentences shown on the Learn index."
			bind:value={excerpt}
		></textarea>
	</div>

	<div class="space-y-1.5">
		<label for="post-cover" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
			Cover image URL <span class="text-slate-400 normal-case">(optional)</span>
		</label>
		<input
			id="post-cover"
			name="coverImageUrl"
			class="field-input"
			type="url"
			maxlength="1000"
			placeholder="https://…"
			bind:value={coverImageUrl}
		/>
		{#if coverImageUrl}
			<div class="mt-2 overflow-hidden rounded-lg border border-slate-200">
				<img
					src={coverImageUrl}
					alt="Cover preview"
					class="h-32 w-full object-cover"
					onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
				/>
			</div>
		{/if}
	</div>

	<div class="space-y-1.5">
		<label for="post-content" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
			Content (Markdown)
		</label>
		<textarea
			id="post-content"
			name="content"
			class="field-input font-mono text-sm"
			rows="18"
			required
			placeholder={'## A subheading\n\nWrite your post in **markdown**.\n\n- Bullet lists work\n- [Links too](https://example.com)\n'}
			bind:value={content}
		></textarea>
		<p class="text-xs text-slate-500">
			Markdown supported (GitHub-flavored). Headings, lists, links, images, code, blockquotes.
		</p>
	</div>

	<div class="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
		{#if mode === 'new'}
			<button type="submit" class="btn-primary">Create draft</button>
			<a href="/admin/blog" class="text-sm text-slate-500 hover:underline">Cancel</a>
		{:else}
			<button type="submit" formaction="?/save" class="btn-primary">
				{post.status === 'published' ? 'Save changes' : 'Save draft'}
			</button>
			{#if post.status === 'draft'}
				<button type="submit" formaction="?/publish" class="btn-secondary">Publish</button>
			{:else}
				<button type="submit" formaction="?/unpublish" class="btn-secondary">Unpublish</button>
				<a
					href={`/learn/${post.slug}`}
					target="_blank"
					rel="noopener"
					class="text-sm text-slate-500 hover:underline"
				>
					View on /learn ↗
				</a>
			{/if}
			<button
				type="submit"
				formaction="?/delete"
				onclick={confirmDelete}
				class="ml-auto text-sm font-medium text-red-600 hover:text-red-700 hover:underline"
			>
				Delete
			</button>
		{/if}
	</div>
</form>
