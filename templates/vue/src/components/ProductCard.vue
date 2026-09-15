<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import type { ProductItem } from "../lib/models/product";

const { item, onAction } = defineProps<{
    item: ProductItem;
    onAction?: (action: Action) => void;
}>();

function handleClick(e: MouseEvent) {
    if (
        !onAction ||
        !item.clickAction ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
    )
        return;
    e.preventDefault();
    onAction(item.clickAction);
}
</script>

<template>
    <article class="product-card">
        <h3>{{ item.name }}</h3>
        <p class="price">${{ item.price.toFixed(2) }}</p>
        <a v-if="item.clickAction" :href="item.clickAction.url" @click="handleClick">
            View Details →
        </a>
    </article>
</template>
