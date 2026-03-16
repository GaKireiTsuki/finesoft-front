<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

const { page } = defineProps<{ page: BasePage }>();
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <a href="/">← Go Home</a>
    </div>
</template>
