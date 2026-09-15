<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import { NAV_LINKS } from "../actions";

	let {
		currentPath = "/",
		onAction,
	}: { currentPath?: string; onAction?: (action: Action) => void } = $props();

	function handleNavClick(action: Action) {
		return (e: MouseEvent) => {
			if (
				!onAction ||
				e.defaultPrevented ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return;
			e.preventDefault();
			onAction(action);
		};
	}
</script>

<nav class="navigation">
	{#each NAV_LINKS as link}
		<a
			href={link.path ?? link.action.url}
			class="navigation-link"
			class:active={link.path !== null && currentPath === link.path}
			onclick={handleNavClick(link.action)}>{link.label}</a
		>
	{/each}
</nav>
