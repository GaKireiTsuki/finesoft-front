<script lang="ts">
	import ProductCard from "../components/ProductCard.svelte";
	import type { SearchPage } from "../lib/models/product";

	let { page }: { page: SearchPage } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>

	<div class="results">
		{#each page.results as item}
			<ProductCard {item} />
		{/each}
	</div>

	{#if page.results.length === 0}
		<p>No products found.</p>
	{/if}
</div>

<style>
	.results {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
</style>
