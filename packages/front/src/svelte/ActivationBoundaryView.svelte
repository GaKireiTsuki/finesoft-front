<script lang="ts">
    import { onDestroy, onMount, untrack } from "svelte";
    import {
        createActivationBoundary,
        setActivationBoundaryContext,
    } from "./context";
    import type { Snippet } from "svelte";

    let {
        active,
        markPageCacheable,
        children,
    }: {
        active: boolean;
        markPageCacheable: () => void;
        children?: Snippet;
    } = $props();

    const controller = createActivationBoundary(() => {
        markPageCacheable();
    });
    setActivationBoundaryContext(controller);

    let previousActive = untrack(() => active);

    onMount(() => {
        controller.mount(active);
        previousActive = active;
    });

    $effect(() => {
        if (active === previousActive) {
            return;
        }

        previousActive = active;
        controller.updateActive(active);
    });

    onDestroy(() => {
        controller.dispose();
    });
</script>

<div aria-hidden={!active} hidden={!active} style={active ? undefined : "display: none;"}>
    {@render children?.()}
</div>
