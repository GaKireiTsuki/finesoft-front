<script lang="ts">
	import { NAV_ACTIONS } from "../actions";
	import { getPerform } from "../lib/framework-svelte";
	import type { ProductPage } from "../lib/models/product";

	let { page }: { page: ProductPage } = $props();

	const perform = getPerform();
</script>

<div>
	<a
		href="/"
		onclick={(e) => {
			if (perform) {
				e.preventDefault();
				void perform(NAV_ACTIONS.home);
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
