<script lang="ts">
	import { onActivate } from "@finesoft/front/svelte";

	let text = $state("");
	let activationCount = $state(0);

	onActivate(() => {
		activationCount += 1;
	});
</script>

<div style="display: grid; gap: 0.5rem">
	<p>Overview activations: {activationCount}</p>
	<label style="display: grid; gap: 0.5rem; max-width: 24rem">
		Overview note
		<input bind:value={text} />
	</label>
</div>
