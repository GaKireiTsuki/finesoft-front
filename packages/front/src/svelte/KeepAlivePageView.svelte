<script lang="ts">
    import type { BasePage } from "@finesoft/front";
    import ActivationBoundaryView from "./ActivationBoundaryView.svelte";
    import { setPageKeepAliveContext } from "./context";
    import type { Snippet } from "svelte";

    let {
        cacheKey,
        page,
        active,
        onCacheable,
        children,
    }: {
        cacheKey: string;
        page: BasePage;
        active: boolean;
        onCacheable?: (cacheKey: string, page: BasePage) => void;
        children?: Snippet;
    } = $props();

    function markCacheable(): void {
        onCacheable?.(cacheKey, page);
    }

    setPageKeepAliveContext({
        markCacheable,
    });
</script>

<ActivationBoundaryView {active} markPageCacheable={markCacheable}>
    {@render children?.()}
</ActivationBoundaryView>
