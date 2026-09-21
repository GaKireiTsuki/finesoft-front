<script setup lang="ts">
import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";
import Layout from "./components/Layout.vue";
import { views } from "./views";
const Outlet = selectOutlet("vue");
const { app } = defineProps<{ app: WebAppView }>();
const snapshot = useSnapshot("vue", app);
</script>

<template>
    <Layout :current-path="snapshot.entries.find((entry) => entry.visible)?.page.url ?? '/'">
        <Outlet :app="app" :views="views" />
    </Layout>
</template>
