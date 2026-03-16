<script setup lang="ts">
import { makeExternalUrlAction, makeFlowAction } from "@finesoft/front";

const links = [
    { label: "Home", action: makeFlowAction("/") },
    { label: "Search", action: makeFlowAction("/search") },
    { label: "About", action: makeFlowAction("/about") },
    { label: "GitHub", action: makeExternalUrlAction("https://github.com") },
];
</script>

<template>
    <nav>
        <a v-for="link in links" :key="link.label" :href="link.action.url">
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
</style>
