<script lang="ts">
	import {
		makeExternalUrlAction,
		makeFlowAction,
		type Action,
	} from "@finesoft/front";
	import { getPerform } from "../lib/framework-svelte";

	let { currentPath = "/" }: { currentPath?: string } = $props();

	// 在组件初始化阶段获取 perform，getContext 只能在此阶段调用
	const perform = getPerform();

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
			if (perform) {
				e.preventDefault();
				void perform(action);
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
