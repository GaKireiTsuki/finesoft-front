<script lang="ts">
	import type { ProductItem } from "../lib/models/product";

	let { item }: { item: ProductItem } = $props();
</script>

<div class="product-card">
	<h3>{item.name}</h3>
	<p class="price">${item.price.toFixed(2)}</p>
	{#if item.clickAction}
		<a href={item.clickAction.url}>View Details →</a>
	{/if}
</div>

<style>
	.product-card {
		border: 1px solid #eee;
		border-radius: 8px;
		padding: 1rem;
		min-width: 200px;
	}
	.price {
		color: #007bff;
		font-weight: bold;
	}
</style>
