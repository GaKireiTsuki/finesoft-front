<script lang="ts">
	import type { ProductItem } from "../lib/models/product";

	let { item }: { item: ProductItem } = $props();
</script>

<article class="product-card">
	<h3>{item.name}</h3>
	<p class="price">${item.price.toFixed(2)}</p>
	{#if item.clickAction && "url" in item.clickAction}
		<a
			href={item.clickAction.url}
			>View Details &rarr;</a
		>
	{/if}
</article>
