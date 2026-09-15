<script lang="ts">
	import type { Action } from "@finesoft/front/web";
	import { NAV_ACTIONS } from "../actions";
	import type { ErrorPage } from "../lib/models/product";

	let { page, onAction }: { page: ErrorPage; onAction?: (action: Action) => void } = $props();
</script>

<section class="page page-error">
	<h1>{page.title}</h1>
	<p>{page.description}</p>
	<a
		href="/"
		onclick={(e) => {
			if (
				!onAction ||
				e.defaultPrevented ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return;
			e.preventDefault();
			onAction(NAV_ACTIONS.home);
		}}>← Go Home</a
	>
</section>
