<script lang="ts">
	// Square-rounded brand glyph — a stylized downward chart path on an accent gradient.
	// Matches screens.jsx BrandMark.
	interface Props {
		size?: number;
	}
	let { size = 28 }: Props = $props();
</script>

<div
	class="flex items-center justify-center"
	style="
		width: {size}px; height: {size}px; border-radius: {Math.round(size * 0.32)}px;
		background: linear-gradient(135deg, var(--accent-mid) 0%, var(--accent-deep) 100%);
		box-shadow: 0 4px 12px -2px var(--accent-mid), inset 0 0.5px 0 rgba(255,255,255,0.5);
	"
>
	<svg width={size * 0.5} height={size * 0.5} viewBox="0 0 14 14" fill="none">
		<path
			d="M2 10l4-4 3 3 3-3"
			stroke="white"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<path
			d="M10 6h2v2"
			stroke="white"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</div>
