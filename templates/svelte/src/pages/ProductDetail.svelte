<script lang="ts">
	import type { ProductPage } from "../lib/models/product";

	let { page }: { page: ProductPage } = $props();
</script>

<div>
	<a href="/">← Back</a>
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
