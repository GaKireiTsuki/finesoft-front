<script lang="ts">
	import type { BasePage } from "@finesoft/front";
	import Home from "./pages/Home.svelte";

	let { page = null }: { page?: BasePage | null } = $props();

	export function update(newPage: BasePage) {
		page = newPage;
	}
</script>

<main>
	{#if page}
		<Home {page} />
	{/if}
</main>
