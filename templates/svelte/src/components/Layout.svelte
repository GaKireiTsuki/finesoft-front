<script lang="ts">
	import type { Action } from "@finesoft/front";
	import type { Snippet } from "svelte";
	import Navigation from "./Navigation.svelte";

	let {
		children,
		currentPath = "/",
		onaction,
	}: {
		children: Snippet;
		currentPath?: string;
		onaction?: (action: Action) => void;
	} = $props();
</script>

<div>
	<Navigation {currentPath} {onaction} />
	<main style="padding: 1rem">
		{@render children()}
	</main>
</div>
