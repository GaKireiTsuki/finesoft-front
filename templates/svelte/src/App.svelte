<script lang="ts">
	import type { Action } from "@finesoft/front";
	import Layout from "./components/Layout.svelte";
	import Loading from "./components/Loading.svelte";
	import PageRenderer from "./components/PageRenderer.svelte";
	import type { AppPage } from "./lib/models/product";

	let {
		page: ssrPage = null,
		onaction,
	}: { page?: AppPage | null; onaction?: (action: Action) => void } =
		$props();

	let page = $state<AppPage | null>(ssrPage);
	let loading = $state(false);

	export function setPage(newPage: AppPage | null, isLoading: boolean) {
		loading = isLoading;
		if (newPage) page = newPage;
	}
</script>

<Layout currentPath={page?.url ?? "/"} {onaction}>
	{#if loading}
		<Loading />
	{:else if page}
		<PageRenderer {page} {onaction} />
	{/if}
</Layout>
