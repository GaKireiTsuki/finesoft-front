<script lang="ts">
	import type { BasePage } from "@finesoft/front";
	import Navigation from "./components/Navigation.svelte";
	import About from "./pages/About.svelte";
	import Home from "./pages/Home.svelte";
	import NotFound from "./pages/NotFound.svelte";
	import ProductDetail from "./pages/ProductDetail.svelte";
	import Search from "./pages/Search.svelte";

	let page = $state<BasePage | null>(null);

	const pageComponents: Record<string, any> = {
		home: Home,
		product: ProductDetail,
		search: Search,
		about: About,
	};

	export function update(newPage: BasePage) {
		page = newPage;
	}
</script>

<Navigation />
<main>
	{#if page}
		{@const PageComponent = pageComponents[page.pageType] ?? NotFound}
		<PageComponent {page} />
	{/if}
</main>
