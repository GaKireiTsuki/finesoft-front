<script setup lang="ts">
import type { ProductItem } from "../lib/models/product";

const { item } = defineProps<{
    item: ProductItem;
}>();
</script>

<template>
    <article class="product-card">
        <h3>{{ item.name }}</h3>
        <p class="price">${{ item.price.toFixed(2) }}</p>
        <a v-if="item.clickAction" :href="item.clickAction.url"> View Details → </a>
    </article>
</template>
