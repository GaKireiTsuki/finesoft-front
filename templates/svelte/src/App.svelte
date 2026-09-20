<script lang="ts">
    import { untrack } from "svelte";
	import { Outlet, useSnapshot, type WebAppView } from "@finesoft/front/svelte";
	import Layout from "./components/Layout.svelte";
	import { views } from "./views";
	let { app }: { app: WebAppView } = $props();
	const snapshot = untrack(() => useSnapshot(app));
</script>

<Layout currentPath={$snapshot.entries.find((entry) => entry.visible)?.page.url ?? "/"}>
	<Outlet {app} {views} />
</Layout>
