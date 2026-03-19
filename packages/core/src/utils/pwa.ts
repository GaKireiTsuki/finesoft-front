/**
 * PWA Display Mode 检测
 *
 * 检测当前应用是否以 PWA 模式运行。
 */

export type PWADisplayMode = "standalone" | "twa" | "browser";

/**
 * 检测 PWA display mode
 *
 * - `standalone`: 已安装的 PWA（通过 Add to Home Screen）
 * - `twa`: Trusted Web Activity（Android 原生壳）
 * - `browser`: 普通浏览器标签页
 */
export function getPWADisplayMode(): PWADisplayMode {
    if (typeof window === "undefined") return "browser";

    // TWA detection: referrer 来自 Android app 或 document.referrer 为 android-app://
    if (document.referrer.startsWith("android-app://")) {
        return "twa";
    }

    // Standalone: display-mode media query or navigator.standalone (iOS Safari)
    if (
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in window.navigator &&
            (window.navigator as { standalone?: boolean }).standalone === true)
    ) {
        return "standalone";
    }

    return "browser";
}
