<script lang="ts">
import {onDestroy} from 'svelte';let {page,initialSnapshot}: {page:{title:string},initialSnapshot?:{destinations: readonly {page:{title?:string}}[]}}=$props();let draft=$state('');onDestroy(()=>{if(typeof window!=='undefined') (globalThis as any).cleanups=((globalThis as any).cleanups??0)+1});
</script><section data-restore-root data-snapshot-title={initialSnapshot?.destinations.at(-1)?.page.title ?? "empty"}><h1>{page.title}</h1><input name="draft" bind:value={draft}/><span>{draft}</span></section>
