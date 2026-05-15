import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent, type App } from "vue";
import "./style.css";

const Ch02RouteResolver = defineAsyncComponent(
    () => import("../components/demos/Ch02-RouteResolver.vue"),
);
const Ch03MiddlewarePlayground = defineAsyncComponent(
    () => import("../components/demos/Ch03-MiddlewarePlayground.vue"),
);
const Timeline = defineAsyncComponent(() => import("../components/primitives/Timeline.vue"));
const Pipeline = defineAsyncComponent(() => import("../components/primitives/Pipeline.vue"));
const JsonInspector = defineAsyncComponent(
    () => import("../components/primitives/JsonInspector.vue"),
);

export default {
    ...DefaultTheme,
    enhanceApp({ app }: { app: App }) {
        app.component("Ch02RouteResolver", Ch02RouteResolver);
        app.component("Ch03MiddlewarePlayground", Ch03MiddlewarePlayground);
        app.component("Timeline", Timeline);
        app.component("Pipeline", Pipeline);
        app.component("JsonInspector", JsonInspector);
    },
};
