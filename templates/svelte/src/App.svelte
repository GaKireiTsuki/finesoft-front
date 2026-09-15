<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import Loading from "./components/Loading.svelte";
	import Layout from "./components/Layout.svelte";
	import PageRenderer from "./components/PageRenderer.svelte";
	import type { AppPage } from "./lib/models/product";

	type Props = {
		page?: AppPage | null;
		loading?: boolean;
		onAction?: (action: Action) => void;
	};

	let props: Props = $props();
</script>

<Layout currentPath={props.page?.url ?? "/"} onAction={props.onAction}>
	{#if props.loading}<Loading />{/if}
	{#if props.page}<PageRenderer page={props.page} onAction={props.onAction} />{/if}
</Layout>
