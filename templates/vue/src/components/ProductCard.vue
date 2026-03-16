<script setup lang="ts">
import type { ProductItem } from "../lib/models/product";

const { item } = defineProps<{ item: ProductItem }>();
</script>

<template>
    <div class="product-card">
        <h3>{{ item.name }}</h3>
        <p class="price">${{ item.price.toFixed(2) }}</p>
        <a v-if="item.clickAction" :href="item.clickAction.url">View Details →</a>
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
