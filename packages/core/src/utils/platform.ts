/**
 * Platform — UA 解析与平台检测
 *
 * 提供统一的平台/浏览器/OS 检测，避免在各处手写 UA 判断。
 */

export interface PlatformInfo {
    /** 操作系统 */
    os: "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
    /** 浏览器 */
    browser: "safari" | "chrome" | "firefox" | "edge" | "opera" | "samsung" | "unknown";
    /** 渲染引擎 */
    engine: "webkit" | "blink" | "gecko" | "unknown";
    /** 是否为移动设备 */
    isMobile: boolean;
    /** 是否为触摸设备 */
    isTouch: boolean;
}

/**
 * 从 User-Agent 字符串解析平台信息
 *
 * @param ua - 主机显式提供的 User-Agent 字符串，默认空字符串
 * @param maxTouchPoints - 主机显式提供的触摸点数量，默认 0
 */
export function detectPlatform(ua = "", maxTouchPoints = 0): PlatformInfo {
    const agent = ua;
    const lower = agent.toLowerCase();

    return {
        os: detectOS(lower),
        browser: detectBrowser(lower),
        engine: detectEngine(lower),
        isMobile: /mobile|android|iphone|ipad|ipod/i.test(agent),
        isTouch: maxTouchPoints > 0,
    };
}

function detectOS(ua: string): PlatformInfo["os"] {
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    if (/macintosh|mac os x/.test(ua)) return "macos";
    if (/windows/.test(ua)) return "windows";
    if (/linux/.test(ua)) return "linux";
    return "unknown";
}

function detectBrowser(ua: string): PlatformInfo["browser"] {
    // Order matters: Edge and Opera include "chrome" in their UA
    if (/edg\//.test(ua)) return "edge";
    if (/opr\/|opera/.test(ua)) return "opera";
    if (/samsungbrowser/.test(ua)) return "samsung";
    if (/chrome|crios/.test(ua) && !/edg\//.test(ua)) return "chrome";
    if (/firefox|fxios/.test(ua)) return "firefox";
    if (/safari/.test(ua) && !/chrome/.test(ua)) return "safari";
    return "unknown";
}

function detectEngine(ua: string): PlatformInfo["engine"] {
    if (/applewebkit/.test(ua) && !/chrome/.test(ua)) return "webkit";
    if (/applewebkit/.test(ua) && /chrome/.test(ua)) return "blink";
    if (/gecko\//.test(ua)) return "gecko";
    return "unknown";
}
