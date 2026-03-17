<script lang="ts">
	import type { Action } from "@finesoft/front";
	import type { AboutPage } from "../lib/models/product";

	let {
		page,
		onaction: _onaction,
	}: { page: AboutPage; onaction?: (action: Action) => void } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.content}</p>
</div>
