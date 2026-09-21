<script lang="ts">
import { Outlet as selectOutlet, type WebAppView } from "@finesoft/front";
import { setContext, untrack } from "svelte";
import Other from "./SvelteOther.svelte";
import Probe from "./SvelteProbe.svelte";
const Outlet = selectOutlet("svelte");
let { app }: { app: WebAppView } = $props();
let locale = $state({ value: untrack(() => app.locale?.lang ?? "missing") });
setContext("native-locale", locale);
const updateContext = () => {
    locale.value += ":updated";
};
const views = { probe: Probe, other: Other };
</script>
<button data-context-update onclick={updateContext}>Update context</button>
<Outlet {app} {views} />
