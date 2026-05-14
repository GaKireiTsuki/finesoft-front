<script lang="ts">
	import { Framework } from "@finesoft/front";
	import { untrack } from "svelte";
	import Layout from "./components/Layout.svelte";
	import Loading from "./components/Loading.svelte";
	import PageRenderer from "./components/PageRenderer.svelte";
	import { setFrameworkContext } from "./lib/framework-svelte";
	import type { AppPage } from "./lib/models/product";

	type Props = {
		framework?: Framework;
		page?: AppPage | null;
	};

	let props: Props = $props();

	// context 只需在初始化时设置一次，用 untrack 明确声明仅读取初始值
	const framework = untrack(() => props.framework);
	if (framework) {
		setFrameworkContext(framework);
	}

	/**
	 * 将导航 Promise 的 rejection 转为 ErrorPage，避免 {:catch} 暴露原始错误。
	 * 对应 template-project 的 transformRejectionIntoErrorPage 模式。
	 */
	function wrapError(p: Promise<AppPage>): Promise<AppPage> {
		return p.catch(
			(err): AppPage =>
				({
					id: "error",
					pageType: "error",
					title: "Error",
					description:
						err instanceof Error
							? err.message
							: "Failed to load page",
					status: 500,
				}) as AppPage,
		);
	}

	/**
	 * 当前页面数据:
	 * - AppPage: SSR 直出 或 已完成的导航
	 * - Promise<AppPage>: SPA 导航中（等待 controller 返回）
	 * - null: 初始空白态
	 */
	let currentPage = $state<Promise<AppPage> | AppPage | null>(
		untrack(() => props.page ?? null),
	);

	/** 用于 Navigation 高亮当前路径；Promise 导航完成后更新 */
	let currentPath = $state<string>(untrack(() => props.page?.url ?? "/"));

	/**
	 * 由 main.ts 的 mount 回调调用，驱动 SPA 导航。
	 * - 传入 Promise: 显示 Loading，resolve 后渲染页面
	 * - 传入 AppPage: 直接更新（SSR hydration 首帧）
	 */
	export function updatePage(newPage: Promise<AppPage> | AppPage): void {
		if (newPage instanceof Promise) {
			const wrapped = wrapError(newPage);
			currentPage = wrapped;
			void wrapped.then((p) => {
				currentPath = p.url ?? "/";
			});
		} else {
			currentPage = newPage;
			currentPath = newPage.url ?? "/";
		}
	}
</script>

<Layout {currentPath}>
	{#if currentPage instanceof Promise}
		{#await currentPage}
			<Loading />
		{:then page}
			<PageRenderer {page} />
		{/await}
	{:else if currentPage}
		<PageRenderer page={currentPage} />
	{/if}
</Layout>
