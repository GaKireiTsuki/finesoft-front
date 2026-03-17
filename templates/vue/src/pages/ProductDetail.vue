<script setup lang="ts">
import type { Action } from "@finesoft/front";
import { NAV_ACTIONS } from "../actions";
import type { ProductPage } from "../lib/models/product";

const { page, onAction } = defineProps<{
    page: ProductPage;
    onAction?: (action: Action) => void;
}>();

function handleBack(e: MouseEvent) {
    if (onAction) {
        e.preventDefault();
        onAction(NAV_ACTIONS.home);
    }
}
</script>

<template>
    <div>
        <a href="/" @click="handleBack">← Back</a>
        <h1>{{ page.product.name }}</h1>
        <p class="price">${{ page.product.price.toFixed(2) }}</p>
        <p>{{ page.product.description }}</p>
    </div>
</template>

<style scoped>
.price {
    font-size: 1.5rem;
    color: #007bff;
    font-weight: bold;
}
</style>
