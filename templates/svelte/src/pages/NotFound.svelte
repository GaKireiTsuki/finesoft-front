<script lang="ts">
	import type { Action } from "@finesoft/front";
	import { NAV_ACTIONS } from "../actions";
	import type { ErrorPage } from "../lib/models/product";

	let {
		page,
		onaction,
	}: { page: ErrorPage; onaction?: (action: Action) => void } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>
	<a
		href="/"
		onclick={(e) => {
			if (onaction) {
				e.preventDefault();
				onaction(NAV_ACTIONS.home);
			}
		}}>← Go Home</a
	>
</div>
