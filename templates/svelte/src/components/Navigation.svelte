<script lang="ts">
	import {
		makeExternalUrlAction,
		makeFlowAction,
		type Action,
	} from "@finesoft/front";

	let {
		currentPath = "/",
		onaction,
	}: {
		currentPath?: string;
		onaction?: (action: Action) => void;
	} = $props();

	const links = [
		{
			label: "Home",
			action: makeFlowAction("/"),
			path: "/" as string | null,
		},
		{
			label: "Search",
			action: makeFlowAction("/search"),
			path: "/search" as string | null,
		},
		{
			label: "About",
			action: makeFlowAction("/about"),
			path: "/about" as string | null,
		},
		{
			label: "GitHub",
			action: makeExternalUrlAction("https://github.com"),
			path: null as string | null,
		},
	];

	function handleNavClick(action: Action) {
		return (e: MouseEvent) => {
			if (onaction) {
				e.preventDefault();
				onaction(action);
			}
		};
	}
</script>

<nav>
	{#each links as link}
		<a
			href={link.action.url}
			class:active={link.path !== null && currentPath === link.path}
			onclick={handleNavClick(link.action)}>{link.label}</a
		>
	{/each}
</nav>

<style>
	nav {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid #eee;
	}
	a {
		text-decoration: none;
		color: #333;
	}
	a:hover {
		color: #007bff;
	}
	a.active {
		color: #007bff;
		font-weight: bold;
	}
</style>
