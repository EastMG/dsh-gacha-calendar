		//#region version
		// 插件版本号：**不要手改这个字符串** —— build.mjs 会用根 package.json 的 version 替换下面的占位符
		// （唯一真源，避免两处手改漂移；lib/client.js 与 packages/core/core.mjs 都会被注入）。
		// 用途：缓存里记录"这份数据是哪版插件产出的"。更新插件后首次启动，据此**强制**刷新一次
		// （不看自动刷新开关）——因为有些改动（悬停格式、来源地址、样式、解析器）不刷新就看不到效果。
		// 写入时机见 engine-api.js 的 refresh()；判定见 60-helpers.js 的 autoRefreshPlan()。
		const PLUGIN_VERSION = "__PLUGIN_VERSION__";
		//#endregion
