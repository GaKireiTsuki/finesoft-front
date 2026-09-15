<script setup lang="ts">
import { isStackNode, isTabsNode } from "@finesoft/front/browser";
import { computed } from "vue";
import type { AppController, AppState } from "./instance";

const { state, profile, controller, initialSnapshot } = defineProps<{
    state?: AppState;
    profile?: AppState;
    initialSnapshot?: import("@finesoft/front/web").NavigationSnapshot;
    controller?: AppController;
}>();

const tree = computed(() => (initialSnapshot ?? state?.snapshot)?.tree ?? null);

/** Tab bar（tree 为 tabs 节点时）。 */
const tabs = computed(() => {
    const t = tree.value;
    return t && isTabsNode(t) ? { order: t.order, active: t.active } : null;
});
const tabLabels: Record<string, string> = { home: "Feed", notes: "Notes" };

/** 激活 tab 的栈深 > 1 → 可返回。 */
const canGoBack = computed(() => {
    const t = tree.value;
    if (!t || !isTabsNode(t)) return false;
    const branch = t.branches[t.active];
    return !!branch && isStackNode(branch) && branch.entries.length > 1;
});

/** 全局切片：名字（跨 tab / 跨重载）。 */
const name = computed({
    get: () => profile?.name ?? state?.name ?? "",
    set: (v) => {
        if (profile) profile.name = v;
        else if (state) state.name = v;
    },
});
</script>

<template>
    <div style="max-width: 32rem; margin: 0 auto; padding: 1rem; font-family: system-ui">
        <!-- 全局切片：名字 -->
        <header style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem">
            <label style="flex: 1">
                Your name (global):
                <input v-model="name" placeholder="anon" @blur="controller?.session?.save()" />
            </label>
            <span v-if="name">👋 {{ name }}</span>
        </header>

        <!-- TabView -->
        <nav v-if="tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1rem">
            <button
                v-for="key in tabs.order"
                :key="key"
                :style="{ fontWeight: key === tabs.active ? '700' : '400' }"
                :aria-current="key === tabs.active"
                @click="controller?.navigation?.selectTab(key)"
            >
                {{ tabLabels[key] ?? key }}
            </button>
        </nav>

        <button
            v-if="canGoBack"
            style="margin-bottom: 0.5rem"
            @click="controller?.navigation?.pop()"
        >
            ← Back
        </button>
    </div>
</template>
