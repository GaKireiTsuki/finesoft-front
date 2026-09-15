<script lang="ts">
    import type { BrowserAppHandle } from "@finesoft/front/browser";
    import type { NavigationSnapshot } from "@finesoft/front/web";
    import { onMount } from "svelte";
    import type { NameStore } from "./instance";
    import { getNavigationChrome, TAB_LABELS } from "./lib/navigation";

    let { initialSnapshot, controller, nameStore }: {
        initialSnapshot?: NavigationSnapshot;
        controller?: BrowserAppHandle;
        nameStore?: NameStore;
    } = $props();
    const chrome = $derived(getNavigationChrome(initialSnapshot));
    // Start empty on both server and client; restore the profile after hydration.
    let name = $state("");
    onMount(() => {
        if (!nameStore) return;
        const store = nameStore;
        name = store.get();
        return store.subscribe(() => { name = store.get(); });
    });
</script>

<div class="app-chrome">
    <header class="profile">
        <label>
            Your name (global):
            <input value={name} placeholder="anon" oninput={(event) => nameStore?.set(event.currentTarget.value)} onblur={() => controller?.session?.save()} />
        </label>
        {#if name}<span>👋 {name}</span>{/if}
    </header>
    {#if chrome.tabs}
        <nav class="tabs" aria-label="Pages">
            {#each chrome.tabs.order as key (key)}
                <button aria-current={key === chrome.tabs.active} onclick={() => void controller?.navigation?.selectTab(key)}>{TAB_LABELS[key] ?? key}</button>
            {/each}
        </nav>
    {/if}
    {#if chrome.canGoBack}<button onclick={() => void controller?.navigation?.pop()}>← Back</button>{/if}
</div>
