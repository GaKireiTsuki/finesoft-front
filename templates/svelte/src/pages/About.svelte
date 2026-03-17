<script lang="ts">
	import type { AboutPage } from "../lib/models/product";

	let { page }: { page: AboutPage } = $props();
</script>

<div>
	<h1>{page.title}</h1>
	<p>{page.content}</p>
</div>
