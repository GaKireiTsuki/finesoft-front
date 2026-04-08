<script lang="ts">
	import { KeepAliveOutlet, onActivate, onDeactivate } from "@finesoft/front/svelte";
	import AboutNotesTab from "../components/AboutNotesTab.svelte";
	import AboutOverviewTab from "../components/AboutOverviewTab.svelte";
	import type { AboutPage } from "../lib/models/product";

	let { page }: { page: AboutPage } = $props();

	let activationCount = $state(0);
	let deactivationCount = $state(0);
	let draft = $state("");
	let activeTab = $state<"overview" | "notes">("overview");

	onActivate(() => {
		activationCount += 1;
	});

	onDeactivate(() => {
		deactivationCount += 1;
	});

	const tabComponents = {
		overview: AboutOverviewTab,
		notes: AboutNotesTab,
	};

	const activeComponent = $derived(tabComponents[activeTab]);
	const outletProps = {};
</script>

<div style="display: grid; gap: 1rem">
	<h1>{page.title}</h1>
	<p>{page.content}</p>

	<section style="border: 1px solid #eee; border-radius: 0.75rem; padding: 1rem">
		<h2>Page keep alive</h2>
		<p>Activate: {activationCount}</p>
		<p>Deactivate: {deactivationCount}</p>
		<label style="display: grid; gap: 0.5rem; max-width: 24rem">
			Draft message
			<input bind:value={draft} />
		</label>
	</section>

	<section style="border: 1px solid #eee; border-radius: 0.75rem; padding: 1rem">
		<h2>KeepAlive outlet</h2>
		<div style="display: flex; gap: 0.5rem; margin-bottom: 1rem">
			<button type="button" onclick={() => (activeTab = "overview")}>Overview tab</button>
			<button type="button" onclick={() => (activeTab = "notes")}>Notes tab</button>
		</div>
		<KeepAliveOutlet cacheKey={activeTab} component={activeComponent} componentProps={outletProps} />
	</section>
</div>
