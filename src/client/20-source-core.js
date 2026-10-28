// src/client/20-source-core.js —— 来源容器（模块顶层）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。

		// ── 来源容器：各游戏文件用 `registerSource` 追加自己的条目 ──
		const SOURCES = [];

		// ── 游戏代表色（唯一一张表）──
		// 用途：实验「日程」面板视图的"**颜色 = 游戏**"（见 82-schedule-view.js 的 ScheduleView /
		// styles/schedule.css 的 `.gacha-cal-sched-*`）。每款一个**中间调**，浅色底与深色底上都看得清；
		// 同一款游戏只用一个色，各服的色只有明度差（便于仍能认出"是同一款"）。
		//
		// ⚠️ 为什么放在这里、而不是写进各 `30-game-*.js` 的 `registerSource({...})` 字面量：
		//    `30-game-*.js` 是抓取/解析的规格（对照源站，改一处就要重新对源站），
		//    而"面板上用什么颜色"是视图身份，与抓取无关；集中一张表才好一眼看出有没有撞色。
		//    下发点在下面的 `registerSource` —— 于是 `SOURCES` 里每一条都带 `color`，字段只有一个新增。
		//
		// 没有 color 的条目（**用户自定义条目**）由视图层按游戏名哈希取固定色盘，见 SCHEDULE_PALETTE。
		const SOURCE_COLORS = {
			fgo: "#4E7CD8",                  // Fate/Grand Order · 迦勒底蓝
			bandori: "#E85C97",              // BanG Dream！少女乐团派对 · 品牌粉
			ournotes: "#5A63C8",             // BanG Dream！OurNotes·日服 · 靛蓝
			"ournotes-global": "#7E88DC",    // 同款国际服 · 同系更浅
			ddlezj: "#E3A02E",               // 嘟嘟脸恶作剧 · 亮黄
			"uma-cn": "#46A96A",             // 闪耀！优俊少女 · 草地绿
			"ba-cn": "#4C9FE0",              // 蔚蓝档案·国服 · 蔚蓝
			"ba-global": "#6BB6E8",          // 同款国际服 · 同系更浅
			"ba-jp": "#2E7BC4",              // 同款日服 · 同系更深
			r1999: "#7A5AF8",                // 重返未来：1999 · 紫
			wuhuamixin: "#43A08E",           // 物华弥新 · 青瓷玉色
			zspms: "#D0605A",                // 战双帕弥什 · 灰调红
			czn: "#8A66D6",                  // 卡厄斯梦境 · 梦境紫
			kedr: "#4F8F6E",                 // 雪松 · 松绿
			"uma-jp": "#C96BA6",             // 赛马娘·日服 · 粉紫
			"uma-global": "#E0709F",         // 赛马娘·国际服 · 品牌粉
			genshin: "#3FA9A0",              // 原神 · 青绿
			hsr: "#6C6FE0",                  // 崩坏：星穹铁道 · 星轨紫蓝
			zzz: "#E0A93B",                  // 绝区零 · 品牌黄
			bh3: "#35A9D8",                  // 崩坏3 · 崩坏青
			arknights: "#52798C",            // 明日方舟 · 钢板灰蓝
			endfield: "#4A6CF7",             // 明日方舟：终末地 · 工业蓝
			wuwa: "#2C8FB8",                 // 鸣潮 · 声骸青蓝
			p5x: "#DC4640",                  // 女神异闻录：夜幕魅影 · Persona 红
			nte: "#C05BC9",                  // 异环 · 霓虹品红
			pjsk: "#2FB3C9",                 // 初音未来：缤纷舞台 · 初音青
			gf2: "#D9773F",                  // 少女前线2：追放 · 追放橙
			stellasora: "#5FA8F5"            // 星塔旅人 · 天蓝
		};

		/** 登记一条来源。**幂等**：按 id 找到就 `Object.assign` 合并，否则追加。 */
		function registerSource(entry) {
			// 颜色统一由上面的表下发（条目自己写了 color 就尊重它）。幂等：每次都是同一个字面值。
			if (entry.color === void 0 && SOURCE_COLORS[entry.id] !== void 0) entry.color = SOURCE_COLORS[entry.id];
			const i = SOURCES.findIndex((s) => s.id === entry.id);
			if (i >= 0) Object.assign(SOURCES[i], entry);
			else SOURCES.push(entry);
		}


		// ---- 统一来源注册表 ----
		// 卡池来源与活动来源完全独立，契约如下：
		// - GACHA_FETCHERS[id]：卡池字段抓取器（async (url, signal) → 数据对象 | null），
		//   数据对象形如 {banner, roles?, bannerDates, event?, eventDates?}；
		//   当活动源与卡池源同 URL 时，event/eventDates 由卡池载荷复用（避免重复请求）。
		// - EVENT_FETCHERS[id]：活动源注册表（{ 默认抓取器, 备选抓取器... }），
		//   抓取器同 GACHA_FETCHERS 契约；fetchEntry 只取其中的 event/eventDates 字段。
		//   活动源与卡池源不同 URL 时独立抓取（来源选择互不影响）。
		// - altSources / eventAltSources：备选源列表，字段为 { label, fetcher, url? , id? }
		//   （url = 该来源的地址；id = 抓取器自带地址的内部来源标识）。
		//   设置页选中后按 url ?? id 路由到对应抓取器；是否走 host 代理由抓取器自己决定。见 normalizeSourceId。

		// 活动源注册表：条目 → { 默认 + 备选抓取器 }。没有独立活动源的条目活动来源显示"未配置"。
