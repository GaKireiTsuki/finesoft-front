<script setup lang="ts">
import { Outlet as selectOutlet, type WebAppView } from "@finesoft/front";
import { provide, ref, type Ref } from "vue";
import Other from "./VueOther.vue";
import Probe from "./VueProbe.vue";
const Outlet = selectOutlet("vue");
const { app } = defineProps<{ app: WebAppView }>();
const locale = ref(app.locale?.lang ?? "missing");
provide<Ref<string>>("native-locale", locale);
const updateContext = () => {
    locale.value += ":updated";
};
const views = { probe: Probe, other: Other };
</script>
<template>
    <button data-context-update @click="updateContext">Update context</button>
    <Outlet :app="app" :views="views" />
</template>
