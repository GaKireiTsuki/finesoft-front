<script lang="ts">
    import { untrack } from "svelte";
	import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";
	import Layout from "./components/Layout.svelte";
	import { views } from "./views";
const Outlet = selectOutlet("svelte");
	let { app }: { app: WebAppView } = $props();
	const snapshot = untrack(() => useSnapshot("svelte", app));
</script>

<Layout currentPath={$snapshot.entries.find((entry) => entry.visible)?.page.url ?? "/"}>
	<Outlet {app} {views} />
</Layout>
