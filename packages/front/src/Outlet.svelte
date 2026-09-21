<script lang="ts">
    import { tick, untrack } from "svelte";
    import type { Component } from "svelte";
    import type { ViewProps, WebAppView } from "@finesoft/web";
    import { useSnapshot } from "./svelte";
    let {
        app,
        views,
    }: {
        app: WebAppView;
        views: Readonly<Record<string, Component<never>>>;
    } = $props();
    const snapshot = untrack(() => useSnapshot(app));
    $effect(() => {
        const revision = $snapshot.revision;
        void tick().then(() => app.commit(revision));
    });
</script>
<main data-fs-outlet>
    {#each $snapshot.entries as entry (entry.entryId)}
        {@const View = (views[entry.page.pageType] ?? views["*"]) as Component<ViewProps> | undefined}
        {#if View}
            <div
                hidden={!entry.visible}
                data-fs-entry={entry.entryId}
                data-fs-key={entry.entryId}
                data-fs-intent={entry.intent}
            >
                {#key entry.entryId + ":" + entry.page.pageType}
                    <View page={entry.page} {app} {entry} />
                {/key}
            </div>
        {:else}
            {@const _missing = (() => {
                throw Error("Missing view: " + entry.page.pageType);
            })()}
        {/if}
    {/each}
</main>
