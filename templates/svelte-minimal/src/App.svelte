<script lang="ts">
    import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";
    import { onMount, untrack } from "svelte";
    import { TAB_LABELS } from "./lib/navigation";
    import { views } from "./views";
const Outlet = selectOutlet("svelte");
    let { app }: { app: WebAppView } = $props();
    const snapshot = untrack(() => useSnapshot("svelte", app));
    let name = $state("");
    onMount(() => app.session?.register({
        key: "profile",
        version: 1,
        decode: (data) => {
            if (
                !data ||
                typeof data !== "object" ||
                typeof (data as { name?: unknown }).name !== "string"
            ) throw Error("invalid-profile-state");
            return data as { name: string };
        },
        capture: () => ({ name }),
        restore: (data) => {
            name = data.name;
        },
    }));
</script>
<div class="app-chrome">
    <header class="profile">
        <label>
            Your name (global):
            <input bind:value={name} placeholder="anon" onblur={() => app.session?.save()} />
        </label>
        {#if name}<span>👋 {name}</span>{/if}
    </header>
    {#if $snapshot.navigation.tabs}
        <nav class="tabs" aria-label="Pages">
            {#each $snapshot.navigation.tabs.order as key (key)}
                <button
                    aria-current={key === $snapshot.navigation.tabs.active}
                    onclick={() => app.perform({ kind: "selectTab", key })}
                >
                    {TAB_LABELS[key] ?? key}
                </button>
            {/each}
        </nav>
    {/if}
    {#if $snapshot.navigation.canGoBack}
        <button onclick={() => app.perform({ kind: "pop" })}>← Back</button>
    {/if}
    <Outlet {app} {views} />
</div>
