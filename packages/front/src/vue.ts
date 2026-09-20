import {
    defineComponent,
    h,
    nextTick,
    onMounted,
    onUnmounted,
    onUpdated,
    shallowRef,
    type Component,
    type PropType,
} from "vue";
import type { ViewProps, WebAppView } from "@finesoft/web";

export type NativeView = Component;
export type NativeViews = Readonly<Record<string, NativeView>>;
export function useSnapshot(app: WebAppView) {
    const snapshot = shallowRef(app.getSnapshot());
    const unsubscribe = app.subscribe(() => {
        snapshot.value = app.getSnapshot();
    });
    onUnmounted(unsubscribe);
    return snapshot;
}
export const Outlet = defineComponent({
    name: "FinesoftOutlet",
    props: {
        app: { type: Object as PropType<WebAppView>, required: true },
        views: { type: Object as PropType<NativeViews>, required: true },
    },
    setup(props) {
        const snapshot = useSnapshot(props.app);
        let renderedRevision = snapshot.value.revision;
        const commit = () => {
            const revision = renderedRevision;
            void nextTick(() => props.app.commit(revision));
        };
        onMounted(commit);
        onUpdated(commit);
        return () => {
            renderedRevision = snapshot.value.revision;
            return h(
                "main",
                { "data-fs-outlet": "" },
                snapshot.value.entries.map((entry) => {
                    const View = props.views[entry.page.pageType] ?? props.views["*"];
                    if (!View) throw Error("Missing view: " + entry.page.pageType);
                    return h(
                        "div",
                        {
                            key: entry.entryId,
                            hidden: !entry.visible,
                            "data-fs-entry": entry.entryId,
                            "data-fs-key": entry.entryId,
                            "data-fs-intent": entry.intent,
                        },
                        [
                            h(View, {
                                key: entry.entryId + ":" + entry.page.pageType,
                                page: entry.page,
                                app: props.app,
                                entry,
                            }),
                        ],
                    );
                }),
            );
        };
    },
});
export type { ViewProps, WebAppView };
