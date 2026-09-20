<script lang="ts">
	import type { Snippet } from "svelte";
	import Navigation from "./Navigation.svelte";

	let {
		children,
		currentPath = "/",
	}: {
		children: Snippet;
		currentPath?: string;
	} = $props();
</script>

<div class="app-shell">
	<Navigation {currentPath} />
	<main class="app-main">
		{@render children()}
	</main>
</div>
