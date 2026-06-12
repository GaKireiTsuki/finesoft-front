<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

defineProps<{ page: BasePage }>();
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>
    </section>
</template>
