<script lang="ts">
	import type { Action } from "@finesoft/front";
	import { NAV_ACTIONS } from "../actions";
	import type { ProductPage } from "../lib/models/product";

	let {
		page,
		onaction,
	}: { page: ProductPage; onaction?: (action: Action) => void } = $props();
</script>

<div>
	<a
		href="/"
		onclick={(e) => {
			if (onaction) {
				e.preventDefault();
				onaction(NAV_ACTIONS.home);
			}
		}}>← Back</a
	>
	<h1>{page.product.name}</h1>
	<p class="price">${page.product.price.toFixed(2)}</p>
	<p>{page.product.description}</p>
</div>

<style>
	.price {
		font-size: 1.5rem;
		color: #007bff;
		font-weight: bold;
	}
</style>
