<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import type { ProductItem } from "../lib/models/product";

	let { item, onAction }: { item: ProductItem; onAction?: (action: Action) => void } = $props();
</script>

<article class="product-card">
	<h3>{item.name}</h3>
	<p class="price">${item.price.toFixed(2)}</p>
	{#if item.clickAction && "url" in item.clickAction}
		<a
			href={item.clickAction.url}
			onclick={(e) => {
				if (
					!onAction ||
					!item.clickAction ||
					e.defaultPrevented ||
					e.button !== 0 ||
					e.metaKey ||
					e.ctrlKey ||
					e.shiftKey ||
					e.altKey
				)
					return;
				e.preventDefault();
				onAction(item.clickAction);
			}}>View Details &rarr;</a
		>
	{/if}
</article>
