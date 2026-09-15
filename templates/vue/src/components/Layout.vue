<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import Navigation from "./Navigation.vue";

const { currentPath = "/", onAction } = defineProps<{
    currentPath?: string;
    onAction?: (action: Action) => void;
}>();
</script>

<template>
    <div class="app-shell">
        <Navigation :current-path="currentPath" :on-action="onAction" />
        <main class="app-main">
            <slot />
        </main>
    </div>
</template>
