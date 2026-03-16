<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

defineProps<{ page: BasePage }>();
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
    </div>
</template>
