<script lang="ts">
	import type { BasePage } from "@finesoft/front";
	import Home from "./pages/Home.svelte";

	let page = $state<BasePage | null>(null);

	export function update(newPage: BasePage) {
		page = newPage;
	}
</script>

<main>
	{#if page}
		<Home {page} />
	{/if}
</main>
