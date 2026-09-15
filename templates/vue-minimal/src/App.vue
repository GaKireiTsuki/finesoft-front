<script setup lang="ts">
import type { BrowserAppHandle } from "@finesoft/front/browser";
import type { NavigationSnapshot } from "@finesoft/front/web";
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { NameStore } from "./instance";
import { getNavigationChrome, TAB_LABELS } from "./lib/navigation";

defineOptions({ inheritAttrs: false });
const { initialSnapshot, controller, nameStore } = defineProps<{
    initialSnapshot?: NavigationSnapshot;
    controller?: BrowserAppHandle;
    nameStore?: NameStore;
}>();
const chrome = computed(() => getNavigationChrome(initialSnapshot));
// Start empty on both server and client; restore the profile after hydration.
const name = ref("");
let unsubscribe: (() => void) | undefined;
onMounted(() => {
    if (!nameStore) return;
    name.value = nameStore.get();
    unsubscribe = nameStore.subscribe(() => {
        name.value = nameStore.get();
    });
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
    <div class="app-chrome">
        <header class="profile">
            <label>
                Your name (global):
                <input
                    :value="name"
                    placeholder="anon"
                    @input="nameStore?.set(($event.target as HTMLInputElement).value)"
                    @blur="controller?.session?.save()"
                />
            </label>
            <span v-if="name">👋 {{ name }}</span>
        </header>
        <nav v-if="chrome.tabs" class="tabs" aria-label="Pages">
            <button
                v-for="key in chrome.tabs.order"
                :key="key"
                :aria-current="key === chrome.tabs.active"
                @click="controller?.navigation?.selectTab(key)"
            >
                {{ TAB_LABELS[key] ?? key }}
            </button>
        </nav>
        <button v-if="chrome.canGoBack" @click="controller?.navigation?.pop()">← Back</button>
    </div>
</template>
