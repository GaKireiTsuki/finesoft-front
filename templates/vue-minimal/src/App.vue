<script setup lang="ts">
import { type BasePage, isStackNode, isTabsNode, sessionEntryKey } from "@finesoft/front";
import { computed, ref, watch } from "vue";
import type { AppController, AppState } from "./main";
import type { FeedPage } from "./lib/controllers/home";

const {
    state,
    controller,
    page: ssrPage,
} = defineProps<{
    state?: AppState;
    controller?: AppController;
    page?: BasePage; // SSR：主目标页面
}>();

const snapshot = computed(() => state?.snapshot ?? null);
const tree = computed(() => snapshot.value?.tree ?? null);

/** 当前可见目标（激活叶子）= snapshot.destinations[0]；SSR 回退到 page prop。 */
const destination = computed(() => snapshot.value?.destinations[0] ?? null);
const page = computed<BasePage | null>(
    () => (destination.value?.page as BasePage) ?? ssrPage ?? null,
);
const feed = computed(() => (page.value?.pageType === "home" ? (page.value as FeedPage) : null));

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

// ---- 全局切片：名字（跨 tab / 跨重载）----
const name = computed({
    get: () => state?.name ?? "",
    set: (v) => {
        if (state) state.name = v;
    },
});

// ---- 导航作用域状态：每屏一份，pop 即丢、push 保留底层屏 ----
const entryKey = computed(() =>
    destination.value ? sessionEntryKey(destination.value.intent, destination.value.params) : null,
);
const scopedNote = ref("");
watch(
    entryKey,
    (key) => {
        scopedNote.value = (key ? (controller?.getScoped(key) as string | undefined) : "") ?? "";
    },
    { immediate: true },
);
function onScopedInput(): void {
    if (entryKey.value) controller?.setScoped(entryKey.value, scopedNote.value);
}
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

        <main v-if="page">
            <button v-if="canGoBack" style="margin-bottom: 0.5rem" @click="controller?.pop()">
                ← Back
            </button>
            <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
            <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>

            <!-- NavigationStack push：feed 列表 -->
            <ul v-if="feed" style="list-style: none; padding: 0; display: grid; gap: 0.5rem">
                <li v-for="item in feed.items" :key="item.id">
                    <button
                        style="width: 100%; text-align: left"
                        @click="controller?.push('detail', { id: item.id })"
                    >
                        {{ item.title }} →
                    </button>
                </li>
            </ul>

            <!-- 导航作用域输入：每屏一份，随屏保留 / 丢弃 -->
            <label v-if="controller" style="display: block; margin-top: 1rem">
                Scoped note for this screen:
                <input
                    v-model="scopedNote"
                    placeholder="kept while this screen stays in the stack"
                    style="width: 100%"
                    @input="onScopedInput"
                />
            </label>
        </main>
    </div>
</template>
