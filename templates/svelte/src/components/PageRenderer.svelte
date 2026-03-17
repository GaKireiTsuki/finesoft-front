<script lang="ts">
	import type { Action } from "@finesoft/front";
	import type { AppPage } from "../lib/models/product";
	import About from "../pages/About.svelte";
	import Home from "../pages/Home.svelte";
	import NotFound from "../pages/NotFound.svelte";
	import ProductDetail from "../pages/ProductDetail.svelte";
	import Search from "../pages/Search.svelte";

	let {
		page,
		onaction,
	}: { page: AppPage; onaction?: (action: Action) => void } = $props();

	const pageComponents: Record<string, any> = {
		home: Home,
		product: ProductDetail,
		search: Search,
		about: About,
		error: NotFound,
	};
</script>

{@const PageComponent = pageComponents[page.pageType] ?? NotFound}
<PageComponent {page} {onaction} />
