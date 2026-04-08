<script lang="ts">
    import { untrack } from "svelte";
    import ActivationBoundaryView from "./ActivationBoundaryView.svelte";
    import { getPageKeepAliveContext } from "./context";

    let {
        cacheKey,
        component,
        componentProps,
    }: {
        cacheKey: string;
        component: any;
        componentProps: Record<string, unknown>;
    } = $props();

    const pageContext = getPageKeepAliveContext();

    const initialEntry = untrack(() => ({
        key: cacheKey,
        component,
        componentProps,
        active: true,
    }));

    let entries = $state<
        Array<{
            key: string;
            component: any;
            componentProps: Record<string, unknown>;
            active: boolean;
        }>
    >([initialEntry]);

    $effect(() => {
        const nextEntries = entries.map((entry) => ({
            ...entry,
            active: entry.key === cacheKey,
        }));
        const existingEntry = nextEntries.find((entry) => entry.key === cacheKey);

        if (existingEntry) {
            existingEntry.component = component;
            existingEntry.componentProps = componentProps;
        } else {
            nextEntries.push({
                key: cacheKey,
                component,
                componentProps,
                active: true,
            });
        }

        entries = nextEntries;
    });
</script>

{#each entries as entry (entry.key)}
    {@const EntryComponent = entry.component}
    <ActivationBoundaryView
        active={entry.active}
        markPageCacheable={pageContext?.markCacheable ?? (() => {})}
    >
        <EntryComponent {...entry.componentProps} />
    </ActivationBoundaryView>
{/each}
