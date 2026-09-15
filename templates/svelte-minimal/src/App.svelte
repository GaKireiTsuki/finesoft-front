<script lang="ts">
	import { type BasePage, Framework } from "@finesoft/front/browser";
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

</script>

<main style="padding: 1rem">
 {#if props.page}<Home page={props.page} />{/if}
</main>
