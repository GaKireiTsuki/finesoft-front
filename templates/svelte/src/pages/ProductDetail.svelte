<script lang="ts">
	import type { ProductPage } from "../lib/models/product";

	let { page }: { page: ProductPage } = $props();
</script>

<section class="page page-product">
	<a
		href="/"
		>← Back</a
	>
	<h1>{page.product.name}</h1>
	<p class="price price-large">${page.product.price.toFixed(2)}</p>
	<p>{page.product.description}</p>
</section>
