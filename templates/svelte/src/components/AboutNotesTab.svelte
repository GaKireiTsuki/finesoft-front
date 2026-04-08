<script lang="ts">
	import { onActivate } from "@finesoft/front/svelte";

	let count = $state(0);
	let activationCount = $state(0);

	onActivate(() => {
		activationCount += 1;
	});
</script>

<div style="display: grid; gap: 0.5rem">
	<p>Notes activations: {activationCount}</p>
	<p>Counter: {count}</p>
	<button type="button" onclick={() => (count += 1)}>Increment</button>
</div>
