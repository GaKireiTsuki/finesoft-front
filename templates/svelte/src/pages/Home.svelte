<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import ProductCard from "../components/ProductCard.svelte";
	import type { HomePage } from "../lib/models/product";

	let { page, onAction }: { page: HomePage; onAction?: (action: Action) => void } = $props();
</script>

<section class="page page-home">
	<h1>{page.title}</h1>
	<p>{page.description}</p>

	{#each page.shelves as shelf}
		<section class="shelf-section">
			<h2>{shelf.title}</h2>
			<div class="shelf" class:horizontal={shelf.isHorizontal}>
				{#each shelf.items as item}
					<ProductCard {item} {onAction} />
				{/each}
			</div>
		</section>
	{/each}
</section>
