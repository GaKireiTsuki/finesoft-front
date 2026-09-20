<script setup lang="ts">
const { currentPath = "/" } = defineProps<{
    currentPath?: string;
}>();
const links = [
    { label: "Home", href: "/" },
    { label: "Search", href: "/search" },
    { label: "About", href: "/about" },
    { label: "GitHub", href: "https://github.com/nicepkg/finesoft" },
] as const;
</script>

<template>
    <nav class="navigation">
        <a
            v-for="link in links"
            :key="link.label"
            :href="link.href"
            class="navigation-link"
            :class="{ active: currentPath === link.href }"
        >
            {{ link.label }}
        </a>
    </nav>
</template>
