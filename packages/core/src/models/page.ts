/**
 * BasePage — 所有页面共享的基础属性
 *
 * 具体页面类型由应用层定义并扩展此接口。
 */

export interface BasePage {
	id: string;
	pageType: string;
	title: string;
	description?: string;
	url?: string;
}
