<script setup lang="ts">
import Navigation from "./Navigation.vue";

const { currentPath = "/" } = defineProps<{
    currentPath?: string;
}>();
</script>

<template>
    <div class="app-shell">
        <Navigation :current-path="currentPath" />
        <main class="app-main">
            <slot />
        </main>
    </div>
</template>
