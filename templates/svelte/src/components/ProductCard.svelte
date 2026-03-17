<script lang="ts">
	import type { Action } from "@finesoft/front";
	import type { ProductItem } from "../lib/models/product";

	let {
		item,
		onaction,
	}: { item: ProductItem; onaction?: (action: Action) => void } = $props();
</script>

<div class="product-card">
	<h3>{item.name}</h3>
	<p class="price">${item.price.toFixed(2)}</p>
	{#if item.clickAction && "url" in item.clickAction}
		<a
			href={item.clickAction.url}
			onclick={(e) => {
				if (onaction && item.clickAction) {
					e.preventDefault();
					onaction(item.clickAction);
				}
			}}>View Details &rarr;</a
		>
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
