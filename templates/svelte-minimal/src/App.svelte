<script lang="ts">
	import type { Action, BasePage } from "@finesoft/front";
	import Home from "./pages/Home.svelte";

	let {
		page: ssrPage = null,
		onaction: _onaction,
	}: { page?: BasePage | null; onaction?: (action: Action) => void } =
		$props();

	let page = $state<BasePage | null>(ssrPage);
	let loading = $state(false);

	export function setPage(newPage: BasePage | null, isLoading: boolean) {
		loading = isLoading;
		if (newPage) page = newPage;
	}
</script>

<main style="padding: 1rem">
	{#if loading}
		<p style="text-align: center; color: #999">Loading…</p>
	{:else if page}
		<Home {page} />
	{/if}
</main>
