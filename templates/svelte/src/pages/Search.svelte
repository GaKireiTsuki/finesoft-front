<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import ProductCard from "../components/ProductCard.svelte";
	import type { SearchPage } from "../lib/models/product";

	let { page, onAction }: { page: SearchPage; onAction?: (action: Action) => void } = $props();
</script>

<section class="page page-search">
	<h1>{page.title}</h1>
	<p>{page.description}</p>

	<div class="results">
		{#each page.results as item}
			<ProductCard {item} {onAction} />
		{/each}
	</div>

	{#if page.results.length === 0}
		<p>No products found.</p>
	{/if}
</section>
