<script lang="ts">
	import { NAV_ACTIONS } from "../actions";
	import { getPerform } from "../lib/framework-svelte";
	import type { ErrorPage } from "../lib/models/product";

	let { page }: { page: ErrorPage } = $props();

	const perform = getPerform();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>
	<a
		href="/"
		onclick={(e) => {
			if (perform) {
				e.preventDefault();
				void perform(NAV_ACTIONS.home);
			}
		}}>← Go Home</a
	>
</div>
