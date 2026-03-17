<script setup lang="ts">
import type { Action } from "@finesoft/front";
import type { ProductItem } from "../lib/models/product";

const { item, onAction } = defineProps<{
    item: ProductItem;
    onAction?: (action: Action) => void;
}>();

function handleClick(e: MouseEvent) {
    if (onAction && item.clickAction) {
        e.preventDefault();
        onAction(item.clickAction);
    }
}
</script>

<template>
    <div class="product-card">
        <h3>{{ item.name }}</h3>
        <p class="price">${{ item.price.toFixed(2) }}</p>
        <a v-if="item.clickAction" :href="item.clickAction.url" @click="handleClick">
            View Details →
        </a>
    </div>
</template>

<style scoped>
.product-card {
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 1rem;
    min-width: 200px;
}
.price {
    color: #007bff;
    font-weight: bold;
}
</style>
