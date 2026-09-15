<script lang="ts">
import type { NavigationSnapshot } from "@finesoft/front/web";
type ViewProps = {initialSnapshot: NavigationSnapshot};
let {initialSnapshot}: ViewProps = $props();
</script>
<output data-chrome>{initialSnapshot.destinations.at(-1)?.page.title ?? "empty"}</output>
