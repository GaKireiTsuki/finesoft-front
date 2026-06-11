<script setup lang="ts">
import { isStackNode, isTabsNode } from "@finesoft/front";
import { computed } from "vue";
import type { AppController, AppState } from "./main";

const { state, controller } = defineProps<{ state?: AppState; controller?: AppController }>();

const tree = computed(() => state?.snapshot?.tree ?? null);

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
    get: () => state?.name ?? "",
    set: (v) => {
        if (state) state.name = v;
    },
});
</script>

<template>
    <div style="max-width: 32rem; margin: 0 auto; padding: 1rem; font-family: system-ui">
        <!-- 全局切片：名字 -->
        <header style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem">
            <label v-if="state" style="flex: 1">
                Your name (global):
                <input v-model="name" placeholder="anon" @blur="controller?.save()" />
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
                @click="controller?.selectTab(key)"
            >
                {{ tabLabels[key] ?? key }}
            </button>
        </nav>

        <button v-if="canGoBack" style="margin-bottom: 0.5rem" @click="controller?.pop()">
            ← Back
        </button>

        <!-- islands 内容由框架挂进此 outlet（稳定、空、不加 v-if） -->
        <main data-fs-outlet></main>
    </div>
</template>
