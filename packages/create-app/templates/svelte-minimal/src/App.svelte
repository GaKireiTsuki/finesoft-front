<script lang="ts">
	import { type BasePage, Framework } from "@finesoft/front";
	import { untrack } from "svelte";
	import { setFrameworkContext } from "./lib/framework-svelte";
	import Home from "./pages/Home.svelte";

	type Props = {
		framework?: Framework;
		page?: BasePage | null;
	};

	let props: Props = $props();

	// context 只需在初始化时设置一次，用 untrack 明确声明仅读取初始值
	const framework = untrack(() => props.framework);
	if (framework) {
		setFrameworkContext(framework);
	}

	/** 将导航 Promise 的 rejection 转为错误页，避免 {:catch} 暴露原始异常 */
	function wrapError(p: Promise<BasePage>): Promise<BasePage> {
		return p.catch(
			(err): BasePage => ({
				id: "error",
				pageType: "error",
				title: "Error",
				description:
					err instanceof Error ? err.message : "Failed to load page",
			}),
		);
	}

	/**
	 * 当前页面数据:
	 * - BasePage: SSR 直出 或 已完成的导航
	 * - Promise<BasePage>: SPA 导航中
	 * - null: 初始空白态
	 */
	let currentPage = $state<Promise<BasePage> | BasePage | null>(
		untrack(() => props.page ?? null),
	);

	/** 由 main.ts 的 mount 回调调用，驱动 SPA 导航 */
	export function updatePage(newPage: Promise<BasePage> | BasePage): void {
		if (newPage instanceof Promise) {
			currentPage = wrapError(newPage);
		} else {
			currentPage = newPage;
		}
	}
</script>

<main style="padding: 1rem">
	{#if currentPage instanceof Promise}
		{#await currentPage}
			<p style="text-align: center; color: #999">Loading…</p>
		{:then page}
			<Home {page} />
		{/await}
	{:else if currentPage}
		<Home page={currentPage} />
	{/if}
</main>
