<script lang="ts">
	import type { Action } from "@finesoft/front";
	import { KeepAlivePageView, type KeepAliveViewEntry } from "@finesoft/front/svelte";
	import type { AppPage } from "../lib/models/product";
	import About from "../pages/About.svelte";
	import Home from "../pages/Home.svelte";
	import NotFound from "../pages/NotFound.svelte";
	import ProductDetail from "../pages/ProductDetail.svelte";
	import Search from "../pages/Search.svelte";

	let {
		pages,
		onAction,
		onCacheable,
	}: {
		pages: KeepAliveViewEntry<AppPage>[];
		onAction?: (action: Action) => void;
		onCacheable?: (cacheKey: string, page: AppPage) => void;
	} = $props();

	const pageComponents: Record<string, any> = {
		home: Home,
		product: ProductDetail,
		search: Search,
		about: About,
		error: NotFound,
	};
</script>

{#each pages as entry (entry.key)}
	{@const PageComponent = pageComponents[entry.page.pageType] ?? NotFound}
	<KeepAlivePageView
		cacheKey={entry.key}
		page={entry.page}
		active={entry.active}
		onCacheable={onCacheable}
	>
		<PageComponent page={entry.page} onAction={onAction} />
	</KeepAlivePageView>
{/each}
