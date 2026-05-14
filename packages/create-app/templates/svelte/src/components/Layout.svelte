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

<div>
	<Navigation {currentPath} />
	<main style="padding: 1rem">
		{@render children()}
	</main>
</div>
