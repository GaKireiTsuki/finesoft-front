<script lang="ts">
	import type { Action, Framework } from "@finesoft/front";
	import type {
		KeepAliveViewEntry,
		SvelteKeepAliveNavigationState,
	} from "@finesoft/front/svelte";
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

	const framework = untrack(() => props.framework);
	const initialPage = untrack(() => props.page ?? null);
	if (framework) {
		setFrameworkContext(framework);
	}

	let navigation = $state<SvelteKeepAliveNavigationState<AppPage>>({
		pages: initialPage
			? [
					{
						key: initialPage.url ?? initialPage.id,
						page: initialPage,
						active: true,
						cacheable: false,
					},
				]
			: [],
		loading: false,
		currentPath: initialPage?.url ?? "/",
	});

	export function updateNavigation(nextState: SvelteKeepAliveNavigationState<AppPage>): void {
		navigation = nextState;
	}
</script>

<Layout currentPath={navigation.currentPath}>
	{#if navigation.loading}
		<Loading />
	{/if}
	<PageRenderer
		pages={navigation.pages as KeepAliveViewEntry<AppPage>[]}
		onAction={navigation.onAction as ((action: Action) => void) | undefined}
		onCacheable={navigation.onCacheable as
			| ((cacheKey: string, page: AppPage) => void)
			| undefined}
	/>
</Layout>
