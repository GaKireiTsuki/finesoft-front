/**
 * BaseShelf / BaseItem — 所有 Shelf 和 Item 共享的基础属性
 *
 * 具体 Shelf/Item 类型由应用层定义并扩展此接口。
 */

import type { Action } from "../actions/types";

export interface BaseShelf {
    id: string;
    shelfType: string;
    title?: string;
    subtitle?: string;
    seeAllAction?: Action;
    isHorizontal?: boolean;
}

export interface BaseItem {
    id: string;
    itemType: string;
    clickAction?: Action;
}
