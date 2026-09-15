<script lang="ts">
	import { Framework } from "@finesoft/front/browser";
	import { untrack } from "svelte";
	import Layout from "./components/Layout.svelte";
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

</script>

<Layout currentPath={props.page?.url ?? "/"}>
 {#if props.page}<PageRenderer page={props.page} />{/if}
</Layout>
