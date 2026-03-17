<script setup lang="ts">
import { makeExternalUrlAction, makeFlowAction, type Action } from "@finesoft/front";

const { currentPath = "/", onAction } = defineProps<{
    currentPath?: string;
    onAction?: (action: Action) => void;
}>();

const links = [
    { label: "Home", action: makeFlowAction("/"), path: "/" },
    { label: "Search", action: makeFlowAction("/search"), path: "/search" },
    { label: "About", action: makeFlowAction("/about"), path: "/about" },
    { label: "GitHub", action: makeExternalUrlAction("https://github.com"), path: null as null },
];

function handleClick(action: Action) {
    return (e: MouseEvent) => {
        if (onAction) {
            e.preventDefault();
            onAction(action);
        }
    };
}
</script>

<template>
    <nav>
        <a
            v-for="link in links"
            :key="link.label"
            :href="link.action.url"
            :class="{ active: link.path !== null && currentPath === link.path }"
            @click="handleClick(link.action)"
        >
            {{ link.label }}
        </a>
    </nav>
</template>

<style scoped>
nav {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 1px solid #eee;
}
a {
    text-decoration: none;
    color: #333;
}
a:hover {
    color: #007bff;
}
a.active {
    color: #007bff;
    font-weight: bold;
}
</style>
