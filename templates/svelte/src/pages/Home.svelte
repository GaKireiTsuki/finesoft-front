<script lang="ts">
	import ProductCard from "../components/ProductCard.svelte";
	import type { HomePage } from "../lib/models/product";

	let { page }: { page: HomePage } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>

	{#each page.shelves as shelf}
		<section>
			<h2>{shelf.title}</h2>
			<div class="shelf" class:horizontal={shelf.isHorizontal}>
				{#each shelf.items as item}
					<ProductCard {item} />
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.shelf {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.shelf.horizontal {
		flex-wrap: nowrap;
		overflow-x: auto;
	}
</style>
