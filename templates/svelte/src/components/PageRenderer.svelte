<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import type { AppPage } from "../lib/models/product";
	import About from "../pages/About.svelte";
	import Home from "../pages/Home.svelte";
	import NotFound from "../pages/NotFound.svelte";
	import ProductDetail from "../pages/ProductDetail.svelte";
	import Search from "../pages/Search.svelte";

	let { page, onAction }: { page: AppPage; onAction?: (action: Action) => void } = $props();
</script>

{#if page.pageType === "home"}
	<Home {page} {onAction} />
{:else if page.pageType === "product"}
	<ProductDetail {page} {onAction} />
{:else if page.pageType === "search"}
	<Search {page} {onAction} />
{:else if page.pageType === "about"}
	<About {page} {onAction} />
{:else}
	<NotFound {page} {onAction} />
{/if}
