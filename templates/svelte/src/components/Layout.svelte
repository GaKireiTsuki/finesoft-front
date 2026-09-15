<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Action } from "@finesoft/front/web";
	import Navigation from "./Navigation.svelte";

	let {
		children,
		currentPath = "/",
		onAction,
	}: {
		children: Snippet;
		currentPath?: string;
		onAction?: (action: Action) => void;
	} = $props();
</script>

<div class="app-shell">
	<Navigation {currentPath} {onAction} />
	<main class="app-main">
		{@render children()}
	</main>
</div>
