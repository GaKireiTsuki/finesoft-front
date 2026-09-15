<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import { NAV_ACTIONS } from "../actions";
	import type { ProductPage } from "../lib/models/product";

	let { page, onAction }: { page: ProductPage; onAction?: (action: Action) => void } = $props();
</script>

<section class="page page-product">
	<a
		href="/"
		onclick={(e) => {
			if (
				!onAction ||
				e.defaultPrevented ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return;
			e.preventDefault();
			onAction(NAV_ACTIONS.home);
		}}>← Back</a
	>
	<h1>{page.product.name}</h1>
	<p class="price price-large">${page.product.price.toFixed(2)}</p>
	<p>{page.product.description}</p>
</section>
