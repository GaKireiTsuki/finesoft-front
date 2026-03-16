<script lang="ts">
	import type { BasePage } from "@finesoft/front";

	let { page }: { page: BasePage } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.description}</p>
	<a href="/">← Go Home</a>
</div>
