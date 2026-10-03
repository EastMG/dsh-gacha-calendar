		//#region version
		// 插件版本号：**不要手改这个字符串** —— build.mjs 会用根 package.json 的 version 替换下面的占位符
		// （唯一真源，避免两处手改漂移；lib/client.js 与 packages/core/core.mjs 都会被注入）。
		// 用途：缓存里记录"这份数据是哪版插件产出的"。更新插件后首次启动，据此**强制**刷新一次
		// （不看自动刷新开关）——因为有些改动（悬停格式、来源地址、样式、解析器）不刷新就看不到效果。
		// 写入时机见 engine-api.js 的 refresh()；判定见 60-helpers.js 的 autoRefreshPlan()。
		const PLUGIN_VERSION = "0.10.9";
		//#endregion

window.__ModuleLoader__.load({
	id: "dsh-gacha-calendar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		//#region config
		const NS = "gacha-calendar";
		// 本插件在 profile 里的条目 id 候选（用于解析设置表单，见 92-dsh-env.js 的 resolveSettingsEntryId）。
		// DSH 0.1.7 起设置文档按**条目 id**寻址，而"插件名/条目 id/包名"三者未必同名：
		//   · cordis.patch.yml 里是 id: gacha-calendar（我们自己的 insert 声明）
		//   · 包名是 dsh-gacha-calendar
		// 所以不写死单一字符串，按顺序试，谁能拿到表单就用谁。
		const SETTINGS_ENTRY_IDS = [NS, "dsh-gacha-calendar"];
		// 刷新频率选项：按天（存分钟），与 host 端 Config.refreshMinutes 对应。
		// 档位对齐常见版本周期：14/21/28/35/42 天 —— 15≈蔚蓝档案的 14 天轮换、21=1999 半版本/3.6 整版本
		// 与异环当期、30≈方舟月度、42=米系与 1999 的整版本
		const REFRESH_OPTIONS = [
			{ label: "1 天", minutes: 1 * 24 * 60 },
			{ label: "5 天", minutes: 5 * 24 * 60 },
			{ label: "7 天", minutes: 7 * 24 * 60 },
			{ label: "15 天", minutes: 15 * 24 * 60 },
			{ label: "21 天", minutes: 21 * 24 * 60 },
			{ label: "30 天", minutes: 30 * 24 * 60 },
			{ label: "42 天", minutes: 42 * 24 * 60 }
		];
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			order: null,
			lastRefresh: 0,
			lastSource: "none",
			// 最近一次联网抓取的解析结果（JSON：{ [gameId]: {banner,bannerDates,roles,event,eventDates} }）
			lastData: "",
			// 不展示的条目 id 列表（设置页开关）；出厂默认隐藏见条目的 `defaultHidden` 字段
			hidden: [],
			// 用户**明确打开**的条目 id 列表 —— 用来覆盖条目的出厂 `defaultHidden`。
			// 为什么不把默认隐藏项直接塞进 `hidden`：那样老用户（配置已存了 hidden=[]）不会生效，
			// 而且用户勾上以后无法区分"是默认值还是我开的"。三态判定见 60-helpers.js 的 isEntryHidden。
			shown: [],
			// 已删除的条目 id 列表（内置条目删除后记录，避免下次加载复活）
			removed: [],
			// 自定义爬取地址（JSON：{ [gameId]: "url" }，覆盖内置 url；空串 = 用默认）
			customUrls: "{}",
			// 自定义活动来源地址（JSON：{ [gameId]: "url" }，覆盖内置 eventUrl）
			customEventUrls: "{}",
			// 自定义条目（JSON 数组，字段与 SOURCES 一致）
			customEntries: "[]"
		};
		//#endregion

		//#region core env（环境注入缝 —— core 零宿主依赖的唯一入口）
		// core（配置 / 来源 / 解析器 / 抓取器 / 刷新 / helpers）里**不允许**直接碰宿主：
		// 不写 window / document / Node API，也不直接 fetch、不直接读时钟。
		// 所有"联网、取当前时间、计时器"一律经过本文件里的 coreEnv，由外壳注入实现：
		//   DSH 插件  → 92-dsh-env.js（transport 走宿主代理 /api/gacha-calendar-proxy）
		//   浏览器扩展 → background 消息转发
		//   Windows / Android / iOS / 鸿蒙 → 各平台原生 HTTP
		// 2b 之后 coreEnv 由 createEngine({ transport, storage, now }) 注入；当前由外壳在加载时 setCoreEnv()。
		let coreEnv = {
			transport: null,
			now: () => Date.now(),
			timer: {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			}
		};

		// 外壳注入（可只注入一部分，其余保持默认）
		function setCoreEnv(next) {
			if (!next) return;
			coreEnv = {
				...coreEnv,
				...next,
				timer: { ...coreEnv.timer, ...(next.timer || {}) }
			};
		}

		// 取当前时间（毫秒）。core 里判断"哪一期覆盖当前"必须用这个，不许直接 Date.now()，
		// 这样各平台能注入自己的时钟、也能在测试里固定时间。
		function nowMs() {
			return coreEnv.now();
		}

		function requireTransport() {
			if (!coreEnv.transport) throw new Error("core transport 未注入");
			return coreEnv.transport;
		}

		// 直连抓取（不需要代理的源：bwiki / PRTS 等 CORS 放行的站，调用方自行加 origin=* 等参数）。
		// 返回 WHATWG Response 形态的对象（有 ok / status / headers / text() / json()），
		// 各平台据此包装自己的 HTTP 实现即可，调用点无需改动。
		function transportFetchRaw(url, opts) {
			return requireTransport().fetchRaw(url, opts);
		}

		// 直连抓取的统一请求头：Accept + Referer=<目标站>/。
		// 为什么必须带 Referer：bwiki（wiki.biligame.com）已对"无 Referer 的裸请求"返回 **567**（实测：
		// 带 Referer 200；只带 UA 或 Accept 均 567；单给 Origin 无效）。浏览器会自动带上本站 Referer
		// （Referer 是禁止脚本设置的头，浏览器会忽略这里设置的值），所以 DSH 生产路径正常；但
		// Node / 原生运行时不会自动带 → core 包在其它平台会整片 567（原神/星铁/鸣潮活动等 bwiki 源）。
		function rawHeaders(url) {
			const h = { Accept: "application/json" };
			try { h.Referer = new URL(url).origin + "/"; } catch { /* 非法 URL 交由 fetch 报错 */ }
			return h;
		}

		//#region 源站时区（显式建模）
		//
		// **为什么需要**：此前一律用 `new Date(y, mo-1, d, h, mi)` 把源站墙钟时间按**本机时区**
		// 解释。对国内用户（UTC+8）恰好正确，但：
		//   · 海外用户用国服插件 → 绝对时刻偏移（倒计时、"是否在开" 判定会错）
		//   · 日服/国际服与国服混用 → 同一份数据在不同机器上得到不同时刻
		// 现在每个来源显式声明 `tz`（源站墙上时钟所用时区），由这里换算成正确的绝对时刻。
		//
		// **注意**：只改"绝对时刻"，**显示文本仍是源站墙钟原文** —— 玩家看游戏内公告
		// 走的就是那串墙钟时间，改成用户本地时间反而对不上。
		//
		// 表示法与取值（均按 2026-10-01 实测的源站标注确定，见交接文档 §59）：
		//   · IANA 名（`UTC` / `Asia/Shanghai` / `Asia/Tokyo` / `Europe/Berlin` …）—— 支持 DST
		//   · 或固定偏移分钟数（`480` = UTC+8 / `540` = UTC+9 / `0` = UTC）
		//   未声明（`null` / `undefined`）→ **沿用本机时区**（与改造前完全一致，向后兼容）
		const TZ_FMT_CACHE = new Map();
		function tzFormatter(tzName) {
			let f = TZ_FMT_CACHE.get(tzName);
			if (f === void 0) {
				try {
					f = new Intl.DateTimeFormat("en-US", {
						timeZone: tzName, hour12: false,
						year: "numeric", month: "2-digit", day: "2-digit",
						hour: "2-digit", minute: "2-digit", second: "2-digit"
					});
				} catch { f = null; }   // 环境不支持该时区名（ICU 缺失）→ 退化为本机时区
				TZ_FMT_CACHE.set(tzName, f);
			}
			return f;
		}

		// 某时刻在某时区的偏移（分钟，东为正）。IANA 名不可用时返回 null。
		// 做法：先把 ts 当作 UTC 取各字段，再用目标时区渲染同一 ts，两套墙上时钟之差即偏移。
		function tzOffsetMinutesAt(tzName, ts) {
			const f = tzFormatter(tzName);
			if (!f) return null;
			const d = new Date(ts);
			if (isNaN(d.getTime())) return null;
			const parts = f.formatToParts(d);
			const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
			const h = g("hour") % 24;   // hour12:false 在个别环境对午夜给 24 → 归零
			const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
			return (asUTC - (Math.floor(ts / 1000) * 1000)) / 60000;
		}

		// 源站时区表示 → 该时刻的偏移（分钟）。固定数字直接用；IANA 名按 ts 求（含 DST）；无法判定 → null（本机时区）
		function sourceOffsetMinutes(tz, ts) {
			if (tz == null || tz === "") return null;
			if (typeof tz === "number") return Number.isFinite(tz) ? tz : null;
			if (typeof tz === "string") {
				if (/^[+-]?\d+$/.test(tz.trim())) return Number(tz.trim());
				return tzOffsetMinutesAt(tz.trim(), ts);
			}
			return null;
		}

		// 绝对毫秒 → 在**源站时区**下的墙上时钟字段（供"把 ts 渲染回源站墙钟"用）。
		// tz 为 null（或时区名不可用）→ 退化为本机时区字段。
		function sourceWallParts(ts, tz) {
			const d = new Date(ts);
			if (tz == null || tz === "") {
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			if (typeof tz === "string" && !/^[+-]?\d+$/.test(tz.trim())) {
				const f = tzFormatter(tz.trim());
				if (f) {
					const parts = f.formatToParts(d);
					const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
					return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
				}
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			// 固定偏移（数字或 "+8" 形式）→ 平移后再取 UTC 字段
			const off = sourceOffsetMinutes(tz, ts);
			if (off == null) {
				return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
			}
			const s = new Date(ts + off * 60000);
			return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
		}

		// 源站墙钟（y-mo-d h:mi）→ 绝对毫秒。tz 为 null 时用本机时区（= 改造前行为）。
		// IANA 名走两遍：先用"把墙钟当 UTC"估一个时刻求偏移，再用该偏移定出真实时刻；
		// 偏移在真实时刻与估计时刻不同（正好跨 DST 边界）时再迭代一次 —— 与 Temporal 的
		// "compatible" 消歧一致，且对游戏源站（多为固定 +8/+9/UTC）根本用不到第二遍。
		function sourceInstant(y, mo, d, h, mi, tz) {
			if (tz == null || tz === "") return new Date(y, mo - 1, d, h, mi).getTime();
			const guess = Date.UTC(y, mo - 1, d, h, mi);
			let off = sourceOffsetMinutes(tz, guess);
			if (off == null) return new Date(y, mo - 1, d, h, mi).getTime();   // 时区名不可用 → 保持原行为
			let ts = guess - off * 60000;
			const off2 = sourceOffsetMinutes(tz, ts);
			if (off2 != null && off2 !== off) ts = guess - off2 * 60000;
			return ts;
		}
		//#endregion


		// 经代理抓取文本（需要绕过 CORS / Referer 反爬的源）。语义与原 host 代理调用完全一致：
		// referer / headers（可选对象）/ body（可选，提供时以 POST + JSON 发出）→ 原始 body 字符串
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			return requireTransport().fetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body });
		}

		// 经代理抓取 JSON。解析失败统一抛 "bad-json"（normErr 会显示成"响应格式异常"），
		// 而不是把原生 SyntaxError 漏出去（那会被归成泛化的"抓取异常"）
		async function proxyFetchJson(proxyUrl, referer, extraHeaders, body) {
			const text = await proxyFetchText(proxyUrl, referer, extraHeaders, body);
			try {
				return JSON.parse(text);
			} catch {
				throw new Error("bad-json");
			}
		}
		//#endregion

		//#region data sources
		// 数据源声明：不含任何内置快照数据（无联网抓取时对应列显示为空）。
		// 卡池来源（url/altSources）与活动来源（eventUrl/eventAltSources）完全独立、各自单独选择；
		// 默认活动源与卡池源相同时（ba-*/r1999 的公告同时含卡池与活动），仍作为独立来源存在，
		// 抓取时同 URL 单次请求复用，换用其他来源时独立抓取。
		// 明日方舟来源地址：默认=官方公告 CMS（web-news.hypergryph.com）；PRTS 卡池一览为备选（mediawiki，浏览器直连）
		// —— 源站时区（`tz`）——
		// 每个条目声明其**源站墙上时钟所用时区**，由 15-env.js 的 sourceInstant() 换算成绝对时刻。
		// 只影响"绝对时刻"（倒计时 / 是否在开），**显示文本仍是源站墙钟原文**（与游戏内公告一致）。
		// 取值依据（2026-10-01 实测源站标注，详见交接文档 §59）：
		//   · 国服系（原神/星铁/绝区零/鸣潮/方舟/终末地/蔚蓝国服/1999/异环）→ UTC+8
		//     其中绝区零正文标 `UTC+8`×17、鸣潮 `UTC+8`×10、1999 `UTC+8`×1
		//   · 蔚蓝日服 → `Asia/Tokyo`（正文标 `JST`×3）
		//   · 蔚蓝国际服 → `UTC`（国际服标准重置点 = UTC 01:59，公告写"上午9點59分"）
		//   · 未声明 → 沿用本机时区（与改造前一致）
		const TZ_CN = "Asia/Shanghai";      // UTC+8：国服一览
		const TZ_JP = "Asia/Tokyo";         // UTC+9：日服
		const TZ_UTC = "UTC";               // UTC  ：国际服
		const AK_OFFICIAL_BULLETIN = "https://web-news.hypergryph.com/api/bulletin";
		const ARKNIGHTS_OFFICIAL_LIST_URL = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";
		const ARKNIGHTS_PRTS_URL = "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2";
		// 鸣潮官方公告（aki-gm-resources-back）：entrypoint.json → 目录（含 hash）→ <dir>/zh-Hans.json 全量公告，
		// 其中 recommend 组含逐期「角色/武器活动唤取」公告，正文带 ✦活动时间✦ 起止
		const WUWA_NOTICE_ENTRY = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";
		const WUWA_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2";
		// 鸣潮 Bwiki 活动日历页（已从**默认活动源降级为备选**，2026-10-01）：
		// 该页仍可解析（parseWuwaCalendar 能抽到 11 条），但**已停更**——最新一条结束于 2026/9/29，
		// 没有当期 3.7 的活动，所以不改解析器，只把它挪到备选。
		const WUWA_EVENT_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2";
		// 绝区零官网公告（api-takumi-static content_v2_user，经 host 代理；无 CORS、无需登录）：
		// iChanId=279（公告频道）返回逐条公告正文（sIntro/sContent），其中「X.Y版本限时频段（上/下期）」
		// 含该期精确起止 + 限定 S 级代理人/音擎；起点写「版本更新后」时取同版本「更新公告」的 dtStartTime。
		const ZZZ_NEWS_LIST_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/706fd13a87294881/getContentList?iChanId=279&iPageSize=50&iPage=1&sLangKey=zh-cn";
		const ZZZ_BWIKI_URL = "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2";
		// 蔚蓝档案·日服 官网新闻接口（api-web.bluearchive.jp，经 host 代理；无 CORS、无需登录）：
		// 返回 {data:{rows:[{id,title(お知らせ/イベント/メンテナンス),summary,content,publishTime}],count}}，
		// 「ピックアップ募集紹介」条目内含逐池「ピックアップ名／ピックアップ生徒／実施期間」。
		const BA_JP_NEWS_URL = "https://api-web.bluearchive.jp/api/news/list?pageIndex=1&pageNum=30";
		// 重返未来1999：默认=官方**游戏内公告**接口（noticecp），它有官网 CMS 不发布的逐期「征集时间」
		// （正文「X.X「…」版本活动一览」按段落给出【征集时间】起止与 UP 角色）；
		// 备选=官网新闻 API（只有维护时间与活动名，无逐期征集时间）。
		const R1999_NOTICE_URL = "https://notice.sl916.com/noticecp/client/query?gameId=50001&channelId=100&subChannelId=1009&serverType=4";
		const R1999_OFFICIAL_URL = "https://re.bluepoch.com/activity/official/websites/information/query";
		const SOURCES = [
			{
				id: "genshin",
				tz: TZ_CN,
				// parserVersion：该条目「解析逻辑」的版本号 —— 源站改版/规则更新后 +1。
				// 用途：无服务端分发时定位「坏了的是哪个版本的用户、哪个源」（见交接文档 §13.4）。
				parserVersion: 1,
				name: "原神",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/b/b0/%E5%8E%9F%E7%A5%9E%E5%9B%BE%E6%A0%87.png!/fw/64",
				source: "Bwiki \u5F80\u671F\u7948\u613F",
				url: "https://wiki.biligame.com/ys/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&prop=text&format=json&formatversion=2",
				// 独立活动源：原神活动一览为 JS 动态加载（Dquery+SMW），经 SMW ask 查询开始/结束时间
				eventUrl: "https://wiki.biligame.com/ys/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B4%BB%E5%8A%A8%5D%5D&format=json",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "hsr",
				tz: TZ_CN,
				parserVersion: 1,
				name: "崩坏：星穹铁道",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/64",
				source: "Bwiki \u5386\u53F2\u8DC3\u8FC1",
				url: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2",
				// 独立活动源：星铁活动一览（api.php 带 origin=* 可浏览器直连；「活动时间」表含当期活动）
				eventUrl: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "zzz",
				tz: TZ_CN,
				parserVersion: 2,
				name: "绝区零",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/64",
				source: "官方公告",
				// 默认卡池源=官网公告（api-takumi-static content_v2_user，经 host 代理，无 CORS、无需登录）：
				// 「X.Y版本限时频段（上/下期）」公告含该期精确起止与限定 S 级代理人/音擎；
				// 无当期频段公告或抓取失败时由抓取器自动回退 Bwiki 往期调频；也可在设置中手动切 Bwiki（备选）
				url: ZZZ_NEWS_LIST_URL,
				altSources: [
					{ label: "Bwiki 往期调频", url: ZZZ_BWIKI_URL, fetcher: "zzz-bwiki" }
				],
				// 独立活动源：官方公告（api-takumi-static，与卡池侧同一接口，经 host 代理）。
				// 「…活动说明」公告正文自带【活动时间】起止（含"X.Y版本更新后/版本结束"折算），
				// 官方口径最及时；Bwiki 活动一览作为备选（编辑滞后时反而无当期内容）。
				eventUrl: ZZZ_NEWS_LIST_URL,
				eventSource: "官方公告",
				eventAltSources: [
					{
						label: "Bwiki 活动一览",
						url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
						fetcher: "zzz-event-bwiki"
					}
				]
			},
			{
				id: "wuwa",
				tz: TZ_CN,
				parserVersion: 2,
				name: "鸣潮",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				source: "官方公告",
				// 默认卡池源=官方公告（aki-gm-resources-back，经 host 代理）：
				// entrypoint.json → <dir>/zh-Hans.json，其 `recommend` 组里 tag=7 为逐期「角色/武器活动唤取」，
				// 条目自带 `startTimeMs`/`endTimeMs` 绝对时间戳（不再解析正文，见 parseWuwaNotice）。
				// 无当期公告或抓取失败时由抓取器自动回退 Bwiki 角色轮换池；也可在设置中手动切 Bwiki（备选）
				url: WUWA_NOTICE_ENTRY,
				altSources: [
					{ label: "Bwiki 角色轮换池", url: WUWA_BWIKI_URL, fetcher: "wuwa-bwiki" }
				],
				// 活动源：**默认=同一份官方公告**（`recommend` 组里 tag=5 为限时活动，见 parseWuwaRecommendEvents），
				// 与卡池是**同一条 URL** → 一次请求复用两侧数据。
				// ⚠️ 2026-10-01 改：Bwiki 活动日历页**已停更**（最新一条结束于 2026/9/29，无 3.7 内容），
				// 所以把它从默认**降级为备选**（eventAltSources），仍可在设置里手动切回。
				eventUrl: WUWA_NOTICE_ENTRY,
				eventSource: "官方公告",
				eventAltSources: [
					{ label: "Bwiki 活动日历", url: WUWA_EVENT_BWIKI_URL, fetcher: "wuwa-event-bwiki" }
				]
			},
			{
				id: "arknights",
				tz: TZ_CN,
				// 2：档位改按池名判定（中坚优先）+ 外显与悬停共用同一份排序列表（v0.9.25 修）
				parserVersion: 2,
				name: "明日方舟",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				source: "官方公告+PRTS",
				// 默认卡池源=官方公告 CMS（经 host 代理）：官方只对限时/联动类寻访发公告，
				// 无当期寻访公告（常规轮换周）时由抓取器自动回退 PRTS；也可在设置中手动切 PRTS 卡池一览（备选）
				url: ARKNIGHTS_OFFICIAL_LIST_URL,
				altSources: [
					{ label: "PRTS 卡池一览", url: ARKNIGHTS_PRTS_URL, fetcher: "arknights-prts" }
				],
				// 独立活动源：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）
				eventUrl: "https://prts.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "PRTS \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "endfield",
				tz: TZ_CN,
				parserVersion: 2,
				name: "明日方舟：终末地",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f1/ArknightsEndfieldAppIcon.png!/fw/64",
				source: "Canmoe",
				// 经 host 代理抓取（canmoe 无 CORS 头，浏览器直连会被拦截）；
				// 数据在 Next.js 组件 chunk 的 JS 里，需先抓页面定位 chunk 再抓 chunk 解析
				url: "https://end.canmoe.com/zh-CN/banner-calendar",
				// 卡池备选来源（设置页下拉可切换；GachaTracker 浏览器直连，wiki.gg 经 host 代理）
				altSources: [
					{
						label: "GachaTracker\uff08\u82F1\u6587\uff09",
						url: "https://gachatracker.app/games/endfield/banners/",
						fetcher: "endfield-gachatracker"
					},
					{
						label: "wiki.gg\uff08\u82F1\u6587\uff09",
						// wiki.gg 校验 Referer：抓取器内部经 host 代理（代理默认 Referer=目标 origin 满足要求）
						url: "https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
						fetcher: "endfield-wiki-gg"
					}
				],
				// 独立活动源：FZ Wiki（中文社区维护，经 host 代理抓 RSC 数据；当期并行活动选结束最晚）
				eventUrl: "https://fz.wiki/wiki/%E6%B4%BB%E5%8A%A8",
				eventSource: "FZ Wiki",
				// 活动备选来源：Game8（英文，经 host 代理）
				eventAltSources: [
					{ label: "Game8\uff08\u82F1\u6587\uff09", url: "https://game8.co/games/Arknights-Endfield/archives/535443", fetcher: "endfield-game8" }
				]
			},
			{
				id: "ba-cn",
				tz: TZ_CN,
				parserVersion: 1,
				name: "蔚蓝档案·国服",
				icon: "https://webcnstatic.yostar.net/ba_cn_web/prod/web/favicon.png?x-oss-process=image/resize,w_64",
				source: "\u5B98\u7F51\u516C\u544A",
				// 经 host 代理 POST 抓取（官网 CORS=null + 动态 SPA）；维护说明同时含当期卡池与活动
				url: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				// 活动默认源与卡池源相同（同一公告解析活动名），可独立切换
				eventUrl: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				eventSource: "\u5B98\u7F51\u516C\u544A"
			},
			{
				id: "ba-global",
				tz: TZ_UTC,
				parserVersion: 1,
				name: "蔚蓝档案·国际服",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				source: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 经 host 代理抓取（nexon CORS 只允许同源）；「更新日誌」board(3352) 同时含当期卡池与活动排期
				url: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				// 卡池备选：GameKee（中文标题含排期；默认仍是 Nexon 官方更新日誌）
				altSources: [
					{ label: "GameKee \u5F53\u671F\u5361\u6C60", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				],
				// 活动默认源与卡池源相同（更新日誌解析活动排期），可独立切换（如 GameKee）
				eventUrl: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				eventSource: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 活动备选来源
				eventAltSources: [
					{ label: "GameKee \u5F53\u671F\u6D3B\u52A8", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				]
			},
			{
				id: "ba-jp",
				tz: TZ_JP,
				parserVersion: 1,
				name: "蔚蓝档案·日服",
				icon: "https://play-lh.googleusercontent.com/H975s6W1-boCSogzpF5_rIyawbjiXfG842ncgjIRiVGzhXHFTCVut0DkBhlDR4CgN1nn98OOC1fWN-LE7kUHnQ=s64",
				source: "官方公告（日文）",
				// 日服官网新闻接口（api-web.bluearchive.jp，经 host 代理）：「ピックアップ募集紹介」公告
				// 内含逐池「ピックアップ名／ピックアップ生徒」与「実施期間」，可直接得到日文官方池名与 UP 生徒
				url: BA_JP_NEWS_URL,
				// 卡池备选：GameKee 当期卡池（原标题解析，只有池名+档期、无角色名）
				altSources: [
					{ label: "GameKee 当期卡池", id: "ba-jp:gamekee", fetcher: "ba-jp-gamekee" }
				],
				// 活动源与卡池源保持独立（解耦）：默认仍是原「GameKee 当期活动」条目；
				// 官方公告的イベント条目作为**可选备选**（备选 value 用其接口地址，抓取器 ba-jp-official）
				eventUrl: "https://www.gamekee.com/ba/huodong/15",
				eventSource: "GameKee 当期活动",
				eventAltSources: [
					{ label: "官方公告（日文）", url: BA_JP_NEWS_URL, fetcher: "ba-jp-official" }
				]
			},
			{
				id: "r1999",
				tz: TZ_CN,
				parserVersion: 3,
				name: "重返未来：1999",
				icon: "https://play-lh.googleusercontent.com/LwcueZMBbLq6aELtqJVn61ToKkJUgxEO8O4KgK_5052hfYoDAglQJIzqSu8srUJeaOZwv36Qi5YKtsXZjo-JPg=s64",
				source: "\u5B98\u65B9\u516C\u544A",
				// 默认源＝官方**游戏内公告**接口（经 host 代理 GET）。逐期「征集时间」只在这里发布：
				// 「版本活动一览」公告正文按段落给出【征集时间】起止 + 【征集说明】里的 6★/5★ UP 角色，
				// 以及各活动的【活动时间】；一个版本上下半场两期都列在同一篇里（下期常提前公布）。
				// 接口不可用/结构变了 → 自动回退官网公告解析（旧行为，无逐期时间）；也可在设置里手动切备选源。
				// 来源名口径：默认「官方公告」（与绝区零等条目一致）；备选沿用旧版原名（卡池侧「官网公告+小米」/活动侧「官网公告」）
				url: R1999_NOTICE_URL,
				altSources: [
					{ label: "\u5B98\u7F51\u516C\u544A+\u5C0F\u7C73", url: R1999_OFFICIAL_URL, fetcher: "r1999-official" }
				],
				// 活动源与卡池源是**同一条 URL**（同一篇「版本活动一览」同时含征集与活动），仍作为独立来源存在
				eventUrl: R1999_NOTICE_URL,
				eventSource: "\u5B98\u65B9\u516C\u544A",
				eventAltSources: [
					{ label: "\u5B98\u7F51\u516C\u544A", url: R1999_OFFICIAL_URL, fetcher: "r1999-official" }
				]
			},
			{
				id: "nte",
				tz: TZ_CN,
				parserVersion: 2,
				name: "异环",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/8/8c/YH_APP.png!/fw/64",
				source: "官网公告",
				// 经 host 代理抓取（wanmei 跨域无 CORS）；官方公告（服务端渲染）含当期限定棋盘卡池 + 限时活动起止
				url: "https://yh.wanmei.com/news/gamebroad/",
				// 活动源同官网公告（同一公告同时含卡池与活动）
				eventUrl: "https://yh.wanmei.com/news/gamebroad/",
				eventSource: "官网公告",
				// 备选：LDSHOP（静态表格，经 host 代理）
				altSources: [
					{ label: "LDSHOP", url: "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html", fetcher: "nte-ldshop" }
				]
			}
		];
		//#endregion

		//#region scrape parsers
		// 纯函数解析器：同一 HTML 输入必然产生同一输出（确定性），
		// 保证网页内容未变时手动刷新结果保持一致。
		function stripTags(s) {
			return (s || "")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]+>/g, "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#91;/g, "[")
				.replace(/&#93;/g, "]")
				.replace(/&#39;/g, "'")
				.replace(/&#8211;/g, "\u2013")
				.replace(/&#160;/g, " ")
				.replace(/&nbsp;/g, " ")
				// 通用数字实体兜底：源站会用**白名单之外**的数字实体（FGO 卡池一览实测 89 处 `&#32;`，
				// 即空格），旧实现只认上面那几个硬编码 → 面板上直接显示成
				// `阿蒂拉&#32; 罗摩&#32; 兰斯洛特(Saber)&#32; …`（2026-10-03 修）。
				// 位置刻意放在硬编码白名单**之后**：已知实体优先，尽量不改变既有解析结果。
				// 注：`next-sources/lib/env.js` 的 decodeEntities 本来就是通用实现，
				//     这次补齐后两者语义一致，不再有"测试对、插件错"的落差。
				.replace(/&#(\d+);/g, (m, n) => {
					try { return String.fromCodePoint(Number(n)); } catch { return m; }
				})
				.replace(/\s+/g, " ")
				.trim();
		}

		// 「版本更新后」这类**只有日期没有时分**的写法，默认按当日该时刻折算。
		// 为什么需要一个默认值：源站常见 `2026/09/28 4.6版本更新后`（日期 + 版本标签的混合体），
		// 日期是明确的，缺的只是时分；不补的话 startTs 会是 null，外显只能回落源站原文
		// （星铁活动列一度显示成 `2026/09/28 4.6版本更新后 ~ 11-10 15:00`，与其它游戏的
		// `09-28 04:00 ~ 11-10 15:00` 口径不一致）。
		// 取 04:00 是因为国内二游版本更新普遍落在凌晨维护窗口（该表内 04:00 出现最多），
		// 拿它当锚点比"不补"更接近真实，也不会让"活动是否已开始"的判定偏移一天。
		const VERSION_UPDATE_ANCHOR = { h: 4, mi: 0 };

		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		// `tz`（可选）= 源站墙钟时区（见 15-env.js / 20-sources.js 的 `tz`）。
		// 传了 → 绝对时刻按**源站时区**换算；不传 → 沿用本机时区（= 改造前行为）。
		// **text 一律是源站墙钟原文**，不随 tz 变 —— 玩家看游戏内公告走的就是这串时间。
		//
		// 兜底：`sourceInstant` 定义在 15-env.js。若调用方只把本文件单独抽出来用
		// （回归脚本用 `new Function` 注入单个函数、或把 core 拆到别处），它可能不在作用域；
		// 那时退回 `new Date(...)`（本机时区）而不是抛 ReferenceError ——
		// 少一次时区换算，但绝不让"抽函数"这种用法直接崩掉。
		function parseTime(s, tz) {
			const mkTs = (y, mo, d, h, mi) => (typeof sourceInstant === "function"
				? sourceInstant(y, mo, d, h, mi, tz)
				: new Date(y, mo - 1, d, h, mi).getTime());
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (m) {
				const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			// 回退：`YYYY/MM/DD <版本更新后>`（日期 + 版本标签，缺时分）→ 按锚点时刻补全。
			// 注意只认**带日期前缀**的这种；纯标签（`4.6版本更新后`）保持 null —— 那种确实
			// 给不出日期（下一版本何时更新是未知的），硬造时间会错得更离谱。
			const v = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后)/);
			if (v) {
				const y = Number(v[1]), mo = Number(v[2]), d = Number(v[3]);
				const { h, mi } = VERSION_UPDATE_ANCHOR;
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			return { ts: null, text: null };
		}

		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		// `tz` 同 parseTime：源站墙钟时区（可选，不传 = 本机时区）
		function parseRange(raw, tz) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0], tz);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0], tz);
			const b = parseTime(parts[1], tz);
			return {
				startTs: a.ts, endTs: b.ts,
				startText: a.text ?? parts[0], endText: b.text ?? parts[1],
				raw: `${a.text ?? parts[0]} ~ ${b.text ?? parts[1]}`
			};
		}

		// 角色名清理：去首尾方括号/空白（zzz 的 [希格莉德（强攻·冰）]）
		function cleanRoles(roles) {
			const r = stripTags(roles).replace(/^[\[【\s]+|[\]】\s]+$/g, "");
			return r;
		}

		// 主池过滤：排除武器/光锥/音擎/回响/重映等副池
		function isMainBanner(banner) {
			if (!banner) return false;
			if (/武器|光锥|音擎|回响|重映|神铸赋形|流光定影|溯回忆象/.test(banner)) return false;
			return /角色活动祈愿|角色活动跃迁|独家频段|寻访|频段/.test(banner) || banner.includes("「");
		}

		// bwiki 通用：解析所有含「时间+版本」的卡池表（原神/星铁/绝区零）
		function parseAllBwiki(html, tz) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>\s*时间\s*<\/th>/i.test(body)) continue;
				if (!/<th[^>]*>\s*版本\s*<\/th>/i.test(body)) continue;
				let banner = "";
				const tc = body.match(/<th[^>]*colspan\s*=\s*"?2"?[^>]*>([\s\S]*?)<\/th>/i);
				if (tc) {
					const alt = tc[1].match(/<img[^>]*alt\s*=\s*"([^"]*)"/i);
					banner = alt ? alt[1] : stripTags(tc[1]);
				}
				if (!banner) {
					const t2 = body.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
					if (t2) banner = stripTags(t2[1]);
				}
				const timeM = body.match(/<th[^>]*>\s*时间\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				const charM = body.match(/<th[^>]*>\s*(?:5星角色|S级代理人|6星干员|5星干员)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				if (!timeM) continue;
				const range = parseRange(timeM[1], tz);
				out.push({
					banner,
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}

		// 方舟：解析「干员轮换卡池」（标准寻访/当期轮换池）所有数据行。
		// 该表行结构：序号 | 寻访页面(title=寻访模拟/干员轮换卡池N) | 开启时间 | 特定干员(6星) | 特定干员(5星)。
		// 兼容历史「限时寻访」表（寻访页面|开启时间|特定干员6星|特定干员5星&4星）作为兜底。
		function parseArknights(html, tz) {
			const out = [];
			// 标准（干员轮换卡池N）+ 中坚（中坚甄选N / 中坚干员轮换卡池N）：
			// 行内 title="寻访模拟/<池名>"。**档位按池名判定且中坚优先**——「中坚干员轮换卡池74」
			// 名字里也含"干员轮换卡池"，先测标准会把整批中坚池误判进标准档（实测踩过）。
			for (const rm of html.matchAll(/<tr(?:[^>]*)>([\s\S]*?)<\/tr>/g)) {
				const row = rm[1];
				const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
				if (tds.length < 3) continue;
				const titleM = (tds[1] || "").match(/title="([^"]*)"/);
				if (!titleM) continue;
				const banner = String(titleM[1]).replace(/^寻访模拟\//, ""); // 干员轮换卡池192 / 中坚甄选14
				if (!/干员轮换卡池|中坚甄选/.test(banner)) continue;         // 只认这两类轮换池行
				const tier = /中坚/.test(banner) ? "中坚" : "标准";
				const roles = [...((tds[3] || "") + (tds[4] || "")).matchAll(/<a[^>]*title="([^"]+)"/g)]
					.map((m) => m[1]).filter(Boolean);
				const range = parseRange(tds[2], tz);
				out.push({ tier, banner, roles: roles.join("、"), ...range, isMain: true });
			}
			// 限时（联合行动/限定）：解析「限时寻访」表
			const i = html.indexOf("限时寻访");
			if (i >= 0) {
				const seg = html.slice(i);
				const tableM = seg.match(/<table[^>]*>([\s\S]*?)<\/table>/);
				if (tableM) {
					const body = tableM[1];
					for (const rm of body.matchAll(/<tr>([\s\S]*?<td[\s\S]*?)<\/tr>/g)) {
						const row = rm[1];
						const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
						if (tds.length < 2) continue;
						const banner = stripTags(tds[0]);
						if (!banner) continue;
						const roles = tds.length > 2
							? [...tds[2].matchAll(/<a[^>]*href="\/w\/[^"]*"[^>]*title="([^"]*)"/g)]
								.map((m) => m[1].trim()).filter(Boolean).join("、")
							: "";
						const range = parseRange(tds[1], tz);
						out.push({ tier: "限时", banner, roles, ...range, isMain: true });
					}
				}
			}
			return out;
		}

		// 明日方舟当期卡池：**外显与悬停共用同一份"当期池"列表**（不再各挑一个）——
		// 外显按档位优先（限时 > 标准 > 中坚）、档内先结束者优先；悬停走统一的 buildPoolHover，
		// 与其它游戏同格式（每池『池名：角色』+ 时间行、同窗口合并时间、结束时间升序）。
		function selectArknights(html, now = nowMs(), tz) {
			const items = parseArknights(html, tz);
			fillMissingStarts(items);
			const tiers = ["限时", "标准", "中坚"];
			const rank = (it) => {
				const i = tiers.indexOf(it.tier);
				return i < 0 ? tiers.length : i;
			};
			const active = items
				.filter((it) => coversNowBounded(it, now))
				.sort((a, b) => (rank(a) - rank(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs));
			if (active.length === 0) return null;
			const win = active[0];
			return {
				banner: win.banner,
				roles: win.roles,
				bannerDates: win.raw,
				bannerDatesRaw: win.rawOriginal || win.raw,
				bannerHover: buildPoolHover(active.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${it.roles}` : ""}`,
					startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw
				})))
			};
		}

		// ---- 明日方舟官方公告（web-news.hypergryph.com CMS，code=arknights）----
		// 官方 CMS：列表接口的 brief 被服务端截断（只有时间与开头几个 UP），角色全量需按 cid 取详情。
		// 标题格式：[家族]【池名】限时寻访(即将)开启；brief 首段即"活动时间：X月X日 HH:mm - X月X日 HH:mm"。

		// 从公告正文/brief 提取 UP 干员（"★★★★★★：结城理（占…）★★★★★：埃癸斯 / 岳羽由加莉（…）"）
		function parseAkOfficialRoles(text) {
			const s = String(text || "")
				.replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\\/g, " ")
				.replace(/\s+/g, " ");
			const segM = s.match(/(?:出现率上升|获得概率提升)\s*([\s\S]*?)(?:注意|抽取概率公示|在本期|$)/);
			const seg = segM ? segM[1] : s;
			const names = [];
			for (const um of seg.matchAll(/(?:★{3,6})\s*[：:]\s*([^★（(\n]+)/g)) {
				for (let tok of String(um[1]).split(/[\/、,，\\\s]+/)) {
					tok = tok.replace(/\[[^\]]*\]/g, "").trim();
					if (tok && !/^[0-9.%占出率概]+$/.test(tok) && tok.length >= 2 && tok.length <= 10) names.push(tok);
				}
			}
			return [...new Set(names)].join("、");
		}

		// 列表 → 当期 限时/联动寻访池数组（bannerDates 统一为 "MM-DD HH:mm ~ MM-DD HH:mm"）
		function parseAkOfficialPools(list, now = nowMs()) {
			const nowYear = new Date(now).getFullYear();
			const out = [];
			for (const it of list || []) {
				const title = String(it.title || "");
				const brief = String(it.brief || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
				if (!/寻访/.test(title) || !/活动时间/.test(brief)) continue;
				const nameM = title.match(/【([^】]+)】\s*限时寻访/);
				if (!nameM) continue;
				const timeM = brief.match(/活动时间\s*[：:]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})\s*[-—~]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!timeM) continue;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(timeM[1]), sd = Number(timeM[2]);
				const em = Number(timeM[5]), ed = Number(timeM[6]);
				const startTs = mk(nowYear, sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endTs = mk(endsNextYear(sm, null, em, null) ? nowYear + 1 : nowYear, em, ed, Number(timeM[7]), Number(timeM[8]));
				if (startTs > now || endTs < now) continue; // 只要当期覆盖
				const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				const startText = fmt(sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endText = fmt(em, ed, Number(timeM[7]), Number(timeM[8]));
				const raw = `${startText} ~ ${endText}`;
				const familyM = title.match(/^\[([^\]]+)\]/);
				out.push({
					cid: String(it.cid || ""),
					family: familyM ? familyM[1] : "",
					banner: nameM[1],
					roles: parseAkOfficialRoles(brief),
					bannerDates: raw,
					bannerDatesRaw: raw,
					startTs, endTs, startText, endText, raw,
					tier: "限时",
					isMain: true
				});
			}
			return out;
		}

		// 官方当期限时寻访（经 host 代理：列表 + 每池详情各 1 次请求）
		async function fetchArknightsOfficialPools(signal, now = nowMs()) {
			const ref = "https://ak.hypergryph.com/";
			const listUrl = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";
			const json = await proxyFetchJson(listUrl, ref);
			const list = Array.isArray(json?.data?.list) ? json.data.list : [];
			const pools = parseAkOfficialPools(list, now);
			await Promise.all(pools.map(async (p) => {
				try {
					const d = await proxyFetchJson(`${AK_OFFICIAL_BULLETIN}/${p.cid}?lang=zh-cn&code=arknights`, ref);
					const content = typeof d?.data?.data === "string" ? d.data.data : "";
					if (content) {
						const roles = parseAkOfficialRoles(content);
						if (roles) p.roles = roles;
					}
				} catch { /* 详情失败保留 brief 解析的角色 */ }
			}));
			return pools;
		}

		// 方舟卡池默认抓取器：官方公告 CMS 优先（当期限时/联动寻访），
		// 官方无当期寻访公告（常规轮换周）或官方失败时自动回退 PRTS 卡池一览（逻辑同 selectArknights）。
		// 设置页手动切到 PRTS 备选源时则走 GACHA_FETCHERS["arknights-prts"]，不经本函数。
		async function fetchArknightsGacha(url, signal, tz, now = nowMs()) {
			try {
				const official = await fetchArknightsOfficialPools(signal, now);
				if (official.length > 0) {
					// 外显与悬停同源同序：先结束者优先（与 PRTS 路径、其它游戏一致），不再取列表首条
					const sorted = official.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
					const p = sorted[0];
					// 悬停：与其它游戏统一为「池名：角色」+ 时间（多池时逐池一行、同窗口合并时间、结束时间升序）
					const pools = sorted.map((x) => ({
						name: x.banner,
						label: `${x.banner}${x.roles ? `\uFF1A${x.roles}` : (x.family ? `\uFF1A${x.family}` : "")}`,
						startTs: x.startTs,
						endTs: x.endTs,
						raw: x.raw || x.bannerDatesRaw || x.bannerDates
					}));
					return {
						banner: p.banner,
						roles: p.roles,
						bannerDates: p.bannerDates,
						bannerDatesRaw: p.bannerDatesRaw,
						bannerHover: buildPoolHover(pools)
					};
				}
			} catch { /* 官方失败 → 回退 PRTS */ }
			const apiUrl = ARKNIGHTS_PRTS_URL + (ARKNIGHTS_PRTS_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			const d = selectArknights(html, now, tz);
			return d ? { ...d } : null;
		}

		// 通用规则：起始时间为"版本更新后"等无具体日期的卡池，继承前一组（按结束时间分组）
		// 卡池的结束时间 —— 同一维护时间点（如星铁 4.5 上半的"4.5版本更新后" = 4.4 下半的结束时间）。
		// 不针对任何游戏特判：所有经 selectCurrent 的解析器统一受益。
		// 补全时保留源站原文（rawOriginal），供面板悬停显示原文（倒计时仍用补全后的时间）。
		function fillMissingStarts(items) {
			const byEnd = items.filter((it) => it.endTs != null).slice().sort((a, b) => a.endTs - b.endTs);
			let groupEnd = null, groupText = null;
			let i = 0;
			while (i < byEnd.length) {
				let j = i;
				while (j < byEnd.length && byEnd[j].endTs === byEnd[i].endTs) j++; // 相同结束时间成组
				if (groupEnd != null) {
					for (let k = i; k < j; k++) {
						const cur = byEnd[k];
						if (cur.startTs == null && groupText) {
							if (!cur.rawOriginal) cur.rawOriginal = cur.raw; // 保留源站原文（如"4.5版本更新后 ~ …"）
							cur.startTs = groupEnd;
							cur.startText = groupText;
							cur.raw = `${groupText} ~ ${cur.endText ?? ""}`.trim();
						}
					}
				}
				groupEnd = byEnd[i].endTs;
				groupText = byEnd[i].endText;
				i = j;
			}
		}

		// 选当期：优先"起始明确且覆盖 now"的主池；
		// 其次"起始未知（版本更新后）但结束在未来"的主池（星铁/zzz 上半，此时起始已被 fillMissingStarts 补齐）；
		// **当期多个主池的角色全部合并**（见下方合并说明）。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			// 先记下**补全前**哪些行的起点是"版本更新后"（startTs 原本为 null）。
			// 为什么要记：fillMissingStarts 会用"上一组结束时间"去猜这类行的起点，
			// 而那个猜测**并非总是对的** —— 星铁 4.6 上线时间期有两池：
			//   「韶艾裁英」4.6版本更新后 ~ 10-21 11:59
			//   「沧海萃珠」4.6版本更新后 ~ 11-10 15:00
			// 两者同为"4.6 上线"，只是结束不同；按"上一组结束"补会把后者补成 10-21，
			// 于是"起点已过"判定失败、它被踢出当期 —— 而它其实覆盖当前时刻
			// （用户实测：卡片只显示绯英，真珠不见了）。
			const hadOpenStart = new Set(items.filter((it) => it.startTs == null).map((it) => it));
			fillMissingStarts(items);
			const inWindow = (it) => it.endTs != null && it.endTs >= now
				&& (it.startTs == null ? true : it.startTs <= now || hadOpenStart.has(it));
			// 说明最后一个条件：起点原本为 null（写作"版本更新后"）的行，**一定已经开始**——
			// 源站表只列**已发布版本**的排期，"X.Y版本更新后"里的 X.Y 必已上线，
			// 所以它的真实起点在版本更新那天（≤ now），补出来的那个值不可信、不应用来判"未开始"。
			// 注意这里**不覆盖**补全后的 startTs：显示（bannerDates 等）仍用补出来的窗口，
			// 悬停也仍显示源站原文"4.6版本更新后 ~ …"，不编造日期。
			const pool = items.filter(inWindow).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			// 外显取哪个池的"名字与时间"：结束最早的（越快结束越该被盯住）。
			//
			// ⚠️ 合并条件（用户要求，2026-09-30 改）：
			//   旧 = 起止**完全相同**才合并 → 星铁同期两池结束不同就只合到自己，
			//        卡片只显示一个池的角色。
			//   新 = **当前时刻落在其持续区间内的主池全部合并**（就是这个 `pool`）。
			const first = pool.slice().sort((a, b) => a.endTs - b.endTs)[0];
			const roles = [...new Set(pool.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				roles,
				bannerDates: first.raw,
				bannerDatesRaw: first.rawOriginal || first.raw
			};
		}

		// MM-DD HH:MM（同年窗口用）
		// 时间戳 → 显示文本。`tz`（可选）= **按该时区渲染**（源站时区）。
		// 为什么必须带 tz：绝对时刻已按源站时区换算，若文本仍按本机时区渲染，
		// 海外用户会看到"文本与时刻不一致"（例如源站写 09-30 04:00，却显示 09-29 20:00）。
		// 传 tz 后：**文本 = 源站墙钟**（与游戏内公告一致）、**时刻 = 正确绝对时刻**，两边统一。
		// 不传 tz 时行为与改造前完全一致（本机时区）。
		//
		// 兜底同 parseTime：`sourceWallParts` 在 15-env.js，单抽本文件时可能不在作用域。
		function wallOf(ts, tz) {
			if (typeof sourceWallParts === "function") return sourceWallParts(ts, tz);
			const d = new Date(ts);
			return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
		}
		function fmtMdHm(ts, tz) {
			const w = wallOf(ts, tz);
			return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
		}

		// YYYY-MM-DD HH:MM（跨年窗口用：避免"05-15 16:00 ~ 05-15 03:59"看着像结束早于开始）
		function fmtYmdHm(ts, tz) {
			const w = wallOf(ts, tz);
			return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
		}

		// 窗口起止文本：两端同一年 → MM-DD；跨年 → 两端都带年份
		function fmtWindow(startTs, endTs, tz) {
			const sameYear = wallOf(startTs, tz).y === wallOf(endTs, tz).y;
			return sameYear ? `${fmtMdHm(startTs, tz)} ~ ${fmtMdHm(endTs, tz)}` : `${fmtYmdHm(startTs, tz)} ~ ${fmtYmdHm(endTs, tz)}`;
		}

		// ── 「长期/常驻窗口」通用规则（**唯一真源**）────────────────────────────────
		// 判定：声明窗口超过该天数的不当作"当期"（外显与悬停共用，①）。
		// 依据：各游戏限时活动实测最长约 84 天（原神），而常驻玩法动辄半年以上——
		// 明日方舟 PRTS 活动一览里「生息演算：重启锚点」245 天、「集成战略：沉沦者的黑流树海」179 天，
		// 两者都是常驻玩法（表内含"进行中"徽标），且因外显不带年份会被误读成"结束早于开始"。
		//
		// ⚠️ 2026-10-03 收敛：这条规则此前有 **3 套实现 / 2 个值** ——
		//   · 本文件 `EVENT_MAX_WINDOW_DAYS = 120` + `isLongTermEvent`（事件侧）
		//   · `41-sources-shared.js` `HOVER_MAX_WINDOW_DAYS = 120` + `hoverIsLongTerm`（**逐字重复**）
		//   · `42-parsers-bestdori.js` `LONG_MS = 400 天` ← **值不同**（sekai 是 120）
		//   实测：bestdori 历史上有 22 个窗口落在 (120, 400] 天之间（全是「新手限定/回归纪念/
		//   每日免费/少女们的回忆/开服纪念」这类长期池）→ 在 400 天下会被误判成"当期"。
		//   当前真实在架池里恰好 0 个落在这个区间，所以是**潜在**不一致而非现行 bug；
		//   但既然是同一条规则，就不该有第二个值。现在统一到下面这一处。
		const LONG_TERM_MAX_WINDOW_DAYS = 120;

		/** 声明窗口超阈值 = 长期/常驻（不当作"当期"）。名与阈值都只有这一处。 */
		function isLongTermWindow(x) {
			return !!x && x.startTs != null && x.endTs != null && (x.endTs - x.startTs) > LONG_TERM_MAX_WINDOW_DAYS * 864e5;
		}

		// 旧名（事件侧语境下可读性更好）。**只是别名**，判定逻辑仍在上面。
		function isLongTermEvent(x) { return isLongTermWindow(x); }

		// ── 「覆盖 now」与「选当期」（**唯一真源**）────────────────────────────────
		// 2026-10-03 普查：全仓有 **92 处**「覆盖 now」判定、**25 种写法**，实质只有 3 种方言：
		//   ① `x.startTs <= now && x.endTs >= now`                        ← 主流
		//   ② `endTs != null && endTs >= now && (startTs == null || startTs <= now)`  ← 显式容许 open start
		//   ③ `startTs != null && endTs != null && startTs <= now && endTs >= now`    ← 两端都要求
		// 其中 **① 与 ② 完全等价**（`startTs == null` 时 `null <= now` 恒真），只是②写得更"诚实"；
		// ③ 更严：它把 startTs 为 null 的行排除掉。所以只需要两个判定，各写各的没有意义。
		//
		// `endTs == null` 表示"没有结束时间"（永久/常驻，或源站没给）——**不覆盖 now**（不以"没结束"当"永远在开"）。

		/** 覆盖 now（常用）：起可为 null（视为"已开始"，如源站写"X.Y版本更新后"），末必须有且未过。 */
		function coversNow(x, now) {
			return !!x && x.endTs != null && x.endTs >= now && (x.startTs == null || x.startTs <= now);
		}

		/** 覆盖 now（**两端都必须有**）：需要明确起止的场合（如按窗口合并/排序的源）。 */
		function coversNowBounded(x, now) {
			return !!x && x.startTs != null && x.endTs != null && x.startTs <= now && x.endTs >= now;
		}

		/**
		 * 选「当期」条目（唯一真源）。在 `coversNow` 之上再加可选条件：
		 *   now            选哪一刻（毫秒，必传）
		 *   kind           只取 `x.kind === kind` 的行（biligame 系用）
		 *   bounded        true → 用 `coversNowBounded`（要求两端都有）
		 *   dropLongTerm   true → 剔除长期/常驻窗口（`isLongTermWindow`）；默认 **false**（保持各源原有语义）
		 *   sort           可选比较函数，对结果排序
		 *   first          可选 true → 只返回第一条（排序后）
		 *   map            可选，先做一次映射再判定（如把 `{win:{startTs,…}}` 摊平）
		 *
		 * ⚠️ `dropLongTerm` 默认 false 是**故意的**：多数调用点原本就没做这个过滤，
		 *    擅自打开会改变选择结果。要改的站点逐个显式打开。
		 *
		 * ⚠️ 名字：不叫 `pickCurrent` —— 那个名字在**本文件上方**已被抓取器工厂占用
		 *    （`const pickCurrent = (parse) => (html) => selectCurrent(...)`）。
		 *    同作用域重名会让产物直接语法错误（构建守卫会报出来）。
		 */
		function pickCovering(items, opts) {
			const o = opts || {};
			const now = o.now;
			const pred = o.bounded ? coversNowBounded : coversNow;
			let list = (Array.isArray(items) ? items : []).filter((x) => x && (o.kind == null || x.kind === o.kind) && pred(x, now));
			if (o.dropLongTerm) list = list.filter((x) => !isLongTermWindow(x));
			if (typeof o.sort === "function") list = list.slice().sort(o.sort);
			return o.first ? (list[0] || null) : list;
		}

		// ── 无年份日期的两条通用规则（**唯一真源**）──────────────────────────────
		// 源站常写「10月22日」这种**不带年份**的日期（限时活动、卡池档期）。要把它变成绝对时刻，
		// 必须回答两个问题；此前各解析器各写各的，共 12+ 处、4 种写法：
		//   A. 这是**哪一年**？—— 借一个"年份线索"（通常是公告发布时刻的墙钟）
		//   B. 结束日期排在开始日期之前 —— 说明**跨年**了（12/28 ~ 1/5），结束该算次年
		// 2026-10-03 收敛：`yearOf` 在 biligame-activity 与 ournotes-global 里**逐字相同**；
		//   「月+日都有的跨年判定」有 **4 处逐字相同**的副本（bandori / biligame-activity /
		//   ournotes-global / umamusume-official），另有 4 处只有月份的退化版。

		/** 月份比线索月晚这么多 → 该日期只可能是**上一年**（例：线索 1 月，档期写 12 月）。 */
		const YEAR_HINT_MONTH_GAP = 6;

		/**
		 * 补年份。`hint` = `{ y, mo }`（本地墙钟字段，通常来自公告发布时刻）。
		 * · 已有年份 → 原样返回
		 * · **没有线索 → 返回 null（不猜当前年）** —— 宁可这条档期不产出，也不编一个年份出来
		 *   （猜错会把整条档期挪到错误的时间，比"未公布"更糟；`40-fetchers.js` 里那条 45 天规则
		 *     属于"能拿到 now 但拿不到公告年"的少数源，单独保留并注明）
		 */
		function inferYear(y, mo, hint) {
			if (y != null) return y;
			if (!hint || hint.y == null) return null;
			return mo > hint.mo + YEAR_HINT_MONTH_GAP ? hint.y - 1 : hint.y;
		}

		/**
		 * 「结束排在开始之前」= 跨年，结束应记次年。
		 * `sd` / `ed` 可省（只有月份信息时退化为按月比较）——这一点覆盖了此前 4 处只有月份的写法。
		 */
		function endsNextYear(sm, sd, em, ed) {
			if (em !== sm) return em < sm;
			if (sd == null || ed == null) return false;
			return ed < sd;
		}

		// 永久/常驻活动判定：源站把「结束时间」写成 `永久`（星铁「星际碰碰好搭档！」等）。
		// 这类行 endTs 为 null，**过去被静默丢弃**——不是判定为"非当期"，而是连痕都没留下，
		// 表现为"源站表里有、面板悬停里没有"（用户点名要修）。
		// 现在显式识别：外显仍不选它（永久活动没有"当期"语义、也就没有倒计时），
		// 但悬停里以一行计数如实交代，不再无声消失。
		//
		// ⚠️ **必须同时满足 endTs == null**：星铁表里大量正常限时活动的**类别**叫
		// 「版本活动 常驻活动」「常驻活动 联动活动」（wiki 的命名习惯），但它们都有明确结束时间。
		// 只按名字判会把 39 条限时活动全误判成永久（实测踩到）。有结束时间 = 限时，不做特例。
		function isPermanentEvent(x) {
			if (!x || x.endTs != null) return false;
			if (/永久/.test(`${x.cat || ""} ${x.tags || ""}`)) return true;
			return /永久\s*$/.test(String(x.raw || ""));
		}

		// 活动列表统一排序（③）：结束时间升序（越快结束越靠前）；结束时间无/未知/未抓到的排最后；
		// 同结束时间再按开始时间升序。同时剔除常驻/长期玩法与空名行（①）。
		// 外显取排序后的第一条，悬停按同序逐行展示 —— 两处共用本函数保证一致。
		function sortEventItems(items) {
			return (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x))
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
		}

		// 活动类别优先级（只影响"外显"挑选，不影响悬停排序）：
		// 第一档 = 剧情/叙事类活动 + 限时高难玩法（剧情/叙事/故事、总力战/大决战、危机合约、挑战活动…）；
		// 其余为第二档。判定优先级：有类别字段（原神 SMW「类型」、星铁/绝区零表「类型」列、方舟分类前缀、
		// 终末地 tags、蔚蓝国际服 cat 列）就按类别判定；源头没有类别信息时才回退按活动名匹配关键词。
		const EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|冥歌海墟|全息/;

		function eventTier(x) {
			const cat = `${x?.cat || ""} ${x?.tags || ""}`.trim();
			const hay = cat || `${x?.name || ""}`;
			return EVENT_TIER1_RE.test(hay) ? 1 : 2;
		}

		// 外显挑选：先按类别档位（第一档优先），同档内按结束时间升序（③ 越快结束越靠前，
		// 结束时间未知排最后）；悬停仍按 endTs 升序全量展示，不受类别影响。
		function pickEventPrimary(items) {
			return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
				const t = eventTier(a) - eventTier(b);
				if (t !== 0) return t;
				const ea = a.endTs == null ? Infinity : a.endTs;
				const eb = b.endTs == null ? Infinity : b.endTs;
				if (ea !== eb) return ea - eb;
				const sa = a.startTs == null ? Infinity : a.startTs;
				const sb = b.startTs == null ? Infinity : b.startTs;
				return sa - sb;
			})[0] || null;
		}

		// 永久/常驻活动的计数行。抽成函数是为了**措辞只有一处**，并让守卫能直接断言文案
		// （曾经的写法是 `常驻/永久活动 N 项（无结束时间，不参与倒计时）`，用户要求改为
		// `以及常驻活动 N 项`）。
		function permanentLine(count) {
			return count > 0 ? `以及常驻活动 ${count} 项` : "";
		}

		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		// permanentCount：永久/常驻活动的条数（不参与排序，只在末尾补一行计数，避免"源站有、面板没有"）。
		function buildEventHover(items, permanentCount = 0) {
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x));
			// 只有 1 条当期活动时，本函数仍返回 ""（由 UI 单条展示）；但若还有永久活动，
			// 就必须把那一行计数带上，否则永久活动又变成看不见。
			if (list.length < 2) {
				return permanentLine(permanentCount);
			}
			const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
			const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
			const lines = list.map((x) => {
				// 有起止的行按行带时间（全部同窗口时只在末尾写一遍）；缺起止的行原样显示该行原文
				if (x.startTs != null && x.endTs != null) {
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			if (permanentCount > 0) lines.push(permanentLine(permanentCount));
			return lines.join("\n");
		}

		// 卡池列悬停（统一格式，沿用方舟/面板既有"换行"排版）：
		// 每池两行 —— "池名：角色" + "起止时间"；窗口完全相同的池合并时间（只在末尾写一遍）；
		// 排序：结束时间升序（无/未知结束时间排最后）。
		// 外显不受此函数影响：仍按各源原有逻辑（同窗口角色合并）。兜底：0/1 池返回 ""，退回单条展示。
		function buildPoolHover(pools) {
			const list = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
			if (list.length < 2) return "";
			const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
			const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
			const lines = [];
			for (const p of list) {
				lines.push(p.label || p.name);
				if (same) continue;
				const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs) : String(p.raw || "").trim();
				if (t) lines.push(t);
			}
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			return lines.join("\n");
		}

		// 鸣潮：角色轮换池页（Bwiki 汇总页，逐期列出）→ 取"覆盖当前时刻"的那一组：
		// 每一组 = 该组 data-start/data-end 之后、到下一组之前的那段里的「共鸣者/xxx」。
		// 旧实现取页面第一组时间 + 整页前 6 个角色名 → 备选/兜底源会显示"过期档期 + 跨池混入的角色"，
		// 且不报任何失败（实测该页当前只有一组已过期计时器）。没有覆盖当前的组 → 返回 null（未公布）。
		function parseWuwaPool(html, now = nowMs(), tz) {
			const text = String(html || "");
			const marks = [...text.matchAll(/data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
			// 页面拿到了却一个计时器都没有 → 汇总页改版（抛错让面板显示"卡池失败"），
			// 而不是伪装成"新卡池未公布"（这是本条目的备选/兜底源）
			if (marks.length === 0) throw new Error("wuwa-pool-no-timer");
			for (let i = 0; i < marks.length; i++) {
				const m = marks[i];
				const start = parseTime(m[1], tz);
				const end = parseTime(m[2], tz);
				if (start.ts == null || end.ts == null) continue;
				if (!(start.ts <= now && now <= end.ts)) continue;
				const seg = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length);
				const chars = [...new Set([...seg.matchAll(/共鸣者\/([^"]+)"/g)].map((x) => x[1]))].slice(0, 6);
				if (chars.length === 0) continue;
				return {
					banner: "\u89D2\u8272\u6362\u53EC\u6C60",
					roles: chars.join("、"),
					startTs: start.ts, endTs: end.ts,
					bannerDates: `${start.text} ~ ${end.text}`
				};
			}
			return null;
		}

		// 鸣潮官方公告解析：从全量公告（game/activity/recommend）中取"覆盖当前时刻"的「角色活动唤取」。
		//
		// ⚠️ 时间**必须用 JSON 里的绝对时间戳** `startTimeMs` / `endTimeMs`，不要再去解析正文。
		// 正文写的是 `✦活动时间✦ 3.7版本更新后 ~ 2026年10月22日09:59（服务器时间）` ——
		// 起始端是**版本标签**而非绝对日期，旧实现用 `(\d{4})年(\d{1,2})月…` 匹配整段 → 恒失败 →
		// 卡池侧返回 null（2026-10-01 实测：官方 JSON 已带 3 个在开角色池，却显示"未公布"）。
		// 现在源站直接给了时间戳，比解析正文更准，也不受措辞漂移影响。
		function parseWuwaNotice(list, now = nowMs(), tz) {
			const groups = [list?.game, list?.activity, list?.recommend].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
				.replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const pools = [];
			for (const arr of groups) {
				for (const it of arr) {
					// 标题可能是 "[但愿长圆如此夜]\n角色活动唤取" / "「玉阙玄华」武器活动唤取"
					const title = stripH(it.tabTitle || it.title || "").replace(/\s+/g, " ").trim();
					const isChar = /角色活动唤取/.test(title);
					const isWeapon = /武器活动唤取/.test(title);
					if (!isChar && !isWeapon) continue;
					const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
					if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
					if (sTs > now || eTs < now) continue; // 只要当期覆盖
					const name = title
						.replace(/\s*(?:角色|武器)活动唤取\s*$/, "")
						.replace(/^[\[【「]\s*/, "")
						.replace(/\s*[\]】」]$/, "")
						.trim();
					if (!name) continue;
					// 类型名（外显用）：标题尾部那一段，如 `角色活动唤取` / `武器活动唤取`
					const type = isChar ? "角色活动唤取" : "武器活动唤取";
					// 角色名：正文开头那句「活动期间，5星角色「心」，4星角色「卜灵」、「桃祈」、「釉瑚」唤取概率限时提升！」
					// 用 [^。！？\n]+ 限在一句内，避免把后面「唤取说明」里的角色也带进来
					const text = stripH(it.content || "");
					const upM = text.match(/活动期间，([^。！？\n]+?)唤取概率限时提升/);
					const roles = upM
						? [...new Set([...upM[1].matchAll(/[「【]([^」】]+)[」】]/g)].map((x) => x[1].trim()).filter(Boolean))].join("、")
						: "";
					pools.push({ name, type, isChar, roles, startTs: sTs, endTs: eTs });
				}
			}
			const cur = pools.filter((p) => p.isChar && p.name);
			if (cur.length === 0) return null;
			// 外显与窗口取**结束最早**的那个池（与 selectCurrent 的 first 同口径）。
			const first = cur.slice().sort((a, b) => a.endTs - b.endTs)[0];
			// 角色：**先拆成单个名字再去重**，然后合并。
			// ⚠️ 别写成 `new Set(cur.map(p => p.roles))` —— 那样比较的是"整串"（各池的 4★ 名单相同
			// 但 5★ 不同 → 整串不同 → 重复留下）。拆开才能把三池共有的 4★ 去成一份。
			// 顺序 = 各池依次展开（5★ 在前、4★ 共有名在后），去重后即 `心、千咲、尤诺、卜灵、桃祈、釉瑚`。
			const roles = [...new Set(cur.flatMap((p) => p.roles.split("、").map((s) => s.trim()).filter(Boolean)))].join("、");
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const raw = fmtWindow(first.startTs, first.endTs, tz);
			// 悬停：首行=卡池类型（与卡片外显同源），随后每池"池名：角色"一行；窗口相同则时间只在末尾写一遍；
			// 按结束时间升序。**类型行只在本源补**，不动全站共用的 buildPoolHover（它按约定对 0/1 池返回 ""）。
			const poolHover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.roles || "-"}`,
				startTs: p.startTs,
				endTs: p.endTs
			})));
			const bannerHover = poolHover ? `${first.type}\n${poolHover}` : "";
			// **外显用卡池类型**（`角色活动唤取`），不用某一个池名：
			// 角色是多池合并的，若外显挂"但愿长圆如此夜"，卡片就成了"标题只说一个池、角色却是三个池的合成"。
			// 与用户 2026-09-30 定的统一口径一致（国服显示 `限时限定招募`、异环显示 `限定棋盘`）。
			// 具体池名在悬停里逐条列出，不丢信息。
			return { banner: first.type, roles, bannerDates: raw, bannerDatesRaw: raw, startTs: first.startTs, endTs: first.endTs, bannerHover };
		}

		// 鸣潮官方活动解析：同一份全量公告的 `recommend` 组里，`tag === 7` 是卡池、**`tag === 5` 是限时活动**。
		// 活动条目形如 tabTitle="[团团勇者大乱斗]休闲活动"，同样带绝对时间戳。
		// 这是 2026-10-01 起鸣潮活动的**默认源**——Bwiki 活动日历页已停更（最新一条结束于 2026/9/29），
		// 而官方源有当期 3.7 的活动，且**与卡池是同一条 URL**、同一次请求即可拿到两侧数据。
		function parseWuwaRecommendEvents(list, now = nowMs(), tz) {
			const arr = Array.isArray(list?.recommend) ? list.recommend : [];
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const events = [];
			for (const it of arr) {
				if (Number(it.tag) !== 5) continue; // 7=卡池；5=限时活动
				const name = stripH(it.tabTitle || "").replace(/\s+/g, " ").trim();
				if (!name) continue;
				const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
				if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
				if (sTs > now || eTs < now) continue;
				events.push({ name, cat: "", startTs: sTs, endTs: eTs });
			}
			if (events.length === 0) return null;
			const sorted = sortEventItems(events);
			if (sorted.length === 0) return null;
			const primary = pickEventPrimary(sorted) || sorted[0];
			const dates = fmtWindow(primary.startTs, primary.endTs, tz);
			return { banner: primary.name, bannerDates: dates, bannerDatesRaw: dates, eventHover: buildEventHover(sorted) };
		}

		// 鸣潮卡池默认抓取器：官方公告（entrypoint → 目录 → zh-Hans.json 全量）优先；
		// 无当期公告 / 抓取失败 → 自动回退 Bwiki 角色轮换池（逻辑同 parseWuwaPool）
		async function fetchWuwaGacha(entryUrl, signal, tz, now = nowMs()) {
			try {
				const ref = "https://aki-gm-resources.aki-game.com/";
				const ej = await proxyFetchJson(entryUrl, ref);
				const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
				const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
				let list = null;
				try { list = await proxyFetchJson(dir + "zh-Hans.json", ref); } catch { list = null; }
				if (!list || typeof list !== "object") list = await proxyFetchJson(dir + "notice.json", ref);
				// **同一份 JSON 里卡池（tag=7）与活动（tag=5）都在** → 顺带把活动字段也返回。
				// 这是"统一来源注册表"里写明的复用契约：**两侧是同一条 URL** 且卡池载荷带 event 字段时，
				// refresh 不再为活动侧另抓一次（否则每轮会向同一条 URL 重复发一次请求）。
				// ⚠️ 我重写解析时一度只返回卡池字段，导致鸣潮每轮请求从 1 次变成 2 次 —— 已补回。
				// 活动侧仍保留自己的抓取器（fetchWuwaEventsOfficial）：卡池侧失败、或用户在设置里
				// 单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
				const ev = parseWuwaRecommendEvents(list, now, tz);
				const evFields = ev
					? { event: ev.banner, eventDates: ev.bannerDates || "", eventDatesRaw: ev.bannerDatesRaw || ev.bannerDates || "", eventHover: ev.eventHover || "" }
					: {};
				const d = parseWuwaNotice(list, now, tz);
				if (d) return { ...d, ...evFields };
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = WUWA_BWIKI_URL + (WUWA_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseWuwaPool(html, nowMs(), tz);
		}

		// 鸣潮活动默认抓取器：抓同一份官方公告，取 `recommend` 组里 tag=5 的限时活动。
		// 与卡池侧是**同一条 URL**（entrypoint.json），所以 refresh 的复用会让两侧共用一次请求。
		async function fetchWuwaEventsOfficial(entryUrl, _signal, tz) {
			const ref = "https://aki-gm-resources.aki-game.com/";
			const ej = await proxyFetchJson(entryUrl, ref);
			const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
			const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
			const list = await proxyFetchJson(dir + "zh-Hans.json", ref);
			if (!list || typeof list !== "object") throw new Error("wuwa-event-bad-json");
			const d = parseWuwaRecommendEvents(list, nowMs(), tz);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || ""
			};
		}

		// 绝区零官网公告解析：从公告频道（iChanId=279）取「X.Y版本限时频段（上/下期）」，选覆盖当前时刻的一期。
		// 公告形如：sIntro="本期代理人与音擎调频活动时间为：3.2版本更新后 ~ 2026/09/30 11:59"，
		// sContent 内含「活动期间，限定S级代理人[克拉蕾(电·锋御)]、[南宫羽(以太·击破)]…」。
		// 起点为"版本更新后"时，用同版本「更新公告」的 dtStartTime 补全；「独家重映/音擎回响」自选段跳过。
		function parseZzzFreq(payload, now = nowMs(), tz) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本更新公告 → "X.Y版本更新后"的起点；同时抽取「S级代理人[X] → 「Y」频段」对应表
			// （频段名只写在更新公告里，逐期频段公告不含频段名，故用它回填卡池标题）
			// 注意：必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，下一期频段会被提前判成"覆盖当前"、把真实在跑的上一期挤掉
			// （与活动侧 parseZzzEventsOfficial 同一口径）。
			const verStart = {};
			const poolOf = {};
			for (const it of list) {
				const t = clean(it?.sTitle);
				const vm = t.match(/(\d+\.\d+)\s*版本/);
				if (!vm) continue;
				if (/更新(?:公告|通知)/.test(t) && !/预下载|预约|前瞻|预抽/.test(t)) {
					const p = parseTime(it.dtStartTime, tz);
					if (p.ts != null && verStart[vm[1]] == null) verStart[vm[1]] = p;
				}
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(/S级代理人\s*[\[【]([^\]】]+)[\]】][^「]{0,40}?「([^」]{2,14})」频段/g)) {
					const name = m[1].replace(/[（(].*$/, "").trim();
					if (name && poolOf[name] == null) poolOf[name] = m[2].trim();
				}
			}
			// 角色名统一为「职业·属性」全角括号（与 Bwiki 显示一致）：克拉蕾(电·锋御) → 克拉蕾（锋御·电）
			const normRole = (name) => {
				const m = name.match(/^([^（()]+)[（(]([^）)]+)[）)]\s*$/);
				if (!m) return name;
				const bits = m[2].split("·");
				return bits.length === 2 ? `${m[1]}（${bits[1]}·${bits[0]}）` : `${m[1]}（${m[2]}）`;
			};
			const pools = [];
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本限时频段\s*((?:（[上下]期）)?)/);
				if (!vm) continue;
				const ver = vm[1];
				const part = vm[2] || "";
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				const re = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})/g;
				const marks = [];
				let m;
				while ((m = re.exec(text)) !== null) {
					marks.push({ start: m[1], end: m[2], from: m.index, to: m.index + m[0].length, after: /版本更新后/.test(m[1]) });
				}
				const created = parseTime(it.dtCreateTime, tz).ts ?? 0;
				for (let i = 0; i < marks.length; i++) {
					const seg = text.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : text.length);
					// 该时间窗对应的「限定S级代理人」句（排除独家重映/音擎回响的自选说明）
					const sentence = seg.split(/[。！；]/).find((s) => /限定S级代理人/.test(s) && !/重映|回响|可自选/.test(s));
					if (!sentence) continue;
					const roleM = sentence.match(/限定S级代理人\s*((?:[\[【][^\]】]+[\]】][、，,及和与\s]*)+)/);
					if (!roleM) continue;
					const roles = [...roleM[1].matchAll(/[\[【]([^\]】]+)[\]】]/g)].map((x) => normRole(x[1].trim())).join("、");
					if (!roles) continue;
					const sp = marks[i].after ? (verStart[ver] || { ts: null, text: null }) : parseTime(marks[i].start, tz);
					const ep = parseTime(marks[i].end, tz);
					if (ep.ts == null) continue;
					pools.push({
						ver, part, roles,
						startTs: sp.ts, endTs: ep.ts,
						startText: sp.text, endText: ep.text,
						raw: `${marks[i].after ? `${ver}版本更新后` : sp.text} ~ ${ep.text}`,
						created,
						isMain: true
					});
				}
			}
			if (pools.length === 0) return null;
			const cover = pools.filter((p) => p.startTs != null && coversNow(p, now));
			// 起点未知（同版本更新公告未收录）但结束在未来 → 仍作为当期（与 selectCurrent 的宽松分支一致）
			const loose = pools.filter((p) => p.startTs == null && p.endTs >= now);
			const picked = (cover.length > 0 ? cover : loose).sort((a, b) => (b.created - a.created) || (a.endTs - b.endTs));
			if (picked.length === 0) return null;
			const first = picked[0];
			const same = picked.filter((p) => p.ver === first.ver && p.part === first.part);
			const roles = [...new Set(same.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			// 卡池名：优先用更新公告里的「频段名」（当期名单命中的新代理人）；复刻期无名时退回版本期名称
			let poolName = "";
			for (const r of roles.split("、")) {
				const base = r.replace(/[（(].*$/, "").trim();
				if (base && poolOf[base]) { poolName = poolOf[base]; break; }
			}
			return {
				banner: poolName ? `「${poolName}」频段` : `${first.ver}版本限时频段${first.part}`,
				roles,
				bannerDates: first.startText && first.endText ? `${first.startText} ~ ${first.endText}` : first.raw,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs
			};
		}

		// 绝区零卡池默认抓取器：官网公告优先；无当期频段公告 / 抓取失败 → 自动回退 Bwiki 往期调频
		async function fetchZzzGacha(listUrl, signal, tz, now = nowMs()) {
			try {
				const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
				// **同一份 payload 里活动数据也在**（该接口同时含频段公告与「活动说明」公告）→ 顺带返回活动字段。
				// 这是"统一来源注册表"里写明的复用契约：卡池载荷带 event 字段时，refresh 不再为活动侧
				// 另抓一次。绝区零两侧是**同一条 URL**（同一 iChanId=279），所以此前每轮会向它发 2 次请求：
				// 一次 parseZzzFreq 取频段、一次 parseZzzEventsOfficial 取活动 —— 纯重复（2026-10-01 实测）。
				// 活动侧**仍保留**自己的抓取器（fetchZzzEventsOfficial 与 `zzz-event-bwiki` 备选）：
				// 卡池侧失败、或用户在设置里单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
				const ev = parseZzzEventsOfficial(payload, now, tz);
				const evFields = ev
					? { event: ev.event, eventDates: ev.eventDates || "", eventDatesRaw: ev.eventDatesRaw || "", eventHover: ev.eventHover || "" }
					: {};
				const d = parseZzzFreq(payload, now, tz);
				if (d) return { ...d, ...evFields };
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = ZZZ_BWIKI_URL + (ZZZ_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return selectCurrent(parseAllBwiki(html), now);
		}

		// 绝区零：官方公告列表（api-takumi-static，与卡池侧同一接口，经 host 代理）→ 当期活动。
		// 活动时间就写在公告正文里（【活动时间】A ~ B），**不需要再抓详情页**；
		// A/B 可能是绝对时间，也可能是"X.Y版本更新后" / "X.Y版本结束"——用「X.Y版本更新公告」的发布时间折算：
		//   版本起点 = 该版本更新公告发布时间；版本结束 = 下一个已知版本起点 − 1 分钟。
		// 当前版本还没有下一版本公告 → 结束时间未知：这类活动**保留**（endTs=null），
		// 由 sortEventItems / pickEventPrimary 的既有规则自然沉到外显与悬停的最后，不跳过、不丢弃。
		const ZZZ_EVENT_WINDOW_RE = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～\-—]\s*((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本结束))/g;

		function parseZzzEventsOfficial(payload, now = nowMs(), tz) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本起点表：取该版本的「更新公告」发布时间。
			// 必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，会把上一版本"版本结束"型活动提前判死、并让新版本活动提前出现。
			const verStart = {};
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本/);
				if (!vm || !/更新(?:公告|通知)/.test(title)) continue;
				if (/预下载|预约|前瞻|预抽/.test(title)) continue;
				const ts = parseTime(it.dtStartTime, tz).ts;
				if (ts != null && verStart[vm[1]] == null) verStart[vm[1]] = ts;
			}
			const versions = Object.keys(verStart).sort((a, b) => verStart[a] - verStart[b]);
			// 折算一个窗口的两个端点；返回 null 表示**窗口此刻不成立**（含"该版本还没开始/无法判定"）。
			// 规则：绝对时间直接用；"X.Y版本更新后"要求该版本已开始（版本更新公告已发布）；
			//      "X.Y版本结束" = 下一个已知版本起点 − 1 分钟；若 X.Y 已是最新版本 → 结束时间未知（endTs=null，
			//      仍算成立：活动在跑，只是没有绝对结束日）→ 由排序规则沉底，不跳过、不丢弃。
			const windowAt = (startText, endText) => {
				let startTs = null;
				const sv = startText.match(/(\d+\.\d+)\s*版本更新后/);
				if (sv) {
					if (verStart[sv[1]] == null) return null;   // 该版本尚未开始 → 活动还没上线
					startTs = verStart[sv[1]];
				} else {
					const p = parseTime(startText, tz);
					if (p.ts == null) return null;
					startTs = p.ts;
				}
				if (startTs > now) return null;
				let endTs = null;
				const ev = endText.match(/(\d+\.\d+)\s*版本结束/);
				if (ev) {
					if (verStart[ev[1]] == null) return null;   // 版本未知 → 无法判定，保守略过
					const later = versions.find((v) => verStart[v] > verStart[ev[1]]);
					if (later != null) endTs = verStart[later] - 60000;
				} else {
					const p = parseTime(endText, tz);
					if (p.ts == null) return null;
					endTs = p.ts;
				}
				if (endTs != null && endTs < now) return null;
				return { startTs, endTs };
			};
			// 标题筛选用「活动说明」：正文里带活动时间的都是这类；商城/城募/剧情/频段公告不在此列
			const byName = new Map();
			for (const it of list) {
				const title = clean(it?.sTitle);
				if (!/活动说明/.test(title)) continue;
				const name = (title.match(/^「([^」]+)」/) || [])[1] || title.replace(/活动说明$/, "").trim();
				if (!name || byName.has(name)) continue;
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(ZZZ_EVENT_WINDOW_RE)) {
					const w = windowAt(m[1], m[2]);
					if (!w) continue;                                  // 这个窗口此刻不成立 → 看下一个窗口
					byName.set(name, { banner: name, name, cat: "", ...w, raw: `${m[1]} ~ ${m[2]}` });
					break;                                             // 一篇公告只取第一个成立的窗口
				}
			}
			const active = sortEventItems([...byName.values()]);
			if (active.length === 0) return null;
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
			return {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || "",
				// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（与其它源一致）
				eventHover: buildEventHover(active)
			};
		}

		async function fetchZzzEventsOfficial(listUrl, signal, tz) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			return parseZzzEventsOfficial(payload, nowMs(), tz);
		}

		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html, tz) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText, tz);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const now = nowMs();
			const active = sortEventItems(items
				.filter((it) => coversNow(it, now))
				.map((it) => ({ name: it.name || it.banner, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw })));
			if (active.length === 0) return null;
			// 外显：类别优先（战斗/高难类优先），同级内结束时间升序（③）；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
			return { banner: primary.name, roles: "", bannerDates: dates, bannerDatesRaw: primary.raw || dates, eventHover: buildEventHover(active) };
		}

		// 解 HTML 数字实体（wiki.gg 的区间分隔符写成 &#8211; = en dash、&#8722; = 减号）+
		// 常见具名实体。stripTags 不解实体，所以需要它才能把时间串拆干净。
		function decodeHtmlEntities(s) {
			return String(s)
				.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
				.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
				.replace(/&nbsp;/g, " ").replace(/&minus;/g, "\u2212").replace(/&ndash;/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/&amp;/g, "&");
		}

		// 英文月份日期 → { ts, text }（如 "Sep 02, 2026, 12:00"、"September 2, 2026"）。
		// 英文源站（wiki.gg / Game8 等）用这种写法，而 parseTime 只认纯数字日期，需要单独一支。
		// 与插件其余来源同一口径：按"源站墙钟时间"直接构造（CN 用户本地即 UTC+8）。
		const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
		function parseEnDate(raw) {
			const m = String(raw).match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
			if (!m) return null;
			const mo = EN_MONTHS[m[1].slice(0, 3).toLowerCase()];
			if (!mo) return null;
			const d = Number(m[2]), y = Number(m[3]);
			const h = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0;
			const pad = (n) => String(n).padStart(2, "0");
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text: `${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}` };
		}

		// 终末地（wiki.gg）：Headhunting/Banners 页 Current 分节 → 当期卡池
		// 该源经 host 代理抓取（fetchEndfieldWikiGg → proxyFetchText 设 Referer=wiki.gg origin），
		// 满足 Wiki.gg 的 Referer 校验，不会触发 403；本解析器仅处理代理返回的 HTML。
		// 线上真实标记（2026-09 实测）：Asia 行是 "Sep 02, 2026, 12:00 &#8211; Sep 30, 2026, 11:59 (UTC+8)"，
		// 同一格里还有 AM/EU 行（UTC−5）；旧实现用 parseTime + split(/[–-]/) 解不了英文月份与实体，恒返回 null
		// → 该备选源长期"抓得到但解析不出"。现在：解实体 + 只取 Asia 行 + 英文月份解析。
		function parseEndfieldCurrent(html) {
			const i = html.indexOf('id="Current"');
			// 页面拿到了却没有 Current 分节 → wiki 页改版（抛错，别伪装成"未公布"）
			if (i < 0) throw new Error("endfield-current-no-section");
			const seg = html.slice(i);
			const tableEnd = seg.indexOf("</table>");
			const table = tableEnd >= 0 ? seg.slice(0, tableEnd) : seg;
			const nameM = table.match(/class="header"[^>]*>([^<]+)</);
			const asiaM = table.match(/Asia:<\/b>([\s\S]*?)<\/span>/);
			const upM = [...table.matchAll(/<li>[\s\S]*?title="([^"]+)"[\s\S]*?\(Drop Rate-UP\)/g)];
			const banner = nameM ? nameM[1].trim() : "";
			let startTs = null, endTs = null, startText = null, endText = null;
			if (asiaM) {
				// 只取 Asia 行（非贪婪已停在 Asia span 结束处）；解实体后按 en/em dash 或"带空格的短横线"切两段
				const asiaText = decodeHtmlEntities(stripTags(asiaM[1]));
				const parts = asiaText.split(/[\u2013\u2014\u2212]|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
				const a = parseEnDate(parts[0] || "");
				const b = parseEnDate(parts[1] || "");
				if (a) { startTs = a.ts; startText = a.text; }
				if (b) { endTs = b.ts; endText = b.text; }
			}
			// 分节在、但卡池名/Asia 档期读不出来 → 表结构变了（抛错）；读得出但不覆盖当前 → null（未公布）
			if (!banner) throw new Error("endfield-current-no-banner");
			if (startTs == null || endTs == null) throw new Error("endfield-current-no-dates");
			if (!(startTs <= nowMs() && endTs >= nowMs())) return null;
			return {
				banner,
				roles: [...new Set(upM.map((m) => m[1]))].join("、"),
				bannerDates: startText && endText ? `${startText} ~ ${endText}` : ""
			};
		}

		// 终末地（GachaTracker）：banners 表格 → 当期卡池（卡池名/干员/起止）
		// GachaTracker 提供 CORS=[*]，浏览器端可直接抓取（替代被 Referer 反爬拦截的 wiki.gg）
		//
		// `tz`（可选）= 源站墙钟时区：
		//  · 传了 → 墙钟按该时区换算成绝对时刻，输出文本也按该时区渲染（海外用户也正确）；
		//  · 没传 → **保持改造前行为逐字节不变**（字符串自带 `+08:00` 定绝对时刻，
		//    文本按本机时区取字段）。为什么不统一成"没传也按 +08 渲染"：
		//    那会改变既有输出（实测让 `_batch6` C4 的文本从 `10-01 00:11` 偏成 `00:12`），
		//    而调用方没声明时区时，我们**没有依据**断定它一定是 +08。
		function parseGachaTracker(html, tz) {
			const shift = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 0, 0, tz) : new Date(d.y, d.mo - 1, d.d, 0, 0).getTime());
			const shiftEnd = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 23, 59, tz) : new Date(d.y, d.mo - 1, d.d, 23, 59).getTime());
			const parse = (s) => { const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
			const rows = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
			const items = [];
			for (const rm of rows) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				const charM = [...body.matchAll(/\/games\/endfield\/characters\/[^"]+" title="([^"]+)"/g)];
				if (!nameM || dateM.length < 2) continue;
				const sd = parse(dateM[0][1]);
				const ed = parse(dateM[1][1]);
				if (!sd || !ed) continue;
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set(charM.map((m) => m[1]))].join("、"),
					// 传了 tz → 按源站墙钟换算；没传 → 沿用字符串自带 +08:00（改造前行为）
					startTs: tz ? shift(sd) : new Date(dateM[0][1] + "T00:00:00+08:00").getTime(),
					endTs: tz ? shiftEnd(ed) : new Date(dateM[1][1] + "T23:59:59+08:00").getTime(),
					// 文本用**源站墙钟原文**（不经过 Date 再解释）—— 这样不传 tz 时也与改造前一致
					startText: dateM[0][1],
					endText: dateM[1][1]
				});
			}
			const now = nowMs();
			const cur = items.find((it) => coversNow(it, now)) || null;
			if (!cur) return null;
			// 输出文本：直接用源站墙钟原文（`YYYY-MM-DD` → `MM-DD`），不随本机时区变
			const fmtDate = (s) => {
				const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
				return m ? `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : String(s);
			};
			return {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmtDate(cur.startText)} 00:00 ~ ${fmtDate(cur.endText)} 23:59`
			};
		}


		// 通用：从 Next.js flight payload HTML 中定位指定组件引用的 JS chunk URL 列表。
		// 适用于"HTML 无数据、数据编译在组件 chunk 里"的 Next.js 站点（如 canmoe）。
		// componentName 形如 "BannerCalendar"；baseUrl 用于把相对路径补全为绝对 URL。
		function nextJsChunkUrls(html, componentName, baseUrl) {
			const i = html.indexOf(componentName);
			if (i < 0) return [];
			const seg = html.slice(Math.max(0, i - 1500), i);
			const br = seg.lastIndexOf("[");
			if (br < 0) return [];
			// flight payload 内 chunk 路径是双重转义（\\\"），还原一层后提取
			const raw = seg.slice(br).replace(/\\\\"/g, '"').replace(/\\"/g, '"');
			const names = [...raw.matchAll(/\/_next\/static\/chunks\/([A-Za-z0-9_.~-]+\.js)/g)].map((x) => x[1]);
			// 补全为绝对 URL：优先页面 origin（chunk 路径是站内相对路径）
			let origin = "";
			try { origin = new URL(baseUrl || "").origin; } catch { /* 无 baseUrl 时保持相对 */ }
			return [...new Set(names)].map((n) => origin + "/_next/static/chunks/" + n);
		}

		// 从 canmoe chunk JS 提取当期卡池：
		// ① 当期角色窗口形如 d={梨诺:{windows:[{start,end,version,period,isRerun}]}},u=[...]
		//   （注意：d 在 canmoe 侧可能长期不更新，只能当"覆盖当前时刻才采信"的快速路径）
		// ② 期次列表形如 <变量>=[{id,title,subtitle,version,periodStart,periodEnd,featured:[...]}]，
		//   变量名随构建变化（曾见 p= / 现为 f=），由 extractCanmoePeriods 按内容定位。
		// 只采用"时间窗口覆盖当前时刻"的条目。
		// 返回值三态：数据对象 / null（**结构在**但没有覆盖当前时刻的期次 → 未公布）/ undefined
		// （这份 JS 里**根本没有**卡池数据结构 → 交给调用方决定：多 chunk 时继续找下一个，
		//  全部 chunk 都没有则说明页面改版 → 报错，而不是伪装成"未公布"）。
		function currentFromCanmoe(js, now, tz) {
			now = now || nowMs();
			let sawStructure = false;
			const fmt = (iso) => {
				// 按**源站时区**（`tz`）渲染，而不是本机时区：否则海外用户会看到
				// 与 `startTs/endTs`（已按源站时区换算）不一致的钟点。
				const w = sourceWallParts(new Date(iso).getTime(), tz);
				return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
			};
			// **统一规则（§49）**：当前时刻落在持续期间内的卡池**全部合并**外显。
			// 旧实现是"两个分支各自命中第一个就 return" → 只显示一个池，同期的另一个池看不到
			// （用户实测：终末地外显没合并）。现在先把两类候选都收集起来再合并。
			//
			// ⚠️ 这条路径**不走 `selectCurrent`**（canmoe 的 chunk 是压缩 JS，得单独解析），
			// 所以 §49 改 `selectCurrent` 时漏了这里 —— 教训：改"通用规则"要**枚举所有外显路径**，
			// 不能只改名字最像的那个函数。
			const active = [];
			// 1) 当期 d：windows 覆盖当前 → 收进来
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				sawStructure = true;
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) {
						active.push({ banner: `\u3010${w[3]}\u3011${roles}`, roles, startTs: a, endTs: b, dates: `${fmt(w[1])} ~ ${fmt(w[2])}`, raw: `${fmt(w[1])} ~ ${fmt(w[2])}` });
					}
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）—— 同样**全部收**，不是取第一个
			const arr = extractCanmoePeriods(js);
			if (arr) {
				sawStructure = true;
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (!(a <= now && now <= b)) continue;
					const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
					const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
					const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
					active.push({
						banner: title || `\u3010${version}\u3011${subtitle}`,
						roles: subtitle || title,
						startTs: a, endTs: b,
						dates: `${fmt(ps)} ~ ${fmt(pe)}`, raw: `${fmt(ps)} ~ ${fmt(pe)}`
					});
				}
			}
			if (active.length > 0) {
				// 外显名与窗口取**结束最早**的那个池（越快结束越该被盯住；与 selectCurrent 的 first 同口径）
				const first = active.slice().sort((x, y) => x.endTs - y.endTs)[0];
				return {
					banner: first.banner,
					roles: [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、"),
					bannerDates: first.dates,
					bannerDatesRaw: first.raw
				};
			}
			// 结构在但没覆盖当前时刻 → null（未公布）；连结构都没有 → undefined（页面改版，交上层决定）
			return sawStructure ? null : void 0;
		}

		// 提取 canmoe chunk 里的"卡池期次数组"（元素含 periodStart/periodEnd 的那个），返回元素子串数组。
		// 数组的变量名是压缩产物的一部分：canmoe 每次重新构建都可能改名（曾见 p=[…]，现为 f=[…]），
		// 所以按"任意 `名字=[` 且数组体里有 periodStart"来定位，不写死变量名
		// （曾因写死 p= 而在 canmoe 改版后静默抓不到当期卡池）。
		function extractCanmoePeriods(js) {
			const re = /[A-Za-z_$][\w$]*\s*=\s*\[/g;
			for (let m = re.exec(js); m; m = re.exec(js)) {
				const start = js.indexOf("[", m.index);
				// 便宜预筛：数组开头不远处就有 periodStart 字段，省掉对每个数组都做括号平衡扫描
				if (!/periodStart\s*:/.test(js.slice(start, start + 4000))) continue;
				let depth = 0, inStr = false, q = "", end = -1;
				for (let i = start; i < js.length; i++) {
					const ch = js[i];
					if (inStr) { if (ch === "\\") i++; else if (ch === q) inStr = false; continue; }
					if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
					if (ch === "[") depth++;
					else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
				}
				if (end < 0) continue;
				const body = js.slice(start + 1, end);
				if (!/periodStart\s*:/.test(body)) continue;
				const out = [];
				let d2 = 0, s2 = false, q2 = "", st = 0;
				for (let k = 0; k < body.length; k++) {
					const ch = body[k];
					if (s2) { if (ch === "\\") k++; else if (ch === q2) s2 = false; continue; }
					if (ch === '"' || ch === "'") { s2 = true; q2 = ch; continue; }
					if (ch === "{" || ch === "[") d2++;
					else if (ch === "}" || ch === "]") d2--;
					else if (ch === "," && d2 === 0) { out.push(body.slice(st, k)); st = k + 1; }
				}
				out.push(body.slice(st));
				return out;
			}
			return null;
		}

		// 终末地当期选择：走统一的"当期选择"逻辑（now 可注入）。
		// 这是**给通用解析（自定义条目/自定义地址）用的宽松包装**：把 undefined 归一成 null，
		// 即"读不出来 → 未公布"，不在这里抛错（用户自定义地址读不出内容是常态，不该报成源站故障）。
		//
		// ⚠️ 2026-10-03：原来还有一个 `parseCanmoeLoose`（同样实现）作为"旧写法"别名，
		//    经全仓引用分析确认**生产与测试都没用**，已删 —— 留两个同名同实现的包装只会让人猜该用哪个。
		function parseCanmoe(js, now = nowMs(), tz) { const d = currentFromCanmoe(js, now, tz); return d === void 0 ? null : d; }
		// 终末地（canmoe 经 host 代理）：页面 HTML → 定位 BannerCalendar chunk → 抓 chunk JS → 窗口匹配当期
		// canmoe 无 CORS 头，两步都经 host 代理（referer 用页面 origin 满足反爬）
		// 数据在某一组件的 chunk 里（含当期 d={...} 与历史期次数组），currentFromCanmoe(js, now) 做窗口匹配
		//
		// 三态（这是本条目的**默认来源**，必须把"源站改版"和"没公布"分开，否则会重演长期静默失灵）：
		//   · 有覆盖当前时刻的期次 → 返回数据；
		//   · 拿到 JS 且里面有卡池结构、但没有覆盖当前的期次 → return null（未公布）；
		//   · 页面/所有 chunk 里都找不到卡池结构（或 chunk 全抓失败）→ **抛错**（面板显示"卡池失败"）。
		async function fetchCanmoeEndfield(pageUrl, _signal, tz, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://end.canmoe.com/");
			const chunks = nextJsChunkUrls(html, "BannerCalendar", pageUrl);
			if (chunks.length === 0) throw new Error("canmoe-no-chunk");   // 页面拿到了但没有数据块链接 = 改版
			let fetchedAny = false, sawStructure = false, lastErr = null;
			for (const c of chunks) {
				let js = null;
				try {
					js = await proxyFetchText(c, "https://end.canmoe.com/");
				} catch (err) {
					lastErr = err;      // 单个 chunk 抓失败：继续试下一个（错误留着，全失败时抛出去）
					continue;
				}
				fetchedAny = true;
				const d = currentFromCanmoe(js, now, tz);
				if (d === void 0) continue;      // 这份 chunk 里没有卡池结构 → 看下一个
				sawStructure = true;
				if (d) {
					const hover = canmoePoolHover(js, now);
					if (hover) d.bannerHover = hover;
					return d;
				}
			}
			if (!fetchedAny) throw (lastErr || new Error("canmoe-chunk-fetch-failed"));
			if (!sawStructure) throw new Error("canmoe-layout-changed");
			return null;   // 结构在、但当期没有覆盖现在的期次 → 未公布
		}

		// 终末地卡池列悬停：canmoe 卡池日历 chunk 内同期全部卡池条目（特许寻访 / 重构寻访 等），
		// 每池"卡池名：角色"一行 + 时间；窗口相同则合并时间；结束时间升序（0/1 池返回 "" 走单条兜底）
		function canmoePoolHover(js, now) {
			const arr = extractCanmoePeriods(js);
			if (!arr) return "";
			const pools = [];
			for (const e of arr) {
				const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
				const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
				if (!ps || !pe) continue;
				const a = new Date(ps).getTime(), b = new Date(pe).getTime();
				if (!(a <= now && now <= b)) continue;
				const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
				const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
				if (!title && !subtitle) continue;
				pools.push({
					name: title || subtitle,
					label: title && subtitle ? `${title}\uFF1A${subtitle}` : (title || subtitle),
					startTs: a,
					endTs: b
				});
			}
			return buildPoolHover(pools);
		}

		// 异环（ldshop 繁体）：解析「項目/資訊」卡池表（含 期間/角色/棋盤 行），返回全部卡池
		// 表格行结构：<td><p>期間</p></td><td><p>8月19日－9月9日</p></td>
		function parseLdshopPools(html) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
			for (const tb of tables) {
				const body = tb[1];
				if (!/期間/.test(body.replace(/<[^>]+>/g, "|"))) continue;
				let info = {};
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
					const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).trim());
					if (tds.length >= 2 && tds[0] && tds[0] !== "項目") info[tds[0]] = tds[1];
				}
				if (!info["期間"]) continue;
				const range = parseLdshopRange(info["期間"]);
				if (!range) continue;
				const chars = [info["全新S級角色"], info["復刻S級角色"]].filter(Boolean).join("/");
				out.push({
					banner: info["角色棋盤"] || "异环卡池",
					roles: chars,
					...range,
					isMain: true
				});
			}
			return out;
		}

		// 中文明期间 → startTs/endTs/bannerDates（如 "8月19日－9月9日"；跨年自动+1年）
		function parseLdshopRange(raw, now) {
			const s = String(raw).trim();
			const m = s.match(/(\d{1,2})月(\d{1,2})日\s*[－\-]\s*(\d{1,2})月(\d{1,2})日/);
			if (!m) return null;
			const base = now || new Date(nowMs());   // 缺省走注入时钟（core 不得直接读宿主时钟）
			const y = base.getFullYear();
			const a = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
			let b = new Date(y, Number(m[3]) - 1, Number(m[4]), 23, 59);
			if (b < a) b = new Date(y + 1, Number(m[3]) - 1, Number(m[4]), 23, 59);
			const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			return { startTs: a.getTime(), endTs: b.getTime(), startText: fmt(a), endText: fmt(b), raw: `${fmt(a)} ~ ${fmt(b)}` };
		}

		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		async function fetchLdshopNte(pageUrl, _signal, tz) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html);
			if (pools.length === 0) return null;
			return selectCurrent(pools, nowMs());
		}

		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		// 官网公告列表条目：<a href="/news/gamebroad/YYYYMMDD/N.html">…<h2 class="title">标题</h2>
		const NTE_ITEM_RE = /<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g;
		// 带新卡池的公告标题：停服维护/版本更新；"1.3版本「…」更新公告"这类版本名夹在中间，所以"更新公告"也要算
		const NTE_MAINT_RE = /停服维护|停服更新|维护公告|版本更新|更新公告/;
		// 逐页向下的上限：维护公告会随新公告发布被挤到第 2、3 页，只看第 1 页会把"进行中的卡池"误判成未公布
		const NTE_MAX_LIST_PAGES = 3;
		// 每次最多试几篇公告正文（按从新到旧），避免某篇规则失效时白抓一堆
		const NTE_MAX_DETAILS = 3;

		// 取分页控件里的后续页地址（相对当前页）：<ul class="pagination"> … <a href="index1.html">2</a>
		function nteNextPageUrls(listUrl, html, seen) {
			const pg = String(html || "").match(/<ul class="pagination">[\s\S]*?<\/ul>/);
			if (!pg) return [];
			const dir = listUrl.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
			const out = [];
			for (const m of pg[0].matchAll(/href="(index\d+\.html)"/g)) {
				const u = dir + m[1];
				if (u !== listUrl && !seen.has(u) && !out.includes(u)) out.push(u);
			}
			return out;
		}

		// 逐页（index.html → index1.html → index2.html …）从新到旧找"带新卡池"的维护/版本更新公告，
		// 取第一篇能解析出当期卡池/活动的正文；"不停服更新"不含新卡池，跳过。
		// 三态：有当期内容 → 数据；列表页有公告但都不含当期内容（或"不停服更新"）→ null（未公布）；
		//      列表页**一条公告链接都没有** → 抛错（官网列表改版，让面板显示"卡池失败"而不是"未公布"）。
		async function fetchNteWanmei(listUrl, signal, tz) {
			const ref = "https://yh.wanmei.com/";
			const seen = new Set();
			const queue = [listUrl];
			let details = 0;
			let sawAnyLink = false;
			while (queue.length && seen.size < NTE_MAX_LIST_PAGES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const html = await proxyFetchText(url, ref);
				if (/\/news\/gamebroad\/\d+\/\d+\.html/.test(html)) sawAnyLink = true;
				// 列表条目本身从新到旧：边收集边试，命中当期内容立刻返回
				for (const m of html.matchAll(NTE_ITEM_RE)) {
					if (!NTE_MAINT_RE.test(m[2]) || /不停服/.test(m[2])) continue;
					if (details >= NTE_MAX_DETAILS) return null;   // 试读额度用完（此时必然已见到公告链接）
					details++;
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref), tz);
					if (data) return data;
				}
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}

		// 异环公告里的「棋盘」条目解析（角色卡池）。
		//
		// 为什么从**「棋盘」**入手（用户建议，2026-09-30）：
		//   异环的角色卡池在公告里叫「X」**限定棋盘**，条目形如
		//     ● 全新限定S级角色「黑羽」
		//     开放时间：9月24日版本更新后-10月15日05:59
		//     棋盘说明：可通过「预言终幕时」限定棋盘获得S级角色「黑羽」。…
		//   `棋盘说明` 是**角色卡池独有的锚点** —— 弧盘走 `研募说明`、剧情段没有这个字段。
		//   用「有棋盘说明」筛，比用"全新限定S级角色"精确：后者漏掉**返场**（`限定S级角色「安魂曲」返场`，
		//   没有"全新"二字），而那也是一张在开的角色池。
		//
		// 旧实现只认 `全新限定S级角色「X」…开放时间：N月N日**维护**更新后-…` 一条正则，
		// 而现公告写的是 `**版本**更新后` → 一条都匹配不上 → 卡池为空 → `if (!data.banner) return null`
		// → `fetchNteWanmei` 继续往下试，最终拿 index1 页那篇**已过期**的旧公告冒充当期。
		function parseNteBoards(text, nowYear) {
			const lines = text.split("\n").map((l) => l.trim());
			// 「一、 全新角色&弧盘」这一段的边界（只在这里找，避免匹配到别处的"开放时间"）
			const start = lines.findIndex((l) => /^一、/.test(l));
			if (start < 0) return [];
			let end = lines.findIndex((l, i) => i > start && /^二、/.test(l));
			if (end < 0) end = lines.length;
			const pools = [];
			for (let i = start; i < end; i++) {
				const m = lines[i].match(/^●\s*(?:全新)?(限定S级角色|S级角色)「([^」]+)」(返场)?/);
				if (!m) continue;
				// 往后找该条目的「开放时间」与「棋盘说明」（各限 8 行内）
				let range = null, board = "";
				for (let j = i + 1; j < Math.min(end, i + 8); j++) {
					if (!range) {
						const t = lines[j].match(/^开放时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
						if (t) {
							range = {
								sMo: +t[1], sD: +t[2], sH: t[3] ? +t[3] : 11, sMi: t[4] ? +t[4] : 0,
								eMo: +t[5], eD: +t[6], eH: +t[7], eMi: +t[8]
							};
						}
					}
					if (!board) {
						const b = lines[j].match(/棋盘说明：可通过「([^」]+)」限定棋盘获得/);
						if (b) board = b[1];
					}
				}
				// **有棋盘说明才是角色卡池**（弧盘那条走研募说明，会在这里被排除）
				if (!range || !board) continue;
				pools.push({
					name: board,
					// 类型：`全新限定S级角色` → 限定棋盘；`限定S级角色…返场` → 返场限定棋盘。
					// 注意 `限定` 属于**类型的一部分**，不是动词/修饰（与国服"更新限时限定招募"同理）。
					type: `${m[3] ? "返场" : ""}限定棋盘`,
					roles: baRoleName(m[2]),
					startTs: new Date(nowYear, range.sMo - 1, range.sD, range.sH, range.sMi).getTime(),
					endTs: new Date(nowYear, range.eMo - 1, range.eD, range.eH, range.eMi).getTime()
				});
			}
			return pools;
		}

		// 解析官网公告正文 → 当期卡池（有「棋盘说明」的角色卡池，按**统一规则**合并）+ 当期活动（限时活动）
		function parseNteWanmei(html, tz) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：**按统一规则**——当前时刻落在开放期间内的「棋盘」全部合并外显。
			// 卡片/悬停都走 banner + roles（与其它游戏一致）：类型进 `banner`，
			// 悬停由面板兜底显示 `类型：角色` + 日期。**不构造 bannerHover**（同国服，见 §48.3d）。
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();
			const active = parseNteBoards(text, nowYear)
				.filter((p) => p.endTs >= now && p.startTs <= now)
				.sort((a, b) => a.endTs - b.endTs);
			if (active.length > 0) {
				data.banner = [...new Set(active.map((p) => p.type))].join(" & ");
				data.roles = [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、");
				// 窗口取结束最早的那个（与 selectCurrent 的 `first` 同口径）
				const first = active[0];
				data.bannerDates = `${fmt(new Date(first.startTs).getMonth() + 1, new Date(first.startTs).getDate(), new Date(first.startTs).getHours(), new Date(first.startTs).getMinutes())} ~ ${fmt(new Date(first.endTs).getMonth() + 1, new Date(first.endTs).getDate(), new Date(first.endTs).getHours(), new Date(first.endTs).getMinutes())}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护|版本)更新后|hh:mm-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
			if (ev) {
				const sMo = +ev[2], sD = +ev[3], sH = ev[4] ? +ev[4] : 11, sMi = ev[5] ? +ev[5] : 0;
				const eMo = +ev[6], eD = +ev[7], eH = +ev[8], eMi = +ev[9];
				data.event = ev[1];
				data.eventDates = `${fmt(sMo, sD, sH, sMi)} ~ ${fmt(eMo, eD, eH, eMi)}`;
				data.eventDatesRaw = data.eventDates;
			}
			if (!data.banner) return null;
			return data;
		}

		// 通用抓取网页文本：MediaWiki api.php（action=parse）→ JSON 的 parse.text；其它 URL → 原始 HTML
		//
		// 同一轮里按 URL 缓存：两侧同址时（自定义条目最常见：用户把同一个页面同时填给
		// 卡池与活动），需要在**不重复发请求**的前提下拿到同一份文本 —— 见 50-refresh.js
		// 的「两侧同一条 URL、活动侧无注册抓取器」分支。缓存按轮清空（refreshAll 开始时重置），
		// 避免跨轮拿到过期数据。
		let htmlTextCache = null;
		function resetHtmlTextCache() { htmlTextCache = new Map(); }
		// **只读**查询：命中才返回，绝不发起请求。
		// 用途见 50-refresh.js：两侧同址且活动侧没有注册抓取器时，**只有在卡池那次
		// 已经通过本函数取过同一 URL 的情况下**才复用；否则宁可记"未公布"，
		// 也**绝不**去打那次注定被 CORS 拦的直连（这条语义有测试守护，别改成会发请求）。
		function peekHtmlText(url) {
			return (htmlTextCache && htmlTextCache.get(url)) || null;
		}
		async function fetchHtmlText(url, signal) {
			if (htmlTextCache && htmlTextCache.has(url)) return htmlTextCache.get(url);
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			let out;
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				out = text;
			} else {
				out = await res.text();
			}
			if (htmlTextCache) htmlTextCache.set(url, out);
			return out;
		}

		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 最后再退到**普通 HTML 表**（见下方 collectGenericGacha）；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericGacha(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const cur = selectCurrent(parseAllBwiki(html, tz), now) || selectCurrent(parseArknights(html, tz), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html, tz);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 每个 chunk 只解析一次：解析里最重的是 chunk 的括号平衡扫描，
					// 而"没命中当期"恰恰是最常见的情况 → 不要为了`a || b`那种写法白跑两遍
					const d = parseCanmoe(js, now, tz);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			// 末位兜底：**普通 HTML 表**（时间 + 名称两列，或含「类型」列）。
			// 为什么需要（2026-10-01 用户点名）：上面三条都是各自的**私有格式**
			// （bwiki 卡池列 / PRTS 卡池一览 / GachaTracker），而用户给自定义条目
			// 填一个普通 wiki 页面时，**活动列能出、卡池列恒空** —— 同一张表明显有内容。
			// 这一兜底复用与活动侧同一套"时间+名称"列识别，保证自定义条目两侧口径一致。
			const generic = selectCurrent(collectGenericGacha(html, tz), now);
			if (generic && generic.banner && generic.bannerDates) return generic;
			return null;
		}

		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				// 「类型」列（如 版本活动/常规活动/剧情活动）→ 用于活动外显的类别优先级
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					// 时间列（含日期/区间）与名称列分开
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					// 名字里偶发混进图片文件名残渣（如「文件:巡星之礼第二十六期.png 」）→ 去掉该前缀
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起始可为 null（"版本更新后"），结束时间必须有效——**除非这行是永久活动**。
					// 原来这里一律 `endTs == null → continue`，把「…~永久」的行在采集阶段就丢了，
					// 下游连"它存在过"都看不到（表现为源站表里有、面板悬停里没有）。
					// 永久活动（结束写作「永久」）保留下来，由 genericEventPayload 单独计数；
					// 其它无结束时间的行仍按旧规则丢弃（起止都拿不到，画不出来）。
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					const isPermanent = range.endTs == null && (/永久/.test(cat0) || /永久\s*$/.test(String(range.raw || time)));
					if (range.endTs == null && !isPermanent) continue;
					items.push({ banner: name, cat: cat0, ...range, isMain: true });
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
				// 通用**卡池**采集（末位兜底，2026-10-01 加）：
		// 与 collectGenericEvents 同一套「时间 + 名称」列识别，但用于**卡池列**。
		//
		// 为什么需要：tryParseGenericGacha 前三条路径（parseAllBwiki / parseArknights /
		// parseGachaTracker）认的都是各自源站的**私有结构**；用户给自定义条目填一个普通
		// wiki 页面时，活动列（走 collectGenericEvents）能出内容，**卡池列却恒空**。
		// 这一条让"同一张表、两侧都能读"，与活动侧口径一致。
		//
		// 与活动侧的唯一差别：**不丢"永久"行**（卡池没有"永久"语义，但也不该在采集阶段
		// 就无声消失），并保留 roles 空串（普通表里没有角色列的结构约定）。
		function collectGenericGacha(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起止都拿不到的行画不出来（活动侧对"永久"有特例，卡池没有该语义）
					if (range.startTs == null && range.endTs == null) continue;
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					items.push({ banner: name, roles: "", cat: cat0, ...range, isMain: true });
				}
			}
			return items;
		}

		// Bwiki 卡池列载荷（原神/星铁）：外显沿用 selectCurrent（同窗口主池角色合并、武器/光锥池不入选）；
		// bannerHover 列出同期全部主池（每池"池名：角色"+时间；窗口相同则合并时间；结束时间升序）
		function bwikiGachaPayload(html, tz) {
			const items = parseAllBwiki(html, tz);
			// 页面拿到了却连一行候选都没有 → wiki 表结构变了（抛错，面板显示"卡池失败"）；
			// 有候选但都不覆盖当前时刻 → 下面返回 null（未公布）。这两件事必须分开。
			if (items.length === 0) throw new Error("bwiki-gacha-no-table");
			// selectCurrent 会就地补全缺失起点（fillMissingStarts），故先取快照
			const snapshot = items.map((it) => ({ banner: it.banner, roles: it.roles, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw, isMain: it.isMain }));
			const cur = selectCurrent(items, nowMs());
			if (!cur) return null;
			const now = nowMs();
			const pools = snapshot
				.filter((it) => it.isMain && coversNow(it, now))
				.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			return { ...cur, bannerHover: buildPoolHover(pools) };
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（兜底）。
		function genericEventPayload(html, tz) {
			const items = collectGenericEvents(html, tz);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw }));
			const now = nowMs();
			// 永久/常驻活动单独计一项：它们 endTs 为 null，本就不该混进"当期"排序，
			// 但也不能像以前那样无声丢掉（见 isPermanentEvent 注释）。
			const permanent = snapshot.filter((it) => isPermanentEvent(it));
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active, permanent.length)
			};
		}

		// 明日方舟（PRTS 活动一览）：表格含「活动开始时间」列 + 隐藏 data-time="开始秒,结束秒"（Unix 秒）。
		// 开始时间用第一列文本（"2026-08-22 04:00"），结束时间用 data-time 第二个值（UTC 秒 → +08）。
		// 注意 data-time 第一个值是页面缓存时刻（非开始时间），故开始以文本列为准。
		// 活动名带核心分类前缀（"支线故事：墟·复刻"）：分类取第三列 <a title="分类:XXX"> 链接，
		// 核心分类 = 排除"复刻活动"（修饰词）后的第一个。
		function collectPrtsEvents(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/data-time="(\d+),(\d+)"/.test(row)) continue;
					const tm = row.match(/data-time="(\d+),(\d+)"/);
					if (!tm) continue;
					const endTs = Number(tm[2]) * 1000; // 结束（UTC 秒 → ms）
					if (!endTs) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
					if (tds.length < 3) continue;
					// 名称：第二列第一个 <a> 的文本（"墟·复刻"），避开状态徽章与 <script> 内容
					const aM = tds[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
					const name = aM ? stripTags(aM[1]).trim() : "";
					if (!name) continue;
					// 分类：第三列所有 <a title="分类:XXX">；核心分类排除"复刻活动"修饰后取第一个
					const catLinks = [...tds[2].matchAll(/title="分类:([^"]+)"/g)].map((m) => m[1]);
					let coreCat = "";
					if (catLinks.length > 0) {
						coreCat = catLinks.find((c) => c !== "\u590D\u523B\u6D3B\u52A8") || catLinks[0];
					} else {
						coreCat = stripTags(tds[2]).replace(/\s+/g, " ").trim();
					}
					const label = coreCat ? `${coreCat}\uFF1A${name}` : name;
					// 开始：第一列文本（"2026-08-22 04:00"）
					const st = parseTime(stripTags(tds[0]).trim(), tz);
					items.push({
						banner: label,
						cat: coreCat,
						...range2(st, endTs),
						isMain: true
					});
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
				// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）
		function prtsEventPayload(html, tz) {
			const items = collectPrtsEvents(html, tz);
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 外显：类别优先（支线故事/危机合约等 vs 登录活动），同级内结束时间升序
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}
		// 起止时间戳 → 统一文本 `MM-DD HH:MM ~ MM-DD HH:MM`
		function range2(st, endTs) {
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const startTs = st && st.ts != null ? st.ts : null;
			return {
				startTs,
				endTs,
				startText: st && st.text ? st.text : "",
				endText: fmt(endTs),
				raw: `${st && st.text ? st.text : ""} ~ ${fmt(endTs)}`.trim()
			};
		}

		// 终末地（Game8 英文站）：活动排期表，条目形如
		// <a class="a-link" href="...">Bedazzling Dawnstar Sign-In</a><br>(Version 1.4)<br>08/09/26 - 09/02/26
		// 日期为美式 MM/DD/YY；多个并行当期活动时选"结束最晚"（覆盖全部当期窗口）。
		// 无起止区间（只有开始日，如 "07/16"）的条目跳过。
		function parseGame8Events(html, tz) {
			const items = [];
			for (const m of html.matchAll(/<a class="a-link"[^>]*>([^<]+)<\/a><br>\((Version[^)]*)\)<br>([^<]*)/g)) {
				const period = m[3].trim();
				if (!/^\d{1,2}\/\d{1,2}\/\d{2}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2}/.test(period)) continue;
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/);
				if (!mm) continue;
				const y = 2000 + Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({
					banner: m[1].trim(),
					roles: "",
					startTs: a.getTime(),
					endTs: b.getTime(),
					isMain: true
				});
			}
			if (items.length === 0) return null;
			const now = nowMs();
			// 当期（进行中）选结束最晚；无当期时返回 null
			const cur = items
				.filter((it) => coversNow(it, now))
				.sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// parseGame8Events 的宽松回退：容忍 <a> 属性顺序/空白变化。仅在主解析未命中时使用。
		function parseGame8EventsLoose(html, tz) {
			const items = [];
			for (const m of html.matchAll(/<a[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]*?\(Version[^)]*\)[\s\S]*?(\d{1,2}\/\d{1,2}\/\d{2,4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4})/g)) {
				const period = m[2].trim();
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
				if (!mm) continue;
				const y = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({ banner: m[1].trim(), roles: "", startTs: a.getTime(), endTs: b.getTime(), isMain: true });
			}
			if (items.length === 0) return null;
			const now = nowMs();
			const cur = items.filter((it) => coversNow(it, now)).sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// 终末地（Game8 经 host 代理，无 CORS）：活动排期页
		async function fetchGame8Endfield(pageUrl, _signal, tz) {
			const html = await proxyFetchText(pageUrl, "https://game8.co/");
			return parseGame8Events(html, tz) || parseGame8EventsLoose(html, tz);
		}

		// 从 fz.wiki 页面（Next.js App Router）内联 RSC flight payload 中抽取 contentJson 的 JSON 字符串。
		// 数据被序列化为 self.__next_f.push([1,"..."])；拼接后按引号转义还原，再按大括号平衡取 contentJson 对象。
		function extractFzContentJson(html) {
			const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
			let full = "";
			let m;
			while ((m = re.exec(html))) {
				try { full += JSON.parse('"' + m[1] + '"'); } catch { full += m[1]; }
			}
			if (!full.includes('"contentJson"')) return null;
			const ci = full.indexOf('"contentJson"');
			let start = full.indexOf("{", ci);
			if (start < 0) return null;
			let depth = 0, i = start, inStr = false, esc = false;
			for (; i < full.length; i++) {
				const c = full[i];
				if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
				if (c === '"') { inStr = true; continue; }
				if (c === "{") depth++;
				else if (c === "}") { depth--; if (depth === 0) break; }
			}
			try { return JSON.parse(full.slice(start, i + 1)); } catch { return null; }
		}

		// 终末地（FZ Wiki /wiki/活动）：页面 RSC payload → 覆盖当前时刻的活动列表。
		// 活动节点有三种历史结构，全部兼容：
		//   ① endfieldCardActivityIndex.attrs.activities[]（最早）
		//   ② 独立子节点 type=*endfieldCardActivityIndex__activities（字段在自身 attrs）
		//   ③ endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data（当前线上结构）
		// 只收"有明确起止"的活动（timeRanges 末段的 open+close 都非空），
		// 与旧行为一致——无 close 的是新手/每周/引导等常驻活动，不当作当期活动。
		// 时间格式 "2026/9/2 7:00:00"；外显=排序第一条（结束最早的），悬停按同序逐行。
		function parseFzWikiActivities(html, now, tz) {
			const obj = extractFzContentJson(html);
			if (!obj) return null;
			const acts = [];
			const pushAct = (name, tags, trs) => {
				if (typeof name !== "string" || !name) return;
				if (!Array.isArray(trs) || trs.length === 0) return;
				const tr = trs[trs.length - 1];
				if (!tr || !tr.open || !tr.close) return;
				acts.push({ name, tags: tags || [], open: tr.open, close: tr.close });
			};
			(function walk(n) {
				if (!n || typeof n !== "object") return;
				if (Array.isArray(n)) { n.forEach(walk); return; }
				// ① 旧结构：活动在父节点 attrs.activities
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.attrs?.activities)) {
					for (const a of n.attrs.activities) pushAct(a.name, a.tags, a.timeRanges);
				}
				// ② 旧结构：独立的 __activities 子节点，字段在各自 attrs 上
				if (n.attrs && typeof n.type === "string" && n.type.includes("endfieldCardActivityIndex__activities")) {
					pushAct(n.attrs.name, n.attrs.tags, n.attrs.timeRanges);
				}
				// ③ 当前结构：endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.content)) {
					for (const c of n.content) {
						const d = c && c.attrs && c.attrs.data;
						if (d) pushAct(d.name, d.tags, d.timeRanges);
					}
				}
				for (const k of Object.keys(n)) walk(n[k]);
			})(obj);
			// 一条活动都没解析出来 → 页面结构变了（不是"当期没活动"）：抛错让该侧记 down，
			// 面板会显示"活动失败"，而不是伪装成"新活动未公布"（历史教训：源站改版长期静默失灵）。
			if (acts.length === 0) throw new Error("fz-wiki-no-activities");
			// 时间格式 "2026/9/2 7:00:00"（fz.wiki 的**服务器墙钟**，+08）。
			// 不能直接丢给 `new Date(str)`：那个格式不是 ISO，会被当**本机时区**解释 →
			// 海外用户拿到偏移的时刻。这里显式拆出字段，按**源站时区**（`tz`）构造。
			const parseT = (s) => {
				const m = String(s).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
				if (m) return sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
				return new Date(String(s).replace(/\//g, "-")).getTime();
			};
			const t0 = now || nowMs();
			// 覆盖当前时刻的活动统一排序（③ 结束时间升序）供悬停；外显另按类别优先挑选
			const activeActs = sortEventItems(acts
				.filter((a) => parseT(a.open) <= t0 && parseT(a.close) >= t0)
				.map((a) => ({ name: a.name, tags: (a.tags || []).join("/"), startTs: parseT(a.open), endTs: parseT(a.close) })));
			// 解析到活动、但当期没有覆盖当前时刻的 → 返回 null（这一侧记 nomatch = "新活动未公布"）
			if (activeActs.length === 0) return null;
			const primary = pickEventPrimary(activeActs) || activeActs[0]; // 叙事活动/挑战活动优先于签到类
			const win = fmtWindow(primary.startTs, primary.endTs, tz);
			return {
				banner: primary.name,
				bannerDatesRaw: win,
				bannerDates: win,
				eventHover: buildEventHover(activeActs)
			};
		}

		// 终末地（FZ Wiki 经 host 代理，无 CORS）：活动排期页。
		// 三态口径：有当期活动 → 数据；解析到活动但没有当期 → null（nomatch）；
		// 页面结构变了/一条都解析不出 → parseFzWikiActivities 抛错（down）。
		async function fetchFzWikiEndfield(pageUrl, _signal, tz, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://fz.wiki/");
			return parseFzWikiActivities(html, now, tz);
		}

		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → collectGenericEvents → {event, eventDates}
		// ⚠️ 2026-10-03：原来这里还有个 `parseGenericEvents(html, tz)`（collectGenericEvents + selectCurrent 的组合），
		//    经全仓引用分析确认**生产与测试都没用**（活路径走的是下面的 `genericEventPayloadFromHtml`，
		//    它多一层"表里一行都没有 → null"的错误语义处理），已删。
		async function tryParseGenericEvent(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			return genericEventPayloadFromHtml(html, tz);
		}

		// 已拿到 HTML 时的活动载荷（**不抛错**版本）：
		// 供「两侧同一条 URL、且活动侧没有注册抓取器」（自定义条目）复用卡池那次已经取到的
		// HTML —— 省掉第二次请求，同时保证活动侧也能被通用解析命中。
		// 与 genericEventPayload 的差别：表里一行都没有时返回 null（交给调用方按 nomatch 处理），
		// 而不是抛 "bwiki-event-no-table"（那条错误语义是给"内置源站改版"用的）。
		function genericEventPayloadFromHtml(html, tz) {
			let items;
			try { items = collectGenericEvents(html, tz); } catch { return null; }
			if (items.length === 0) return null;
			const cur = selectCurrent(items, nowMs());
			if (!cur || !cur.banner) return null;
			return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
		}

		// 原神（bwiki SMW 语义查询）：活动一览页数据在 JS 动态加载（Dquery + SMW），
		// 改用 api.php?action=ask 直接查询「分类:活动」的开始/结束时间，选当期。
		// 属性：名称/开始时间/结束时间/所属版本；结束时间 9999/01/01 为永久活动占位（跳过）。
		// 查询 URL 由 fetchYsActivity 构造，浏览器直连（api.php 带 origin=* 有 CORS）。
		function parseSmwActivity(json, tz) {
			const results = json?.query?.results || {};
			const now = nowMs();
			const covering = [];
			// SMW timestamp 是 UTC 秒，raw 形如 "1/2026/8/28/10/0/0/0"（**服务器本地时间 +08**）。
			// 用 raw 的值直接构造，但必须按**源站时区**（`tz`）解释 —— 否则海外用户
			// 得到的绝对时刻会整体偏移（"是否在开/倒计时"随之出错）。
			const parseRaw = (v) => {
				if (!v) return null;
				if (v.raw != null) {
					const p = String(v.raw).split("/");
					if (p.length >= 8) {
						const y = Number(p[1]), mo = Number(p[2]), d = Number(p[3]), h = Number(p[4]), mi = Number(p[5]);
						if (y && mo && d) return sourceInstant(y, mo, d, h || 0, mi || 0, tz);
					}
				}
				// 回退：value 若是严格 ISO 本地时间则用之（避免把展示文本误判为时间）
				const iso = v.value != null ? String(v.value) : "";
				if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(iso)) {
					const t = new Date(iso.replace(" ", "T")).getTime();
					if (!Number.isNaN(t)) return t;
				}
				return null;
			};
			for (const [title, r] of Object.entries(results)) {
				const p = r.printouts || {};
				const nameArr = p["名称"] || [];
				const name = Array.isArray(nameArr) && nameArr[0] ? String(nameArr[0]) : title;
				const startTs = parseRaw(p["开始时间"]?.[0]);
				const endTs = parseRaw(p["结束时间"]?.[0]);
				if (startTs == null || endTs == null) continue;
				// 永久活动占位（9999 年）跳过
				if (endTs > 4102444800000) continue; // 2100-01-01
				if (startTs <= now && endTs >= now) {
					// 类型属性（如 剧情活动/常规活动/版本活动）→ 活动外显的类别优先级。
					// 注意 SMW 这里返回的是字符串数组（不是 {fulltext} 值对象），两种形态都兼容。
					const catArr = p["类型"] || [];
					const cat = catArr
						.map((x) => (typeof x === "string" ? x : String((x && (x.fulltext || x.value)) || "")))
						.filter(Boolean)
						.join("/");
					covering.push({ name, cat, startTs, endTs });
				}
			}
			if (covering.length === 0) return null;
			// 悬停按结束时间升序；外显按类别优先（剧情活动/挑战类优先于常规/网页类）
			const ordered = sortEventItems(covering);
			const best = pickEventPrimary(ordered) || ordered[0];
			const win = fmtWindow(best.startTs, best.endTs, tz);
			return {
				banner: best.name,
				roles: "",
				bannerDates: win,
				bannerDatesRaw: win,
				eventHover: buildEventHover(ordered)
			};
		}

		// 原神 SMW 活动查询（经 origin=* 直连）
		// 返回 EVENT_FETCHERS 契约格式 {event, eventDates, eventDatesRaw}（parseSmwActivity 产出卡池格式，这里转换）
		async function fetchYsActivity(signal, tz) {
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|?\u7C7B\u578B|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json, tz);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || ""
			};
		}

		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// 经 host 同源代理的来源（蔚蓝系列 / 终末地 wiki.gg / 1999 等）不用工厂包装：
		// 其抓取器内部自行调用 proxyFetchText / proxyFetchJson（绕过 CORS 与 Referer 反爬）。
		// 抓取器签名：async (url, signal, tz) → 数据对象 | null
		//   第三个参数 `tz` = 源站墙钟时区（可选，见 15-env.js）。工厂把它透传给解析函数，
		//   解析函数再交给 parseTime/parseRange —— 这样"源站时区"只需在来源声明里写一次。
		function mkMediaWiki(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text, tz);
			};
		}
		function mkRaw(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text(), tz);
			};
		}
		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());
		//#endregion

		// ═══════════════════════════════════════════════════════════════════════════
		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/41-sources-shared.js`，
		//    现按用户要求内联到本体（它本就是「本体已有的 pad2/decodeEntities/textOf + 新增来源共用工具」，
		//    分成两个文件只让人来回跳）。符号名与实现**一律未改**。
		//    原文件头保留在下面，信息不丢。
		// ═══════════════════════════════════════════════════════════════════════════

// src/client/41-sources-shared.js —— 新增来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// `next-sources/` 目录与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
//
// 本段提供（解析器直接引用这些名字，不再有 import）：
//   · 抓取：fetchText / fetchJson / fetchMediaWikiText（走宿主代理或直连）
//   · 文本：pad2 / decodeEntities / textOf
//   · 悬停排版：hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover 逐字一致）
// 其余 env 名字（sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags）由 30-parsers.js 与 15-env.js 提供。

		// 解析器原本 import ./lib/env.js；这里用插件已有实现 + 少量补齐顶上（解析器代码不改）。
		//   sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags → 本体已有
		//   pad2 / decodeEntities / textOf                                    → 本区补
		//   fetchText / fetchJson / fetchMediaWikiText                        → 接宿主代理 / 直连
		const ENTITIES_NS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
		// ⚠️ pad2 本体**没有**（第一版误以为有 → 7 个 bwiki 来源全报 "pad2 is not defined"）
		function pad2(n) { return String(n).padStart(2, "0"); }
		function decodeEntities(s) {
			return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
				const key = k.toLowerCase();
				if (ENTITIES_NS[key] != null) return ENTITIES_NS[key];
				if (/^#\d+$/.test(key)) { try { return String.fromCodePoint(Number(key.slice(1))); } catch { return m; } }
				return m;
			});
		}
		function textOf(html) {
			return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
				.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
		}

		// ── HTML 命名实体（**唯一真源**）───────────────────────────────────────────
		// 2026-10-03 合并：此前 **5 个解析器**各写一份 `ENT_EXTRA` + `decodeExtra`
		//   （bandori / biligame-activity / biligame-announce / ournotes-global / ournotes），
		//   函数体**逐字节相同**，差别只在实体表 —— 而 5 张表**互为子集**。
		//   现在用**并集**（30 个，行为探测确认完整覆盖 5 张表），所以：
		//     · 零回归（原来能解的仍然能解）
		//     · 更正确（原来哪个解析器缺 `&copy;` / `&yen;`，就会把实体字面量漏到面板上）
		//   表里也含 `amp/lt/gt/quot/apos/nbsp`（下面 `decodeEntities` 本来就处理），重复无害。
		const ENTITIES_EXTRA = {
			middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–",
			nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
			sup2: "²", sup3: "³", deg: "°", ensp: " ", emsp: " ",
			thinsp: " ", bull: "•", copy: "©", reg: "®", trade: "™",
			laquo: "«", raquo: "»", amp: "&", quot: "\"", apos: "'",
			lt: "<", gt: ">", yen: "¥", hearts: "♥", star: "★",
		};
		/** 在 `decodeEntities` 之上再解一批命名实体（媒体/排版符号）。 */
		function decodeExtra(s) {
			return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
				const v = ENTITIES_EXTRA[String(k).toLowerCase()];
				return v != null ? v : m;
			}));
		}
		/** HTML → 纯文本（保留换行结构）。原来 5 个文件里的 `plain()` 都是这个。 */
		function htmlText(html) { return decodeExtra(textOf(html)); }
		/** 同上，但把空白压成单空格并去首尾空白（原来只有 ournotes-global 这么做）。 */
		function htmlTextTight(html) { return htmlText(html).replace(/\s+/g, " ").trim(); }

		// ── 时间戳与排序（**唯一真源**）────────────────────────────────────────────
		// 2026-10-03 收敛：
		//   · `toTs` 有 2 份、语义还不同（bestdori **宽容**：接受数字字符串；sekai **严格**：只接受 number）
		//   · `byNewestStart` 有 3 份，其中 umapyoi 那份**缺 null 守卫**
		//     （`a.endTs - b.endTs` 在 endTs 为 null 时得 NaN，排序行为未定义）
		//   现在统一为下面两个。取**宽容版** `numOrNull`：对 number 两者行为一致，
		//   对数字字符串宽容版能解出来而严格版返回 null —— 即"能解析的更多"，属改进。

		/** 源站时间戳 → 数字毫秒；`null` / `""` / 非数字 → null。接受数字字符串。 */
		function numOrNull(v) {
			if (v == null || v === "") return null;
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		}

		/**
		 * 「按开始时间从新到旧」排序：开始晚的在前；同开始则**结束早的在前**（空结束排最后）；
		 * 再同则按 id 升序。`endTs` 用 `Infinity` 兜空值 —— 原 umapyoi 版直接相减，
		 * 一旦有 null 就得 NaN（潜在 bug），这里一并修掉。
		 */
		function byNewestStart(a, b) {
			return (b.startTs - a.startTs)
				|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
				|| ((Number(a.id) || 0) - (Number(b.id) || 0));
		}

		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") {
				const res = await transportFetchRaw(url, { signal: o.signal, headers: Object.assign({}, rawHeaders(url), o.headers || {}) });
				if (!res.ok) throw new Error("http-" + res.status);
				return res.text();
			}
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}
		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}
		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}
		//#endregion

		//#region 悬停排版共用工具（**唯一真源，改实现就改这里**）
		// 方案 A（用户 2026-10-03）：新增来源的悬停频出「格式/规则与原有条目差别很大」，
		// 根因是各批次各写各的。这里把排版逻辑做成唯一真源，解析器一律调用。
		// ⚠️ 2026-10-03 之后 `next-sources/` 与生成器都已删除，本段**不再由任何脚本抽取/覆盖**。
		// ── 为什么单独立一个区域 ──
		// 用户 2026-10-03 反馈「新增游戏的悬停样式/格式/规则和原来的差别很大」。核实后确认：
		// 各批次解析器**各写各的悬停**，出现了三类偏差 ——
		//   ① 悬停里塞元信息（来源 URL / 时区推定 / 抓取条数 / 实现细节）—— 本体条目**从不**这样做
		//   ② 「档期在前、名称在后」（本体一律 `名称 + 3 空格 + 档期`）
		//   ③ 档期用源站原文而非 fmtWindow 格式化
		// 修法（方案 A）：把本体那两个函数的排版逻辑抽到这里做**唯一真源**，解析器一律调用。
		// （落点原本是 next-sources/lib/env.js，压平后就是本文件；测试与运行时读的是同一份代码。）
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：**直接用本体 30-parsers.js 的那一条**（阈值也只有那一处）。
// ⚠️ 2026-10-03 收敛：这里曾有一份逐字重复的实现 + 第二个 `HOVER_MAX_WINDOW_DAYS = 120` 常量。
//    同一条规则不该有第二份实现/第二个值 —— 已删，改为调用 `isLongTermWindow`。
//    （函数声明会提升，所以 41 在本体的 30 之后拼接也不影响这里的调用。）
// 排序：结束时间升序（无/未知结束时间排最后），再按开始时间
function hoverSortByEnd(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// 永久/常驻活动计数行 —— **直接用本体 `permanentLine`**（30-parsers.js）。
// ⚠️ 2026-10-03 收敛：这里曾有一份逐字相同的副本 `hoverPermanentLine`（措辞 `以及常驻活动 N 项`）。
//    本体注释写着"抽成函数是为了**措辞只有一处**"，副本正是打破了那句话，已删。

/**
 * 卡池列悬停。复刻本体 `buildPoolHover`：
 *   每池两行 —— `池名：角色` ⏎ `档期`；窗口完全相同的池合并时间（只在末尾写一遍）。
 * `pools` 项：`{ name, label?, startTs?, endTs?, raw? }`（`label` 优先于 `name`）。
 * 返回 "" = 不足 2 池，交回 UI 默认两行式。
 */
function hoverPool(pools, tz) {
	const list = (Array.isArray(pools) ? pools : [])
		.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
		.sort(hoverSortByEnd);
	if (list.length < 2) return "";
	const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
	const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
	const lines = [];
	for (const p of list) {
		lines.push(p.label || p.name);
		if (same) continue;
		const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs, tz) : String(p.raw || "").trim();
		if (t) lines.push(t);
	}
	if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
	return lines.join("\n");
}

/**
 * 活动列悬停。复刻本体 `buildEventHover`：
 *   每条一行 `名称` + **3 空格** + `档期`（档期用 fmtWindow 格式化）；
 *   窗口完全相同时只列名称、末尾写一次档期；缺起止的行显示该行 `raw` 原文。
 * **不排序**（与本体一致：调用方负责排序）。
 * `permanentCount` = 永久/常驻活动数，只在末尾补一行计数。
 * 返回 "" = 不足 2 条（交回 UI 默认两行式）。
 */
function hoverEvent(items, tz, permanentCount = 0) {
	const list = (Array.isArray(items) ? items : [])
		.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
		.filter((x) => !isLongTermWindow(x));
	if (list.length < 2) return permanentLine(permanentCount);
	const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
	const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
	const lines = list.map((x) => {
		if (x.startTs != null && x.endTs != null) {
			return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs, tz)}`;
		}
		const raw = String(x.raw || "").trim();
		return raw ? `${x.name}   ${raw}` : x.name;
	});
	if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
	if (permanentCount > 0) lines.push(permanentLine(permanentCount));
	return lines.join("\n");
}

		//#region proxy fetchers（经 host 代理）与统一来源注册表
		// 中文时间解析（繁体/简体共用）：
		// "8月18日(二)維護後" / "9月1日(二)上午9點59分" / "晚間10點59分" / "08月20日 14:00"
		function parseZhTime(raw, nowYear) {
			const s = String(raw).trim();
			const md = s.match(/(\d{1,2})月(\d{1,2})日/);
			if (!md) return null;
			const mo = Number(md[1]), d = Number(md[2]);
			let h = 0, mi = 0;
			const tm = s.match(/(上午|下午|中午|凌晨|晚上|晚間)?\s*(\d{1,2})[點点](\d{1,2})?[分]?/);
			if (tm) {
				let hh = Number(tm[2]);
				const mm = tm[3] ? Number(tm[3]) : 0;
				const period = tm[1] || "";
				if ((period === "下午" || period === "晚上" || period === "晚間") && hh < 12) hh += 12;
				if (period === "中午" && hh < 12) hh += 12;
				if (period === "凌晨" && hh === 12) hh = 0;
				h = hh; mi = mm;
			}
			const ts = new Date(nowYear, mo - 1, d, h, mi).getTime();
			return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
		}

		// 经 host 代理抓取文本 / JSON 两个函数的**实现**已移到外壳（92-dsh-env.js），
		// core 侧只在 15-env.js 保留同名薄封装（转调 coreEnv.transport）——这是 core 零宿主依赖的接缝之一。

		// 解析繁体时间段："8月18日(二)維護後 ~ 9月1日(二)上午9點59分"
		// 跨年（如 12月30日 ~ 1月5日）：结束月份小于开始月份 → 结束端按"下一年"解析；
		// 否则 end 会早于 start，当期会被误判成"未公布"（每年 12 月底~1 月初复发）。
		function parseBaZhRange(raw, nowYear) {
			const s = stripTags(raw);
			const parts = s.split(/[~～]/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const moOf = (x) => { const m = String(x).match(/(\d{1,2})月/); return m ? Number(m[1]) : null; };
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseZhTime(parts[0], nowYear);
			const b = parseZhTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		// 解析更新日誌正文的日程表 → 行数组 {cat, name, range, dateRaw}
		function parseBaLogRows(content, nowYear) {
			const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
			const items = [];
			for (const row of rows) {
				const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
				if (cells.length < 3) continue;
				const cat = cells[1] || "";
				const name = cells[2] || "";
				if (!cat || !name) continue;
				let range = parseBaZhRange(cells[0], nowYear);
				let relStart = false;
				let openEnded = false;
				if (!range && /維護(?:結束)?後|維護後/.test(cells[0])) {
					// 起点写"維護結束後"的日程行：先解析结束端，起点留待按本期维护结束时间补全（fetchBaGlobal）
					const parts = stripTags(cells[0]).split(/[~～]/).map((x) => x.trim());
					if (parts.length >= 2) {
						const b = parseZhTime(parts[parts.length - 1], nowYear);
						if (b) { range = { startTs: null, endTs: b.ts, startText: null, endText: b.text, raw: stripTags(cells[0]) }; relStart = true; }
					} else {
						// 只有「維護後」、官方未给结束端（如常駐化活動）：保留该行，结束端留空、时间按原文展示，不做推算
						range = { startTs: null, endTs: null, startText: null, endText: null, raw: stripTags(cells[0]) };
						relStart = true;
						openEnded = true;
					}
				}
				items.push({ cat, name, range, dateRaw: cells[0], relStart, openEnded });
			}
			return items;
		}

		// 蔚蓝档案·国际服：nexon 官方「更新日誌」board(3352) → 当期卡池 + 当期活动
		// 一次请求拿到更新日誌正文，从日程表同时提取 特選招募（卡池）与 活動劇情/總力戰（活动）
		async function fetchBaGlobal(logListUrl, signal, tz, now = nowMs()) {
			const ref = "https://forum.nexon.com/bluearchiveTW/";
			const list = await proxyFetchJson(logListUrl, ref);
			const threads = Array.isArray(list?.threads) ? list.threads : [];
			// 每篇日志的维护日取标题日期（"8/18(二) 更新日誌"）；日期跨年按当前年推断
			// ⚠️ 这里是 `inferYear`（30-parsers.js）那条规则的**绝对值版本**：拿不到公告年、
			//    只拿得到 now，于是用"按今年解释后若落在 now 之后 45 天以外 → 必是去年"代替月份比较。
			//    之所以 45 天而非 6 个月：日志列表按时间倒序、且只取 `ts <= now` 的那篇，
			//    正常日期一定紧贴 now；超出一个半月的"未来日期"只可能是把去年的 12/31 解释成了今年。
			const LOG_DATE_ROLLBACK_DAYS = 45;
			const y = new Date(now).getFullYear();
			const threadDate = (t) => {
				const m = String(t.title || "").match(/(\d{1,2})\/(\d{1,2})\(/);
				if (!m) return null;
				let d = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
				if (d.getTime() > now + LOG_DATE_ROLLBACK_DAYS * 864e5) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]), 0, 0);
				return d.getTime();
			};
			const dated = threads
				.map((t) => ({ t, ts: threadDate(t) }))
				.filter((x) => x.ts != null && /更新日誌/.test(String(x.t.title || "")))
				.sort((a, b) => b.ts - a.ts);
			// 窗口匹配：日志 i 覆盖 [其维护日, 下一篇(更早)日志维护日)；取"最新且不晚于 now"的一篇
			const pick = dated.find((x) => x.ts <= now);
			if (!pick?.t?.threadId) return null;
			const detail = await proxyFetchJson(`https://forum.nexon.com/api/v1/thread/${pick.t.threadId}?alias=bluearchiveTW&countryCode=KR`, ref);
			const content = typeof detail?.content === "string" ? detail.content : "";
			if (!content) return null;
			const nowYear = new Date(now).getFullYear();
			const rows = parseBaLogRows(content, nowYear);
			// 维护结束时刻：从正文维护段"日期…上午10點～下午2點"取结束钟点，
			// 用于把日程表里起点为"維護結束後"的行补成显式起点
			const logTxt = String(content).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
			const mEnd = logTxt.match(/日期\s*[：:]\s*\d{1,2}月\d{1,2}日(?:[^。\n]{0,60}?)[～~-]\s*(上午|下午|中午|晚上)(\d{1,2})點(?:\s*(\d{1,2})分?)?/);
			let maintEndTs = null, maintEndText = "";
			const dayBase = new Date(pick.ts);
			if (mEnd) {
				let hh = Number(mEnd[2]);
				if ((mEnd[1] === "下午" || mEnd[1] === "晚上") && hh < 12) hh += 12;
				if (mEnd[1] === "中午" && hh < 12) hh += 12;
				const mi = mEnd[3] ? Number(mEnd[3]) : 0;
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), hh, mi).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			}
			if (maintEndTs == null) { // 兜底：维护日 14:00
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 14, 0).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} 14:00`;
			}
			for (const r of rows) {
				if (r.relStart && r.range && r.range.startTs == null) {
					r.range.startTs = maintEndTs;
					r.range.startText = maintEndText;
					// 结束端缺失的行不改写 raw：保留日程原文，避免出现"09-08 14:00 ~"这种半个区间
					if (!r.openEnded) r.range.raw = `${maintEndText} ~ ${r.range.endText ?? ""}`.trim();
				}
			}
			// 当期卡池：特別特選招募 / 特選招募（时间覆盖 now）
			const bannerRow = rows.find((r) => /特選招募/.test(r.cat) && r.range && coversNow(r.range, now));
			// 当期活动候选：活動劇情 > 迷你活動 > 總力戰/大決戰/制約解除決戰/綜合戰術考試；
			// 常駐化活動（名稱含「常駐」）优先级最低；只有起点、官方未给结束端的行同样纳入候选
			const activeRow = (r) => !!r.range && r.range.startTs != null && r.range.startTs <= now &&
				(r.openEnded || (r.range.endTs != null && r.range.endTs >= now));
			const evTier = (r) => {
				if (/活動劇情/.test(r.cat)) return 1;
				if (/迷你活動/.test(r.cat)) return 2;
				if (/總力戰|大決戰|制約解除決戰|綜合戰術考試/.test(r.cat)) return 3;
				return 9;
			};
			const evCandidates = rows.filter((r) => evTier(r) < 9 && activeRow(r));
			// ③ 统一排序：结束时间升序（常驻/未给结束端的行 endTs 为空，自然排最后）；
			// 外显取排序第一条，悬停按同序逐行；长期/常驻玩法由 sortEventItems 一并剔除
			const evOrdered = sortEventItems(evCandidates.map((r) => ({
				name: r.name,
				cat: r.cat,
				startTs: r.openEnded ? null : r.range.startTs,
				endTs: r.openEnded ? null : r.range.endTs,
				raw: r.openEnded ? r.dateRaw : r.range.raw
			})));
			// 外显：类别优先（活動劇情/總力戰/大決戰 优先于 迷你活動/常駐类），同级内结束时间升序
			const eventRow = pickEventPrimary(evOrdered) || null;
			const evDates = eventRow
				? (eventRow.startTs != null && eventRow.endTs != null ? fmtWindow(eventRow.startTs, eventRow.endTs) : (eventRow.raw || ""))
				: "";
			const eventHover = buildEventHover(evOrdered);
			const data = {
				banner: "",
				roles: "",
				bannerDates: "",
				event: "",
				eventDates: ""
			};
			if (bannerRow) {
				data.banner = bannerRow.cat; // 如「特別特選招募」「特選招募」
				data.roles = baRoleName(bannerRow.name); // 蔚蓝三服角色名：保留括号后缀 + 全角括号转半角
				data.bannerDates = bannerRow.range.raw;
			} else if (eventRow) {
				// 无卡池行时至少给出活动
				data.banner = eventRow.name;
				data.bannerDates = evDates;
			}
			// 卡池列悬停：日程表里同期所有招募行（特選招募/特別特選招募 等），每池"类别：成员"一行 + 时间
			const recRows = rows.filter((r) => /招募/.test(r.cat) && r.range && coversNowBounded(r.range, now));
			const poolHover = buildPoolHover(recRows.map((r) => ({
				name: r.cat,
				label: `${r.cat}\uFF1A${baRoleName(r.name)}`,
				startTs: r.range.startTs,
				endTs: r.range.endTs,
				raw: r.range.raw
			})));
			if (poolHover) data.bannerHover = poolHover;
			if (eventRow) {
				data.event = eventRow.name; // 活动名（去掉"活動劇情："类类别前缀，精简展示）
				data.eventDates = evDates;
				if (eventRow.openEnded) data.eventDatesRaw = eventRow.dateRaw;
			}
			if (eventHover) data.eventHover = eventHover;
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 终末地（wiki.gg 经 host 代理）：抓取 Headhunting/Banners HTML → parseEndfieldCurrent
		// ⚠️ 2026-10-03 实测更正（原注释说"校验 Referer，非 wiki.gg 域名 403"，**是错的**）：
		//    wiki.gg 拦的是 **浏览器型 User-Agent**，不是 Referer。逐项实测（同一 URL）：
		//      无头 200 / 仅 Referer 200 / 仅 Accept 200 / Referer+Accept 200
		//      仅 UA=Chrome/126 **403** / 仅 UA=curl/8.0 200 / 仅 UA=dsh-gacha-calendar 200
		//    而宿主代理 `src/index.js` 对所有请求统一发**浏览器 UA**（它的注释写着
		//    "browser-like, to satisfy anti-scrape"）—— 于是这个备选源经代理必然 403。
		//    修法：本抓取器显式覆盖 UA 为中性值（代理的 `headers` 参数会覆盖默认 UA）。
		//    不给末端用户添麻烦，也不动全局 UA（别处可能正依赖浏览器 UA）。
		const ENDFIELD_WG_UA = "dsh-gacha-calendar";
		// 注意：这个地址是 MediaWiki 的 **api.php**，返回的是 JSON（`{"parse":{"text":"<html>"}}`）——
		// 必须取 parse.text 再解析。旧实现直接把原始 JSON 串喂给解析器，于是 id="Current" 在 JSON 里是
		// 转义形式（id=\"Current\"）永远匹配不到 → 该备选源长期"抓得到但解析不出"（这才是真根因）。
		async function fetchEndfieldWikiGg(proxyUrl) {
			const json = await proxyFetchJson(proxyUrl, "https://endfield.wiki.gg/", { "User-Agent": ENDFIELD_WG_UA });
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseEndfieldCurrent(html);
		}

		// ---- 蔚蓝档案·日服 官方公告（api-web.bluearchive.jp）----
		// 「ピックアップ募集紹介」条目结构（同一公告内多池、逐池给出）：
		//   ▼ピックアップ対象
		//   ピックアップ名： 「そして夏は爆破で終わる！」
		//   ピックアップ生徒：★3「カスミ(水着)」
		//   ▼実施期間 2026年9月9日(水) メンテナンス後 ~ 2026年9月23日(水・祝) 10:59
		// 时间按 JST(+09:00) 解析（展示时转本地）；起点写「メンテナンス後」时取同期维护公告
		// 「▼実施時間 … ～ … 17:00前後」的结束时刻。活动取同期「イベント」条目的開催期間。
		function parseBaJpNews(json, now = nowMs(), tz) {
			const rows = Array.isArray(json?.data?.rows) ? json.data.rows : [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\s+/g, " ").trim();
			// JST 时间戳（JST = UTC+9）
			const jstTs = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
			const jpDate = (s) => {
				const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,8}(\d{1,2}):(\d{2})/);
				return m ? jstTs(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
			};
			const afterMaint = (s) => /メンテナンス後/.test(String(s));
			// 维护结束时刻（"メンテナンス後"的起点）：最新一篇维护公告的実施時間 结束端
			let maintEnd = null;
			for (const it of rows) {
				const m = clean(it.content).match(/実施時間\s*([^~～]{4,48})[~～]\s*([^前]{4,48})/);
				if (!m) continue;
				const e = jpDate(m[2]);
				if (e != null) { maintEnd = e; break; }
			}
			// 当期卡池：最新一篇含「ピックアップ名／ピックアップ生徒」的募集公告
			let pools = null;
			for (const it of rows) {
				const text = clean(it.content);
				if (!/ピックアップ募集/.test(text) || !/ピックアップ名/.test(text)) continue;
				const found = [...text.matchAll(/ピックアップ名：\s*「([^」]+)」\s*ピックアップ生徒：\s*(?:★\d)?「([^」]+)」/g)]
					.map((m) => ({ name: m[1], student: m[2] }));
				if (found.length === 0) continue;
				const windows = [...text.matchAll(/実施期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/g)].map((m) => {
					const a = m[1].trim(), b = m[2].trim();
					const startTs = afterMaint(a) ? maintEnd : jpDate(a);
					const endTs = jpDate(b);
					return { startTs: startTs ?? null, endTs: endTs ?? null, raw: `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}` };
				});
				const fallback = windows[0] || { startTs: null, endTs: null, raw: "" };
				pools = found.map((f, i) => Object.assign({ name: f.name, student: f.student }, windows[i] || fallback));
				break;
			}
			if (!pools) return null;
			// 只保留覆盖当前时刻的池（起点缺省时按"结束在未来"宽松判定）
			const cur = pools.filter((p) => coversNow(p, now));
			if (cur.length === 0) return null;
			// 展示用的档期必须取"被选中的那个池"自己的窗口（cur[0]）—— 旧实现固定取 windows[0]，
			// 一旦当期命中的不是第一个池，就会显示"B 池名字 + A 池时间"，倒计时按错档期跑。
			const win0 = cur[0];
			const dates = win0.startTs != null && win0.endTs != null ? fmtWindow(win0.startTs, win0.endTs, tz) : (win0.raw || "");
			const data = {
				banner: cur[0].name,
				roles: [...new Set(cur.map((p) => p.student))].join("、"),
				bannerDates: dates,
				bannerDatesRaw: win0.raw || dates,
				startTs: cur[0].startTs,
				endTs: cur[0].endTs
			};
			// 卡池列悬停：每池「池名：生徒」一行 + 时间（同窗口合并，结束时间升序）
			const hover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.student}`,
				startTs: p.startTs,
				endTs: p.endTs,
				raw: p.raw
			})));
			if (hover) data.bannerHover = hover;
			// 活动：同期「イベント」条目的開催期間
			for (const it of rows) {
				const sum = clean(it.summary);
				const text = clean(it.content);
				const m = (sum || text).match(/【(復刻)?イベント】「([^」]+)」/);
				if (!m) continue;
				const pr = text.match(/開催期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/);
				if (!pr) continue;
				const a = pr[1].trim(), b = pr[2].trim();
				const startTs = afterMaint(a) ? maintEnd : jpDate(a);
				const endTs = jpDate(b);
				if (startTs == null || endTs == null || startTs > now || endTs < now) continue;
				data.event = m[1] ? `${m[2]}（復刻）` : m[2];
				data.eventDates = fmtWindow(startTs, endTs);
				data.eventDatesRaw = `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}`;
				break;
			}
			return data;
		}

		// 日服卡池默认抓取器：官网新闻接口优先；失败或无当期募集 → 回退 GameKee 当期卡池（仅池名+档期）。
		// 只返回卡池字段：活动字段由活动源单独负责（卡池/活动解耦，避免活动源失败时静默混入官方活动）
		async function fetchBaJpGacha(url, signal, tz, now = nowMs()) {
			try {
				const json = await proxyFetchJson(url, "https://bluearchive.jp/");
				const d = parseBaJpNews(json, now, tz);
				if (d) {
					delete d.event;
					delete d.eventDates;
					delete d.eventDatesRaw;
					return d;
				}
			} catch { /* 官方失败 → GameKee 兜底 */ }
			return fetchGameKeeBa("jp");
		}

		// 日服活动备选抓取器：同一个官方接口的「イベント」条目（只取 event 字段）
		async function fetchBaJpOfficialEvent(url, signal, tz, now = nowMs()) {
			const json = await proxyFetchJson(url, "https://bluearchive.jp/");
			const d = parseBaJpNews(json, now, tz);
			if (!d || !d.event) return null;
			return { event: d.event, eventDates: d.eventDates || "", eventDatesRaw: d.eventDatesRaw || d.eventDates || "" };
		}

		// ---- GameKee（蔚蓝档案）----
		// 解析标题里的排期：【8/18~9/01】 / 【8月26日 ~ 9月9日】 → {startText, endText, startTs, endTs}
		function parseGkRange(title, nowYear) {
			const m = String(title).match(/【([^】]+)】/);
			if (!m) return null;
			const inner = m[1].replace(/\s+/g, "");
			const parts = inner.split(/[~～\-—]/);
			if (parts.length < 2) return null;
			const moOf = (p) => { const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/); return md ? Number(md[1]) : null; };
			const parseGkTime = (p, year) => {
				// 8/18 或 8月18日（日服可能带 日）
				const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/);
				if (!md) return null;
				const mo = Number(md[1]), d = Number(md[2]);
				const ts = new Date(year, mo - 1, d, 0, 0).getTime();
				return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00` };
			};
			// 跨年（如 【12/28~1/5】）：结束月份小于开始月份 → 结束端按"下一年"解析
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseGkTime(parts[0], nowYear);
			const b = parseGkTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		// GameKee：按服务器拉当期卡池+活动（标题含排期）
		// serverKey: "jp"|"global"；返回 {banner, roles, bannerDates, event, eventDates}
		async function fetchGameKeeBa(serverKey) {
			const ref = "https://www.gamekee.com/ba/huodong/15";
			const headers = { "game-alias": "ba" };
			// 1. 目录树 → 找"当期活动 | 当期卡池"子条目
			const tree = await proxyFetchJson("https://www.gamekee.com/v1/wiki/entry?id=15", ref, headers);
			const list = tree?.data?.entry_list || [];
			let currentCat = null;
			const find = (nodes) => {
				for (const n of nodes || []) {
					// 名称可能含隐藏字符，用 includes 匹配
					if (String(n.name || "").includes("\u5F53\u671F\u6D3B\u52A8") && String(n.name || "").includes("\u5361\u6C60")) { currentCat = n; return; }
					if (n.child) find(n.child);
				}
			};
			find(list);
			if (!currentCat?.child) return null;
			const child = currentCat.child;
			// 找该服条目：日服(jp) 活动/卡池；国际服(global) 活动/卡池
			const isJp = serverKey === "jp";
			const kw = isJp ? "日服" : "国际服";
			const eventEntry = child.find((c) => c.name.includes(kw + "活动"));
			const bannerEntry = child.find((c) => c.name.includes(kw + "当期卡池"));
			// 2. 拉标题（含排期）
			const getTitle = async (entry) => {
				if (!entry?.content_id) return null;
				const d = await proxyFetchJson(`https://www.gamekee.com/v1/content/detail/${entry.content_id}`, ref, headers);
				return typeof d?.data?.title === "string" ? d.data.title : "";
			};
			const bannerTitle = bannerEntry ? await getTitle(bannerEntry) : "";
			const eventTitle = eventEntry ? await getTitle(eventEntry) : "";
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const data = { banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
			if (bannerTitle) {
				const rng = parseGkRange(bannerTitle, nowYear);
				if (rng) {
					// 卡池名：只去「(蔚蓝档案)(日服/国际服)当期卡池(评测)：」这类表头与末尾日期括号，
					// 池名里的标点（! ~ ！ 等）一律保留
					data.banner = String(bannerTitle)
						.replace(/^(?:蔚蓝档案)?\s*(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:卡池|招募|评测)[^：:]*[:：]\s*/, "")
						.replace(/【[^】]*\d[^】]*】/g, "")
						.trim();
					data.bannerDates = rng.raw;
				}
			}
			if (eventTitle) {
				const rng = parseGkRange(eventTitle, nowYear);
				if (rng) {
					// 活动名：只删可识别的游戏/服别前缀与"活动攻略整理"类后缀 + 末尾日期括号；
					// 名字里的标点（! ~ ！ ～ 等）与「复刻」都保留
					// 如 "蔚蓝档案国际服 比赛开始~目标！满贯全垒打！~ 复刻活动攻略整理【09/01~09/15】"
					//    → "比赛开始~目标！满贯全垒打！~ 复刻"
					const cleaned = String(eventTitle)
						.replace(/【[^】]*\d[^】]*】/g, "")
						.replace(/^蔚蓝档案\s*/, "")
						.replace(/^(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:活动|卡池)(?:攻略|评测)?[^：:]*[:：]\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*(?:当期)?\s*(?:活动|卡池)\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*[:：]?\s*/, "")
						.replace(/活动一图攻略整理|活动攻略整理|攻略整理$/, "")
						.trim();
					data.event = cleaned || String(eventTitle).replace(/【[^】]*\d[^】]*】/g, "").trim();
					data.eventDates = rng.raw;
				}
			}
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 蔚蓝国服（官网 bluearchive-cn.com）：news/list → 最新维护更新说明 → 当期卡池/活动名 + 维护起止
		// 时间：维护日 14:00 ~ 下次维护前（约 +14 天，取维护日开始、预加载下一期预告前）
		async function fetchBaCn(listUrl, _signal, tz, now = nowMs()) {
			const H = { "game-alias": "ba" };
			const ref = "https://bluearchive-cn.com/";
			const nowYear = new Date(now).getFullYear();
			const list = await proxyFetchJson(listUrl, ref, H);
			const rows = list?.data?.rows || [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			// 窗口匹配：对最新的若干篇"维护更新说明"，按其正文首个维护时间（起）+14 天（卡池窗口）判定是否覆盖 now；
			// 列表 content 被截断时按 id 取详情补齐再判定；选覆盖 now 的那一篇（不再无条件取最新）
			const mains = rows.filter((n) => /维护更新说明/.test(n.title || ""));
			let maintTitle = null;
			let maintRaw = null;      // 选中那篇的**原始正文**：循环里已经为它抓过详情时直接复用，不再重复请求
			for (const it of mains.slice(0, 8)) {
				let raw = String(it.content || "");
				let txt = clean(raw);
				let first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!first && it.id) {
					try {
						const det = await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${it.id}`, ref, H);
						raw = String(det?.data?.news?.content || "");
						txt = clean(raw);
						first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
					} catch { /* 跳过该候选 */ }
				}
				if (!first) continue;
				const mo = Number(first[1]), d = Number(first[2]);
				const startTs = new Date(nowYear, mo - 1, d, Number(first[3]), Number(first[4])).getTime();
				const endTs = new Date(nowYear, mo - 1, d + 14, 13, 59).getTime();
				if (startTs <= now && now <= endTs) { maintTitle = it; maintRaw = raw; break; }
			}
			if (!maintTitle?.id) return null;
			// 选中那篇若已经在上面抓过详情（列表 content 被截断的情况）→ 直接复用，省掉一次代理往返
			const content = maintRaw || String((await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${maintTitle.id}`, ref, H))?.data?.news?.content || "");
			if (!content) return null;
			// HTML → 文本
			const text = String(content)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			return parseBaCnMaintText(text, nowYear, tz);
		}
		// 国服公告里「招募」开头的东西**不是一类**。实测（09月24日维护更新说明）：
		//   更新限时限定招募【秩序隐匿于粼粼波光中】   ← 限定角色卡池（当期主卡池）
		//   更新限时限定招募【思绪飘散在漫漫夏夜里】   ← 限定角色卡池（同期第二池）
		//   更新限时招募活动【100次免费招募】          ← 免费招募**活动**（不是卡池）
		//   更新限时招募活动【3★必得招募】            ← 必得**活动**
		//   更新限时招募活动【3★限定成员必得招募】    ← 限定必得**活动**
		//   更新限时招募活动【3★自选招募】            ← 自选**活动**
		// 关键区分点在**词序**：`…招募【` 后面紧跟 `】` 的是**卡池名**；
		//   而 `招募活动【` 是"招募"作定语去修饰"活动"，是**活动**。
		// 曾经的糟糕修法是"把所有 招募 塞进一条正则按出现顺序取第一条" —— 那等于把
		// 限定卡池与招募活动混成同一类（用户指出）。这里按类型分级取，并显式排除活动类。
		const BA_CN_CHAR_POOL_RE = /^更新限时(限定复刻|限定|复刻|)招募$/;
		// 档位：限定角色池 > 普通角色池 > 限定复刻池 > 复刻池（数值越小越优先）
		const BA_CN_POOL_RANK = { 限定: 0, "": 1, 限定复刻: 2, 复刻: 3 };

		function baCnPoolInfo(line) {
			const m = line.match(/更新限时([^【]*)【([^】]+)】/);
			if (!m) return null;
			const t = BA_CN_CHAR_POOL_RE.exec(`更新限时${m[1]}`);
			return { isPool: !!t, kind: t ? t[1] : "", name: m[2] };
		}

		// 国服维护公告正文 → 卡池/活动数据（纯函数：只吃**已清洗的文本**，不碰网络）。
		// 抽出来是为了能用合成文本精确回归 —— 这个源的坑全在措辞（见上面类型表），
		// 而措辞能不能认出来只能靠测解析，靠抓线上只能"等它坏了才发现"。
		// 无角色卡池时返回 null（调用方据此判"未公布"）。
		function parseBaCnMaintText(text, nowYear, tz) {
			// 卡池识别分两步：① 挑出**角色卡池**（排除招募活动）；② 按档位选外显那一类。
			//
			// WHY 不能只认一种写法：措辞漂移过。旧写法 `更新限时招募【X】` 曾一度**一处都没有**
			//   （实测 0 处），当前正文用的是 `更新限时限定招募【X】`。老代码只认旧写法 →
			//   banner 为空 → 末尾 `if (!data.banner) return null` 把整条记录判死，
			//   表现为卡池与活动**两列同时**「无匹配/未公布」（两列共用本函数）。
			const bannerPools = [];
			for (const line of text.split("\n")) {
				const info = baCnPoolInfo(line);
				if (info && info.isPool) bannerPools.push({ ...info, line });
			}
			// 按（档位, 出现顺序）取最优：稳定排序即可，因为 bannerPools 已按文档顺序收集
			bannerPools.sort((a, b) => (BA_CN_POOL_RANK[a.kind] ?? 9) - (BA_CN_POOL_RANK[b.kind] ?? 9));
			const bannerPool = bannerPools[0] || null;
			// 当期活动名（第一个"更新限时活动【X】"）
			const eventM = text.match(/更新限时活动【([^】]+)】/);
			// 维护开始时间 "08月20日 14:00"
			const maintM = text.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let bannerDates = "", eventDates = "";
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const start = fmt(mo, d, Number(maintM[3]), Number(maintM[4]));
				// 卡池结束：约 14 天后（下一期维护）
				const end = new Date(nowYear, mo - 1, d + 14, 13, 59);
				bannerDates = `${start} ~ ${fmt(end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`;
				// 活动结束：约 28 天后（蓝档国服活动通常比卡池多一期，如和乐庆典到 09-17 13:59）
				const eEnd = new Date(nowYear, mo - 1, d + 28, 13, 59);
				eventDates = `${start} ~ ${fmt(eEnd.getMonth() + 1, eEnd.getDate(), eEnd.getHours(), eEnd.getMinutes())}`;
			}
			// 公告里同期**全部角色卡池**（只含卡池，不含招募活动）：池名 + 该行成员名，如
			// 2、更新限时招募【夏日思绪长…】，…全新3★成员「桔梗（泳装）」、2★成员「莲华（泳装）」登场
			const recPools = bannerPools.map((p) => {
				const members = [...new Set([...p.line.matchAll(/(?:\d★)?(?:限定)?成员\s*[「“"]([^」”"]+)[」”"]/g)].map((x) => baRoleName(x[1].trim())).filter(Boolean))];
				return { name: p.name, kind: p.kind, members };
			});
			// ---- 外显 = **卡池类型**（对齐国际服「特選招募」的呈现方式），不是某个池名 ----
			//
			// WHY 改成显示类型（用户要求，2026-09-30）：国服一期公告常同时开**同类多个池**
			//   （当期两个「限定招募」），只显示第一个池名会漏掉另一个池；而卡池类型才是
			//   "这一期在开什么"的稳定答案。国际服走结构化日程表，外显本来就是类别（`特選招募`），
			//   这里对齐它。
			// 同类型多池的**角色合并**展示（同国际服 roles 的做法）；悬停只列同类型那些池，
			// 不把其它档位的池混进来（否则"显示限定招募、悬停却列着复刻池"自相矛盾）。
			//
			// 类型只放在 `banner` 里（悬停第一行会显示它，与国际服 `特選招募` 的位置一致）。
			// **不另外加 `bannerKind` 字段**：面板卡片格的规则是"有角色就显示角色"，
			// 而 core 的 Result JSON 是冻结契约、字段白名单外的会被丢掉（实测过），
			// 想让卡片显示类型就得改契约。用户 2026-09-30 选择方案 A（类型只进悬停），
			// 故这里不留没有消费者的字段。
			const bannerKind = bannerPool ? bannerPool.kind : null;
			// 类型名 = **限时[限定][复刻]招募** —— 注意**不带 `更新`**。
			//
			// 公告原文是 `2、更新限时限定招募【秩序隐匿于粼粼波光中】`，断句是：
			//   「更新」= 公告的动词（这期更新了什么），「限时限定招募」= 卡池类型。
			// 我最初写成 `更新限时${kind}招募`（`更新限时限定招募`）是把动词也吞进了类型名——
			// 卡池不叫"更新限时限定招募"，就叫"限时限定招募"（用户指出）。
			const bannerTypeName = bannerPool ? `限时${bannerKind}招募` : "";
			const sameKindPools = bannerPool ? recPools.filter((p) => p.kind === bannerKind) : [];
			const roleNames = [...new Set(sameKindPools.flatMap((p) => p.members))];
			const data = {
				banner: bannerTypeName,
				roles: roleNames.join("、"),
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates
			};
			// 卡池列悬停：**不单独构造 `bannerHover`**（用户要求"悬停显示卡池类型"，2026-09-30）。
			//
			// 原因：国服的"类型"已经在 `banner` 里（如 `更新限时限定招募`），而面板的悬停规则是
			//   `title = withFailNote(g.bannerHover || gachaTitle, …)`
			//   `gachaTitle = (g.roles ? `${g.banner}：${g.roles}` : g.banner) + 日期`
			// 所以**不设 bannerHover 时，悬停自然就是**
			//   `更新限时限定招募：莲见(泳装)、圣娅(泳装)`
			//   `09-24 14:00 ~ 10-08 13:59`
			// —— 已含类型，且类型与卡片口径一致。
			//
			// 曾试过"每池一行、以类型开头"，但国服一期常开**同类多池**，那样会输出多行**完全一样**
			// 的文字（只有成员不同）；而按类型归并成一条后，`buildPoolHover` 对 0/1 池返回空串
			// （全站共用的兜底约定）。结论：这里根本不需要 bannerHover，交给 UI 的兜底更准。
			if (!data.banner) return null;
			return data;
		}

		// 重返未来：1999 征集名增强源（小米游戏中心官方资讯流，SSR 页免登录可抓）
		// 官网资讯接口不发布征集名；小米游戏中心游戏页（game.xiaomi.com/game/62346241）的 SSR 数据
		// 含官方账号「神秘学研究员」最新 3 条资讯全文，其中「活动征集」公告带真实征集名与征集时间
		// （如【烈火悬流无尽】8/13 10:00-9/3 4:59、【湖的馈赠】自选六星 8/28 5:00-9/14 4:59）。
		// 主池优先：只认"征集时间覆盖当前时刻"且带定向 UP 的征集公告，且 UP 角色属于官网「新增角色」
		// （官方 SixStar 列表，如 赫多涅/纳西索斯）——自选六星池（无定向 UP）不作为主池；
		// 无主池匹配返回 null（由官网解析兜底显示角色名）。多条主池匹配取最新发布者。
		async function fetchXiaomiR99Gacha(gamePageUrl, officialSixStars) {
			const html = await proxyFetchText(gamePageUrl, "https://game.xiaomi.com/");
			const start = html.indexOf('"official":{"viewpoints":{"infos":[');
			if (start < 0) return null;
			const raw = html.slice(start);
			const marks = [...raw.matchAll(/\{"viewpointId":"/g)].map((x) => x.index);
			if (marks.length === 0) return null;
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();   // 复用同一注入时钟（core 不得直接读宿主时钟）
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let best = null;
			for (let i = 0; i < marks.length; i++) {
				const seg = raw.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : raw.length);
				const title = (seg.match(/"title":"([^"]*)"/) || [])[1] || "";
				const texts = [...seg.matchAll(/"contentType":1,"positionIndex":\d+,"content":"([\s\S]*?)"/g)].map((x) => x[1]);
				const content = texts.join(" ").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u002F/g, "/").replace(/\\n/g, " ");
				if (!/征集/.test(title + content)) continue;
				const nameM = title.match(/【([^】]+)】活动征集/) || content.match(/【([^】]+)】活动征集/);
				if (!nameM) continue;
				// 征集时间："8/28 5:00-9/14 4:59" / "8/13 10:00 - 9/3 4:59"
				const timeM = content.match(/征集(?:开放)?时间[◀◀:：\s]*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*[-—~]\s*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
				if (!timeM) continue;
				const sm = Number(timeM[1]), sd = Number(timeM[2]), sh = timeM[3] ? Number(timeM[3]) : 0, smi = timeM[4] ? Number(timeM[4]) : 0;
				const em = Number(timeM[5]), ed = Number(timeM[6]), eh = timeM[7] ? Number(timeM[7]) : 0, emi = timeM[8] ? Number(timeM[8]) : 0;
				const startTs = new Date(nowYear, sm - 1, sd, sh, smi).getTime();
				// 跨年（如 12/28-1/5）结束补下一年
				const endTs = new Date(endsNextYear(sm, null, em, null) ? nowYear + 1 : nowYear, em - 1, ed, eh, emi).getTime();
				if (startTs > now || endTs < now) continue; // 只取覆盖当期的征集
				// 主池判定：带定向 UP（【X】受邀概率UP）且 UP 角色属于官网新增角色
				const upM = title.match(/【([^】]+)】受邀概率UP/) || content.match(/【([^】]+)】受邀概率UP/);
				const upName = upM ? cleanRoles(upM[1]).replace(/[（）()].*$/, "") : "";
				const isMain = upName !== "" && Array.isArray(officialSixStars) && officialSixStars.includes(upName);
				if (!isMain) continue; // 自选六星池等非主池不作为当期卡池
				const cand = {
					banner: nameM[1],
					bannerDates: `${fmt(sm, sd, sh, smi)} ~ ${fmt(em, ed, eh, emi)}`,
					roles: upName,
					order: i
				};
				// 多条主池覆盖当期时取最新发布（feed 靠前者更新）
				if (!best || cand.order < best.order) best = cand;
			}
			return best ? { banner: best.banner, bannerDates: best.bannerDates, roles: best.roles } : null;
		}

		// ---- 重返未来：1999 官方游戏内公告（noticecp）----
		// 官网 CMS 公告只发布维护时间与活动名，**逐期征集起止**只出现在官方游戏内公告的
		// 「X.X「…」版本活动一览」里：正文是块状富文本（content 为 JSON 字符串），按
		// `「名称」类型` 分段 —— 征集段含【征集时间】+【征集说明】(6★/5★ UP)，活动段含【活动时间】。
		// 接口归属：notice.sl916.com 证书主体=广州深蓝互动网络科技有限公司（与官网 re.bluepoch.com
		// 同主体、同 EdgeOne CDN），免登录/无 CORS，经 host 代理读取；开源项目 MAA1999/M9A 长期使用
		// 同一接口（见 README 致谢）。一版本上下半场两期都列在同一篇里，下期常提前公布。
		// 征集类别 → 外显优先级（用户拍板的口径）：
		//   限定系（巡游限定 › 限定复刻 › 巡游限定复刻 › 联动 › 限定）＞ 活动征集 ＞ 限时征集 ＞ 轮换征集。
		// 同类内先结束者优先（与其它游戏"越快结束越靠前"一致）；**未登记的类别排到最后**（只进悬停、不抢外显），
		// 将来官方造新词时不会顶掉主池。
		const R99_POOL_TIERS = ["巡游限定征集", "限定复刻自选征集", "巡游限定复刻征集", "联动征集", "限定征集", "活动征集", "限时征集", "轮换征集"];

		// 块状富文本 → 纯文本行数组（保持原顺序）；content 不是预期的 JSON 数组时返回 null
		function r99NoticeLines(item) {
			const raw = item && item.contentMap && item.contentMap["zh-CN"] && item.contentMap["zh-CN"].content;
			if (typeof raw !== "string" || raw === "") return null;
			let blocks;
			try { blocks = JSON.parse(raw); } catch { return null; }
			if (!Array.isArray(blocks)) return null;
			return blocks.map((b) => stripTags(String((b && b.content) || ""))).filter((x) => x !== "");
		}

		// "8/13 10:00 - 9/3 4:59" → 时间戳；年份用公告自身的 beginTime 锚定（避免跨年误判）
		function r99ParseWindow(text, year) {
			const m = String(text).match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[-\u2014~]\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
			if (!m) return null;
			const sm = Number(m[1]), sd = Number(m[2]), sh = Number(m[3]), smi = Number(m[4]);
			const em = Number(m[5]), ed = Number(m[6]), eh = Number(m[7]), emi = Number(m[8]);
			const startTs = new Date(year, sm - 1, sd, sh, smi).getTime();
			const endYear = endsNextYear(sm, sd, em, ed) ? year + 1 : year;   // 跨年（如 12/28 - 1/5）
			return { startTs, endTs: new Date(endYear, em - 1, ed, eh, emi).getTime() };
		}

		// 自选池（湖的涟漪／湖的馈赠／限定复刻自选等）**没有 UP 角色名单**，改为标注自选位数：
		// 「自主选择1位六星角色」/「自主选择并锁定3位6星角色」→“自选 N 位 6★”（不带括号）；
		// 只提到"自选"但原文没写位数 → 退化为“自选 6★”；两者都没有 → 返回 ""（不臆造）。
		const R99_CN_NUM = { "\u4e00": 1, "\u4e8c": 2, "\u4e24": 2, "\u4e09": 3, "\u56db": 4, "\u4e94": 5, "\u516d": 6, "\u4e03": 7, "\u516b": 8, "\u4e5d": 9, "\u5341": 10 };

		function r99SelfSelectRoles(body) {
			const text = String(body || "");
			const m = text.match(/\u9009\u62e9(?:\u5e76\u9501\u5b9a)?\s*(\d+|[一二两三四五六七八九十])\s*\u4f4d\s*(?:\u516d\u661f|6\u661f)/);
			if (m) {
				const n = R99_CN_NUM[m[1]] !== undefined ? R99_CN_NUM[m[1]] : Number(m[1]);
				return `\u81ea\u9009 ${n} \u4f4d 6\u2605`;
			}
			if (/\u81ea\u9009/.test(text)) return "\u81ea\u9009 6\u2605";
			return "";
		}

		// 独立池公告：标题形如「池名」类型开启！，正文只有一张图（拿不到 UP 名单），
		// 但接口的 beginTime/endTime 就是该池的真实起止。官方**逐池各发一篇**，且**过期即从公告板下线**：
		// 实测公告板上 22 条无一条过期，已结束的池与其轮换期全都没有公告（"有公告" ⟺ "该池在开"）。
		// 所以轮换征集只能靠它——一览里那三行日期不带时间，过期后连日期行也会随版本一起消失。
		const R99_SOLO_POOL = /^\u300c([^\u300d]{1,40})\u300d([^\u300c\u300d]{1,12})\u5f00\u542f\uff01$/;
		function r99SoloPools(items) {
			const out = [];
			for (const it of items) {
				const title = String((it.contentMap && it.contentMap["zh-CN"] && it.contentMap["zh-CN"].title) || "").trim();
				const m = title.match(R99_SOLO_POOL);
				if (!m) continue;
				const kind = m[2].trim();
				if (R99_POOL_TIERS.indexOf(kind) < 0) continue;   // 衣着上新/上架/上新等不是卡池
				const startTs = Number(it.beginTime);
				const endTs = Number(it.endTime) - 6e4;           // 接口边界是排他的（…05:00），面板统一显示末分钟 04:59
				if (!startTs || !endTs) continue;
				out.push({
					name: `\u300c${m[1]}\u300d${kind}`, kind, roles: "", startTs, endTs, raw: "",
					display: fmtWindow(startTs, endTs)
				});
			}
			return out;
		}

		// 解析一篇「版本活动一览」→ { pools, events, rotRows }
		function parseR99Overview(item, now = nowMs()) {
			const lines = r99NoticeLines(item);
			if (!lines) return null;
			const year = new Date(Number(item.beginTime) || now).getFullYear();
			// 段：`「名称」类型` 开一段，其后各行归该段（直至下一个段标题）
			const sections = [];
			let cur = null;
			for (const line of lines) {
				const head = line.match(/^\u300c([^\u300d]{1,40})\u300d([^\u3010\u203b\uff1a:]{1,16})[\uff1a:]?$/);
				if (head) { cur = { name: head[1], kind: head[2].trim(), lines: [] }; sections.push(cur); continue; }
				if (cur) cur.lines.push(line);
			}
			const pools = [], events = [];
			const seenEvent = new Set();
			for (const sec of sections) {
				const body = sec.lines.join("\n");
				// UP 角色：6★ 单个；5★ 常写成「阿夫西维（木）」、「X（智）」连列 → 取标记后的整串
				const six = [...body.matchAll(/6\u661f\u89d2\u8272\s*\u300c([^\u300d]+)\u300d/g)].map((m) => cleanRoles(m[1]));
				const five = [];
				for (const m of body.matchAll(/5\u661f\u89d2\u8272\s*((?:\u300c[^\u300d]+\u300d[\u3001\s]*)+)/g)) {
					for (const x of String(m[1]).matchAll(/\u300c([^\u300d]+)\u300d/g)) five.push(cleanRoles(x[1]));
				}
				const upRoles = six.concat(five).filter((x) => x !== "").join("\u3001");
				const roles = upRoles || r99SelfSelectRoles(body);   // 自选池没有 UP 名单 → 标注自选位数
				if (/\u5f81\u96c6/.test(sec.kind)) {
					// 征集段：只认【征集时间】（活动段才有【活动时间】）
					const line = sec.lines.find((l) => /^\u3010\u5f81\u96c6\u65f6\u95f4\u3011/.test(l));
					const w = line ? r99ParseWindow(line, year) : null;
					if (!w) continue;   // 该段没有可解析的征集时间 → 跳过（整篇都没有则由上层按结构异常处理）
					pools.push({
						name: `\u300c${sec.name}\u300d${sec.kind}`, kind: sec.kind, roles,
						startTs: w.startTs, endTs: w.endTs,
						raw: (line.match(/\u3010\u5f81\u96c6\u65f6\u95f4\u3011\s*(.+)$/) || [])[1] || "",
						display: fmtWindow(w.startTs, w.endTs)
					});
					continue;
				}
				// 活动段：取该段全部【…时间】/【…模式】窗口的整体跨度
				// （如「活动正篇」＝故事模式起 → 商店兑换止；段落内没有时间的不算活动）
				const wins = [];
				for (const l of sec.lines) {
					if (!/^\u3010[^\u3011]{1,12}\u3011/.test(l)) continue;
					const w = r99ParseWindow(l, year);
					if (w) wins.push(w);
				}
				if (wins.length === 0) continue;
				const startTs = Math.min.apply(null, wins.map((w) => w.startTs));
				const endTs = Math.max.apply(null, wins.map((w) => w.endTs));
				// 同一活动在一篇里可能出现多次（同名同窗口，如两处「衣着风尚」）→ 去重
				const key = `${sec.name}|${startTs}|${endTs}`;
				if (seenEvent.has(key)) continue;
				seenEvent.add(key);
				events.push({ name: sec.name, cat: sec.kind, startTs, endTs, raw: fmtWindow(startTs, endTs) });
			}
			// 轮换征集在一览里**只有日期行**（「N月N日更新：角色」，不带起止时间）→ 这里只当"角色字典"。
			// 时间不再用"+14 天"推算：每期轮换都有自己的独立公告（见 r99SoloPools），接口给的就是真实起止。
			const rotRows = [];
			for (const line of lines) {
				const m = line.match(/^(\d{1,2})\u6708(\d{1,2})\u65e5\u66f4\u65b0[\uff1a:]\s*(.+)$/);
				if (!m) continue;
				// 只用"更新日"当匹配键（与同一期独立公告的 startTs 同一天），不作为时间来源
				rotRows.push({ startTs: new Date(year, Number(m[1]) - 1, Number(m[2]), 5, 0).getTime(), roles: cleanRoles(m[3]) });
			}
			return { pools, events, rotRows };
		}

		// 官方游戏内公告 → 当期征集（含真实起止、悬停列全部并行）+ 当期活动（同其它游戏的活动列规则）。
		// 结构异常（接口改版 / 正文不再可解析）→ 抛错，由上层回退官网公告；
		// 结构正常但没有覆盖当前时刻的征集/活动 → 返回 null（该侧按"未公布"）。
		async function fetchR99Notice(now = nowMs()) {
			const json = await proxyFetchJson(R1999_NOTICE_URL, "https://www.sl916.com/");
			const items = json && Array.isArray(json.data) ? json.data : null;
			if (!items) throw new Error("r1999-notice-no-section");
			const titleOf = (it) => String((it.contentMap && it.contentMap["zh-CN"] && it.contentMap["zh-CN"].title) || "");
			const overviews = items.filter((it) => /\u7248\u672c\u6d3b\u52a8\u4e00\u89c8/.test(titleOf(it)));
			if (overviews.length === 0) throw new Error("r1999-notice-no-section");
			const pools = [], events = [], rotRows = [];
			let parsed = 0;
			for (const it of overviews) {
				const o = parseR99Overview(it, now);
				if (!o) continue;
				parsed++;
				pools.push.apply(pools, o.pools);
				events.push.apply(events, o.events);
				rotRows.push.apply(rotRows, o.rotRows);
			}
			if (parsed === 0) throw new Error("r1999-notice-no-dates");
			// 用独立公告补齐一览没有的池（当前就是轮换征集）。同名池**以一览为准**——它有正文【征集时间】
			// 与 UP 名单；独立公告正文只有图，只能补"池名 + 真实起止"，角色另从日期行字典里按同一天取。
			const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
			const rolesByDay = new Map(rotRows.map((r) => [dayKey(r.startTs), r.roles]));
			for (const p of r99SoloPools(items)) {
				if (pools.some((x) => x.name === p.name)) continue;
				p.roles = rolesByDay.get(dayKey(p.startTs)) || "";
				pools.push(p);
			}
			const data = {};
			// 当期 = 窗口覆盖现在的池；同名多期（一览的下一期 + 公告的当期）只留第一个 = 一览优先
			const seenName = new Set();
			const active = pools.filter((p) => {
				if (!(coversNow(p, now))) return false;
				if (seenName.has(p.name)) return false;
				seenName.add(p.name);
				return true;
			});
			if (active.length > 0) {
				const rank = (p) => {
					const i = R99_POOL_TIERS.indexOf(p.kind);
					return i < 0 ? R99_POOL_TIERS.length : i;
				};
				const win = active.slice().sort((a, b) => (rank(a) - rank(b)) || (a.endTs - b.endTs))[0];
				data.banner = win.name;
				data.roles = win.roles || "";
				data.bannerDates = win.display;
				data.bannerDatesRaw = win.raw || win.display;
				const hover = buildPoolHover(active.map((p) => ({
					name: p.name,
					label: `${p.name}${p.roles ? `\uFF1A${p.roles}` : ""}`,
					startTs: p.startTs, endTs: p.endTs, raw: p.raw
				})));
				if (hover) data.bannerHover = hover;
			}
			const activeEvents = sortEventItems(events.filter((e) => coversNow(e, now)));
			const primary = pickEventPrimary(activeEvents);
			if (primary) {
				data.event = primary.name;
				data.eventDates = fmtWindow(primary.startTs, primary.endTs);
				data.eventDatesRaw = primary.raw || data.eventDates;
				const hover = buildEventHover(activeEvents);
				if (hover) data.eventHover = hover;
			}
			return (data.banner || data.event) ? data : null;
		}

		// 重返未来：1999 入口：默认源＝官方游戏内公告（逐期征集时间）；
		// 来源被切到官网公告（备选源）或自定义地址时直接走官网解析（旧行为）。
		async function fetchR99(url, signal, tz, now = nowMs()) {
			if (!/noticecp/.test(String(url || ""))) return fetchR99Official(url, signal, now);
			try {
				return await fetchR99Notice(now);
			} catch {
				// 游戏内公告接口不可用/结构变了 → 回退官网公告（宁可少时间信息，也不要整格报错）
				return fetchR99Official(R1999_OFFICIAL_URL, signal, tz, now);
			}
		}

		// 重返未来：1999（官网 re.bluepoch.com 新闻 API，POST 经 host 代理）
		// 列表接口（informationType=2 资讯）按上线时间倒序返回含全文的公告，
		// 取最新一期「版本更新维护公告」：当期卡池（首位6星角色名，官网无征集名）/ 当期活动 / 维护起止 + 下一期维护日
		async function fetchR99Official(listUrl, signal, tz, now = nowMs()) {
			const ref = "https://re.bluepoch.com/";
			const list = await proxyFetchJson(listUrl, ref, {}, { current: 1, pageSize: 30, informationType: 2 });
			const items = list?.data?.pageData || [];
			const nowYear = new Date(now).getFullYear();
			const cleanText = (raw) => String(raw)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 单条版本公告的"版本窗口"（仅用于判断哪一期覆盖当前，不再用于展示）：
			// 起点 = 本篇维护结束时刻；结束端 = **比本篇更新的一期维护公告的维护开始时间**；
			// 若还没有更新的一期（下一版本公告未发布）→ 按"维护起 + 42 天"兜底（1999 版本实测 21~42 天）。
			// 注意：不再使用公告里「可在X月X日上午5点之后」——实测那是**心相观测商店兑换**说明，
			// 曾据此把版本判成提前结束，导致版本中后期整格空白。
			const maintWindow = (text, olderThanIdx) => {
				const maintM = text.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
				if (!maintM) return null;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(maintM[1]), mm = Number(maintM[2]), md = Number(maintM[3]);
				const startTs = mk(Number(maintM[6]), Number(maintM[7]), Number(maintM[8]), Number(maintM[9]), Number(maintM[10]));
				let endTs = null;
				// 列表按发布时间倒序：下标更小的一期更新 → 取其维护开始时间作为本篇结束端
				for (let i = olderThanIdx - 1; i >= 0; i--) {
					const t2 = cleanText(versions[i].content);
					const m2 = t2.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
					if (!m2) continue;
					const cand = mk(Number(m2[1]), Number(m2[2]), Number(m2[3]), Number(m2[4]), Number(m2[5]));
					if (cand > startTs) { endTs = cand; break; }
				}
				if (endTs == null) endTs = new Date(sm, mm - 1, md + 42, 4, 59).getTime();
				return { maintM, startTs, endTs };
			};
			// 窗口匹配：选"版本更新维护公告"中版本窗口覆盖 now 的那一期（不再无条件取最新）
			const versions = items.filter((n) => /版本更新维护公告/.test(n.title || "") && n.content);
			let maint = null, win = null, text = "";
			for (let i = 0; i < versions.length; i++) {
				const n = versions[i];
				const t = cleanText(n.content);
				const w = maintWindow(t, i);
				if (w && coversNow(w, now)) { maint = n; win = w; text = t; break; }
			}
			if (!maint) {
				// 官方无当期覆盖 → 小米资讯流当期主池兜底（UP 名单取最新版本公告）
				let sixStars = [];
				if (versions[0]) {
					sixStars = [...cleanText(versions[0].content).matchAll(/6星角色「([^」]+)」/g)]
						.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
						.filter(Boolean);
				}
				try {
					const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
					if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
						return {
							banner: xiaomi.banner,
							roles: xiaomi.roles || "",
							bannerDates: xiaomi.bannerDates,
							bannerDatesRaw: xiaomi.bannerDates,
							event: ""
						};
					}
				} catch { /* 兜底失败 → 返回空，由上层"失败沿用上次成功数据"保留展示原数据 */ }
				return null;
			}
			// —— 官方当期公告解析（text 已清洗）——
			// 当期新增角色（当期多池）：只取「版本全新内容一览 → 新增角色」段内的 6 星角色，
			// 避免把复刻/心相/其它段的角色也算进来；多池外显合并角色（如 赫多涅、纳西索斯）
			const newSeg = text.match(/新增角色([\s\S]{0,220}?)(?=\d+\s*[.、]\s*新增|【|$)/);
			const newSix = (newSeg ? [...newSeg[1].matchAll(/6星角色「([^」]+)」/g)] : [])
				.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
				.filter(Boolean);
			const sixStars = newSix.length > 0
				? newSix
				: [...text.matchAll(/6星角色「([^」]+)」/g)].map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, "")).filter(Boolean);
			const bannerName = sixStars[0] || "";
			// 卡池时间：官网不发布逐池征集时间，靠"下一期维护/版本周期"推算并不可靠 →
			// 外显暂时固定为简短文案（等有可靠时间源再显示真实起止）
			const bannerDates = "暂无时间信息";
			// 当期活动：新增活动列表第 2 项（首位6星角色剧情活动，"「赫多涅·凡人或英雄」"）
			const actM = text.match(/活动正篇[，,]\s*「([^」]+)」/);
			const eventName = actM ? String(actM[1]).replace(/^[^·]+·/, "") : "";
			// 活动时间与卡池同一规则：官网不发布可靠起止，外显固定为同一文案
			const eventDates = bannerDates;
			const data = {
				banner: bannerName,
				roles: sixStars.join("、"),
				bannerDates,
				event: eventName,
				eventDates
			};
			if (!data.banner || !data.bannerDates) return null;
			// 征集名增强：小米官方资讯流有"主池"征集公告（UP 属于官网新增角色）时，
			// 用真实征集名/征集时间/UP 角色覆盖卡池字段；无主池匹配则保持官网"角色名"显示
			try {
				const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
				if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
					data.banner = xiaomi.banner;
					data.bannerDates = xiaomi.bannerDates;
					data.roles = xiaomi.roles || "";
				}
			} catch { /* 增强源失败不影响官网解析结果 */ }
			return data;
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
		const GACHA_FETCHERS = {
			genshin: mkMediaWiki(bwikiGachaPayload),
			hsr: mkMediaWiki(bwikiGachaPayload),
			zzz: (url, signal, tz) => fetchZzzGacha(url, signal, tz),
			"zzz-bwiki": mkMediaWiki(pickCurrent(parseAllBwiki)),
			arknights: (url, signal, tz) => fetchArknightsGacha(url, signal, tz),
			// ⚠️ `selectArknights` / `parseWuwaPool` 的**第二参是 `now`**（不是 tz），
			// 而 mkMediaWiki 只会传 `(text, tz)` —— 直接包进去会让 `now` 收到时区值，
			// `startTs <= now` 恒为 false → 解析结果恒为 null（静默"未公布"，极难查）。
			// 所以这两个注册点必须**显式传 nowMs()**。
			"arknights-prts": (url, signal, tz) => mkMediaWiki((text) => selectArknights(text, nowMs(), tz))(url, signal, tz),
			wuwa: (url, signal, tz) => fetchWuwaGacha(url, signal, tz),
			"wuwa-bwiki": (url, signal, tz) => mkMediaWiki((text) => parseWuwaPool(text, nowMs(), tz))(url, signal, tz),
			// 终末地默认：Canmoe（中文，Next.js 数据经 host 代理两步抓取）
			endfield: (url, signal, tz) => fetchCanmoeEndfield(url, signal, tz),
			// 终末地备选：GachaTracker（英文，浏览器直连）/ wiki.gg（英文，经 host 代理）
			"endfield-gachatracker": mkRaw(parseGachaTracker),
			"endfield-wiki-gg": (url, signal, tz) => fetchEndfieldWikiGg(url, signal, tz),
			// 异环：ldshop（繁体，静态表格经 host 代理）
			nte: (url, signal, tz) => fetchNteWanmei(url, signal, tz),
			"nte-ldshop": (url, signal, tz) => fetchLdshopNte(url, signal, tz),
			"ba-cn": (url, signal, tz) => fetchBaCn(url, signal, tz),
			"ba-global": (url, signal, tz) => fetchBaGlobal(url, signal, tz),
			"ba-global-gamekee": () => fetchGameKeeBa("global"),
			"ba-jp": (url, signal, tz) => fetchBaJpGacha(url, signal, tz),
			"ba-jp-gamekee": () => fetchGameKeeBa("jp"),
			"r1999": (url, signal, tz) => fetchR99(url, signal, tz),
			// 重返未来1999 备选：官网公告（只有维护时间与活动名，无逐期征集时间）
			"r1999-official": (url, signal, tz) => fetchR99Official(url, signal, tz)
		};
		// 活动源注册表：条目 → { 默认 + 备选抓取器 }。没有独立活动源的条目活动来源显示"未配置"。
		const EVENT_FETCHERS = {
			// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
			genshin: {
				default: (url, signal, tz) => fetchYsActivity(signal, tz)
			},
			// 星铁：活动一览（静态「活动时间」表，api.php 可直连）→ 外显当期 + 悬停列出全部并行活动
			hsr: {
				default: mkMediaWiki(genericEventPayload)
			},
			// 绝区零：默认=官方公告（api-takumi-static，与卡池侧同一接口；活动时间写在公告正文里，
			// 含"X.Y版本更新后/版本结束"的换算；结束时间未知的活动保留并沉底）→ 备选=Bwiki 活动一览
			zzz: {
				default: (url, signal, tz) => fetchZzzEventsOfficial(url, signal, tz),
				"zzz-event-bwiki": mkMediaWiki(genericEventPayload)
			},
			// 异环：活动源就是同一篇官网公告（与卡池侧**同一条 URL**，fetchNteWanmei 一个函数同时解析两者）。
			// 注册成独立活动源的意义：卡池侧本轮抓挂、或用户把**卡池**来源改成自定义/备选时，
			// 活动侧仍能自己抓、自己报错，而不是整列空掉（复用只是"同一 URL 省一次请求"的优化，不是它的腿）。
			nte: {
				default: (url, signal, tz) => fetchNteWanmei(url, signal, tz)
			},
			// 明日方舟：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）→ 同上
			arknights: {
				default: mkMediaWiki(prtsEventPayload)
			},
			// 终末地：FZ Wiki（中文，经 host 代理、抓 RSC 数据；外显当期=结束最晚，悬停列出全部并行）
			endfield: {
				default: (url, signal, tz) => fetchFzWikiEndfield(url, signal, tz).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null
				),
				"endfield-game8": (url, signal, tz) => fetchGame8Endfield(url, signal, tz).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				)
			},
			// 鸣潮：**默认=同一份官方公告**（`recommend` 组里 tag=5 为限时活动），与卡池是**同一条 URL**
			// → 一次请求复用两侧数据（refresh 的复用优化）。
			// ⚠️ 2026-10-01 改：Bwiki 活动日历**已停更**（最新一条结束于 2026/9/29），
			// 所以把官方提为默认、Bwiki 降级为备选（`wuwa-event-bwiki`），仍可在设置里手动切回。
			wuwa: {
				default: (url, signal, tz) => fetchWuwaEventsOfficial(url, signal, tz),
				// ⚠️ 回调**必须**声明第二个参数 `tz`：mkMediaWiki 的契约是 `parse(text, tz)`
				//   （见 30-parsers.js 的 mkMediaWiki）。原来只写了 `(html)` 却在体内用 `tz`
				//   → 运行时 `tz is not defined`：用户在设置页把鸣潮活动源切到「Bwiki 活动日历」就必然抓取失败。
				//   2026-10-03 修正（同批还加了静态守卫 `test/cases-fetcher-args.mjs`）。
				"wuwa-event-bwiki": mkMediaWiki((html, tz) => {
					const d = parseWuwaCalendar(html, tz);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null;
				})
			},
			// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
			"ba-cn": {
				default: (url, signal, tz) => fetchBaCn(url, signal, tz)
			},
			// 蔚蓝国际服：默认与卡池同 URL（更新日誌含活动排期）；备选 GameKee
			"ba-global": {
				default: (url, signal, tz) => fetchBaGlobal(url, signal, tz),
				"ba-global-gamekee": () => fetchGameKeeBa("global")
			},
			// 蔚蓝日服：活动源与卡池源独立——默认 GameKee 当期活动条目（原行为不变）；
			// 备选 = 日服官方公告里的イベント条目（抓取器复用官方解析，仅取 event/eventDates）
			"ba-jp": {
				default: () => fetchGameKeeBa("jp"),
				"ba-jp-official": (url, signal, tz) => fetchBaJpOfficialEvent(url, signal, tz)
			},
			// 重返未来：默认与卡池同 URL（同一篇「版本活动一览」同时含征集与活动）；
			// 备选＝官网公告（只有维护时间与活动名）
			"r1999": {
				default: (url, signal, tz) => fetchR99(url, signal, tz),
				"r1999-official": (url, signal, tz) => fetchR99Official(url, signal, tz)
			}
		};

		// —— 备选源（altSources / eventAltSources）的字段约定与 altSourceId / normalizeSourceId，
		//    以及下面的 gachaFetcherFor / eventFetcherFor 用到的标识归一，都在 60-helpers.js ——
		//    （设置页也要用这两个纯函数，所以放在 core 与外壳共用的 helpers 里，而不是 core 内部）
		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器（无 → null）
		function gachaFetcherFor(source, url) {
			const want = normalizeSourceId(url);
			const alt = (source.altSources || []).find((a) => altSourceId(a) === want && GACHA_FETCHERS[a.fetcher]);
			return alt ? GACHA_FETCHERS[alt.fetcher] : GACHA_FETCHERS[source.id] || null;
		}

		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const want = normalizeSourceId(url);
			const alt = (source.eventAltSources || []).find((a) => altSourceId(a) === want && table[a.fetcher]);
			return alt ? table[alt.fetcher] : table.default || null;
		}
		//#endregion

// src/client/35-parsers-p5x.js
//
// 由 next-sources/parsers/p5x.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_p5x__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-p5x.js —— P5X 国服（完美世界官方站）
//
// ⚠️ 调研结论（2026-10-02 / 2026-10-03 实测）
//   官方站的**卡池/活动专栏已停更两年**：
//     · /news/gamebroad/（游戏公告）最后一条 2024-10-10
//     · /news/gameevent/（游戏活动）最后一条 2024-09-27
//     · /news/gamenews/（游戏新闻 = 版本更新公告）**仍在更新**（实测最新 2026-09-24「5.4.1版本今日上线」）
//   所以只能从**版本更新公告正文**里抽卡池/活动。这没问题 —— 官方正文是**分区块**的，
//   每个区块自带标题与 `活动时间：`，形如：
//
//     <p>契约更新</p>
//     <p>缘结之契开启</p>
//     <p>活动时间：2026年9月24日—2026年10月22日</p>
//     <p>指定自选契约「缘结之契」再次开启！</p>
//
// ── 2026-10-03 修的真实 bug ──
//   旧实现把**公告标题**（`逐月者之梦《女神异闻录：夜幕魅影》5.4.1版本今日上线`）
//   当成"卡池名"，并在**全文**里抓第一个覆盖当前的 `A日—B日`。后果：
//   · 面板卡池列显示的是**版本更新公告标题**，像"5.4.1版本今日上线"这种，用户看不出卡池是什么；
//   · 抓到的档期是**版本周期**（如 09-24 ~ 10-22），而不是卡池周期。
//   实测反例（证明两者确实不同）：5.3.1 版本周期 8/13–9/3，而官方在同篇正文里给
//   「统统创飞」「怪盗幻像的试炼」写的是 **8/24–9/3**。
//   修法：**先切区块**，卡池只认「契约更新」块、活动只认「活动更新」块，各自用**自己那行的**档期。
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw? } | { event, eventDates, ... }
//
// 时区：国服，源站**未见显式标注**（原文只有「2026年9月24日—10月22日」），按 UTC+8 推定。
// 数据形态：日期是**纯日期无时分** → 起止按惯例补 04:00 / 03:59（推算，非源站给定值）。


const ns_p5x_BASE = "https://p5x.wanmei.com";

// 列表页 → 条目数组 [{ href, title, dateText }]
function ns_p5x_parseP5xList(html) {
	const items = [];
	// 站点形态：<a href="/news/gamenews/20260924/264338.html"> … <p class="item_title">标题</p> … <p class="date_time">2026.09.24</p>
	const re = /<a[^>]+href="(\/news\/[a-z]+\/(\d{8})\/(\d+)\.s?html)"[^>]*>([\s\S]{0,1200}?)<\/a>/g;
	for (const m of String(html).matchAll(re)) {
		const block = m[4];
		const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/);
		const dm = block.match(/class="date_time"[^>]*>([\s\S]*?)<\/\w+>/);
		const title = tm ? stripTags(tm[1]) : "";
		if (!title) continue;
		items.push({ href: m[1], dateKey: m[2], id: m[3], title, dateText: dm ? stripTags(dm[1]) : "" });
	}
	// 兜底：站点偶有 class 顺序不同 → 退化为"按 href 切块"再就近找标题/日期
	if (items.length === 0) {
		const links = [...String(html).matchAll(/href="(\/news\/([a-z]+)\/(\d{8})\/(\d+)\.s?html)"/g)];
		for (const m of links) {
			const start = m.index;
			const block = String(html).slice(start, start + 1400);
			const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/) || block.match(/<p[^>]*>([^<]{4,80})<\/p>/);
			const title = tm ? stripTags(tm[1]) : "";
			if (title) items.push({ href: m[1], dateKey: m[3], id: m[4], title, dateText: "" });
		}
	}
	// 去重（同一 href 可能在"最新/推荐"两处出现）
	const seen = new Set();
	return items.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

// 详情页正文 → 纯文本（**按块级标签切行**，区块解析依赖这个行结构）
// 导出供测试：夹具测试需要"HTML→行文本"这一步，跟抓取器用同一实现，避免测试自造。
function ns_p5x_p5xBodyText(html) {
	return decodeEntities(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	).replace(/[ \t\u00a0]+/g, " ");
}

// 从**单行文本**抽「YYYY年M月D日 — YYYY年M月D日」档期
// 形态（实测）：`2026年9月24日—10月22日更新前`、`2026年10月5日—2026年10月22日更新前`
function ns_p5x_parseP5xWindows(text, tz) {
	const out = [];
	const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*[—\-~～至]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g;
	for (const m of String(text).matchAll(re)) {
		const y1 = +m[1], mo1 = +m[2], d1 = +m[3];
		const y2 = m[4] ? +m[4] : (endsNextYear(mo1, null, +m[5], null) ? y1 + 1 : y1);   // 跨年：结束月小于开始月
		const mo2 = +m[5], d2 = +m[6];
		// 时刻：公告只给日期 → 按国服惯例补 04:00 开 / 03:59 收（推算，见文件头）
		const startTs = sourceInstant(y1, mo1, d1, 4, 0, tz);
		const endTs = sourceInstant(y2, mo2, d2, 3, 59, tz);
		if (endTs <= startTs) continue;
		out.push({ startTs, endTs, raw: `${y1}年${mo1}月${d1}日 ~ ${y2}年${mo2}月${d2}日` });
	}
	return out;
}

// ── 区块解析 ──
// 类别行形态（实测）：`活动更新`、`契约更新`、`玩法更新`、`功能拓展`、`启示卡更新`、
//   `版本更新`、以及**类别与标题同行**的 `活动更新-2.5周年时光庆典`、`活动BOSS更新-追欲的魔术师`。
// 注意：不能只按"含更新"就认 —— 正文里还有 `版本更新后，将新增2种启示卡…` 这类叙述句。
// 这里要求整行**以「类别+更新/拓展」结尾**，或后面只跟一个短分隔符+标题（≤40 字），
// 从而把叙述句排除掉。
const ns_p5x_P5X_CAT_RE = /^([\u4e00-\u9fffA-Za-z]{2,10}(?:更新|拓展))(?:\s*[-－—－:：]\s*(.{1,40}))?$/;
// `活动时间：…` 及其近义写法
const ns_p5x_P5X_TIME_RE = /^(?:活动|开放|售卖|举办|开启|持续)时间\s*[:：]\s*(.+)$/;

/**
 * 把公告正文切成区块。返回 [{ category, name, title, windowRaw, lines }]
 *   · category —— 类别行（如 `契约更新` / `活动更新`）
 *   · name     —— 与类别同行的标题（`活动更新-2.5周年时光庆典` 时为 `2.5周年时光庆典`）
 *   · title    —— 该区块的展示名：优先同行标题，否则取类别行后的第一条非时间行
 *   · windowRaw—— 该区块里**第一行** `活动时间：…` 的原文
 */
function ns_p5x_parseP5xBlocks(text) {
	const lines = String(text).split("\n").map((s) => s.trim()).filter(Boolean);
	const blocks = [];
	let cur = null;
	for (const line of lines) {
		const cm = line.match(ns_p5x_P5X_CAT_RE);
		if (cm) {
			if (cur) blocks.push(cur);
			cur = { category: cm[1], name: (cm[2] || "").trim(), title: (cm[2] || "").trim(), windowRaw: "", lines: [] };
			continue;
		}
		if (!cur) continue;                    // 类别行之前的内容（导语）忽略
		const tm = line.match(ns_p5x_P5X_TIME_RE);
		if (tm) {
			if (!cur.windowRaw) cur.windowRaw = tm[1].trim();
			continue;
		}
		if (!cur.title) cur.title = line;       // 类别行后紧跟的第一条非时间行 = 标题
		cur.lines.push(line);
	}
	if (cur) blocks.push(cur);
	return blocks;
}

// 供测试：直接对一段正文本跑区块解析
// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
// 取列表里最新的 N 条公告并解析出区块。
// ⚠️ **逐条容错**：只有"最新一条都抓不到"才算真失败（抛出）；
//    次新那条只是"多看一条"的兜底（上一轮公告通常已过期），它抓不到（404/超时）不该拖垮整个条目
//    —— 实测踩过：夹具只映射了最新一条，多抓的第 2 条 404 直接把整条报成"抓取失败"。
async function ns_p5x_fetchP5xAnnouncements(url, signal, count = 2) {
	const listUrl = url || `${ns_p5x_BASE}/news/gamenews/index.html`;
	const list = ns_p5x_parseP5xList(await fetchText(listUrl, { referer: ns_p5x_BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)).slice(0, Math.max(1, count));
	const out = [];
	for (let i = 0; i < sorted.length; i++) {
		const item = sorted[i];
		const detailUrl = item.href.startsWith("http") ? item.href : ns_p5x_BASE + item.href;
		try {
			const text = ns_p5x_p5xBodyText(await fetchText(detailUrl, { referer: ns_p5x_BASE, signal }));
			out.push({ item, text, blocks: ns_p5x_parseP5xBlocks(text) });
		} catch (err) {
			if (err && err.name === "AbortError") throw err;   // 中止信号必须透传
			if (i === 0) throw err;                            // 最新一条失败 = 真失败
			// 次新一条失败 → 忽略（已有一条可用）
		}
	}
	return out;
}

// 在候选区块里挑"覆盖当前时刻"的那个；都没有就返回 null（= 未公布）
function ns_p5x_pickCurrentBlock(cands, tz, now) {
	const withWin = [];
	for (const b of cands) {
		const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
		if (wins.length === 0) continue;
		withWin.push({ block: b, win: wins[0] });
	}
	return withWin.find((x) => coversNow(x.win, now)) || null;
}

// 正文导语里的「…「X」获取概率限时UP！」—— 本期限定 UP 池名（官方只给名字，常不给档期）
function ns_p5x_p5xUpNames(text) {
	const out = [];
	for (const m of String(text).matchAll(/[「【]([^」】]{2,30})[」】]\s*获取概率限时UP/g)) {
		const n = m[1].trim();
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}

// ── 卡池侧 ──
// 只认「契约更新」块（官方唯一明确写卡池档期的地方）。
// 抽不到覆盖当前的契约档期 → null（未公布）。**绝不**退化成"拿版本公告标题当卡池名"。
async function ns_p5x_gachaP5x(url, signal, tz = "Asia/Shanghai") {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	const now = Date.now();
	for (const { text, blocks } of anns) {
		const poolBlocks = blocks.filter((b) => /契约/.test(b.category) || /契约/.test(b.title));
		const hit = ns_p5x_pickCurrentBlock(poolBlocks, tz, now);
		if (!hit) continue;
		const up = ns_p5x_p5xUpNames(text);
		// ⚠️ 2026-10-03 改（方案 A 收敛）：这里原本**手搓**三行悬停 `池名` ⏎ `档期` ⏎ `本期限定UP：角色`
		//    —— 档期夹在名称与角色中间，与本体「池名：角色 ⏎ 档期」的顺序不一致。
		//    现在按通用规则表达：把 UP 角色放进 **`roles`** 字段。
		//    效果（与本体同构）：外显 = 角色名（本体对"有角色名的卡池"就是这么外显的），
		//    UI 默认两行式 = `缘结之契开启：汐见琴音` ⏎ `09-24 04:00 ~ 10-22 03:59`。
		//    只有 1 个当期池 → 不设 bannerHover（hoverPool 的契约就是 <2 条交回 UI）。
		return {
			banner: hit.block.title,
			roles: up.join("、"),
			bannerDates: fmtWindow(hit.win.startTs, hit.win.endTs, tz),
			bannerDatesRaw: hit.block.windowRaw,
			startTs: hit.win.startTs,
			endTs: hit.win.endTs
		};
	}
	return null;
}

// ── 活动侧 ──
// 只认「活动」类区块（`活动更新` / `活动BOSS更新`）。外显取**最早结束**的当期活动（最紧迫），
// 悬停按结束时间升序逐行列出全部当期活动。
async function ns_p5x_eventsP5x(url, signal, tz = "Asia/Shanghai") {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	const now = Date.now();
	for (const { blocks } of anns) {
		const evBlocks = blocks.filter((b) => /活动/.test(b.category));
		const active = [];
		for (const b of evBlocks) {
			const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
			if (wins.length === 0) continue;
			const w = wins[0];
			if (coversNow(w, now) && b.title) active.push({ block: b, win: w });
		}
		if (active.length === 0) continue;
		// 稳定排序：先按结束时间升序（越紧迫越前），同结束时间保持原文顺序
		active.sort((a, b) => a.win.endTs - b.win.endTs);
		const primary = active[0];
		// ⚠️ 2026-10-03 改：原本手搓 `名称  + 档期`（**2 个空格**），本体一律 **3 个空格** → 改用共用 hoverEvent。
		const hover = hoverEvent(active.map((x) => ({ name: x.block.title, startTs: x.win.startTs, endTs: x.win.endTs })), tz);
		return {
			event: primary.block.title,
			eventDates: fmtWindow(primary.win.startTs, primary.win.endTs, tz),
			eventDatesRaw: primary.block.windowRaw,
			...(hover ? { eventHover: hover } : {})
		};
	}
	return null;
}

// 供测试：从本地 HTML 直接跑解析（不联网）

// src/client/42-parsers-bandori.js —— BanG Dream 全系（国服手游 / OurNotes 日服 / OurNotes 国际服 / Bestdori 备选源）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-bandori.js              BanG Dream！少女乐团派对·国服（biligame 官方公告）
//      · 42-parsers-ournotes.js             BanG Dream！OurNotes·日服（WP REST）
//      · 42-parsers-ournotes-global.js      BanG Dream！OurNotes·国际服（BHK 官方公告）
//      · 42-parsers-bestdori.js             BanG Dream（Bestdori 社区库，备选源）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bandori.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bandori.js
//
// 由 next-sources/parsers/bandori.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bandori__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bandori.js —— BanG Dream! 少女乐团派对 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/bandori-list、bandori-detail-18418）──
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20
//   → { code:0, totalNum:2815, data:[{ id, title, ctime, mtime, content, displayTime?, typeId, … }] }
//   ⚠️ 两个实测坑（任务书已提示，夹具再次证实）：
//     ① 列表里的 `content` 是**截断的**（末尾 `…`）→ 正文必须抓详情 /news/{id}
//     ② **返回顺序非严格倒序**：page 1 的头两条是 2019 年的常驻置顶公告
//        （概率公示 / 公平运营声明），后面才是 2026 年的倒序块
//        → 必须按 `displayTime || ctime` 自行排序，不能信数组顺序
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, code:0, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, … } }
//
// ── 公告正文的实际结构（两侧都从这里抽）──────────────────────────────────
// 一期公告用 `活动一、`…`活动八、` 分节，每节形如：
//     活动二、「黄金周纪念·前篇Dream＆KIRAMEKI Festival招募」开启！
//     ★招募日程★
//     9月29日维护后~10月11日12:59
//     …
//     ※可招募时间：9月29日维护后~10月16日12:59      ← 节内补充窗口（挂到 hover）
// 所以：
//   · 卡池侧 = 名字含「招募」且**非**免费/确定/StepUp 类的那一节（活动二）→ 主窗口 + ★5 名单当 roles
//   · 活动侧 = 名字不含「招募」的那一节（活动一「…」挑战演出活动）→ 主窗口
//   · 每一节的**主窗口**只取 `★…日程★`/`★…时间★` 之后的第一条窗口行（节内补充窗口不算主窗口）
//     —— 否则同节多条窗口会让「选当期」随系统时间漂移，测试也不可复现。
//   · `维护后`（起点无具体时刻）用该公告 `displayTime` 的时刻补齐（实测 18418：
//     displayTime=2026-09-29 10:00:00，正文「9月29日维护后」= 10:00，与 Bestdori CN startAt 吻合）。
//
// ── 时区 UTC+8（Asia/Shanghai）**已交叉验证** ─────────────────────────────
//   任务书给的交叉证据：官方 displayTime=2026-09-29 10:00 ↔ Bestdori CN startAt=2026-09-29 02:00Z
//   （= 10:00+08）。本条是硬证据，非推测。


const ns_bandori_BANDORI_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20";
const ns_bandori_BANDORI_TZ = "Asia/Shanghai";
const ns_bandori_BANDORI_HOME = "https://www.biligame.com/detail/?id=138";

// 标题（WP/REST 的 title 可能是对象；这里统一取字符串）
function ns_bandori_bandoriTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return decodeExtra(t.rendered || "");
	return decodeExtra(t || "");
}

// ── 列表解析 ──
function ns_bandori_parseBandoriList(json) {
	if (!json || typeof json !== "object") throw new Error("bandori-bad-json");
	if (json.code !== 0) throw new Error("bandori-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("bandori-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => ({
			id: x.id,
			title: ns_bandori_bandoriTitle(x),
			displayTime: x.displayTime || "",
			ctime: x.ctime || "",
			mtime: x.mtime || "",
			// 排序用的"生效时刻"：优先 displayTime（= 维护后开服时刻），退 ctime
			sortKey: String(x.displayTime || x.ctime || ""),
			dateTs: ns_bandori_parseBandoriDate(x.displayTime || x.ctime)
		}))
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}

// "2026-09-29 10:00:00" → 绝对毫秒（按 tz 解释源站墙钟）
function ns_bandori_parseBandoriDate(s, tz = ns_bandori_BANDORI_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_bandori_bandoriDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_bandori_BANDORI_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

// ── 窗口行 ──
// 整行匹配（前后不允许有别的文字）——实测这样刚好滤掉正文里大量
// 「9月29日维护后，《MATSURI BAYASHI》将上架…」这类**带尾巴**的日期句，
// 以及「本期也将开启限时招募券任务（9月29日 维护后～10月14日 22:59）！」这类括注。
const ns_bandori_WIN_LINE = /^[※☆★\s]*((?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*(?:更新维护后|维护后|\d{1,2}:\d{2})?)\s*[~～]\s*((?:(?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*)?(?:更新维护后|维护后|\d{1,2}:\d{2}))\s*[！!。]?\s*$/;
const ns_bandori_HALF = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(更新维护后|维护后)?(?:\s*(\d{1,2}):(\d{2}))?$/;

// 单侧（起点或终点）→ { mo, d, phrase, h, mi }；解析不出 → null
function ns_bandori_parseHalf(s) {
	const m = ns_bandori_HALF.exec(String(s || "").trim());
	if (!m) return null;
	return {
		y: m[1] ? +m[1] : null,
		mo: +m[2], d: +m[3],
		phrase: m[4] || null,
		h: m[5] != null ? +m[5] : null,
		mi: m[6] != null ? +m[6] : null
	};
}

// 一条窗口行 → { startTs, endTs, raw }；短语起点用 hint（公告 displayTime）补时刻
function ns_bandori_parseBandoriWindow(line, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const m = ns_bandori_WIN_LINE.exec(String(line || "").trim());
	if (!m) return null;
	const a = ns_bandori_parseHalf(m[1]), b = ns_bandori_parseHalf(m[2]);
	if (!a || !b) return null;
	// 年份：源站只写「9月29日」→ 取公告年份（hint）；跨年时末段 +1
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	const y1 = a.y != null ? a.y : (hintParts ? hintParts.y : null);
	if (y1 == null) return null;
	let y2 = b.y != null ? b.y : y1;
	if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;

	let h1 = a.h, mi1 = a.mi;
	if (h1 == null) {
		if (!a.phrase || !hintParts) return null;           // 起点不明又不给 hint → 不猜
		h1 = hintParts.h; mi1 = hintParts.mi;
	}
	if (mi1 == null) mi1 = 0;
	let h2 = b.h, mi2 = b.mi;
	if (h2 == null) {
		if (!b.phrase || !hintParts) return null;
		h2 = hintParts.h; mi2 = hintParts.mi;
	}
	if (mi2 == null) mi2 = 0;

	const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
	const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: String(line).trim() };
}

// ── 正文分节 ──
// 返回 [{ name, quote, windows:[{…}], primary }]
//   · name  = 「活动二、…」里的整段
//   · quote = name 里第一个「…」内的名字（外显用，比整段干净）
//   · primary = 节内第一条「★…日程★/★…时间★」表头之后的窗口；没有表头则取该节第一条窗口
function ns_bandori_parseBandoriSections(text, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim()).filter(Boolean);
	const sections = [];
	let cur = null;
	let expectWindow = false;      // 上一条是 ★…日程★ 类表头 → 下一条窗口即主窗口
	for (const line of lines) {
		const sec = /^活动\s*[一二三四五六七八九十百\d]+\s*、\s*([\s\S]+)$/.exec(line);
		if (sec) {
			cur = { name: sec[1].trim(), quote: "", windows: [], primary: null };
			const q = /[「【]([^」】]+)[」】]/.exec(cur.name);
			cur.quote = q ? q[1].trim() : "";
			sections.push(cur);
			expectWindow = false;
			continue;
		}
		if (/^[★☆※\s]*(活动日程|招募日程|活动时间|招募时间|举办日程|开展时间|日程)[★☆※\s]*$/.test(line)) {
			expectWindow = true;
			continue;
		}
		const w = ns_bandori_parseBandoriWindow(line, tz, hint);
		if (w) {
			if (cur) {
				cur.windows.push(w);
				if (cur.primary == null && expectWindow) cur.primary = w;
			}
			expectWindow = false;
			continue;
		}
		if (line.length > 14) expectWindow = false;   // 长正文行打断"表头→窗口"的邻接关系
	}
	for (const s of sections) if (s.primary == null && s.windows.length) s.primary = s.windows[0];
	return sections;
}

// 卡池节 = 名字含「招募」；主卡池节 = 再排除免费/确定/StepUp 这类派生池
const ns_bandori_GACHA_SEC_RE = /招募/;
const ns_bandori_GACHA_SIDE_RE = /免费|無料|确定|確定|初次|Step\s*up|StepUp|1日1次|每日|一日一次/i;

function ns_bandori_pickBandoriGachaSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && ns_bandori_GACHA_SEC_RE.test(s.name));
	if (!pool.length) return null;
	const main = pool.filter((s) => !ns_bandori_GACHA_SIDE_RE.test(s.name));
	return (main.length ? main : pool)[0];
}
function ns_bandori_pickBandoriEventSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name) && /活动/.test(s.name));
	if (pool.length) return pool[0];
	return (sections || []).find((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name)) || null;
}
// 悬停标签用的实体清理：卡池/活动名进悬停前必须把 `&middot;` 之类还原，
// 否则同一期内容会出现两种形态 —— 外显 banner 走 `ns_bandori_bandoriTitle`（已还原成 `·`），
// 而悬停用节里的 quote（未还原，会显示成 `黄金周纪念&middot;前篇…`）。
// 外显与悬停**必须逐字一致**。
// ⚠️ 只用于悬停标签；roles 字段的对外契约不变（既有的 `&sup2;` 形态由既有测试钉住）。
function ns_bandori_hoverLabel(s) {
	return decodeExtra(String(s == null ? "" : s)).replace(/\s+/g, " ").trim();
}
// 每节的主窗口 → 悬停条目 `{ name, startTs, endTs, raw }`（hoverPool / hoverEvent 的入参形状）。
// 名称取节内第一个「…」里的名字（quote），比整段干净；raw 保留源站原文（缺起止时才用）。
function ns_bandori_bandoriSectionItem(section, name) {
	return {
		name: ns_bandori_hoverLabel(name || section.quote || section.name),
		startTs: section.primary.startTs,
		endTs: section.primary.endTs,
		raw: section.primary.raw
	};
}
// 当期（覆盖 now）的主卡池节：含「招募」且排除免费/确定/StepUp 这类派生池。
// ⚠️ 还要**有 ★5 名单**才算"池"：公告里「★5 期间限定 奇迹招募券礼包」这种**礼包上架**节
//    名字也带「招募」，但没有任何角色（实测真实夹具 18418 第 2 个这样的节）。
//    卡池悬停是「池名：角色」两行式，没有角色的节塞进去只会让悬停出现光秃秃的商品名。
function ns_bandori_bandoriActiveGachaSections(sections, text, now) {
	return (sections || []).filter((s) =>
		s.primary && !ns_bandori_GACHA_SIDE_RE.test(s.name) && ns_bandori_GACHA_SEC_RE.test(s.name)
		&& coversNow(s.primary, now)
		&& !!ns_bandori_bandoriRolesFromSection(text, s));
}
// 当期（覆盖 now）的全部活动节（含卡池节 —— 这一期一起开的档期都能在悬停里看到）
function ns_bandori_bandoriActiveSections(sections, now) {
	return (sections || []).filter((s) => s.primary && coversNow(s.primary, now));
}

// 节内 ★5 名单 → roles（实测形态：`★5 丸山彩[镜中无法映照的手中]`、`★5 CHU² [这样的休假方式]`）
function ns_bandori_bandoriRolesFromSection(text, section) {
	if (!section) return "";
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim());
	const startIdx = lines.findIndex((l) => l.startsWith(`活动`) && l.includes(section.name));
	if (startIdx < 0) return "";
	const names = [];
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (/^活动\s*[一二三四五六七八九十百\d]+\s*、/.test(lines[i])) break;
		const m = /^★\s*5\s*(.+?)\s*[\[［]/.exec(lines[i]);
		if (m) {
			const n = m[1].replace(/[&][a-z0-9]+;/gi, "").trim();
			if (n && !names.includes(n)) names.push(n);
		}
	}
	return names.join("、");
}

// ── 取一期公告：列表倒序 → 逐条抓详情 → 用 selector 挑第一个"可用"的 ──
// 单条详情失败（网络/404）不整体崩，继续下一条；**全部失败则抛第一个错误**
// （不能把"源站挂了"静默降级成"未公布"）。
async function ns_bandori_loadAnnouncement(listUrl, signal, selector, limit = 5) {
	const list = ns_bandori_parseBandoriList(await fetchJson(listUrl, { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null;
	for (const it of list.slice(0, limit)) {
		try {
			const detail = await fetchJson(ns_bandori_bandoriDetailUrl(listUrl, it.id), { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			const text = htmlText(d.content);
			const hint = ns_bandori_parseBandoriDate(d.displayTime || d.mtime || it.displayTime || it.ctime) || it.dateTs;
			const sections = ns_bandori_parseBandoriSections(text, ns_bandori_BANDORI_TZ, hint);
			const picked = selector(sections);
			if (!picked) continue;
			return { item: it, data: d, text, hint, sections, picked };
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// ── 卡池侧 ──
async function ns_bandori_gachaBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriGachaSection);
	if (!a) return null;
	const w = a.picked.primary;
	const banner = a.picked.quote || a.picked.name;
	// 悬停（本体 buildPoolHover 格式）：当期主池每池两行「池名：角色」⏎「档期」，结束时间升序。
	// 派生池（免费/确定/StepUp）不进悬停；只有 1 个当期主池时 hoverPool 返回 "" → 不设 bannerHover。
	const pools = ns_bandori_bandoriActiveGachaSections(a.sections, a.text, Date.now()).map((s) => {
		const roles = ns_bandori_bandoriRolesFromSection(a.text, s).replace(/、/g, "/");
		const name = ns_bandori_hoverLabel(s.quote || s.name);
		return { ...ns_bandori_bandoriSectionItem(s, name), label: roles ? `${name}：${roles}` : name };
	});
	const bannerHover = hoverPool(pools, tz);
	return {
		banner,
		roles: ns_bandori_bandoriRolesFromSection(a.text, a.picked),
		bannerDates: fmtWindow(w.startTs, w.endTs, tz),
		bannerDatesRaw: w.raw,
		startTs: w.startTs,
		endTs: w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

// ── 活动侧 ──
// 同源同一份公告：外显取"挑战演出活动"那一节，hover 列出该公告全部节的窗口
// （含卡池节，并附节名），这样悬停能看到这一期一起开的全部档期。
async function ns_bandori_eventsBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriEventSection);
	if (!a) return null;
	const w = a.picked.primary;
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现是「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 只有 1 条当期 → hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式。
	const active = ns_bandori_bandoriActiveSections(a.sections, Date.now());
	const eventHover = hoverEvent(active.map((s) => ns_bandori_bandoriSectionItem(s)), tz);
	return {
		event: a.picked.quote || ns_bandori_bandoriTitle(a.item) || a.picked.name,
		eventDates: fmtWindow(w.startTs, w.endTs, tz),
		eventDatesRaw: w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-ournotes.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-ournotes.js
//
// 由 next-sources/parsers/ournotes.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_ournotes__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-ournotes.js —— BanG Dream! OurNotes 日服（bushimo 官方 WordPress REST）
//
// 契约：async (url, signal, tz) → { event, eventDates, eventDatesRaw?, eventHover? } | null
//   本来源**只有活动/公告侧单侧**（没有卡池专用源）——按任务书只写 event 侧。
//
// ── 可直连（mode="direct"）──────────────────────────────────────────────────
//   调研实测 `https://bang-dream-on.bushimo.jp` 的 ACAO **回显 Origin**
//   → 是环境里仅有的三个可直接 fetch 的源之一（另两个是 api.umapyoi.net / sekai-world.github.io）。
//   注意：registry 里声明的 mode 与这里 fetchJson 传的 mode **必须一致**。
//
// ── 实测形态（2026-10-01/02 抓夹具 fixtures/ournotes-list）──────────────────
// 列表：GET /wp-json/wp/v2/posts?per_page=20&page=1
//   → 标准 WP REST 数组，每项 { id, date, date_gmt, link, title{rendered}, excerpt{rendered}, content{rendered}, … }
//   ⚠️ **不能加 `_fields=id,date,date_gmt,link,title` 裁剪**（任务书给的省流写法）：
//      活动区间藏在 `excerpt`/`content` 里，只取 title/date 就只剩"公告发布时刻"，
//      拿不到任何「举办期间」。夹具实测：288 的活动区间 `2026年9月24日(木)～10月28日(水)14:59`
//      只出现在 content 里，excerpt 里没有。
//   ⚠️ 这是**新游戏**：全站只有 11 篇公告（2026-01 建站 → 2026-09），
//      其中只有 6 篇带日期区间，属正常状态，不是抓取失败。
//
// ── 时区 Asia/Tokyo（**实测**，非推测）──────────────────────────────────────
//   逐条比对 `date` 与 `date_gmt`：全部相差 **9 小时**
//   （例：id=389 `date=2026-09-21T16:30:30` / `date_gmt=2026-09-21T07:30:30`）→ JST=UTC+9。
//
// ── 取值策略 ────────────────────────────────────────────────────────────────
//   公告不是排期表：一篇公告里可能完全没有日期（如 id=389「動作環境について」），
//   也可能有多个不相干的区间（直播时刻、展会日程、活动期间）。
//   所以：① 按 date_gmt 倒序遍历公告；② 从 title+excerpt+content 抽「日期[时刻]～日期[时刻]」区间；
//        ③ 外显取**第一条覆盖当前时刻**的区间（没有则取最新一篇的第一条区间）；
//        ④ hover 逐行列出所有覆盖当前的区间（附所属公告标题）。
//   只给"一个日期"的句子（「9月24日(木)に決定しました！」）**不算区间** → 不产出，不硬凑。


const ns_ournotes_OURNOTES_LIST_URL = "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1";
const ns_ournotes_OURNOTES_TZ = "Asia/Tokyo";

function ns_ournotes_ournotesTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return decodeExtra(t.rendered || "").replace(/\s+/g, " ").trim();
	return decodeExtra(t || "").replace(/\s+/g, " ").trim();
}

// ── 日文日期区间令牌 ──
// 令牌化而不是一条大正则：日文公告里「年」可省、「月」在末段可省（`10月17日(土)・18日(日)`）、
// 时刻可省、分隔符有 `～`/`〜`/`~`/`・` 多种 —— 用一条正则的可选组会互相吃掉，走令牌清楚得多。
//   DATE：年?(可选) 月?(可选) 日 + 可选 (曜日)
//   TIME：HH:MM（全角冒号也算）
//   SEP ：~ ～ 〜 〰 － - – — ・
const ns_ournotes_JP_TOKEN = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,6}[）)])?|(\d{1,2})\s*[:：]\s*(\d{2})|([~\uff5e\u301c\u3030\uff0d\-\u2013\u2014]|・)/g;

// 从一段文本抽区间。返回 [{ startTs, endTs, raw }]（同 raw 去重）
//   起点**必须**带月份（防止把「5日連続」「30日間」这类裸"日"当窗口起点）
//   末段可省"月"（`・18日(日)`）→ 月份取起点月，日小于起点日则进一个月
//   末段缺时刻 → 全天（00:00 / 23:59）；起点缺时刻 → 00:00
function ns_ournotes_parseOurNotesWindows(text, tz = ns_ournotes_OURNOTES_TZ, hint = null) {
	const out = [];
	const seen = new Set();
	const s = String(text == null ? "" : text);
	ns_ournotes_JP_TOKEN.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_ournotes_JP_TOKEN.exec(s)) !== null) {
		toks.push({
			date: m[3] != null ? { y: m[1] ? +m[1] : null, mo: m[2] != null ? +m[2] : null, d: +m[3] } : null,
			time: m[4] != null ? { h: +m[4], mi: +m[5] } : null,
			sep: m[6] || null,
			at: m.index,
			end: m.index + m[0].length
		});
		if (m[0] === "") ns_ournotes_JP_TOKEN.lastIndex++;
	}
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	let i = 0;
	while (i < toks.length) {
		const t0 = toks[i];
		if (!t0.date || t0.date.mo == null) { i++; continue; }
		let j = i + 1;
		let startTime = null;
		if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
		if (!(toks[j] && toks[j].sep)) { i++; continue; }
		j++;
		let endDate = null, endTime = null;
		if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
		if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
		if (!endDate && !endTime) { i++; continue; }

		// 年份：源站常只写月日 → 借公告年（共用 inferYear）。
		// ⚠️ 2026-10-03 改：原先是 `t0.date.y ?? hintParts.y` —— **不做"跨年份修正"**，
		//    于是「1 月公告里写的 12 月活动」会被算成**本**年 12 月（实际是去年 12 月）。
		//    `inferYear` 的"起始月比公告月晚 6 个月以上 → 算去年"正为此而设。
		const y1 = inferYear(t0.date.y, t0.date.mo, hintParts);
		if (y1 == null) { i++; continue; }
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo != null ? endDate.mo : t0.date.mo;
			d2 = endDate.d;
			y2 = endDate.y != null ? endDate.y : y1;
			if (endDate.y == null && endsNextYear(t0.date.mo, t0.date.d, mo2, d2)) {
				// 末段只写「日」且比起点日小 → 视为下一个月（可能跨年）
				if (endDate.mo == null) { mo2 = t0.date.mo + 1; if (mo2 > 12) { mo2 = 1; y2 = y1 + 1; } }
				else y2 = y1 + 1;
			}
		} else {
			mo2 = t0.date.mo; d2 = t0.date.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, t0.date.mo, t0.date.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) { i++; continue; }
		const raw = s.slice(t0.at, toks[j - 1].end).trim();
		if (!seen.has(raw)) { seen.add(raw); out.push({ startTs, endTs, raw }); }
		i++;
	}
	return out;
}

// ── 公告集合 → [{ id, title, dateTs, windows }]（按 date_gmt 倒序）──
function ns_ournotes_parseOurNotesPosts(json, tz = ns_ournotes_OURNOTES_TZ) {
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	return json
		.filter((p) => p && p.id != null)
		.map((p) => {
			const hint = ns_ournotes_parseOurNotesInstant(p.date, tz);
			const hay = [
				ns_ournotes_ournotesTitle(p),
				htmlText(p.excerpt && p.excerpt.rendered),
				htmlText(p.content && p.content.rendered)
			].join("\n");
			return {
				id: p.id,
				title: ns_ournotes_ournotesTitle(p),
				dateText: p.date || "",
				dateTs: hint,
				windows: ns_ournotes_parseOurNotesWindows(hay, tz, hint)
			};
		})
		.sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

// WP 的 `date` 是**源站本地时间且不带时区后缀**（"2026-09-21T16:30:30"）→ 按 tz 解释为墙钟
function ns_ournotes_parseOurNotesInstant(s, tz = ns_ournotes_OURNOTES_TZ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

// 外显挑选：第一条"覆盖当前时刻"的区间（按公告倒序、区间原序）；都没有则取最新一篇的第一条区间
function ns_ournotes_selectOurNotesPrimary(entries, now) {
	const list = Array.isArray(entries) ? entries : [];
	for (const p of list) for (const w of p.windows) if (coversNow(w, now)) return { post: p, win: w };
	for (const p of list) if (p.windows.length) return { post: p, win: p.windows[0] };
	return null;
}

// ── 抓取器（活动侧单侧）──
async function ns_ournotes_eventsOurNotes(url, signal, tz = ns_ournotes_OURNOTES_TZ) {
	const listUrl = url || ns_ournotes_OURNOTES_LIST_URL;
	// mode 必须与 registry-<batch>.js 里声明的 "direct" 一致（本目录只有 3 个源可直连）
	const json = await fetchJson(listUrl, { signal, mode: "direct" });
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	if (json.length === 0) return null;
	const posts = ns_ournotes_parseOurNotesPosts(json, tz);
	const now = Date.now();
	const picked = ns_ournotes_selectOurNotesPrimary(posts, now);
	if (!picked || !picked.win) return null;
	const active = [];
	for (const p of posts) for (const w of p.windows) if (coversNow(w, now)) active.push({ p, w });
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 名称用公告标题（这是该站的"活动名"来源）；行内不再附来源站名/URL/时区推定等元信息。
	// ⚠️ 只有 1 条当期窗口时 hoverEvent 返回 "" → **不设 eventHover**，由 UI 走默认两行式
	//    「名称 ⏎ 档期」（实测夹具里覆盖当期的只有 1 条：288 那篇）。
	const list = (active.length ? active : [picked]).map(({ p, w }) => ({
		name: p.title,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: w.raw
	}));
	const eventHover = hoverEvent(list, tz);
	return {
		event: picked.post.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-ournotes-global.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-ournotes-global.js
//
// 由 next-sources/parsers/ournotes-global.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_ournotes-global__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-ournotes-global.js —— BanG Dream！OurNotes **国际服**（BHK 发行）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   两侧读**同一份公告 feed**（与国际服一致：一份公告里既有招募也有活动），靠标题分流。
//
// ══ 条目形态：**默认未配置**（只挂备选源，不给 url/eventUrl）════════════════
//   本条目在 registry-p9.js 里**没有** `url` / `eventUrl`，只有 `altSources` / `eventAltSources`。
//   插件 50-refresh.js 的语义是 `if (!source.url && !source.eventUrl) → skipped`：
//   不抓取、不计成功也不计失败，UI 显示「未配置（不抓取卡池/活动）」；用户在设置页选「官方公告（BHK）」
//   才会真正抓取。与米游社那套「崩坏3 新建条目、默认未配置」完全同型（见 45-next-sources.js）。
//
// ══ 接口（Lead 定位；本机**抓不到**，夹具是**合成**的，见下）══════════════════
//   发行商 = BHK（BILIBILI HK LIMITED），bundleId `com.bilibili.sirius`，内部代号 sirius。
//   列表 GET https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw
//   详情 GET https://l11-web-api.biligames.com/game/news/detail?game_base_id=118241&id=<id>&lang=zh-tw
//   Lead 实测抓到过一次：`{"code":0,"data":{"page_number":1,"page_size":20,"total_count":0,"list":[]}}`
//   → 源站**暂无公告**（国际服 2026-09-24 才上线）。
//   ⚠️ 此后本机对该域 `fetch failed`（ECONNRESET）：2026-10-03 复测三个 lang（zh-tw/zh-cn/en-us）
//      全部失败（实测 437~1507ms 直接失败）→ **拿不到真实夹具**。故本模块的夹具是**合成**的，
//      并在 fixtures/p9-ournotes-global-*/response.txt.meta.json 与 test/cases-p9.mjs 里**明确标注**。
//
// ══ 因此本解析器对**字段名**采取宽容策略（合成夹具只覆盖我们假设的字段）══════
//   · 列表项 id：`id` / `news_id` / `article_id` / `content_id`
//   · 标题：`title` / `name` / `subject`（可能是纯文本，也可能带 HTML）
//   · 发布时间（用于**推断正文里省略年份**）：`display_time` / `create_time` / `publish_time` / `date`
//   · 详情正文：`content` / `body` / `text` / `detail` / `description`（HTML 或纯文本）
//   · 结构化档期（若源站给了就优先用，给了才好）：`start_time`+`end_time` 等常见命名
//   · `total_count === 0` 或 `list` 为空 → 返回 null（= 未公布）
//   ⚠️ 以上字段名是**假设**，不是实测（源站无可达内容）。若将来抓一次真实响应，第一件事就是
//      按真实字段收紧这几个候选列表（位置集中在本文件 #region 字段候选）。
//
// ══ tz = Asia/Shanghai（**任务书指定**）═════════════════════════════════════
//   国际服含港澳台（zh-tw / zh-cn 为主），源站未标时区。**不要**照日服用 Asia/Tokyo。
//   绝对时刻走 `sourceInstant(...)`，文本走 `fmtWindow(...)`。
//
// ══ 合并器注意 ══
//   与 biligame-activity.js 同理：本文件**不 import 其它解析器**（合并器按文件命名空间隔离、
//   不会重命名跨文件 import 的名字），只 import lib/env.js。逻辑与 uma 的正文抽档期同源但自带一份。


const ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID = 118241;
const ns_ournotes_global_OURNOTES_GLOBAL_TZ = "Asia/Shanghai";
const ns_ournotes_global_OURNOTES_GLOBAL_LANGS = ["zh-tw", "zh-cn", "en-us", "ko-kr"];
const ns_ournotes_global_OURNOTES_GLOBAL_HOME = "https://www.biligames.com/";
const ns_ournotes_global_LIST_ORIGIN = "https://l11-web-api.biligames.com";
const ns_ournotes_global_DETAIL_LIMIT = 8;

function ns_ournotes_global_ournotesGlobalListUrl(lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/page?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&show_position=1&lang=${lang}`;
}
function ns_ournotes_global_ournotesGlobalDetailUrl(id, lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/detail?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&id=${id}&lang=${lang}`;
}
const ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL = ns_ournotes_global_ournotesGlobalListUrl("zh-tw");
// 备选源标识就是 URL 本身（`altSourceId(alt) = alt.url`）→ 注册表里的 URL 必须与这里逐字一致
function ns_ournotes_global_langOf(url, fallback = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	try {
		const v = new URL(url).searchParams.get("lang");
		return v && ns_ournotes_global_OURNOTES_GLOBAL_LANGS.includes(v) ? v : fallback;
	} catch { return fallback; }
}

// 按 </p> 切段（详情正文若是 HTML）；纯文本没有 <p> → 退化成按行切
//#endregion

//#region 字段候选（**假设**，源站不可达，见文件头）
function ns_ournotes_global_pickStr(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "string" && v.trim() !== "") return v.trim();
	}
	return "";
}
function ns_ournotes_global_pickNum(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "string" && /^\d{6,}$/.test(v.trim())) return Number(v.trim());
	}
	return null;
}
const ns_ournotes_global_K_ID = ["id", "news_id", "article_id", "content_id", "newsId"];
const ns_ournotes_global_K_TITLE = ["title", "name", "subject", "news_title"];
const ns_ournotes_global_K_TIME = ["display_time", "displayTime", "create_time", "createTime", "publish_time", "publishTime", "date", "ctime"];
const ns_ournotes_global_K_CONTENT = ["content", "body", "text", "detail", "description", "news_content"];
const ns_ournotes_global_K_START = ["start_time", "startTime", "begin_time", "beginTime", "start_at", "startAt", "start_date"];
const ns_ournotes_global_K_END = ["end_time", "endTime", "end_at", "endAt", "end_date", "endDate"];
function ns_ournotes_global_ournotesGlobalTitle(x) {
	return htmlTextTight(ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TITLE));
}
//#endregion

//#region 列表 / 详情结构
// 列表 JSON → { totalCount, items:[{ id, title, sortKey, dateTs, raw }] }（按发布时间倒序）
//   结构不合法（非对象 / code≠0 / data 非对象 / list 非数组）→ 抛错（结构性损坏）
function ns_ournotes_global_parseOurNotesGlobalPage(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("ournotes-global-bad-json");
	if (json.code !== 0) throw new Error("ournotes-global-code-" + json.code);
	const d = json.data;
	if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("ournotes-global-bad-json");
	if (!Array.isArray(d.list)) throw new Error("ournotes-global-bad-json");
	const totalRaw = d.total_count != null ? d.total_count : d.totalCount;
	const totalCount = totalRaw == null ? d.list.length : Number(totalRaw);
	const items = d.list
		.filter((x) => x && typeof x === "object")
		.map((x) => {
			const sortKey = ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TIME);
			return {
				id: ns_ournotes_global_pickNum(x, ns_ournotes_global_K_ID),
				title: ns_ournotes_global_ournotesGlobalTitle(x),
				sortKey,
				dateTs: ns_ournotes_global_parseOurNotesGlobalStamp(sortKey, ns_ournotes_global_OURNOTES_GLOBAL_TZ),
				raw: x
			};
		})
		.filter((x) => x.id != null && x.title)
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	return { totalCount: Number.isFinite(totalCount) ? totalCount : items.length, items, raw: d };
}
// 空 = 未公布：`total_count === 0` 或 list 为空（**实测** Lead 抓到的那次就是 total_count:0）
function ns_ournotes_global_isOurNotesGlobalEmpty(json, page = null) {
	const p = page || ns_ournotes_global_parseOurNotesGlobalPage(json);
	return p.totalCount === 0 || p.items.length === 0;
}
function ns_ournotes_global_ournotesGlobalDetailText(detail) {
	const d = detail && typeof detail === "object" && detail.data && typeof detail.data === "object" ? detail.data : detail;
	if (!d || typeof d !== "object") return "";
	const v = (() => {
		for (const k of ns_ournotes_global_K_CONTENT) {
			const c = d[k];
			if (typeof c === "string" && c.trim() !== "") return c;
			if (c && typeof c === "object" && typeof c.rendered === "string") return c.rendered;
		}
		return "";
	})();
	return v;
}
// 结构化档期（若源站给了 start/end 字段就优先用，给了才好）；拿不到 → null
function ns_ournotes_global_ournotesGlobalStructuredWindow(item, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const d = item && typeof item === "object" && item.data && typeof item.data === "object" ? item.data : item;
	const a = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_START), b = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_END);
	if (!a || !b) return null;
	const aTs = ns_ournotes_global_parseOurNotesGlobalStamp(a, tz), bTs = ns_ournotes_global_parseOurNotesGlobalStamp(b, tz);
	if (aTs == null || bTs == null || !(bTs > aTs)) return null;
	return { startTs: aTs, endTs: bTs, raw: `${a} ~ ${b}`, glued: false, structured: true };
}
//#endregion

//#region 日期令牌（容错：年月日 / 斜杠 / 点 / ISO，年份可省）
function ns_ournotes_global_parseOurNotesGlobalStamp(s, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const t = String(s == null ? "" : s).trim();
	if (t === "") return null;
	// 纯数字：> 1e11 视为毫秒，否则视为秒（**假设**）
	if (/^\d{10,13}$/.test(t)) {
		const n = Number(t);
		return n > 1e11 ? n : n * 1000;
	}
	// ⚠️ `(?:\s*日)?` 必须写成可选组：若写成 `\s*日?`，后面的空格会被 `\s*` 吃掉，
	//    而时刻组本身可选 → 正则不回退，`2026-10-01 12:00:00` 会被静默当成 00:00（本模块第一版踩过）
	const m = /^(?:(\d{4})\s*[年\/\-.]\s*)?(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})(?:\s*日)?(?:[\sT]+(\d{1,2})\s*[:：]\s*(\d{2}))?/.exec(t);
	if (!m) return null;
	const y = m[1] ? +m[1] : null;
	if (y == null) return null;                     // 没有年份 → 需要外部补全（由调用方按公告年补）
	const mo = +m[2], d = +m[3], h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return sourceInstant(y, mo, d, h, mi, tz);
}
const ns_ournotes_global_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|常駐|永久|常設|長期)"
].join("|"), "g");
// ⚠️ 2026-10-03：此处原有本地 `yearOf`（补年份）—— 与 `biligame-activity.js` 那份**逐字相同**，
//    已统一到 `30-parsers.js` 的共用 `inferYear(y, mo, hint)`。
// 一段文本 → { norm, windows:[{ startTs, endTs, raw, glued }], skipped }
function ns_ournotes_global_extractOurNotesGlobalWindows(text, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, yearHint = null) {
	const src = String(text == null ? "" : text);
	const norm = src;
	const toks = [];
	ns_ournotes_global_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_ournotes_global_TOK_RE.exec(norm)) !== null) {
		if (m[0] === "") { ns_ournotes_global_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) toks.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) toks.push(t);
		} else if (g.sep != null) toks.push({ kind: "sep", text: g.sep, at, end });
		else if (g.perm != null) toks.push({ kind: "perm", text: g.perm, at, end });
	}
	const windows = [], skipped = [];
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raw = norm.slice(a.at, b.end).trim();
		if (b.kind === "perm") { skipped.push({ raw, reason: "perm" }); i += 2; continue; }
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const y1 = inferYear(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw, reason: "no-year" }); i += 2; continue; }
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		const startTs = sourceInstant(y1, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw, glued: false });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

//#region 标题分流（国际服多语言 → 关键词按语种各一套；**假设**，未拿到真实标题）
const ns_ournotes_global_RE_GACHA_ZH = /招募|扭蛋|必得|祈愿|招集/;
const ns_ournotes_global_RE_EVENT_ZH = /活動|活动|賽事|赛事|劇情|剧情|舉辦|举办|慶典|庆典|任務|任务/;
const ns_ournotes_global_RE_GACHA_EN = /\brecruit|\bgacha\b|\bbanner\b|\bpickup\b|\bpick-up\b/i;
const ns_ournotes_global_RE_EVENT_EN = /\bevent\b|\bcampaign\b|\bstory\b|\bmission\b|\bcelebration\b/i;
const ns_ournotes_global_RE_GACHA_KO = /모집|가챠|뽑기/;
const ns_ournotes_global_RE_EVENT_KO = /이벤트|활동|스토리|캠페인/;
function ns_ournotes_global_classifyOurNotesGlobalTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_ournotes_global_RE_GACHA_ZH.test(t) || ns_ournotes_global_RE_GACHA_EN.test(t) || ns_ournotes_global_RE_GACHA_KO.test(t)) return "gacha";
	if (ns_ournotes_global_RE_EVENT_ZH.test(t) || ns_ournotes_global_RE_EVENT_EN.test(t) || ns_ournotes_global_RE_EVENT_KO.test(t)) return "event";
	return null;
}
// 标题清洗：去掉尾部动作尾巴（简繁都认：`开放！`/`開放！`/`舉辦中！`…），保留活动/卡池名
const ns_ournotes_global_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|即將|现已|現已|正在|已)?(?:开放|開放|開啟|开启|举办|舉辦|登場|登场|上线|上線|开始|開始|结束|結束|预告|預告)[中]?[！!。]?\s*$/;
function ns_ournotes_global_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_ournotes_global_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz, now = Date.now()) → 对象 | null）
// 外显挑选：覆盖 now 的窗口里取结束最早的（并列按文档顺序）
function ns_ournotes_global_pickOurNotesGlobalWindow(items, now) {
	const act = (items || []).filter((x) => coversNow(x, now));
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function ns_ournotes_global_yearHintOf(item, tz) {
	return item && item.dateTs != null ? sourceWallParts(item.dateTs, tz) : null;
}
async function ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, want) {
	const listUrl = url || ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL;
	const lang = ns_ournotes_global_langOf(listUrl);
	// mode 一律 "proxy"：`l11-web-api.biligames.com` 无 ACAO（也未实测直连放行）
	const json = await fetchJson(listUrl, { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
	const page = ns_ournotes_global_parseOurNotesGlobalPage(json);
	if (ns_ournotes_global_isOurNotesGlobalEmpty(json, page)) return null;     // total_count:0 / list 空 → 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of page.items.slice(0, ns_ournotes_global_DETAIL_LIMIT)) {
		if (ns_ournotes_global_classifyOurNotesGlobalTitle(it.title) !== want) continue;
		tried++;
		let detail = null;
		try {
			detail = await fetchJson(ns_ournotes_global_ournotesGlobalDetailUrl(it.id, lang), { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		loaded++;
		const text = ns_ournotes_global_ournotesGlobalDetailText(detail);
		const title = ns_ournotes_global_ournotesGlobalTitle((detail && detail.data) || detail) || it.title;
		const hint = ns_ournotes_global_yearHintOf(it, tz);
		const structured = ns_ournotes_global_ournotesGlobalStructuredWindow(detail, tz);
		const parsed = ns_ournotes_global_extractOurNotesGlobalWindows(text, tz, hint);
		const windows = structured ? [structured, ...parsed.windows] : parsed.windows;
		const best = ns_ournotes_global_pickOurNotesGlobalWindow(windows, now);
		if (!best) continue;
		const active = windows.filter((x) => coversNow(x, now))
			.map((x, i) => ({ x, i }))
			.sort((a, b) => (a.x.startTs - b.x.startTs) || (a.i - b.i))
			.map((o) => o.x);
		// ⚠️ 2026-10-03 改：这里原本手搓悬停，且有**三层**元信息 ——
		//   ① 头行 `BanG Dream！OurNotes·国际服 · ${title}（国际服含港澳台，源站未标时区；tz=… 按任务书指定…）`
		//   ② `来源：BHK 官方公告 l11-web-api.biligames.com（game_base_id=…，lang=…）` ← 来源 URL + 内部字段名 + 内部 id
		//   ③ 行内装饰符 `▶ ` / `  ` + `（结构化字段）` ← 实现说明；且**档期在前**
		//   它一直没被发现，是因为该条目**默认未配置**（出厂不抓取）→ 活体审计永远看不到它的悬停。
		//   现在改用共用 hoverPool：只留「名称 ⏎ 档期」。时区依据写在本文件顶部注释与条目 tz 字段里。
		const name = ns_ournotes_global_cleanTitle(title) || "（未命名）";
		const hover = hoverPool(active.map((x) => ({ name, startTs: x.startTs, endTs: x.endTs })), tz);
		return { title, best, hover };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全失败 → 抛错
	return null;
}
async function ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		banner: ns_ournotes_global_cleanTitle(title) || "（未命名招募）",
		roles: "",
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		bannerHover: hover
	};
}
async function ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		event: ns_ournotes_global_cleanTitle(title) || "（未命名活动）",
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		eventHover: hover
	};
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bestdori.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bestdori.js
//
// 由 next-sources/parsers/bestdori.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bestdori__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bestdori.js —— BanG Dream!（Bestdori 社区数据库，取**简中服**时间段）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-bestdori-gacha` / `b1-bestdori-events`）与任务给的简化形态的差别：
//   1. 两个文件都是**以 id 为 key 的对象**（不是数组）：gacha 2149 个键、events 345 个键。
//   2. 时间是 **字符串毫秒**（`"1462071600000"`），需要 Number()；缺失服区为 `null`。
//   3. 字段名实测：
//      gacha：{ resourceName, bannerAssetBundleName, gachaName[5], publishedAt[5], closedAt[5], type, newCards }
//      event：{ eventType, eventName[5], assetBundleName, startAt[5], endAt[5], … }
//      —— 任务里猜的 `eventName`/`startAt`/`publishedAt`/`closedAt` 全对，但**值是字符串**。
//
// 服区下标：0=日 1=英 2=繁中 **3=简中** 4=韩。
//   实测交叉验证（夹具里的 gacha 1「リリース記念ガチャ」五连名称）：
//     [0] リリース記念ガチャ / [1] Release Celebration Gacha / [2] 遊戲上線紀念轉蛋 / [3] 开服纪念招募 / [4] 오픈 기념 뽑기
//   → [3] 是**简体中文**，即简中服（本条目要的服区）。gacha 里带 CN 时间的有 1734 / 2149 条。
//
// 时区：UTC+8。UTC 毫秒本身就是**绝对时刻**，这里**不做任何时区换算**；
//   `tz`（Asia/Shanghai）只用于把绝对时刻渲染成源站墙钟文本（sourceWallParts/fmtWindow）。
//   交叉验证（调研文档 + 夹具）：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt=1790647200000（=02:00Z）完全吻合。


const ns_bestdori_DEFAULT_GACHA = "https://bestdori.com/api/gacha/all.5.json";
const ns_bestdori_DEFAULT_EVENT = "https://bestdori.com/api/events/all.5.json";
const ns_bestdori_CN_INDEX = 3;                        // 简中服下标（见文件头实测）
// 长期/常驻池阈值：**用本体那一条**（LONG_TERM_MAX_WINDOW_DAYS = 120）。
// ⚠️ 2026-10-03 收敛：这里原本是 400 天，与本体/sekai 的 120 天**不是同一个值** ——
//    同一条规则不该有两个值。实测影响：夹具里 22 个窗口落在 (120, 400] 天之间
//    （「新手限定 / 回归纪念 / 每日免费 / 少女们的回忆 / 开服纪念」这类长期池），
//    在 400 天下会被误判成"当期"。当前真实在架池恰好 0 个落在该区间，故属**潜在**不一致。
const ns_bestdori_LONG_MS = LONG_TERM_MAX_WINDOW_DAYS * 864e5;

// ⚠️ 2026-10-03 收敛：本文件原有 `toTs`（宽容版）与 `byNewestStart` —— 前者与 sekai 那份**语义不同**、
//    后者与 sekai 那份逐字相同（差别只在 `Number(a.id)` 与 `a.id`）。均已统一到
//    `41-sources-shared.js` 的 `numOrNull` / `byNewestStart`。

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**（≤400 天）简中池里取 startTs 最新的一期当"当期卡池"；
// 长期/常驻池（miracle/free 等，closedAt 常是 2100 哨兵）不参与选择，只在 hover 里报个数。
function ns_bestdori_parseBestdoriGacha(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-gacha-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const pools = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.publishedAt) || !Array.isArray(v.closedAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.gachaName) ? v.gachaName[ns_bestdori_CN_INDEX] : null;
		const p = numOrNull(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = numOrNull(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => coversNow(x, now));
	const bounded = active.filter((x) => !x.long).sort(byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同一期招募可能被源站多处登记（同名同窗口）→ 先去重成一条（本体没有「×n」记法，也不该有重复行）。
	// ⚠️ 2026-10-03 改：这里原本**手搓悬停**（`名称（类型枚举）×n  档期` 单行式 + 「另有 N 个未列出」
	//    + 「结束时间是 2100 之类的哨兵值」这类元信息），与本体/其它来源的
	//    「池名 ⏎ 档期」两行式不一致 —— 本备选源没被方案 A 的悬停审计覆盖到（它只是 altSources 里的一个）。
	//    现在改用共用 hoverPool：排版只有一处实现。
	const seen = new Set();
	const uniq = bounded.filter((p) => {
		const k = `${p.name}|${p.startTs}|${p.endTs}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const hover = hoverPool(uniq.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// ── 活动侧 ──
function ns_bestdori_parseBestdoriEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-event-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const rows = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.startAt) || !Array.isArray(v.endAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.eventName) ? v.eventName[ns_bestdori_CN_INDEX] : null;
		const s = numOrNull(v.startAt[ns_bestdori_CN_INDEX]);
		const e = numOrNull(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => coversNow(x, now)).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 活动一般只有一期在期；多期时 hover 逐行列出（与插件 buildEventHover 同约定：<2 条返回 ""）
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: dates, eventHover: hover };
}

// 抓取器：mode="proxy"（实测 bestdori.com 无 ACAO，必须走宿主代理）
async function ns_bestdori_gachaBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_GACHA, { signal });
	return ns_bestdori_parseBestdoriGacha(data, now, tz);
}
async function ns_bestdori_eventsBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_EVENT, { signal });
	return ns_bestdori_parseBestdoriEvents(data, now, tz);
}

// src/client/42-parsers-bwiki.js —— bwiki wiki 页系（物华弥新 / 战双 / 卡厄斯 / 雪松 + 4 个备选源）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-bwiki.js                物华弥新 + 4 个 bwiki 备选源（kedr-kaxi / uma-cn-bwiki / uma-jp-bwiki / stellasora-bwiki）
//      · 42-parsers-bwiki-wikitext.js       战双（SMW ask + 公告）/ 卡厄斯（Lua 模块）/ 雪松（模板）
//      · 42-parsers-kedr-wiki.js            雪松 wiki 页解析工具（生产已改走 bwiki-wikitext；本文件供回归测试）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bwiki.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bwiki.js
//
// 由 next-sources/parsers/bwiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bwiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bwiki.js —— 批次 B2：bwiki（MediaWiki api.php）来源
//
// 统一抓取形态（**全部 mode:"proxy"**，2026-10-02 实测 bwiki 全系 ACAO 为空）：
//   https://wiki.biligame.com/<wiki>/api.php?action=parse&page=<页面名URL编码>&prop=text&format=json&formatversion=2
// 用 `fetchMediaWikiText(url, opts)`：它会自动追加 `&origin=*` 并取 `parse.text`。
// 契约：async (url, signal, tz) → 数据对象 | null（见 CONVENTIONS.md）。
//   `now` 只在最后一位、自带默认值（铁律 2）；测试可传固定 now 以离线断言。
//
// ─────────────────────────────────────────────────────────────────────────────
// 实测结论（2026-10-02，夹具见 fixtures/bwiki-*）：**7 个来源 / 8 个"侧"里只有 2 侧能给出"当期"数据**
//   来源            页面            结构                        实测最新一条        当期可用?
//   whmx 物华弥新    限时招集档案     CardSelect 表 113 行        2026-09-30 起        ✅ 覆盖 now
//   umamusume 简中   简中卡池         两张表：已实装 191 行 / 预测 240 行  2026-10-23 止  ✅ 覆盖 now
//   umamusume 日服   活动             单表 100 行（标题=「往期活动」）   2025-12-26 起    ❌ 归档，停在 2025-12
//   whmx 物华弥新    活动             CardSelect 表 62 行        2025-05-01 起        ❌ 停在 2025-05
//   zspms 战双       研发记录         107 张小表（每池一张）       2024-03-21 起        ❌ 停在 2024Q1
//   kedrgame 雪松    卡池信息         无表格，仅「台架测试[一/二]」  2024-12-07 ~ 13      ❌ 台架测试占位
//   czn 卡厄斯梦境   卡池记录         只有「模板:Gacha」链接，空页   —                    ❌ 无内容
//   stellasora 星塔  首页             活动日历 2 项（JS 计算剩余时间） 2026-04-07 止     ❌ 停更 + 无名
//   ⇒ 另外 6 侧在"当期"判定下**如实返回 null**（源站抓到页面但当期没有内容），
//     而不是硬凑一个过期档期。逐条都在这份注释与 registry-b2.js 里写明。
// ─────────────────────────────────────────────────────────────────────────────
//
// 「当期」判定沿用插件本体 `src/client/30-parsers.js` 的 bwiki 语义（bwikiGachaPayload /
// genericEventPayload）：**过滤出覆盖当前时刻的条目；一条都没有 → 返回 null（未公布）**。
// 卡池外显取"结束最早"的池（越快结束越该盯住），roles 合并同期全部主池；活动外显优先
// 剧情/挑战档，悬停按结束时间升序逐行。
//
// 时区（依据见 registry-b2.js 注释）：
//   · 国服（whmx / umamusume 简中 / zspms / kedrgame / czn / stellasora）= Asia/Shanghai（**推测**，源站未显式标注）
//   · 赛马娘日服（umamusume 活动）= Asia/Tokyo（**硬标注**：卡池页正文「日服卡池时间记录统一为日本时间」）
//
// 已知源站坑（都做了处理，见各解析器注释）：
//   ① umamusume 简中「已实装卡池」表的时间列是 **结束 ~ 开始**（与其它表相反）→ 按整表多数票判定朝向
//   ② 该表 191 个数据行里，94 行「支援卡卡池」共用上一行的 `rowspan="2"` 时间 → 只有 3 格，需继承日期
//   ③ 战双日期带 12 小时制（`10:00 AM`）；雪松日期只有日期无时刻；whmx 有「开服后」这种无时刻写法
//   ④ 源站存在错行（uma 日服活动 `2025/04/10 11:00~ 2024/04/18 10:59`）→ endTs<=startTs 的行整行丢弃
//   ⑤ bwiki 对高频请求返回 HTTP 567（WAF 挑战页，body 7KB，含 "567 <id>"）→ 抓夹具必须重试/限速


//#region HTML 工具（够用即可，不引依赖）
// MediaWiki 的表格会嵌套（cell 内嵌 table）→ 用深度计数切表，避免非贪婪正则截断
function ns_bwiki_eachTable(html) {
	const out = [];
	const re = /<table\b[^>]*>|<\/table>/gi;
	let m, depth = 0, start = -1;
	while ((m = re.exec(html))) {
		if (m[0][1] !== "/") { if (depth === 0) start = m.index; depth++; }
		else { depth--; if (depth === 0) out.push(html.slice(start, m.index + m[0].length)); }
	}
	return out;
}
// 行 → [{ attrs, cells:[{tag,attrs,html,text}] }]
function ns_bwiki_tableRows(tbl) {
	const rows = [];
	const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
	let m;
	while ((m = re.exec(tbl))) rows.push({ attrs: m[1], cells: ns_bwiki_rowCells(m[2]) });
	return rows;
}
function ns_bwiki_rowCells(rowHtml) {
	const out = [];
	const re = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
	let m;
	while ((m = re.exec(rowHtml))) {
		out.push({ tag: m[1].toLowerCase(), attrs: m[2], html: m[3], text: stripTags(m[3]) });
	}
	return out;
}
function ns_bwiki_attrOf(html, name) {
	const s = String(html);
	const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) || s.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
	return m ? stripTags(m[1]) : "";
}
// 表头单元格文本（取第一行含 <th> 的）
function ns_bwiki_headerCells(tbl) {
	const hr = ns_bwiki_tableRows(tbl).find((r) => r.cells.some((c) => c.tag === "th"));
	return hr ? hr.cells.map((c) => c.text) : [];
}
function ns_bwiki_findTablesByHeaders(tables, wanted) {
	return tables.filter((tbl) => {
		const h = ns_bwiki_headerCells(tbl).join("|");
		return wanted.every((w) => h.includes(w));
	});
}
// 表/节点之前最近的小节标题（用于取干净的池名、区分「已实装/预测」两张同表头表）
function ns_bwiki_headingBefore(html, idx) {
	const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m, last = "";
	while ((m = re.exec(html))) {
		if (m.index >= idx) break;
		last = stripTags(m[2]).replace(/\s*\[\s*编辑\s*\]\s*/g, "").trim();
	}
	return last;
}
// 图片名 → 可读名（whmx 用 `孤岛螺旋-banner.png`；stellasora 用 `Banner bossrush 5.png`）
function ns_bwiki_cleanImgName(alt) {
	let x = String(alt || "").trim();
	if (!x || /^(无图|暂无)/.test(x)) return "";
	x = x.replace(/^文件\s*[:：]\s*/, "").replace(/\.(png|jpe?g|gif|webp)$/i, "");
	x = x.replace(/^banner[\s_-]*/i, "").replace(/[\s_-]*banner$/i, "");
	return x.trim();
}
// 单元格里所有 <a title="…">（去重、保序）—— bwiki 常把角色名只放在 title/alt 属性里。
// 少数行没有角色词条，只有图片文件链接（如 whmx 自选池 `文件:结伴同游·请调书.png`）→ 退化为清洗后的文件名。
function ns_bwiki_linkTitles(html) {
	const out = [], seen = new Set();
	const re = /<a\b[^>]*\btitle\s*=\s*"([^"]*)"/gi;
	let m;
	while ((m = re.exec(String(html)))) {
		let t = stripTags(m[1]).trim();
		if (/^(文件|File|分类|Category)\s*[:：]/i.test(t) || /\.(png|jpe?g|gif|webp)$/i.test(t)) t = ns_bwiki_cleanImgName(t);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}
//#endregion

//#region 日期解析
// 三种源站写法：
//   `2026年09月30日 10:00`、`2026年9月30日开服后`（无时刻）
//   `2026/09/30 10:00`、`2026/9/30 9:59 AM`（12 小时制）、`2024/12/7`
//   `10月22日 09:59`（省年份 → 继承上一个点的年份，月倒退则 +1 年）
const ns_bwiki_DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})|(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

// 紧跟日期之后的时刻（可带 AM/PM）；没有 → null（= 源站只给日期）
function ns_bwiki_timeAfter(text, from) {
	const m = String(text).slice(from, from + 14).match(/^\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/);
	if (!m) return null;
	let h = +m[1];
	const mi = +m[2];
	const ap = m[3] ? m[3].toLowerCase() : "";
	if (ap === "p" && h < 12) h += 12;
	if (ap === "a" && h === 12) h = 0;
	if (h > 23 || mi > 59) return null;
	return { h, mi };
}
// 文本 → 日期点数组 [{y,mo,d,h,mi,noTime}]
function ns_bwiki_parsePoints(text) {
	const s = String(text);
	const out = [];
	let lastY = null, lastMo = null;
	ns_bwiki_DATE_RE.lastIndex = 0;
	let m;
	while ((m = ns_bwiki_DATE_RE.exec(s))) {
		let y, mo, d;
		if (m[1] != null) { y = +m[1]; mo = +m[2]; d = +m[3]; }
		else if (m[4] != null) { y = +m[4]; mo = +m[5]; d = +m[6]; }
		else { y = null; mo = +m[7]; d = +m[8]; }
		if (y == null) {
			if (lastY == null) continue;                        // 前面也没有年份 → 无法定位
			y = lastMo != null && mo < lastMo - YEAR_HINT_MONTH_GAP ? lastY + 1 : lastY;   // 跨年（12月 → 1月）
		}
		const t = ns_bwiki_timeAfter(s, m.index + m[0].length);
		out.push({ y, mo, d, h: t ? t.h : 0, mi: t ? t.mi : 0, noTime: !t });
		lastY = y; lastMo = mo;
	}
	return out;
}
function ns_bwiki_pointTs(p, tz) { return sourceInstant(p.y, p.mo, p.d, p.h, p.mi, tz); }
function ns_bwiki_prettyPoint(p) { return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`; }

// 整表朝向：源站有些表写「开始 ~ 结束」，有些写「结束 ~ 开始」（uma 简中已实装表就是后者）。
// 用多数票判定，避免个别错行把整表判反；错行本身按 endTs<=startTs 丢弃。
function ns_bwiki_detectOrientation(texts, tz) {
	let rev = 0, nor = 0;
	for (const t of texts) {
		const ps = ns_bwiki_parsePoints(t);
		if (ps.length < 2) continue;
		const a = ns_bwiki_pointTs(ps[0], tz), b = ns_bwiki_pointTs(ps[1], tz);
		if (a > b) rev++;
		else if (a < b) nor++;
	}
	return rev > nor ? "endFirst" : "startFirst";
}
// 单元格 → 窗口（取前两个日期点）；只有日期没时刻时：起点按 00:00、终点按 23:59
function ns_bwiki_windowsFromCell(text, tz, orient = "startFirst") {
	const ps = ns_bwiki_parsePoints(text);
	if (ps.length < 2) return [];
	const a = ps[0], b = ps[1];
	let sp, ep;
	if (orient === "endFirst") { sp = b; ep = a; } else { sp = a; ep = b; }
	const startTs = ns_bwiki_pointTs(sp, tz);
	const endTs = ns_bwiki_pointTs(ep.noTime ? { ...ep, h: 23, mi: 59 } : ep, tz);
	if (!(endTs > startTs)) return [];                     // 源站错行 → 丢掉（不硬造）
	const raw = String(text).replace(/\s+/g, " ").trim();
	return [{ startTs, endTs, raw, startText: ns_bwiki_prettyPoint(sp), endText: ns_bwiki_prettyPoint(ep) }];
}
//#endregion

//#region 当期挑选（沿用插件本体语义）
const ns_bwiki_EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|全息/;
function ns_bwiki_eventTier(x) {
	const cat = `${x.cat || ""} ${x.name || x.event || ""}`.trim();
	return ns_bwiki_EVENT_TIER1_RE.test(cat) ? 1 : 2;
}
function ns_bwiki_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }

// 覆盖 now 的条目：结束在未来且已开始（起点未知的行按"已开始"处理）
function ns_bwiki_activeItems(items, now) {
	return items.filter((it) => coversNow(it, now));
}
// 卡池：主池优先；外显取结束最早（同结束按**页面顺序**，与插件 `selectCurrent` 的稳定排序一致）
function ns_bwiki_pickCurrentPool(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const main = act.filter((it) => it.isMain !== false);
	const pool = (main.length ? main : act).slice()
		.sort((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0)));
	return { first: pool[0], pool };
}
function ns_bwiki_mergeRoles(items) {
	const seen = new Set(), out = [];
	for (const it of items) {
		for (const r of String(it.roles || "").split(/[、，,]/)) {
			const k = r.trim();
			if (!k || seen.has(k)) continue;
			seen.add(k);
			out.push(k);
		}
	}
	return out.join("、");
}
// 活动：外显优先剧情/挑战档，同级内结束时间升序
function ns_bwiki_pickCurrentEvent(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const ordered = act.slice().sort((a, b) => (ns_bwiki_eventTier(a) - ns_bwiki_eventTier(b))
		|| (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0)));
	return { first: ordered[0], ordered };
}
// ⚠️ 2026-10-03 删掉了本文件自带的三个重复实现：`ns_bwiki_permanentLine` / `ns_bwiki_buildPoolHover` /
//    `ns_bwiki_buildEventHover`。它们与共用工具 `hoverPermanentLine` / `hoverPool` / `hoverEvent`
//    是同一套排版（措辞逐字相同），且卡池那份**少了按结束时间排序**（本体 buildPoolHover 会排）——
//    属于"同一条规则的第二份实现"。本文件只剩 4 个**备选源**仍在用（uma-cn-bwiki / kedr-kaxi /
//    uma-jp-bwiki / stellasora-bwiki），它们此前没被方案 A 的悬停审计覆盖到，所以漏改了。
function ns_bwiki_gachaPayload(items, tz, now) {
	const cur = ns_bwiki_pickCurrentPool(items, now);
	if (!cur) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const first = cur.first;
	// 池名与本体同构：有角色名 →「池名：角色」，没有 → 只写池名
	const hover = hoverPool(cur.pool.map((p) => ({ name: p.banner, label: `${p.banner}${p.roles ? `：${p.roles}` : ""}`, startTs: p.startTs, endTs: p.endTs, raw: p.raw })), tz);
	return {
		banner: first.banner,
		roles: ns_bwiki_mergeRoles(cur.pool),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
function ns_bwiki_eventPayload(items, tz, now, permanentCount = 0) {
	const cur = ns_bwiki_pickCurrentEvent(items, now);
	if (!cur) return null;
	const first = cur.first;
	// 排序由调用方负责（hoverEvent **不排序**，与本体一致）：这里按结束时间升序
	const ordered = cur.ordered.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0)));
	const hover = hoverEvent(ordered.map((x) => ({ name: x.event, startTs: x.startTs, endTs: x.endTs, raw: x.raw })), tz, permanentCount);
	return {
		event: first.event,
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
	};
}
//#endregion

//#region ① 物华弥新（whmx）
// 卡池页「限时招集档案」：`<table id="CardSelectTr" class="CardSelect wikitable sortable col-fold">`
//   表头 `活动名称 | UP器者 | 开放时间 | 备注`，113 行数据；**名称/UP 都只在 <img alt> / <a title> 属性里**
//   （正文 text 是空的），所以必须读属性。行属性 `data-param1` 是招集类型（新实装器者·限定 …）。
//   时间写法：`2026年09月30日 10:00 ~ 10月22日 09:59`（终点省年份）；远古行有 `2024年4月19日开服后~…`。
function ns_bwiki_parseWhmxGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];                       // 空页 → 无候选
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间", "活动名称"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-gacha:no-table");   // 结构变了 → 抓取失败
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		const banner = ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || ns_bwiki_attrOf(r.attrs, "data-param1") || "限时招集";
		const roles = ns_bwiki_linkTitles(c1.html).join("、") || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt"));
		items.push({
			_i: i, banner, roles, cat: ns_bwiki_attrOf(r.attrs, "data-param1"), note: c3.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
// 活动页「活动」：同款 CardSelect 表，表头 `活动时间 | 图 | 名称 | 类型 | 备注`，63 行数据。
// ⚠️ 实测最新一条 = 2025/05/01（页面缓存时间 2026-10-01，即内容确实停在 2025-05）→ 当期无覆盖 → null。
function ns_bwiki_parseWhmxEvents(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 5 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3, c4] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")), note: c4.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ② 闪耀优俊少女 国服（umamusume / page=简中卡池）
// 页面两张同表头的表（各含表头行共 192 / 241 行，数据行 191 / 240）：
//   ①「已实装卡池」= 简中服**实际已实装**的记录（当期外显用这张） ②「预测卡池」= **推算**。
//   ⚠️ 页首正文：「简中卡池加速 -> 简中预测时间-185天 / 2025/05/22 简中重新更新 -> 简中预测时间+423天」
//      ⇒ 简中服时刻是**按日服时差推算**出来的，**不是官方时刻表**。本解析器只用①做当期外显，
//        ②的推算结果只放进 `bannerHover` 并显式标注「接下来的预测卡池（按日服时差推算，非官方时刻表）」。
//   表结构：表头 `时间 | 卡池(colspan=2) | Up对象` → 数据行 4 格 [时间][池类型][池名][Up对象]，
//     其中「支援卡卡池」行与上一行共用时间（上一行 `rowspan="2"`）→ 只有 3 格，需继承日期。
//   ⚠️① 表时间列是 **结束 ~ 开始**（整表多数票判定为 endFirst）；② 表是 **开始 ~ 结束**。
function ns_bwiki_parseUmaCnGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { live: [], predicted: [] };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["时间", "卡池"]);
	if (cands.length === 0) throw new Error("bwiki-uma-cn-gacha:no-table");
	const parseOne = (tbl) => {
		const raw = [];
		let pendingDate = "";
		for (const r of ns_bwiki_tableRows(tbl)) {
			const cs = r.cells;
			if (!cs.length || cs.some((c) => c.tag === "th")) continue;
			if (cs.length >= 4) {
				pendingDate = cs[0].text;
				raw.push({ dateText: pendingDate, catCell: cs[1], nameCell: cs[2], upCell: cs[3] });
			} else if (cs.length === 3) {
				raw.push({ dateText: pendingDate, catCell: cs[0], nameCell: cs[1], upCell: cs[2] });
			}
		}
		const orient = ns_bwiki_detectOrientation(raw.map((x) => x.dateText), tz);
		const items = [];
		raw.forEach((x, i) => {
			const wins = ns_bwiki_windowsFromCell(x.dateText, tz, orient);
			if (wins.length === 0) return;
			const cat = x.catCell.text;
			const roles = textOf(x.upCell.html).split("\n")
				.map((s) => s.trim().replace(/^简\//, "")).filter(Boolean).join("、");
			items.push({
				_i: i,
				banner: String(x.nameCell.text).replace(/\s+/g, " ").trim() || "卡池",
				roles, cat, isMain: !/支援/.test(cat),
				startTs: wins[0].startTs, endTs: wins[0].endTs,
				orient,                                   // 整表朝向（诊断/测试用；不进契约字段）
				raw: wins[0].raw                          // 源站原文（不含任何加工）
			});
		});
		return items;
	};
	// 用各表之前最近的小节标题区分「已实装」/「预测」（取不到标题时退回文档顺序）
	const withHead = cands.map((tbl) => ({ tbl, head: ns_bwiki_headingBefore(html, html.indexOf(tbl)) }));
	const liveTbl = (withHead.find((x) => /已实装/.test(x.head)) || withHead[0]).tbl;
	const predTbl = (withHead.find((x) => /预测/.test(x.head)) || withHead[1] || withHead[0]).tbl;
	return { live: parseOne(liveTbl), predicted: predTbl === liveTbl ? [] : parseOne(predTbl) };
}
// 预测卡池：**不进悬停**（方案 A：悬停只放"当期"，且不得含元信息）。
// 该表是 wiki 按日服时差机械平移出来的：池名里连**日服原始年份**都还留着
// （如 `八骏赛马娘卡池 20230911` 被平移到 2026-09），远期条目一路排到 2029 年。
// 2026-10-03 改：原先这里给 bannerHover 追加「—— 接下来的预测卡池（按日服时差推算，非官方时刻表） ——」
//   + 3 条未来条目。那既是"非当期"内容，头部又是元信息/来源说明 ——
//   「社区推算，非官方」这层意思已经写在来源标签里（`Bwiki 简中卡池（社区推算，非官方）`），
//   不需要再在悬停里重复。保留函数是为了让夹具测试仍能直接断言"预测表的解析结果"。
//#endregion

//#region ③ 赛马娘 日服（umamusume / page=活动）—— 时区硬标注 Asia/Tokyo
// 页面只有一张表，标题是「往期活动」（**归档**，不是当期排期），100 行；表头 `活动时间 | 图 | 名称 | 类型`。
//   时间写法 `2025/12/26 11:00~ 2026/01/08 10:59`（开始 ~ 结束）。
//   第 1 行是常驻（`常驻~ 常驻`，无日期）→ 只计入常驻条数，不进当期排序。
//   ⚠️ 实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
//   ⚠️ 源站有错行 `2025/04/10 11:00~ 2024/04/18 10:59` → endTs<=startTs 被整行丢弃。
function ns_bwiki_parseUmaJpEvents(html, tz = "Asia/Tokyo") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { items: [], permanent: 0 };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-uma-jp-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	let permanent = 0;
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) {
			if (/常驻|永久|長期|长期/.test(c0.text)) permanent++;
			return;
		}
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return { items, permanent };
}
//#endregion

//#region ④ 战双帕弥什 国服（zspms / page=研发记录）
// 107 张独立小表，每张 = 一期「降临狙击」研发池：行1 = `<td colspan="2">` 立绘/名（名在 <a title>），
//   行2 = `日期 | 2024/03/21 10:00 AM 至 2024/04/04 09:59 AM`（**12 小时制**），
//   行3 = `效果 | 「<a title=角色>」…`。表格前最近的 h2 就是干净的池名（如 `【露西亚·深红囚影】…限时概率UP`）。
//   ⚠️ 实测最新一期 = 2024/03/21（页面缓存时间 2026-10-01）→ 该页 **停在 2024Q1**，当期无覆盖 → null。
//      （页首自述「目前该记录仅包括"降临狙击角色"池和"命运降临角色狙击"池」。）
function ns_bwiki_parseZspmsGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const items = [];
	let seenLabel = 0;
	tables.forEach((tbl, ti) => {
		const rows = ns_bwiki_tableRows(tbl);
		let dateText = "", roleText = "", imgTitle = "";
		for (const r of rows) {
			if (r.cells.length === 1) {                        // 立绘行（colspan=2）
				const t = ns_bwiki_attrOf(r.cells[0].html, "title") || r.cells[0].text;
				if (t) imgTitle = t;
			}
			for (let i = 0; i < r.cells.length; i++) {
				const label = r.cells[i].text;
				const next = r.cells[i + 1];
				if (!next) continue;
				if (/^(日期|时间)/.test(label)) { dateText = next.text; seenLabel++; }
				else if (/^效果/.test(label)) roleText = next.html;
			}
		}
		const w = ns_bwiki_windowsFromCell(dateText, tz, "startFirst")[0];
		if (!w) return;
		const head = ns_bwiki_headingBefore(html, html.indexOf(tbl));
		const roles = ns_bwiki_linkTitles(roleText).join("、");
		items.push({
			_i: ti,
			banner: head || ns_bwiki_cleanImgName(imgTitle) || "研发池",
			roles, cat: "研发", note: "降临狙击角色池",
			startTs: w.startTs, endTs: w.endTs, raw: w.raw
		});
	});
	if (seenLabel === 0 && tables.length > 0) throw new Error("bwiki-zspms-gacha:no-table");   // 结构变了
	return items;
}
//#endregion

//#region ⑤ 雪松（kedrgame / page=卡池信息）—— ⚠️ 台架测试占位页，可能已停更
// 该页**没有任何表格**，只有两个小节「台架测试[一]」「台架测试[二]」，正文形如：
//   `<b>===时间===</b>：2024/12/7-2024/12/13`（**只有日期、没有时刻**）
//   第二段是 `？-？`（未填）。→ 实测唯一可解析的窗口 = 2024/12/07 ~ 2024/12/13，早于当期 → null。
//   ⚠️ 风险标注：最近编辑 2025-08-01、页面自称「台架测试」；但同 wiki 有 `历史卡池-精英集结-1.0.0-*`、
//      `游戏内部公告(2026.6/7)` 等更新页面，说明 wiki 还活着、只是本页不再是有效数据源。
function ns_bwiki_parseKedrGacha(html, tz = "Asia/Shanghai") {
	const re = /={2,}\s*时间\s*={2,}\s*(?:<\/b>)?\s*[:：]?\s*([^<]*)/g;
	const items = [];
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const value = m[1].replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(value, tz, "startFirst")[0];
		if (!w) continue;
		items.push({
			_i: i++,
			banner: ns_bwiki_headingBefore(html, m.index) || "卡池",
			roles: "", cat: "台架测试", note: value,
			startTs: w.startTs, endTs: w.endTs, raw: value
		});
	}
	return items;
}
//#endregion

//#region ⑥ 卡厄斯梦境 国服（czn / page=卡池记录）—— ⚠️ 实测为空页
// `prop=text` 全文只有 `模板:Gacha` 一个链接，**无表格、无日期**（wiki 侧该模板已不存在/不产出内容）。
// 同 wiki 站内搜索 "卡池" 只命中 4 页（卡池记录 / 首页 / 首页-PC端 / 首页-移动端），没有更好的卡池页。
// ⇒ 返回 []，抓取器据此返回 null（如实"抓到了页面但当期没内容"）。若日后 wiki 补全为 CardSelect 表，
//    本解析器按 whmx 同款表头（开放时间/活动名称）兜底解析。
function ns_bwiki_parseCznGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间"]);
	if (cands.length === 0) return [];                         // 有表但不是卡池表 → 视为无内容
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			banner: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || "卡池",
			roles: ns_bwiki_linkTitles(c1.html).join("、"),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ⑦ 星塔旅人 国服（stellasora / page=首页 的「活动日历」区块）—— ⚠️ 低可用性
// 区块形如：
//   `<div class="activity-item"><img alt="Banner bossrush 5.png" …>
//      <div class="activity-time" data-end-time="2026-04-01T02:59:59">计算中...</div>
//      <div class="activity-date">2026/03/01</div></div>`
// 只有 2 项；**没有活动名文本字段**（只能取立绘文件名）、剩余时间由页面 JS 现算（静态是「计算中...」）。
// `data-end-time` 是**不带时区**的 ISO → 按源站墙钟（国服 UTC+8）解释（**假设**，见 registry-b2.js）。
// ⚠️ 实测两项分别止于 2026-04-01 / 2026-04-07（页面静态计数「当前正在进行的活动有 0 个」）→ 当期无覆盖 → null。
function ns_bwiki_parseStellasoraEvents(html, tz = "Asia/Shanghai") {
	const out = [];
	const re = /<div class="activity-item">([\s\S]*?)<div class="activity-date"\s*>([^<]*)<\/div>/g;
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const block = m[1];
		const endIso = ns_bwiki_attrOf(block, "data-end-time");
		const startText = m[2].replace(/\s+/g, " ").trim();
		const alt = ns_bwiki_attrOf(block, "alt");
		const sp = ns_bwiki_parsePoints(startText)[0];
		const em = String(endIso).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
		if (!sp || !em) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, 0, 0, tz);
		const endTs = sourceInstant(+em[1], +em[2], +em[3], +em[4], +em[5], tz);
		if (!(endTs > startTs)) continue;
		out.push({
			_i: i++,
			event: ns_bwiki_cleanImgName(alt) || "活动",
			cat: "活动日历", img: ns_bwiki_cleanImgName(alt), imgRaw: alt,
			startTs, endTs, raw: `${startText} ~ ${endIso}`
		});
	}
	return out;
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
async function ns_bwiki_fetchHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy" });
}
// 物华弥新 国服 —— 卡池
async function ns_bwiki_gachaWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_gachaPayload(items, tz, ns_bwiki_nowOf(now));
}
// 物华弥新 国服 —— 活动
async function ns_bwiki_eventsWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
// 闪耀优俊少女 国服 —— 卡池（只用「已实装卡池」，预测只进 bannerHover 且标注为推算）
async function ns_bwiki_gachaUmaCn(url, signal, tz = "Asia/Shanghai", now) {
	const { live, predicted } = ns_bwiki_parseUmaCnGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	const n = ns_bwiki_nowOf(now);
	// 预测表只用来让夹具测试断言解析结果，**不进悬停**（见 ns_bwiki_umaCnPredictHover 的说明）
	return ns_bwiki_gachaPayload(live, tz, n);
}
// 赛马娘 日服 —— 活动（bwiki 侧；页面为「往期活动」归档）
async function ns_bwiki_eventsUmaJp(url, signal, tz = "Asia/Tokyo", now) {
	const { items, permanent } = ns_bwiki_parseUmaJpEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), permanent);
}
// 战双帕弥什 国服 —— 卡池（研发记录）
async function ns_bwiki_gachaZspms(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseZspmsGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 雪松 —— 卡池（台架测试占位页）
async function ns_bwiki_gachaKedr(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseKedrGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 卡厄斯梦境 国服 —— 卡池（页面为空，预期 null）
async function ns_bwiki_gachaCzn(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseCznGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 星塔旅人 国服 —— 活动（首页活动日历，低可用性）
async function ns_bwiki_eventsStellasora(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_eventPayload(ns_bwiki_parseStellasoraEvents(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bwiki-wikitext.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bwiki-wikitext.js
//
// 由 next-sources/parsers/bwiki-wikitext.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bwiki-wikitext__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bwiki-wikitext.js —— 批次 P8：三个 bwiki 来源的**wikitext 形态**解析器
//
// 本文件只装 P8 的三个来源（**不动** parsers/bwiki.js —— 那是 B2 的 `prop=text` HTML 形态）：
//   ① 战双帕弥什 zspms   —— 两步：SMW `action=ask` 索引 → 取最新「版本更新公告」→ `prop=wikitext` 正文
//   ② 卡厄斯梦境 czn     —— 一步：`Module:Gacha/data` 的 **Lua 表**（`prop=wikitext`）
//   ③ 雪松 kedrgame      —— 一步：`Template:首页游戏版本内容` 的 **模板调用**（`prop=wikitext`）
//
// 契约（与 CONVENTIONS.md / 插件 40-fetchers.js 完全一致）：
//   async (url, signal, tz, now = Date.now()) → 数据对象 | null
//     · 卡池侧 { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//     · 活动侧 { event, eventDates, eventDatesRaw, eventHover }
//   `now` 一律**第 4 个参数**（铁律 2：本仓库历史上把 now 放第二位 → `startTs <= now` 恒假 → 静默"未公布"）。
//   覆盖 now 的档期一条都没有 → **返回 null（未公布）**，绝不硬凑过期档期；结构性损坏才 throw。
//
// ══ 抓取证据（2026-10-02 实抓，夹具全部为真响应）══════════════════════════════
//   fixtures/p8-zspms-ask        HTTP 200 / 20,470B  SMW ask 命中 **40 条**，最新《远信回响》20260922
//   fixtures/p8-zspms-notice     HTTP 200 / 42,908B  parse.wikitext["*"] 正文 9,846B
//   fixtures/p8-czn-module       HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006）
//   fixtures/p8-kedr-template    HTTP 200 /  3,750B  `时间进度条` **5 条**
//   fixtures/p8-czn-record       HTTP 200 /    423B  备选页 `卡池记录`（模板调用 1 条，2026/03）
//
// ⚠️ bwiki 反爬（EdgeOne WAF）：请求发太密会被拦成 **HTTP 567**（≈7KB JS 挑战页、非 JSON、页内含 requestId）。
//    实测只带 UA 也能 200，**不是请求头问题** → 抓夹具要 6~10s 间隔 + 退避重试 + 校验 body 是 JSON
//    （见 test/capture-p8.mjs）。运行期若某侧抛 `bad-json`/`proxy-http-567`，那是 WAF，不是"未公布"。
//
// ══ 时区：三个来源一律 Asia/Shanghai（**均为推测**）═══════════════════════════
//   源站**都没有**时区标注。旁证：
//     · zspms 停服维护 05:00~11:00、卡池日切 05:00（国服特征）；公告尾部写「2026年9月22日」
//     · czn `10:00:00` 开池 / `02:00:00` 关池（国服作息）
//     · kedr 每期都在 `05:00` 换池（与 P6 的雪松社区页同款旁证）
//   故记"推测"，注册表注释里同样标注。
//
// ══ 「版本更新后」这类**相对起点**的锚点策略（重要，与任务书略有出入，理由在此）══
//   stellasora.js 的先例：相对起点没有绝对时刻 → 用**该公告的发布时间**当锚点 + 标 `startInferred: true`。
//   本文件沿用该精神（相对起点必须有据可依的锚点、必须标 inferred、绝不假造时刻），但锚点优先级更细：
//     ① 源站**自己写明的停服维护窗口**的结束时刻（`…将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
//        —— "版本更新后"就是维护结束之后，这是**源站原文给的绝对锚点**，比公告发布日期精确 2 天；
//     ② 兜底：公告 `{{公告|时间=YYYYMMDD}}` 字段（**= stellasora 先例的"公告发布时间"**，本夹具里是 20260922）；
//     ③ 再兜底：该相对点**自带的日期**（`2026年9月24日版本更新后`）按当日 00:00（防御性；只要正则匹配到相对点，
//        ② 的公告时间字段就一定存在，故这条实际到不了，保留以防字段被源站删除）。
//   三条路径**都**标 `startInferred: true`，并把推断依据留在**数据字段**（`startFrom`/`startRel`）与代码注释里。
//   ⚠️ 悬停**不写**推断依据（用户 2026-10-03：「悬停里的元信息彻底删掉」）——悬停只放名称/角色/档期，
//   与本体 buildPoolHover / buildEventHover 同格式（见下面 "当期挑选 / 悬停" 区域）。
//   （若坚持"一律用发布时间"，只需删掉 ns_bwiki_wikitext_zspmsMaintenanceWindow 的调用。兜底锚点行为不受悬停改动影响。）


//#region 通用：MediaWiki `prop=wikitext`（fetchMediaWikiText 只取 parse.text，这里要 parse.wikitext）
// 实测两种返回形态都要兼容：
//   · 本项目抓到的 bwiki 是 `{"parse":{"title":…,"wikitext":{"*":"正文"}}}`（对象包一层 `"*"`）
//   · 部分 MediaWiki（如 fgo.wiki 的某些配置）直接给字符串 → 也兼容
function ns_bwiki_wikitext_mediaWikiWikitext(json) {
	const p = json && json.parse;
	if (!p) return null;
	const wt = p.wikitext;
	if (typeof wt === "string") return wt;
	if (wt && typeof wt === "object" && typeof wt["*"] === "string") return wt["*"];
	return null;
}
// 带 Referer 请求（浏览器真实会带；bwiki 的 EdgeOne WAF 拦的主要是"频率"，但少一个 bot 信号没坏处）。
// ⚠️ 夹具测试不受影响：离线 harness 只读代理 URL 里的 `url` 参数，忽略 referer。
async function ns_bwiki_wikitext_fetchWikitext(url, signal, referer = "") {
	const json = await fetchJson(url, { referer, signal, mode: "proxy" });
	const wt = ns_bwiki_wikitext_mediaWikiWikitext(json);
	if (wt == null) throw new Error("bad-json");     // 含 missingtitle（HTTP 仍 200）→ 结构性损坏
	return wt;
}
//#endregion

//#region 通用：当期挑选 / 悬停
// ── 悬停排版（用户 2026-10-03 方案 A）────────────────────────────────────────
// 用户反馈「新增游戏的面板外显/悬停的样式、格式、规则和原来的差别很大」。本文件此前各写各的悬停，
// 三类偏差全中：① 首行塞元信息（来源站名/URL/SMW 时间/tz 推定/抓取条数/维护锚点）；
// ② 「档期在前、名称在后」；③ 自拼档期文本而非 fmtWindow。
// 修法：**排版一律交给 lib/env.js 的共用工具**（与本体 buildPoolHover / buildEventHover 逐字一致），
// 本区域只负责把解析结果映射成入参；悬停里**只剩** 名称/角色/档期。
// ⚠️ 元信息（来源站名、域名/URL、API/页面名、时区推定、抓取条数、内部 id、SMW 时间、起点锚点、
//    「起点推断」注记、游戏名+区服前缀、任何「（…）」实现说明）**直接删掉**，不搬家、不进任何字段。
//    实现说明只留在**代码注释**与数据字段（startInferred/startFrom/startRel）里，供测试与排查用。
function ns_bwiki_wikitext_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }
// 覆盖 now 的条目（起点/终点都有绝对时刻才进候选；缺任一端的不产出）
function ns_bwiki_wikitext_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.startTs != null && coversNow(it, now));
}
// 卡池条目 → `hoverPool` 入参。`name` = 池名原文（工具用它判空/兜底），`label` = 外显同构的「池名：角色」
// （逐字照本体调用方：src/client/30-parsers.js 的 selectArknights`label: `${it.banner}：${it.roles}``）。
// ⚠️ 战双的池名形如「时崎狂三狙击 / 命运时崎狂三狙击」——**原样**当池名用，不自己编角色名。
function ns_bwiki_wikitext_poolItem(x) {
	const name = String(x.banner == null ? "" : x.banner).trim();
	const roles = String(x.roles == null ? "" : x.roles).trim();
	return {
		name,
		label: roles ? `${name}：${roles}` : name,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw || ""
	};
}
// 活动条目 → `hoverEvent` 入参：显示的是**活动名**（不是「活动时间」这类标签）+ 档期。
function ns_bwiki_wikitext_eventItem(x, nameOf) {
	return { name: nameOf(x), startTs: x.startTs, endTs: x.endTs, raw: x.raw || "" };
}
// 卡池侧载荷。cmp 决定"外显"优先序；默认 = 结束最早优先（越快结束越该盯住，与 bwiki.js 同口径）。
// 悬停一律走共用 `hoverPool`：≥2 池 → 每池「池名：角色」行 + 档期行（窗口全同则只写一次档期）；
// **<2 池 → 不设 bannerHover**（交回 UI 的「banner：roles」⏎「档期」两行式兜底，与本体约定一致）。
function ns_bwiki_wikitext_gachaPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const hover = hoverPool(sorted.map(ns_bwiki_wikitext_poolItem), tz);
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	return out;
}
// 活动侧载荷。cmp 决定外显优先序；悬停列出**全部覆盖当期**的条目（按同一排序，**名称在前**）。
// 悬停一律走共用 `hoverEvent`（名称 + 3 空格 + 档期；不排序，由调用方排好）：
// **<2 条 → 不设 eventHover**（交回 UI 的「event」⏎「eventDates|raw」兜底）。
function ns_bwiki_wikitext_eventPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const nameOf = opts.nameOf || ((x) => x.name || x.event || "");
	const hover = hoverEvent(sorted.map((x) => ns_bwiki_wikitext_eventItem(x, nameOf)), tz, opts.permanentCount || 0);
	return {
		event: nameOf(first),
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
	};
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
const ns_bwiki_wikitext_ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ns_bwiki_wikitext_ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
function ns_bwiki_wikitext_zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

//#region 战双：SMW ask 索引
// 实测返回（fixtures/p8-zspms-ask）：
//   {"query-continue-offset":40,
//    "query":{"printrequests":[{"label":"标题",…},{"label":"时间",…}],
//             "results":{"《远信回响》版本更新公告":{"printouts":{"标题":["《远信回响》版本更新公告"],
//                                                              "时间":["20260922"]},
//                                                 "fulltext":"《远信回响》版本更新公告","fullurl":…,"namespace":0,"exists":"1"}},
//             "serializer":"SMW\\Serializers\\QueryResultSerializer","version":2,
//             "meta":{"hash":…,"count":40,"offset":0,…}}}
// ⚠️ `时间` 是**字符串** `"20260922"`（YYYYMMDD），**不是** SMW 的 timestamp 对象。
//    但仍做兼容：字符串 / 数组 / {timestamp} / {fulltext} 都吃。
function ns_bwiki_wikitext_smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_wikitext_smwText(v[0]);
	if (typeof v === "object") {
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// ask JSON → 按 `时间` 严格倒序的行 [{ page, title, time, fullurl }]
//   结构性损坏（无 query.results）→ 抛错；**0 条也抛错**：该查询依赖 `类别::版本`，
//   返回 0 条说明索引/属性坏了，绝不能静默降级成"未公布"（任务书明确要求）。
function ns_bwiki_wikitext_parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: ns_bwiki_wikitext_smwText(p["标题"]) || page,
			time: ns_bwiki_wikitext_smwText(p["时间"]),
			fullurl: (v && v.fullurl) || ""
		};
	});
	if (rows.length === 0) throw new Error("zspms-ask:no-result");
	rows.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
	return rows;
}
//#endregion

//#region 战双：正文 → 档期
// `{{颜色引用|红|2026年9月24日版本更新后 - 2026年11月5日05:00}}` —— 档期**写在模板参数里**，
// 所以必须先剥模板（保留内文），否则整段档期都看不见。处理顺序：
//   ① `{{颜色引用|<色>|<正文>}}` → 只留 <正文>（档期就在这里）  ② `{{公告|…}}` 信息模板 → 整块丢弃（时间另取）
//   ③ 其它无参/单参模板 → 无参丢、有参留最后一个参数   ④ `'''` 粗体标记 → 去掉
//   ⑤ `[[file:…]]` → 去掉   ⑥ `<br>`/块级标签 → 换行（正文是 `<br>` 分行写的）
//   ⑦ 标题 `==X==` → 独立行，并打上 `\u0001H<level>\u0001` 前缀（后面要靠标题栈取活动名）
function ns_bwiki_wikitext_zspmsNormalize(wikitext) {
	let s = String(wikitext == null ? "" : wikitext);
	s = s.replace(/\{\{颜色引用\s*\|[^|{}]*\|([\s\S]*?)\}\}/g, "$1");
	s = s.replace(/\{\{公告[\s\S]*?\}\}/g, "");
	s = s.replace(/\{\{[^{}]*\}\}/g, (m) => { const i = m.lastIndexOf("|"); return i < 0 ? "" : m.slice(i + 1, -2); });
	s = s.replace(/'''/g, "");
	s = s.replace(/\[\[(?:file|File|文件)\s*:[^\]]*\]\]/g, "");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/?(?:hr|center|div|p|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/?(?:b|i|u|span|small|big|font|sup|sub)\b[^>]*>/gi, "");
	s = s.replace(/&nbsp;/gi, " ");
	// ⚠️ 标题必须**整行**匹配（加 m + ^$）：否则表格行 `{| class="wikitable" style="…"` 里的两个 `=`
	//    会被当成一级标题，往标题栈里塞一个假标题。
	s = s.replace(/^(={1,6})\s*([^=\n]+?)\s*\1\s*$/gm, (m, eq, title) => `\u0001H${eq.length}\u0001${title}`);
	return s;
}

// 停服维护窗口（源站原文，例：`我们将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
// 只在含「停服维护/停机维护」的那一行里找 `YY…MM…DD HH:MM - HH:MM`（终点可省日期）。
function ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const line = String(text == null ? "" : text).split("\n").find((l) => /停服维护|停机维护|维护更新/.test(l) && /\d{4}\s*年/.test(l));
	if (!line) return null;
	const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(line);
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const startTs = sourceInstant(y, mo, d, +m[4], +m[5], tz);
	let endTs = sourceInstant(y, mo, d, +m[6], +m[7], tz);
	if (endTs <= startTs) endTs = sourceInstant(y, mo, d + 1, +m[6], +m[7], tz);   // 跨零点的维护（如 22:00-02:00）
	if (!(endTs > startTs)) return null;
	const raw = `${y}-${pad2(mo)}-${pad2(d)} ${pad2(+m[4])}:${m[5]} - ${pad2(+m[6])}:${m[7]}`;
	return { startTs, endTs, raw };
}

// 中文年月日「起点 - 终点」窗口（源站墙钟原文形态）：
//   `2026年9月24日版本更新后 - 2026年11月5日05:00`（相对起点）
//   `2026年9月29日10:00 - 2026年11月3日23:59`（双端显式时刻）
//   `2026年9月24日 - 2026年10月1日`（双端只有日期 → 起点 00:00 / 终点 23:59）
// ⚠️ 内部空白只用 `[ \t]`（**不许跨行**）：否则维护段 `9月24日05:00 - 11:00` 会跟下一行的日期拼成假窗口。
const ns_bwiki_wikitext__SP = "[ \\t]*";
const ns_bwiki_wikitext__CN_DATE = "(\\d{4})" + ns_bwiki_wikitext__SP + "年" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "月" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "日";
const ns_bwiki_wikitext__CN_TIME = "(\\d{1,2})" + ns_bwiki_wikitext__SP + "[:：]" + ns_bwiki_wikitext__SP + "(\\d{2})";
const ns_bwiki_wikitext__CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const ns_bwiki_wikitext__CN_WIN_SRC = ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + "|" + ns_bwiki_wikitext__CN_REL + ")?" + ns_bwiki_wikitext__SP + "[-–—－~～至到]" + ns_bwiki_wikitext__SP
	+ ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const ns_bwiki_wikitext__GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function ns_bwiki_wikitext_cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
function ns_bwiki_wikitext_zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: ns_bwiki_wikitext_cleanHead(m[2]) });
	});
	return out;
}
function ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !ns_bwiki_wikitext__GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const ns_bwiki_wikitext__ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function ns_bwiki_wikitext_zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function ns_bwiki_wikitext_zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
function ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = ns_bwiki_wikitext_zspmsNormalize(raw);
	const maint = ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = ns_bwiki_wikitext_zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(ns_bwiki_wikitext__CN_WIN_SRC, "g");
	let m;
	while ((m = re.exec(text))) {
		// —— 起点：显式时刻 > 相对锚点（① 源站维护结束时刻 → ② 公告时间字段[stellasora 先例] → ③ 自带日期）
		//    三条相对锚点路径都标 startInferred=true，并把依据写进 startFrom（hover 会如实显示）
		let startTs, startInferred = false, startFrom = "", startRel = "";
		if (m[4] != null) {
			startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		} else if (m[6] != null) {
			startRel = m[6];
			startInferred = true;
			if (maint && maint.endTs != null) { startTs = maint.endTs; startFrom = `源站维护窗口 ${maint.raw} 的结束时刻`; }
			else if (annDate) { startTs = sourceInstant(annDate.y, annDate.mo, annDate.d, 0, 0, tz); startFrom = `公告时间 ${timeField}`; }
			else { startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz); startFrom = `自带日期 ${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`; }
		} else {
			startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz);
			startInferred = true;
			startFrom = "源站只给日期，起点按 00:00";
		}
		// —— 终点（缺时刻按 23:59）
		const endTs = m[10] != null
			? sourceInstant(+m[7], +m[8], +m[9], +m[10], +m[11], tz)
			: sourceInstant(+m[7], +m[8], +m[9], 23, 59, tz);
		if (!(endTs > startTs)) { skipped++; continue; }             // 源站错行 → 丢弃，不硬造

		// —— 行上下文（分类 + 池名 + 活动名都只看本行）
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		let lineEnd = text.indexOf("\n", m.index);
		if (lineEnd < 0) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd);
		const lineIdx = text.slice(0, lineStart).split("\n").length - 1;
		const isPool = /研发池/.test(line);
		const base = {
			_i: items.length,
			startTs, endTs,
			raw: m[0],
			startInferred, startFrom, startRel,
			line: line.trim()
		};
		if (isPool) {
			const pools = ns_bwiki_wikitext_zspmsPools(line);
			const role = ns_bwiki_wikitext_zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = ns_bwiki_wikitext__ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const ns_bwiki_wikitext__ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
function ns_bwiki_wikitext_zspmsEventTier(x) { return ns_bwiki_wikitext__ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function ns_bwiki_wikitext_zspmsEventCmp(a, b) {
	return (ns_bwiki_wikitext_zspmsEventTier(a) - ns_bwiki_wikitext_zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
// ⚠️ 原先这里有个 zspmsHeader()：往悬停首行拼「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8
//    为推测；起点锚点=源站维护结束 …）」。按方案 A **整段删除**（元信息不进悬停，也不搬到别的字段）。
//    公告标题/SMW 时间/维护窗口仍是**数据字段**（announceTime / anchor / startFrom），解析逻辑不变。

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
async function ns_bwiki_wikitext_zspmsLatestNotice(url, signal) {
	const rows = ns_bwiki_wikitext_parseZspmsAsk(await fetchJson(url || ns_bwiki_wikitext_ZSPMS_ASK_URL, { referer: ns_bwiki_wikitext_ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(ns_bwiki_wikitext_zspmsParseUrl(row.page), signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	return { row, rows, wikitext };
}
async function ns_bwiki_wikitext_gachaZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = Date.now()) {
	// `row`（ask 索引行）仍要传给解析器：`{{公告|时间=…}}` 缺失时用它兜底相对起点的锚点。
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
async function ns_bwiki_wikitext_eventsZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = Date.now()) {
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
const ns_bwiki_wikitext_CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
const ns_bwiki_wikitext_CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_RECORD_PAGE = "卡池记录";
const ns_bwiki_wikitext_CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
function ns_bwiki_wikitext_cznStamp(text) {
	const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ \t]+(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*[:：]\s*(\d{2}))?\s*$/.exec(String(text == null ? "" : text));
	if (!m) return null;
	const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// Lua 表 → 6 期 [{ id, type, char, startTs, endTs, raw }]
// 实测形态（fixtures/p8-czn-module，999B，6 期）：
//   return { ["0001"] = { type = "主战员营救概率提升", start_date = "2026-5-28 10:00:00",
//                          end_date = "2026-6-17 02:00:00", link_char = "绯", }, … }
function ns_bwiki_wikitext_parseCznLua(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = ns_bwiki_wikitext_cznStamp(f.start_date), b = ns_bwiki_wikitext_cznStamp(f.end_date);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;                       // 源站错行 → 丢弃
		items.push({
			_i: items.length,
			id: m[1],
			type: f.type || "",
			char: f.link_char || "",
			startTs, endTs,
			raw: `${f.start_date} ~ ${f.end_date}`
		});
	}
	if (items.length === 0) throw new Error("czn-lua:no-entry");   // 结构变了（Lua 表被改/页面空）→ 抓取失败
	return items;
}
// 备选页 `卡池记录`（**只有 1 条**模板调用，2026/03，已过期；本文件只导出纯函数，不挂抓取器）：
//   {{Gacha|id=TEST|title=小春概率UP|type=救援概率UP|Start_Date=2026/03/22 8:59:00|End_Date=2026/03/27 8:59:00|UP=小春|banner=…}}
function ns_bwiki_wikitext_parseCznRecord(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const callRe = /\{\{\s*Gacha\s*\|([\s\S]*?)\}\}/g;
	let m;
	while ((m = callRe.exec(src))) {
		const f = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			f[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		const a = ns_bwiki_wikitext_cznStamp(f["Start_Date"]), b = ns_bwiki_wikitext_cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			cat: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
// ⚠️ 原先此处给 `ns_bwiki_wikitext_gachaPayload` 传了 header「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」
//    —— 那是悬停元信息（来源站名 / API 名 / 抓取条数 / 时区推定），按方案 A **整段删除**。
//    Lua 表页名/期数仍是**数据**（ns_bwiki_wikitext_CZN_MODULE_PAGE / items.length），注释与注册表里都有，不进悬停。
async function ns_bwiki_wikitext_gachaCzn(url, signal, tz = ns_bwiki_wikitext_CZN_TZ, now = Date.now()) {
	const items = ns_bwiki_wikitext_parseCznLua(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_CZN_MODULE_URL, signal, ns_bwiki_wikitext_CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return ns_bwiki_wikitext_gachaPayload(items, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
const ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
function ns_bwiki_wikitext_kedrTemplateUrl(page = ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_KEDR_TEMPLATE_URL = ns_bwiki_wikitext_kedrTemplateUrl();
const ns_bwiki_wikitext_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
function ns_bwiki_wikitext_kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
function ns_bwiki_wikitext_kedrStamp(text) { return ns_bwiki_wikitext_cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
function ns_bwiki_wikitext_kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
function ns_bwiki_wikitext_kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (ns_bwiki_wikitext_kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
function ns_bwiki_wikitext_kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
function ns_bwiki_wikitext_parseKedrTemplate(wikitext, tz = ns_bwiki_wikitext_KEDR_TZ) {
	const calls = ns_bwiki_wikitext_kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = ns_bwiki_wikitext_kedrStamp(p["开始时间"]), b = ns_bwiki_wikitext_kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (ns_bwiki_wikitext_kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: ns_bwiki_wikitext_kedrRoleFromName(name) });
		else if (ns_bwiki_wikitext_kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
// ⚠️ 原先这里有个 _KEDR_HEADER：「雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，
//    活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）」——悬停元信息（来源站名/页面名/分流口径/时区推定），
//    按方案 A **整段删除**（分流规则仍在 ns_bwiki_wikitext_kedrIsGacha / ns_bwiki_wikitext_kedrIsEvent 的注释里）。
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
async function ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = Date.now()) {
	const { gacha } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_gachaPayload(gacha, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
async function ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = Date.now()) {
	const { event } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_eventPayload(event, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-kedr-wiki.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-kedr-wiki.js
//
// 由 next-sources/parsers/kedr-wiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_kedr-wiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-kedr-wiki.js —— 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 契约：async (url, signal, tz, now = Date.now()) → { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover } | null
//
// ⚠️ **这是社区 wiki，不是官方源**：雪松（Кедр / kedrgame，俄语"雪松"）**官方源未找到**
//    （调研结论见 `dsh-gacha-calendar-新增来源第二轮调研-2026-10-02.md` §5：官方无公告 API，
//      bwiki 的 `page=卡池信息` 又是「台架测试」占位页）→ 本来源是**社区结构化页**，`kind: "wiki"`。
//    稳定性弱于官方 API：页面随时可能被社区改写/停更。
//
// ══ 实测形态（2026-10-02 抓夹具 fixtures/p6-kedr-archive，HTTP 200 / 17,298 B）══
//   GET https://wiki.biligame.com/kedrgame/api.php?action=parse&page=<percent-encoded>&prop=text&format=json&formatversion=2
//   （页名 `往期动员【常驻】—1.0.0—` **必须 percent-encode 后再拼 URL**，见 ns_kedr_wiki_kedrParseUrl）
//   → 标准 MediaWiki `{ parse:{ title, pageid, text } }`，`text` 是 16,516 B 的 HTML。
//
//   ⚠️ **与任务书假设不同：该页没有任何 `<table>`（实测 0 张）**，所以不存在"表格档期抽取"。
//      真实结构是「每个小节一段档期 + 若干可折叠卡池面板」：
//        <h1><span class="mw-headline" id="1.0.0-1"><b>1.0.0-1</b></span>…[编辑]</h1>
//        <div …><p><big>
//          <b>开始时间：2026-06-22-12:00<br /></b>
//          <b>结束时间：2026-06-29-05:00<br /></b>
//        </big></p>
//        <div class="panel panel-info"><div class="panel-heading">…<span>卡池:精英集结·指挥</span>…展开/折叠
//          <div class="panel-body…"><p>角色：<a title="安吉拉">安吉拉</a><br />职业：指挥<br />卡池：【<a …>精英集结·指挥</a>】…
//      要点：① 档期不是一行"起 ~ 止"，而是**开始时间 / 结束时间 两行**（各带 `<br />`）→ 要配对；
//            ② 时间戳形态是 `YYYY-MM-DD-HH:MM`（日期与时刻之间**又多一个连字符**，非标准写法）；
//            ③ 小节标题在 `<h1>` 里，4 节 = `1.0.0-1` ~ `1.0.0-4`；
//            ④ 每节 2 个卡池（`卡池:` 出现在折叠面板标题上），`角色：` 后是 UP 角色（安克文本即名字）。
//      ⇒ 解析器按 `<h1>` 切节（下面 ns_kedr_wiki_kedrSections），节内配对两个时间戳 + 收集卡池/角色。
//
// ══ 时区 Asia/Shanghai（**推测**，源站未标注）══
//   页面正文没有任何时区字样。两条旁证支持国服 UTC+8：① 每期 `结束时间` 都落在 **05:00**
//   （国服常见的每日 05:00 日切点）；② 起始是 `12:00`（中午开池）。**未经源站声明**，故记"推测"。
//
// ══ 「往期动员」是**归档页**（重要）══
//   页面标题即「往期」：实测 4 期全部落在 2026-06-22 ~ 2026-07-20（抓取时刻 2026-10-02 已全部结束）
//   → 抓取器在"当期"语义下会**如实返回 null（未公布）**，而不是硬凑一个过期档期。
//   若社区把当期动员也挂到同一页/同款结构，本解析器无需改动即可产出。
//
// ══ bwiki 反爬（抓夹具时必看）══
//   高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 ~7KB 挑战页、**不是 JSON**）
//   → 抓夹具要限速 30s 重试，并**校验 body 是不是 JSON**（否则会把挑战页存成夹具）。
//   本次抓取两次请求都是 HTTP 200 + 合法 JSON（无触发）。`fetchMediaWikiText` 对坏 JSON 会抛
//   `bad-json` → 属"该侧抓取失败"，不会被当成"未公布"。


const ns_kedr_wiki_KEDR_API = "https://wiki.biligame.com/kedrgame/api.php";
const ns_kedr_wiki_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";
const ns_kedr_wiki_KEDR_ARCHIVE_PAGE = "往期动员【常驻】—1.0.0—";
// 推测：国服 UTC+8（源站未标注；旁证见文件头）
const ns_kedr_wiki_KEDR_TZ = "Asia/Shanghai";

// ⚠️ 页名必须 encodeURIComponent 后再拼（与 fgo.js 的 fgoParseUrl 同做法）：
//    registry-p6.js 里的 URL 必须用这同一个函数构造，否则离线夹具（test/map.json 的整串键）命中不到。
function ns_kedr_wiki_kedrParseUrl(page) {
	return `${ns_kedr_wiki_KEDR_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_kedr_wiki_KEDR_ARCHIVE_URL = ns_kedr_wiki_kedrParseUrl(ns_kedr_wiki_KEDR_ARCHIVE_PAGE);

//#region 结构解析
// 按 <h1>…</h6> 切节；节标题取 `<span class="mw-headline">`（退回去标签后的文本），并去掉 `[编辑]`
//   ⚠️ 页首的目录标题 `<h2 id="mw-toc-heading">目录</h2>` 也是 heading → 显式排除（否则小节数虚高）
function ns_kedr_wiki_kedrSections(html) {
	const s = String(html == null ? "" : html);
	const heads = [];
	const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
	let m;
	while ((m = re.exec(s)) !== null) {
		if (/mw-toc-heading/.test(m[2])) continue;
		const inner = m[3];
		const hl = /<span[^>]*class="mw-headline"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
		const title = stripTags(hl ? hl[1] : inner)
			.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
			.replace(/\s+/g, " ")
			.trim();
		heads.push({ level: +m[1], title, start: m.index, bodyStart: re.lastIndex });
	}
	return heads.map((h, i) => ({
		title: h.title,
		level: h.level,
		html: s.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : s.length)
	}));
}
// `开始时间：2026-06-22-12:00` / `结束时间：2026-06-29-05:00`
//   ⚠️ 源站的时间戳是 `YYYY-MM-DD-HH:MM`（日期与时刻之间再多一个连字符）→ 分隔符放宽
const ns_kedr_wiki_STAMP_BODY = "(\\d{4})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\s]\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
function ns_kedr_wiki_kedrStamp(sectionHtml, label) {
	const re = new RegExp(label + "\\s*[:：][\\s\\S]{0,40}?" + ns_kedr_wiki_STAMP_BODY);
	const m = re.exec(String(sectionHtml == null ? "" : sectionHtml));
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi, text: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}-${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}
// 节内卡池名：`卡池:精英集结·指挥`（折叠面板标题上）；正文里 `卡池：【<a…>…】` 形态由
// 排除 `<`/`【`/`】` 的字符类天然跳过，不会重复取到。去重保序。
function ns_kedr_wiki_kedrPools(sectionHtml) {
	return [...String(sectionHtml == null ? "" : sectionHtml).matchAll(/卡池\s*[:：]\s*([^<【】\n]{1,24})/g)]
		.map((m) => m[1].replace(/\s+/g, " ").trim())
		.filter((x, i, a) => x && a.indexOf(x) === i);
}
// 节内 UP 角色：`角色：<a …>安吉拉</a><br />` → 取到第一个 <br>/</p> 之前的内容去标签
function ns_kedr_wiki_kedrRoles(sectionHtml) {
	const out = [];
	const re = /角色\s*[:：]([\s\S]{0,200}?)(?:<br\s*\/?>|<\/p>|$)/gi;
	let m;
	while ((m = re.exec(String(sectionHtml == null ? "" : sectionHtml))) !== null) {
		const t = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (t && !out.includes(t)) out.push(t);
		if (m[0] === "") re.lastIndex++;
	}
	return out;
}

// 页面 HTML → { sectionTitles, items:[{section,pools,roles,startTs,endTs,raw}], skipped }
//   结构性损坏（没有任何小节）→ 抛错（该侧算抓取失败），与 bwiki.js 的 no-table 同口径。
function ns_kedr_wiki_parseKedrArchive(html, tz = ns_kedr_wiki_KEDR_TZ) {
	const sections = ns_kedr_wiki_kedrSections(html);
	if (sections.length === 0) throw new Error("kedr-wiki:no-section");
	const items = [];
	let skipped = 0;
	sections.forEach((sec, i) => {
		const a = ns_kedr_wiki_kedrStamp(sec.html, "开始时间");
		const b = ns_kedr_wiki_kedrStamp(sec.html, "结束时间");
		if (!a || !b) { skipped++; return; }                      // 缺档期的小节（如纯说明节）→ 跳过
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }            // 源站错行 → 丢掉，不硬造
		items.push({
			_i: i,
			section: sec.title || `第 ${i + 1} 节`,
			pools: ns_kedr_wiki_kedrPools(sec.html),
			roles: ns_kedr_wiki_kedrRoles(sec.html),
			startTs, endTs,
			// raw：两端都是源站原文（`YYYY-MM-DD-HH:MM`），中间的 `~` 是本解析器拼的（源站分行写）
			raw: `${a.text} ~ ${b.text}`
		});
	});
	return { sectionTitles: sections.map((s) => s.title), items, skipped };
}
//#endregion

//#region 抓取器
// 当期 = 窗口覆盖 now 的那一节（取结束最早，并列按页面顺序）；没有覆盖 → null（未公布）
async function ns_kedr_wiki_gachaKedrWiki(url, signal, tz = ns_kedr_wiki_KEDR_TZ, now = Date.now()) {
	const html = await fetchMediaWikiText(url || ns_kedr_wiki_KEDR_ARCHIVE_URL, { referer: ns_kedr_wiki_KEDR_REFERER, signal, mode: "proxy" });
	const parsed = ns_kedr_wiki_parseKedrArchive(html, tz);
	const act = parsed.items
		.filter((x) => coversNow(x, now))
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.x._i - b.x._i))
		.map((o) => o.x);
	if (act.length === 0) return null;
	const first = act[0];
	// ⚠️ 2026-10-03 改：这里原本手搓悬停，且三处不合规 ——
	//   ① 头行 `${KEDR_ARCHIVE_PAGE}（bwiki 社区页，非官方源；tz=UTC+8 为推测）` = 来源名 + 可信度说明 + 时区推定
	//      （「社区页 / 非官方 / tz 为推测」这类信息应写在**来源声明**里：条目 tz 字段 + 设置页来源标签）
	//   ② 行格式是 `档期   节名`（**档期在前**），本体一律「池名 ⏎ 档期」
	//   ③ 自带排版实现（没走共用 hoverPool）
	// 现在改用共用 hoverPool。
	const hover = hoverPool(act.map((x) => ({
		name: `${x.section}${x.pools.length ? `（${x.pools.join(" / ")}）` : ""}`,
		startTs: x.startTs,
		endTs: x.endTs
	})), tz);
	return {
		banner: first.pools.length ? `${first.section}（${first.pools.join(" / ")}）` : first.section,
		roles: first.roles.join("、"),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw,
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
//#endregion

// src/client/42-parsers-biligame.js —— biligame 官方公告系（物华弥新 / 闪耀优俊少女 / 嘟嘟脸恶作剧）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-biligame-announce.js    嘟嘟脸恶作剧（biligame 官方公告）
//      · 42-parsers-biligame-activity.js    物华弥新 / 闪耀优俊少女（biligame 官方公告）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-biligame-announce.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-biligame-announce.js
//
// 由 next-sources/parsers/biligame-announce.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_biligame-announce__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-biligame-announce.js —— 嘟嘟脸恶作剧 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 卡池侧：{ banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   两侧都读**同一份官方公告**（同 bandori.js：一份公告里既有活动档期也有招募档期）。
//
// ══ 实测形态（2026-10-02 抓夹具：fixtures/p6-ddlezj-list、fixtures/p6-ddlezj-detail）══
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50
//   → { request_id, data:[13 条], totalNum:13, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断，末尾 `...`) }
//   ⚠️ 三处实测细节（都与 bandori 同款 API 的表现不同，别照抄结论）：
//     ① 本游戏列表**本身就按时间倒序**（13 条严格递减）；bandori 那批是"置顶公告打乱顺序"。
//        仍然自行排序：排序键 = `displayTime || ctime`（字符串比较，形如 `YYYY-MM-DD HH:MM:SS`）。
//     ② **5/13 条没有 displayTime**（17631 / 17429 / 17244 / 16948 / 16947）→ 必须退到 ctime。
//     ③ 列表里的 content 是**截断**的 → 正文只能抓详情 /news/{id}。
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   ⚠️ `/news/17825` 的 data 里 `gameExtensionId=1282` + `site=嘟嘟脸恶作剧` —— 这是扩展 id 的
//      **第二重独立印证**（第一重：官网页面的网络请求自身就带 gameExtensionId=1282）。
//      参数空间实测：positionId 只有 `2` 有数据；typeId=1 主公告(13) / 2 预约(1) / 3~8 空。
//
// ══ 正文结构（HTML 富文本：169 个 <p> / 41 个 <br>）══
//   每个 <p> 是一个逻辑单元，**标题与档期经常各占一个 <p>**：
//     <p>一、主题剧院【凝聚滴落的回忆之池】</p>
//     <p>活动时间：2026/04/23 &nbsp;维护后 - 2026/05/07 09:59</p>
//     <p>③梦境之地</p>
//     <p>活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)</p>
//     <p>三、招募UP中 使徒招募 ①精选使徒招募【积极心态】雨伊 活动时间：…  ← 标题与档期同段</p>
//   `textOf()` 会把 `<br>` 换成换行、把 `</p><p>` 换成**空格** → 用 textOf 的"行"会把同段多个
//   `<p>` 粘成一长行（夹具里就是这样）。所以本解析器**按 `</p>` 切段**再净化
//   （与 fgo.js / bwiki.js 自写 HTML 工具的做法一致），段内再把空白压平。
//
// ══ 时区：条目 tz = "+540"（UTC+9 固定偏移）—— **源站原文标 UTC+9，不是我们换算的** ══
//   正文里 `(UTC+9)` 出现 **4 处**，例如：
//     `活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)`
//   这是**源站原文**。国服公告却用日本时区，**属源站如此**（本项目不改源站口径）。
//   另有大量档期**不带后缀**（`活动时间：2026/04/30 10:00 - 2026/05/07 10:59`），但同一份公告里
//   同一天的收尾时刻与带后缀的严格一致（七、艾利亚斯边境 活动时间收尾 `05-07 10:59`
//   ↔ 同节 BOSS登场时间 `2026/05/07 10:59 (UTC+9)`）→ 整份公告统一按 UTC+9 解释。
//   raw 字段里保留源站**是否写了后缀**（写了就带上），不做任何改写。
//
// ══ 「维护后」不猜时刻（任务书明确要求：抽不到就返回 null）══
//   大量档期写作 `2026/04/23 维护后 - 2026/05/07 09:59`：起点只有"维护后"、**没有钟点**。
//   公告的 displayTime 是**发布时刻**（17825 = 2026-04-27 12:00），不等于该次维护的结束时刻
//   （维护发生在 04-23）→ 用它补齐会把窗口起点写错。故：**起点无钟点的档期一律不产出**
//   （计入 `skippedNoTime`，只在 hover 里如实说明），绝不硬凑。
//   同一份公告里所有档期都抽不出"覆盖当前时刻"的窗口 → 抓取器返回 null（未公布）。


const ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID = 1282;
const ns_biligame_announce_DDLEZJ_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50";
// 条目 tz：源站正文自标 (UTC+9)，故用固定偏移分钟数 "+540"（≡ Asia/Tokyo，无夏令时）
const ns_biligame_announce_DDLEZJ_TZ = "+540";
// ⚠️ 只有公告**正文档期**用 UTC+9；列表/详情里的 displayTime|ctime 是 B 站 CMS 的**发布时刻**，
//    实测口径是国服 UTC+8（**推测**，源站未标注）→ 单独一个常量，只用于 dateTs（排序/诊断）。
//    排序键本身是原始字符串，窗口换算完全不受它影响。
const ns_biligame_announce_DDLEZJ_CMS_TZ = "Asia/Shanghai";
const ns_biligame_announce_DDLEZJ_HOME = "https://game.bilibili.com/trickcal/news/";
// 一条公告最多往下抓几篇详情（公告很稀疏：全站只有 13 篇）
const ns_biligame_announce_DETAIL_LIMIT = 6;


//#region 列表
// 列表条目 → [{ id, title, displayTime, ctime, mtime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_announce_parseDdlezjList(json) {
	if (!json || typeof json !== "object") throw new Error("ddlezj-bad-json");
	if (json.code !== 0) throw new Error("ddlezj-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("ddlezj-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测 5/13 条没有 displayTime → 退 ctime
			return {
				id: x.id,
				title: decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				mtime: x.mtime || "",
				sortKey,
				dateTs: ns_biligame_announce_parseDdlezjDate(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}
// "2026-06-22 14:21:07"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_announce_parseDdlezjDate(s, tz = ns_biligame_announce_DDLEZJ_CMS_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
function ns_biligame_announce_ddlezjDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_announce_DDLEZJ_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}
//#endregion

//#region 正文 → 段落
// 按 </p> 切段（标题/档期各占一段，或同段）：去标签 + 还原实体 + 空白压平
function ns_biligame_announce_ddlezjParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => htmlText(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 档期抽取
// 段落里的「标签：起 - 止[(UTC±N)]」。要点：
//   · 标签限定 2~12 个非空白非冒号字符（`活动时间` / `商店兑换时间` / `BOSS登场时间` / `投票收件`…）
//   · 起止都必须是 **带 4 位年份** 的日期（能滤掉正文里 `04/30 03:00` 这种裸月日）
//   · 起点的钟点可缺（`维护后`）→ 仍匹配上来，但由调用方判定为"抽不到"并跳过
//   · 终点必须带钟点
// 分段拼装（一条大正则手写括号极易出错）：组序 = 1 标签 / 2 起 / 3 起后缀 / 4 止 / 5 止后缀
//   ⚠️ 后缀必须在**捕获组之外**：否则 `2026/05/07 09:59 (UTC+9)` 会被整段当成"止"，
//      再送去解析时刻就必然失败（第一版就踩了这个坑，4 条 (UTC+9) 档期全被误判成"抽不到"）。
const ns_biligame_announce_RE_LABEL = "[^\\s：:]{2,12}";
const ns_biligame_announce_RE_DATE = "\\d{4}\\s*[/\\-.]\\s*\\d{1,2}\\s*[/\\-.]\\s*\\d{1,2}";
const ns_biligame_announce_RE_TIME = "\\d{1,2}\\s*[:：]\\s*\\d{2}";
const ns_biligame_announce_RE_UTC = "UTC[+-]\\d{1,2}";
const ns_biligame_announce_RE_START = `(${ns_biligame_announce_RE_DATE}(?:\\s*(?:${ns_biligame_announce_RE_TIME}|维护后))?)(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_RE_END = `(${ns_biligame_announce_RE_DATE}\\s*${ns_biligame_announce_RE_TIME})(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_WIN_RE = new RegExp(
	`(${ns_biligame_announce_RE_LABEL})[：:]\\s*${ns_biligame_announce_RE_START}\\s*(?:~|～|至|到|-|–|—)\\s*${ns_biligame_announce_RE_END}`,
	"g"
);
const ns_biligame_announce_STAMP = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
function ns_biligame_announce_parseDdlezjStamp(s) {
	const m = ns_biligame_announce_STAMP.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// 段落里的标题段：`一、…` / `① …` / 小标题 `使徒招募` `卡片扭蛋` / 纯括号名 `【冒险通行证】`
//   （实测：`九、通行证` 与 `【冒险通行证】` 各占一段，不把后者当小标题就会两期都叫「九、通行证」）
const ns_biligame_announce_HEAD_SEC = /^[一二三四五六七八九十百]+\s*[、.．]/;
const ns_biligame_announce_HEAD_ITEM = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]/;
const ns_biligame_announce_HEAD_SUB = /^(使徒招募|卡片扭蛋)$/;
const ns_biligame_announce_HEAD_PURE = /^【[^】]{1,12}】$/;
// 段内标题（档期与标题同段时用）：取最后 1~2 个空白分词，滤掉长描述句
function ns_biligame_announce_pickTitle(prefix, fallback) {
	const toks = String(prefix || "").split(/\s+/).filter(Boolean);
	const ok = (t) => {
		const s = String(t).replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		return s && s.length <= 22 && !/[。，,！!？?；;]/.test(s) ? s : "";
	};
	for (let i = toks.length - 1; i >= 0 && i >= toks.length - 2; i--) {
		const s = ok(toks[i]);
		if (!s) continue;
		// 末段过短（如 `【冒险通行证】`）→ 与上一段拼起来，名字更完整
		if (s.length <= 7 && i > 0) {
			const p = ok(toks[i - 1]);
			if (p) return p + " " + s;
		}
		return s;
	}
	return String(fallback || "").trim();
}
// 招募/扭蛋 = 卡池侧；其余 = 活动侧（与 bandori.js 的 GACHA_SEC_RE 同口径）
const ns_biligame_announce_GACHA_RE = /招募|扭蛋|卡池|精选/;

// 正文 HTML → { items:[{name,label,startTs,endTs,suffix,raw,kind}], skippedNoTime:[…] }
//   kind: "gacha" | "event"；suffix: 源站原文里的 `UTC+9`（没写就是 ""）
function ns_biligame_announce_parseDdlezjAnnouncement(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	const paragraphs = ns_biligame_announce_ddlezjParagraphs(html);
	const items = [];
	const skippedNoTime = [];
	let current = "";                                  // 最近的标题段
	for (const para of paragraphs) {
		ns_biligame_announce_WIN_RE.lastIndex = 0;
		let m, hadWindow = false;
		while ((m = ns_biligame_announce_WIN_RE.exec(para)) !== null) {
			hadWindow = true;
			const label = m[1];
			const startText = m[2].trim();
			const endText = m[4].trim();
			const suffix = m[5] || m[3] || "";         // (UTC+9) 写在起或止之后都认
			const name = ns_biligame_announce_pickTitle(para.slice(0, m.index), current);
			const raw = `${startText} ~ ${endText}${suffix ? ` (${suffix})` : ""}`;
			if (m[0] === "") ns_biligame_announce_WIN_RE.lastIndex++;
			// 起点无钟点（`维护后`）→ 不猜，如实记入 skippedNoTime
			if (!/\d\s*[:：]\s*\d{2}\s*$/.test(startText)) {
				skippedNoTime.push({ name, label, raw });
				continue;
			}
			const a = ns_biligame_announce_parseDdlezjStamp(startText);
			const b = ns_biligame_announce_parseDdlezjStamp(endText);
			if (!a || !b) { skippedNoTime.push({ name, label, raw }); continue; }
			const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
			const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
			if (!(endTs > startTs)) continue;          // 源站错行 → 丢掉，不硬造
			items.push({
				name: name || label,
				label,
				startTs, endTs,
				suffix,
				raw,
				kind: ns_biligame_announce_GACHA_RE.test(name) ? "gacha" : "event"
			});
		}
		if (hadWindow) continue;
		if (ns_biligame_announce_HEAD_SEC.test(para) || ns_biligame_announce_HEAD_ITEM.test(para) || ns_biligame_announce_HEAD_SUB.test(para) || ns_biligame_announce_HEAD_PURE.test(para)) {
			current = para.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		}
	}
	return { items, skippedNoTime, paragraphs };
}
// 纯函数便捷入口：只要窗口（不含标题推断结果里的 kind 之外的加工）
function ns_biligame_announce_parseDdlezjWindows(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	return ns_biligame_announce_parseDdlezjAnnouncement(html, tz).items;
}
//#endregion

//#region 选当期（覆盖 now；不覆盖 → null，不硬凑过期档期）
// 卡池：覆盖当前的招募档里取**结束最早**的（越快结束越该盯住，与插件 selectCurrent 同口径）；
//       并列按文档顺序。
function ns_biligame_announce_pickDdlezjGacha(items, now) {
	const act = (items || []).filter((x) => x.kind === "gacha" && coversNow(x, now));
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 活动：覆盖当前的**活动档**（label=`活动时间`）优先，其次其它标签（商店兑换时间 / BOSS登场时间…）；
//       同级内结束最早优先，并列按文档顺序。
function ns_biligame_announce_pickDdlezjEvent(items, now) {
	const act = (items || []).filter((x) => x.kind === "event" && coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => (x.label === "活动时间" ? 0 : 1);
	return act.map((x, i) => ({ x, i })).sort((a, b) => (rank(a.x) - rank(b.x)) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 选当期条目：**直接用共用 pickCovering**（覆盖 now + kind 过滤 + 按结束时间升序）
function ns_biligame_announce_covering(items, now, kind) {
	return pickCovering(items, { now, kind, sort: (a, b) => (a.endTs - b.endTs) || 0 });
}
// ⚠️ 2026-10-03 删：这里原本有两个只服务于**悬停元信息**的常量/函数 ——
//   · `skipNote(parsed)` → `—— 另有 N 条档期起点写作「维护后」（源站未给钟点、…）→ 不产出，绝不硬凑 ——`
//   · `TZ_NOTE = "（源站正文自标 (UTC+9)，本条目 tz=+540）"`
//   两者都进了 `bannerHover` / `eventHover`：分隔线装饰 + 抓取统计 + 时区说明 + 内部 tz 值，
//   而方案 A 要求悬停**只**有名称与档期。
//   「本条目 tz=+540」这类信息本来就在**来源声明**里（条目 tz 字段），不需要在悬停里复述。
//   `parsed.skippedNoTime` 本身仍保留（测试要断言"维护后档期不产出"），只是不再写进悬停。
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 对象 | null；now 在最后、有默认值）
// 列表倒序 → 逐条往下抓详情（最多 ns_biligame_announce_DETAIL_LIMIT 篇），由调用方从每篇里挑"覆盖当前时刻"的档期；
// 单条详情失败（网络/404）不整体崩，继续下一条，
// **但若所有详情请求都失败** → 抛错（不能把"源站挂了"静默降级成"未公布"）。
// 实测（2026-10-02）：13 篇里只有「活动公告」类带档期，最新几篇是规则/开发者笔记（0 条档期）
// → 必须往下走几篇才可能命中当期，故 limit 取 6。
async function ns_biligame_announce_loadDdlezj(listUrl, signal, tz) {
	const list = ns_biligame_announce_parseDdlezjList(await fetchJson(listUrl, { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null, loaded = 0;
	const seen = [];
	for (const it of list.slice(0, ns_biligame_announce_DETAIL_LIMIT)) {
		try {
			const detail = await fetchJson(ns_biligame_announce_ddlezjDetailUrl(listUrl, it.id), { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			loaded++;
			seen.push({ item: it, data: d, parsed: ns_biligame_announce_parseDdlezjAnnouncement(d.content, tz) });
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (loaded === 0 && firstErr) throw firstErr;
	return { seen };
}
// 卡池侧
async function ns_biligame_announce_gachaDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = Date.now()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { item, data, parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjGacha(parsed.items, now);
		if (!best) continue;
		const act = ns_biligame_announce_covering(parsed.items, now, "gacha");
		// 悬停 = 共用 hoverPool（池名 ⏎ 档期）；元信息（来源/公告标题/时区说明/维护后统计）一律不进
		const hover = hoverPool(act.map((x) => ({ name: x.name, startTs: x.startTs, endTs: x.endTs })), tz);
		return {
			banner: best.name,
			roles: "",                                  // 源站为公告正文，无结构化角色名单（池名里已带角色）
			bannerDates: fmtWindow(best.startTs, best.endTs, tz),
			bannerDatesRaw: best.raw,
			startTs: best.startTs,
			endTs: best.endTs,
			...(hover ? { bannerHover: hover } : {})
		};
	}
	return null;                                       // 抓到公告但当期无覆盖 → 未公布
}
// 活动侧
async function ns_biligame_announce_eventsDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = Date.now()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { item, data, parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjEvent(parsed.items, now);
		if (!best) continue;
		const act = ns_biligame_announce_covering(parsed.items, now, "event");
		// 非「活动时间」标签的档期在**名称**里标注它是什么窗口（内容，不是元信息）
		const hover = hoverEvent(act.map((x) => ({
			name: `${x.name}${x.label === "活动时间" ? "" : `（${x.label}）`}`,
			startTs: x.startTs,
			endTs: x.endTs
		})), tz);
		return {
			event: best.name,
			eventDates: fmtWindow(best.startTs, best.endTs, tz),
			eventDatesRaw: best.raw,
			...(hover ? { eventHover: hover } : {})
		};
	}
	return null;
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-biligame-activity.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-biligame-activity.js
//
// 由 next-sources/parsers/biligame-activity.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_biligame-activity__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-biligame-activity.js —— biligame 官方公告（活动/卡池档期）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover? }        （eventHover 缺省 = 当期只有 1 条）
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover? }
//   本文件服务两个游戏（同一套官方接口 api.biligame.com/news）：
//     ① 物华弥新 国服 —— **只做活动侧**（卡池侧仍用 B2 的 bwiki `限时招集档案`，见 registry-p9.js）
//     ② 闪耀优俊少女 国服 —— 卡池 + 活动两侧（**取代** B2 的 bwiki 推算表作主源）
//
//   ══ 悬停（hover）规则 —— 用户 2026-10-03 反馈「新增游戏的面板外显/悬停的样式、格式、规则
//      和原来的差别很大」，核实后确认三类偏差，本文件按「方案 A」全部修掉 ══
//     · 排版唯一真源 = `lib/env.js` 的 `hoverPool` / `hoverEvent`（与本体 buildPoolHover /
//       buildEventHover **逐字一致**），本文件**不自己拼字符串**、不排序（工具不排序，调用方排）。
//     · 活动侧 ≥2 条：每条一行「名称 + 3 空格 + 档期（fmtWindow）」，按结束时间升序；
//       只有 1 条 → 工具返回 "" → **不设** `eventHover`，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
//     · 卡池侧 ≥2 池：每池「池名：角色」⏎ 档期（窗口全同则档期只在末尾写一遍）；
//       只有 1 池 → 工具返回 "" → **不设** `bannerHover`，交回 UI 默认两行式（`banner：roles` ⏎ 档期）。
//     · 悬停里**只放名称与档期**：来源站名 / URL / API 名 / 时区推定说明 / 抓取统计 /
//       内部 id（gameExtensionId、typeId、post_id）/ 游戏名+区服前缀 / 任何「（…）」实现说明
//       一律**彻底不进悬停文本**（用户原话「元信息彻底删掉」）——只留在**代码注释**与
//       `parse*` 的返回字段里（供测试与排障），**不搬到别处、不写进别的字段**。
//       ⚠️ 例外：`bannerDatesRaw` / `eventDatesRaw` 照既有约定**保留源站原文**（本体也有条目这么做）。
//
// ── 为什么不再 import `biligame-announce.js`（P6 嘟嘟脸，同形态）─────────────
//   思路/函数确实同源（列表 → 逐条详情 → 正文抽档期 → 挑覆盖 now 的窗口 → 抽不到就 null），
//   但历史上跨解析器 import 会被合并器的命名空间隔离打断（它给本文件的**声明**加 `ns_<file>_`
//   前缀，却不重命名"从别的解析器 import 进来的名字"）→ 生成物里会变成 `… is not defined`。
//   所以当时两个文件各自抄了一份 `decodeExtra` + 实体表。
//   ⚠️ 2026-10-03 更新：压平成 `src/client/` 普通源码段后**不再有命名空间合并器**，
//   而那两份 `ENT_EXTRA` / `decodeExtra` / `plain` **函数体逐字节相同、表互为子集** ——
//   已统一到 `41-sources-shared.js` 的 `decodeExtra` / `htmlText` / `htmlTextTight`（并集表）。
//   本条历史记录保留，因为"跨文件同名/同源"这个坑值得记住。
//
// ══ 接口实测形态（2026-10-02 抓夹具）════════════════════════════════════════
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=<id>&positionId=2&typeId=<t>&pageNum=1&pageSize=50
//   → { request_id, data:[…], totalNum, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断), createTime, modifyTime }
//   ⚠️ `positionId=2` **必填**（省略返回空）；条目里 `displayTime` **可能缺**（实测物华弥新
//      typeId=4 有 5/36 条没有、typeId=1 有 10/17 条没有）→ 排序键必须退到 `ctime`。
//   ⚠️ 列表里的 `content` 是**截断**的 → 正文档期只能抓详情 `/news/{id}`。
// 详情：GET https://api.biligame.com/news/<id>
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   夹具里 `data.site` / `data.gameExtensionId` 是**独立印证**：
//     18419 → site=物华弥新 gid=613 ；18426 → site=闪耀！优俊少女 gid=1006 。
//
// ══ ① 物华弥新 国服（gameExtensionId=613）══════════════════════════════════
//   ⚠️⚠️ **两路 typeId 都要拉，缺一会丢档期**（实测）：
//     typeId=4（`typeName=活动`）totalNum=36，最新 2026-09-30 id=18419「经以山海」限时活动开启
//     typeId=1（`typeName=公告`）totalNum=17，**最新 2026-09-10 id=18334「无稽妄语」限时活动开启**
//       —— 18334 这条**不在 typeId=4 里**（两路 id 集合实测**零重叠**：36 ∩ 17 = ∅）
//   合并规则：按 id 去重 + 按 `displayTime||ctime` 严格倒序（实测合并后前 6 条 =
//   18419 / 18334 / 18265 / 18194 / 18109 / 18047，夹具都抓了前 5 条详情）。
//
//   ══ 正文档期形态（**注意：与任务书里的猜测不同，这里是实测原文**）══
//     `活动时间：9月23日 10:00 ~ 10月22日 09:59`      ← **不带年份、用「月日」**
//     `活动时间：9月30日 10:00 ~ 常驻`                 ← 终点是「常驻」= 无终点 → **不产出**
//     标题与档期**不在同一段**：`<p>一、旅程将启-经以山海</p>` + `<p>活动时间：…</p>`
//     ⇒ 按 `</p>` 切段后，用小节标题（`一、…`）+ 紧随其后的 `活动时间：` 行配对。
//     年份推断：源站只写「月日」→ 取**该公告 displayTime 的年份**；起月比发布月大 6 个月以上
//     视为上一年（跨年公告），终点若比起点早就 +1 年。（夹具里所有窗口都同年，无需跨年。）
//     kind：小节标题含 `招集|招募|引介|卡池|扭蛋` → 卡池侧，其余 → 活动侧（本文件活动侧只用后者）。
//
//   ══ 外显取哪一条？══
//     同一份公告里有十几条「活动时间」（登录活动、主线活动、试炼场、衣装…全都叫「活动时间」）。
//     规则：① 覆盖 now 优先；② 小节名与**标题里引号中的活动名**完全一致者优先
//     （18419 标题「经以山海」限时活动开启 → 小节`四、经以山海`；18334 → 小节`二、无稽妄语`），
//     ③ 其次结束最早；④ 并列按文档顺序。⇒ 取到的是本期**主线活动**，而不是最早结束的登录活动。
//
// ══ ② 闪耀优俊少女 国服（gameExtensionId=1006）══════════════════════════════
//   ⚠️ **只有单一 feed（typeId=1）且卡池/活动混排**（totalNum=671，一页 50）。
//     `typeId=4`（活动专类）实测**已停更**（13 条，停在 2026-04-19）→ **不用它**。
//   标题分流（任务书口径）：
//     卡池 = 标题含 `招募` / `扭蛋` / `必得`（先判卡池：`…庆典招募开放！` 里也含「活动」字样）
//     活动 = 标题含 `活动` / `赛事` / `剧情` / `举办`
//     两者都不含 → **跳过**（如`养成剧本…开放！`/`部分养成优俊少女追加进化技能！`），不抓详情。
//   ⚠️ 正文档期形如：`10/2 12:00 ～ 10/13 11:59`（**全角波浪 `～`**、**不带年份**、**月/日**），
//     且**标签常与前一段或同段共存**：
//       <p>精选招募开放期间</p><p>10/2 12:00 ～ 10/13 11:59</p>      ← 上一段是标签
//       <p>活动期间 10/1 12:00 ～ 10/711:59</p>                      ← 同段；⚠️ 源站**少了一个空格**
//     ⇒ 标签取「同段内窗口之前的文字」，空则退回「上一段非窗口段」。
//     ⚠️ 实测源站笔误 `10/711:59`（18423 活动期间）：日期与时刻**粘连**。本解析器用
//        `ns_biligame_activity_deglueDateTimes()` 归一成 `10/7 11:59`，并记 `glued:true` + `rawNorm`（供测试与排障）。
//        ⚠️ 这条说明**只留在这里**：旧版曾把它拼成一个「（源站原文…粘连…）」括号注进悬停 → 已删。
//     外显挑选：同一条公告里常有多个「…期间」（活动期间 / 奖励领取期间 / 报名期间 / 第N轮…）→
//       卡池侧优先标签含`招募`的窗口，活动侧优先`活动期间`，其次含`期间|时间`，最后其它；同级结束早者先。
//
// ══ 时区 tz = Asia/Shanghai（**推测，但有逐字交叉印证**）════════════════════
//   源站**不标时区**。交叉印证：公告 `displayTime`（B 站 CMS 发布时刻）与正文档期墙钟**逐字一致**：
//     · 18419 displayTime=2026-09-30 10:00:00 ↔ 正文`活动时间：9月30日 10:00 ~ …`
//     · 18426 displayTime=2026-10-02 12:00:00 ↔ 正文`10/2 12:00 ～ 10/13 11:59`
//   ⇒ 正文墙钟与 CMS 同一口径；B 站 CMS 为 UTC+8 → 记 Asia/Shanghai。（仍是**推定**，不是源站声明。）
//   绝对时刻一律走 `sourceInstant(...)`，文本一律走 `fmtWindow(...)`（源站墙钟原文不重解释）。
//
// ══ EdgeOne/抓取注意 ══
//   `api.biligame.com` **无 ACAO**（调研实测）→ mode 一律 "proxy"，**不可 direct**。
//   抓夹具时别并发太猛（列表+详情共 11 次请求，实测每 7~9 秒一发全部 HTTP 200）。


const ns_biligame_activity_BILIGAME_ACTIVITY_TZ = "Asia/Shanghai";
const ns_biligame_activity_WHMX_GAME_EXTENSION_ID = 613;
const ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID = 1006;
// 物华弥新：4=活动专类 / 1=公告（两路 id 实测零重叠，缺一路就丢档期）
const ns_biligame_activity_WHMX_TYPE_IDS = [4, 1];
const ns_biligame_activity_WHMX_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, ns_biligame_activity_WHMX_TYPE_IDS[0]);
// 两路 URL（注册表只声明主 URL=typeId 4；解析器会自行派生 typeId 1 那路，见 ns_biligame_activity_whmxListUrls()）
const ns_biligame_activity_WHMX_LIST_URLS = ns_biligame_activity_WHMX_TYPE_IDS.map((t) => ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, t));
const ns_biligame_activity_UMA_CN_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID, 1);
const ns_biligame_activity_WHMX_HOME = "https://game.bilibili.com/whmx/";
const ns_biligame_activity_UMA_CN_HOME = "https://game.bilibili.com/umamusume/";
// 逐条往下抓详情的上限（公告很稀疏：一天最多 1~2 篇，但档期藏在正文里）
const ns_biligame_activity_DETAIL_LIMIT_WHMX = 6;
const ns_biligame_activity_DETAIL_LIMIT_UMA = 8;

// 列表 URL 构造：positionId=2 **必填**（实测省略返回空），pageSize=50 足够（两游戏都 < 700 且只取最新的）
function ns_biligame_activity_biligameListUrl(gameExtensionId, typeId, pageSize = 50) {
	return `https://api.biligame.com/news/list?gameExtensionId=${gameExtensionId}`
		+ `&positionId=2&typeId=${typeId}&pageNum=1&pageSize=${pageSize}`;
}
// 同一参数空间里换另一路 typeId（物华弥新两路都拉）——只改 typeId，其余参数原样，保证
// 「夹具 URL ⇄ 解析器实际请求的 URL」字符串完全一致（离线夹具按整串命中）
function ns_biligame_activity_siblingListUrl(listUrl, typeId) {
	try {
		const u = new URL(listUrl);
		u.searchParams.set("typeId", String(typeId));
		return u.toString();
	} catch {
		return ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, typeId);
	}
}
function ns_biligame_activity_whmxListUrls(listUrl = ns_biligame_activity_WHMX_LIST_URL) {
	const primary = listUrl || ns_biligame_activity_WHMX_LIST_URL;
	let t = ns_biligame_activity_WHMX_TYPE_IDS[0];
	try { t = Number(new URL(primary).searchParams.get("typeId")) || t; } catch { /* keep */ }
	const other = ns_biligame_activity_WHMX_TYPE_IDS.find((x) => x !== t) || t;
	const out = [primary];
	const second = ns_biligame_activity_siblingListUrl(primary, other);
	if (second !== primary) out.push(second);
	return out;
}
function ns_biligame_activity_biligameDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_activity_WHMX_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

// 按 </p> 切段（公告正文的每个逻辑单元都是 <p>；textOf 的行会把多段粘一起，不能用）
function ns_biligame_activity_biligameParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => htmlText(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 悬停排版（**只有名称与档期**，见文件头「悬停规则」）
// 本区域只做两件事：① 从「覆盖 now 的档期」里取出名称；② 按结束时间升序排好交给共用工具。
// 排版（3 空格 / 档期格式化 / 窗口全同只写一遍 / <2 条返回 ""）**全在 lib/env.js**，这里绝不自拼。
//
// ⚠️ 为什么这里有注释而悬停里没有：来源/URL/tz 推定/抓取条数/内部 id 都是**排障信息**，
//    用户明确要求「元信息彻底删掉」→ 只留在代码注释与 `parse*` 的返回字段（skipped / section /
//    label / raw…）里，**不搬到别处、不写进别的字段**。
// ⚠️ 「常驻不产出」「源站日期与时刻粘连」这类**实现说明**同样不进悬停（旧版曾拼在 hover 里）。
function ns_biligame_activity_byEndAsc(a, b) { return (a.endTs - b.endTs) || (a.startTs - b.startTs); }
// 覆盖 now 的档期 → 悬停行（`name` 由调用方给的 nameOf 决定；空名行直接丢弃，不硬造占位名）
function ns_biligame_activity_hoverRows(covering, nameOf) {
	return (covering || [])
		.slice()
		.sort(ns_biligame_activity_byEndAsc)
		.map((x) => {
			const name = String(nameOf(x) || "").trim();
			return name ? { name, startTs: x.startTs, endTs: x.endTs, raw: x.raw } : null;
		})
		.filter(Boolean);
}
// ① 物华弥新 活动侧：名称 = 源站小节名（`四、经以山海` → `经以山海`），缺小节时退回段落标签
function ns_biligame_activity_whmxEventHover(covering, tz) {
	return hoverEvent(ns_biligame_activity_hoverRows(covering, (x) => x.section || x.label), tz);
}
// ② 闪耀优俊少女 活动侧：名称 = 源站期间标签（`活动期间` / `第1轮` / `决赛轮：匹配期间` …）；
//    标签缺失时退回公告标题（= 该活动的名字），仍为空则整行丢弃。
//    多条期间属于**同一份公告**，因此每行只写期间名 + 档期，不再重复活动名（同一个名字重复 N 遍没有信息量）。
function ns_biligame_activity_umaCnEventHover(covering, tz, fallbackName = "") {
	return hoverEvent(ns_biligame_activity_hoverRows(covering, (x) => x.label || fallbackName), tz);
}
// ③ 闪耀优俊少女 卡池侧：每池写「池名：角色」（与本体 `banner：roles` 同构；无角色时只写池名）。
//    池名取**源站期间标签**（`精选招募开放期间` / `开放期间`）：同一份公告可能同时开着多个期间，
//    若用公告标题，每池同名 → `hoverPool` 会输出重复行。列出的期间集合 = 原有「覆盖 now」集合，
//    **当期判定不变**（本次只改 hover 拼装，不动外显/档期字段）。
function ns_biligame_activity_umaCnPoolHover(covering, tz, rolesText = "", fallbackName = "") {
	const suffix = rolesText ? `：${rolesText}` : "";
	return hoverPool(ns_biligame_activity_hoverRows(covering, (x) => `${x.label || fallbackName}${suffix}`), tz);
}
//#endregion

//#region 列表
// 列表 JSON → [{ id, title, typeId, displayTime, ctime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_activity_parseBiligameList(json) {
	if (!json || typeof json !== "object") throw new Error("biligame-bad-json");
	if (json.code !== 0) throw new Error("biligame-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("biligame-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测大量条目缺 displayTime → 退 ctime
			return {
				id: x.id,
				title: decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				sortKey,
				dateTs: ns_biligame_activity_parseCmsStamp(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
// "2026-09-30 10:00:00"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_activity_parseCmsStamp(s, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
// 多路 feed 合并：按 id 去重（先到先得）+ 严格倒序（实测两路 id 零重叠，但去重仍必要）
function ns_biligame_activity_mergeBiligameLists(groups) {
	const seen = new Set();
	const out = [];
	for (const g of groups || []) {
		for (const it of g || []) {
			if (seen.has(it.id)) continue;
			seen.add(it.id);
			out.push(it);
		}
	}
	return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
//#endregion

//#region 档期抽取：源站墙钟（月日、可能缺年份）→ 窗口
// ⚠️ 实测源站笔误：`10/711:59`（日期与时刻粘连，见 18423 活动期间）。
//    只处理「日期数字 ≥3 位且紧跟 HH:MM」的形态（正常运行写法 `10/7 11:59` / `9月23日 10:00` 不受影响），
//    按「末 2 位为小时」优先切分（`711` → 7 日 11 时），若日不合法再试「末 1 位为小时」。
//    ins（可选）：收集插入的空格位置，供 `raw` 回到**源站原文**（契约要求 raw 保留原文）。
const ns_biligame_activity_GLUE_RE = /([\/\-.]|月|日)(\d{2,4})\s*[:：]\s*(\d{2})/g;
function ns_biligame_activity_deglueDateTimes(s, ins = null) {
	const src = String(s == null ? "" : s);
	let out = "", last = 0;
	ns_biligame_activity_GLUE_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_GLUE_RE.exec(src)) !== null) {
		if (m[0] === "") { ns_biligame_activity_GLUE_RE.lastIndex++; continue; }
		const run = m[2];
		if (run.length < 3) continue;                 // 正常写法（`日 10:00` / `10:00`）→ 原样
		let day = null, hour = null;
		const d2 = run.slice(0, run.length - 2), h2 = run.slice(-2);
		if (d2 !== "" && +d2 >= 1 && +d2 <= 31 && +h2 <= 23) { day = d2; hour = h2; }
		else {
			const d1 = run.slice(0, run.length - 1), h1 = run.slice(-1);
			if (d1 !== "" && +d1 >= 1 && +d1 <= 31 && +h1 <= 23) { day = d1; hour = h1; }
		}
		if (day == null) continue;
		out += src.slice(last, m.index) + m[1] + day;
		if (ins) ins.push({ normIndex: out.length, srcIndex: m.index + m[1].length + run.length });
		out += " " + hour + ":" + m[3];
		last = m.index + m[0].length;
	}
	return out + src.slice(last);
}
// 归一化坐标 → 源站坐标（因为只插入了空格，逐个抵消即可）
function ns_biligame_activity_toSourceRange(normStart, normEnd, ins) {
	let s = normStart, e = normEnd;
	for (const p of ins) {
		if (p.normIndex < normStart) s--;
		if (p.normIndex < normEnd) e--;
	}
	return { s, e };
}
// 令牌表：① 完整「日期+时刻」 ② 只有日期（止点缺时刻时兜底） ③ 区间分隔符 ④ 「常驻/永久」= 无终点
//   日期形态涵盖实测两种：`9月23日 10:00`（无年）与 `2026/09/30 10:00`（带年）
const ns_biligame_activity_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|永久)"
].join("|"), "g");
function ns_biligame_activity_tokenizeWindows(text) {
	const out = [];
	ns_biligame_activity_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_TOK_RE.exec(text)) !== null) {
		if (m[0] === "") { ns_biligame_activity_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) out.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) out.push(t);
		} else if (g.sep != null) {
			out.push({ kind: "sep", text: g.sep, at, end });
		} else if (g.perm != null) {
			out.push({ kind: "perm", text: g.perm, at, end });
		}
	}
	return out;
}
// 一段文本 → { norm, windows:[{ startTs, endTs, raw(源站原文), rawNorm(归一化后), glued, perm? }] }
//   · 起点必须带时刻（令牌 ①）  · 终点可以是时刻/日期（缺时刻 → 23:59）/「常驻」
//   · 年份抽不出来（源站无年份且公告也没年份）→ 该窗口进 skipped，不产出
function ns_biligame_activity_extractWindowsDetailed(text, yearHint, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const src = String(text == null ? "" : text);
	const ins = [];
	const norm = ns_biligame_activity_deglueDateTimes(src, ins);
	const glued = ins.length > 0;
	const toks = ns_biligame_activity_tokenizeWindows(norm);
	const windows = [], skipped = [];
	const rawOf = (a, b) => {
		const r = ns_biligame_activity_toSourceRange(a.at, b.end, ins);
		return { src: src.slice(r.s, r.e).trim(), norm: norm.slice(a.at, b.end).trim() };
	};
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raws = rawOf(a, b);
		const y1 = inferYear(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "no-year" }); i += 2; continue; }
		if (b.kind === "perm") {
			skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "perm" });   // 「常驻」= 无终点 → 不产出
			i += 2;
			continue;
		}
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const h1 = a.h, mi1 = a.mi;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;
		const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw: raws.src, rawNorm: raws.norm, glued, at: a.at, end: b.end });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

//#region ① 物华弥新 活动正文档期
// 小节标题 `一、旅程将启-经以山海` / `十三、试炼场`
const ns_biligame_activity_WHMX_SECTION_RE = /^[一二三四五六七八九十百]+\s*[、.．]\s*(.+)$/;
// 小节名含这些词 → 卡池侧（本文件活动侧不用；保留 kind 便于测试断言）
const ns_biligame_activity_GACHA_SEC_RE = /招集|招募|引介|卡池|扭蛋/;
const ns_biligame_activity_WHMX_LABEL_RE = /^([^\s：:]{2,12})\s*[：:]/;
// 正文 HTML → { items:[{ name, section, label, startTs, endTs, raw, glued, kind }], skipped, paragraphs }
function ns_biligame_activity_parseWhmxActivity(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let section = "";
	for (const para of paragraphs) {
		const sec = ns_biligame_activity_WHMX_SECTION_RE.exec(para);
		if (sec) { section = sec[1].trim(); continue; }     // 标题独占一段（实测）
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, section });
			continue;
		}
		const labelM = ns_biligame_activity_WHMX_LABEL_RE.exec(para);
		const label = labelM ? labelM[1] : "";
		for (const w of windows) {
			items.push({
				name: section || label,
				section,
				label,
				startTs: w.startTs,
				endTs: w.endTs,
				raw: w.raw,
				rawNorm: w.rawNorm,
				glued: w.glued,
				kind: ns_biligame_activity_GACHA_SEC_RE.test(section) ? "gacha" : "event"
			});
		}
		for (const s of sk) skipped.push({ ...s, section });
	}
	return { items, skipped, paragraphs };
}
//#endregion

//#region ② 闪耀优俊少女 正文/标题
// 标题分流：卡池（招募/扭蛋/必得）优先；其次活动（活动/赛事/剧情/举办）；都不含 → null（跳过，不抓详情）
const ns_biligame_activity_UMA_GACHA_RE = /招募|扭蛋|必得/;
const ns_biligame_activity_UMA_EVENT_RE = /活动|赛事|剧情|举办/;
function ns_biligame_activity_classifyUmaCnTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_biligame_activity_UMA_GACHA_RE.test(t)) return "gacha";
	if (ns_biligame_activity_UMA_EVENT_RE.test(t)) return "event";
	return null;
}
// 正文 HTML → { items:[{ name:标签, label, startTs, endTs, raw, glued }], skipped, paragraphs }
//   标签：同段内窗口之前的文字（`活动期间 10/1 12:00 ～ …`）→ 空则退回上一段非窗口段
function ns_biligame_activity_parseUmaCnAnnouncement(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let prevLabel = "";
	for (const para of paragraphs) {
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, label: prevLabel });
			// 记录「可能是标签」的短段（供下一段的窗口使用）：实测标签形如
			// `精选招募开放期间` / `开放期间` / `活动期间` / `角色剧情开放期间` → 需含 期间|时间 等词
			if (para.length <= 24 && !/[。！？，,；;：:]/.test(para) && /期间|时间|开放|活动/.test(para)) prevLabel = para;
			continue;
		}
		for (const w of windows) {
			const head = norm.slice(0, w.at).replace(/^[※·・\-—\s]+/, "").replace(/[：:]\s*$/, "").trim();
			const label = head || prevLabel;
			items.push({ name: label || "（无标签）", label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawNorm: w.rawNorm, glued: w.glued });
		}
		for (const s of sk) skipped.push({ ...s, label: prevLabel });
	}
	return { items, skipped, paragraphs };
}
// 外显挑选：卡池侧优先标签含`招募`；活动侧优先`活动期间`，其次含`期间|时间`，最后其它细分期间。
// 同级取结束最早，并列按文档顺序。（实测：18425 活动期间 / 18423 活动期间 都是 rank0）
function ns_biligame_activity_pickUmaWindow(items, now, want) {
	const act = (items || []).filter((x) => coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		const l = String(x.label || "");
		if (want === "gacha") return /招募/.test(l) ? 0 : 1;
		if (/^(活动期间|活动时间)/.test(l)) return 0;
		if (/期间|时间/.test(l)) return 1;
		return 2;
	};
	return act.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || (a.w.endTs - b.w.endTs) || (a.i - b.i))[0].w;
}
// UP 角色/协助卡名（可选字段）：只认 `★★★ [系列名]角色名` 这种明确行（协助卡列表没有 ★★★ → 不产出）
function ns_biligame_activity_umaRoles(paragraphs) {
	const out = [];
	for (const p of paragraphs || []) {
		const m = /^★★★\s*(?:\[[^\]]*\]|【[^】]*】)?\s*([^\s（(＜【\[]+)/.exec(p);
		if (m && m[1] && !out.includes(m[1])) out.push(m[1]);
		if (out.length >= 6) break;
	}
	return out;
}
//#endregion

//#region 文字清洗 / 标题里的活动名
// 标题清洗：去掉尾部的动作尾巴（`开放！`/`即将开放！`/`举办中！`/`开启`…），保留活动/卡池名
const ns_biligame_activity_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|现已|正在|已)?(?:开放|开启|举办|登场|上线|开始|结束|预告|推出)[中]?[！!。]?\s*$/;
function ns_biligame_activity_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_biligame_activity_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
// 标题里引号中的活动名：`「经以山海」限时活动开启` → 经以山海
// （物华弥新用它把外显锁定到本期主线活动小节，而不是最早结束的登录活动）
function ns_biligame_activity_quotedName(title) {
	const m = /[「“"【]([^」”"】]{2,14})[」”"】]/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}
//#endregion

//#region 物华弥新 外显挑选 / 抓取器
function ns_biligame_activity_pickWhmxEvent(items, now, preferName = "") {
	const act = (items || []).filter((x) => x.kind === "event" && coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		if (!preferName) return 1;
		if (x.section === preferName) return 0;
		if (x.section.includes(preferName)) return 1;
		return 2;
	};
	return act.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 选当期事件：**直接用共用 pickCovering**（覆盖 now + kind 过滤 + 按开始时间升序）
function ns_biligame_activity_coveringWhmxEvents(items, now) {
	return pickCovering(items, { now, kind: "event", sort: (a, b) => (a.startTs - b.startTs) || 0 });
}
// ⚠️ 曾经这里有 `WHMX_TZ_NOTE`（时区推定说明）与 `skipNote()`（「常驻不产出」说明），两者都只用于
//    拼旧悬停 → 用户要求「元信息彻底删掉」后**已整体删除**（时区推定的依据仍在文件头 ① 的交叉印证里，
//    「常驻」为何不进 items 仍在 `ns_biligame_activity_extractWindowsDetailed` 的注释与 `skipped[].reason` 里）。
function ns_biligame_activity_yearHintOf(item, tz) {
	const ts = item && item.dateTs != null ? item.dateTs : null;
	return ts == null ? null : sourceWallParts(ts, tz);
}
// 活动侧抓取器（契约：async (url, signal, tz, now = Date.now()) → 对象 | null）
//   两路 typeId（4 与 1）**都拉** → 合并去重倒序 → 逐条抓详情（≤6 篇）→ 正文抽档期 → 挑覆盖 now 的
//   · 抓到公告但没有任何覆盖 now 的活动档期 → null（未公布）
//   · 所有详情请求都失败 → 抛错（不能把「源站挂了」静默降级成「未公布」）
//   · 一路 feed 失败且最终没找到覆盖 now 的档期 → 抛错（此时不能声称「未公布」）
async function ns_biligame_activity_eventsWhmxOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const listUrl = url || ns_biligame_activity_WHMX_LIST_URL;
	const merged = [];
	const feedErrors = [];
	let okFeeds = 0;
	for (const u of ns_biligame_activity_whmxListUrls(listUrl)) {
		try {
			const items = ns_biligame_activity_parseBiligameList(await fetchJson(u, { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" }));
			merged.push(items);
			okFeeds++;
		} catch (e) {
			feedErrors.push(e);
		}
	}
	if (okFeeds === 0) throw feedErrors[0];
	const list = ns_biligame_activity_mergeBiligameLists(merged);
	if (!list.length) return null;                     // 两路都是空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_WHMX)) {
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const title = decodeExtra(d.title || it.title || "").replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseWhmxActivity(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickWhmxEvent(parsed.items, now, ns_biligame_activity_quotedName(title));
		if (!best) continue;
		// 悬停 = 覆盖 now 的全部活动档期，逐行「小节名 + 3 空格 + 档期」（共用工具排版，按结束时间升序）。
		// 只有 1 条 → 工具返回 "" → **不设** eventHover，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=613，typeId=4/1…
		// 共 N 篇）」「物华弥新 国服 · 标题 + tz 推定」「▶ 标出外显那条」「另有 N 条常驻不产出」
		// 全部是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const eventHover = ns_biligame_activity_whmxEventHover(ns_biligame_activity_coveringWhmxEvents(parsed.items, now), tz);
		const eventDates = fmtWindow(best.startTs, best.endTs, tz);
		return {
			event: ns_biligame_activity_cleanTitle(title) || best.section || best.label,
			eventDates,
			eventDatesRaw: best.raw,
			...(eventHover ? { eventHover } : {})
		};
	}
	if (loaded === 0 && firstErr) throw firstErr;
	if (feedErrors.length) throw feedErrors[0];        // 一路 feed 失败 → 不能声称「未公布」
	return null;
}
//#endregion

//#region 闪耀优俊少女 抓取器（卡池 + 活动，同一 feed 靠标题分流）
// 单一 feed（typeId=1）→ 逐条往下（≤8 篇）→ 标题分流 → 只抓**本侧相关**的详情 → 正文抽档期
async function ns_biligame_activity_loadUmaCn(url, signal, tz, now, want) {
	const listUrl = url || ns_biligame_activity_UMA_CN_LIST_URL;
	const list = ns_biligame_activity_parseBiligameList(await fetchJson(listUrl, { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;                     // 空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_UMA)) {
		const title = decodeExtra(it.title || "").replace(/\s+/g, " ").trim();
		if (ns_biligame_activity_classifyUmaCnTitle(title) !== want) continue;   // 标题分流：不相关的不抓详情（省请求）
		tried++;
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const dt = decodeExtra(d.title || title).replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseUmaCnAnnouncement(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickUmaWindow(parsed.items, now, want);
		if (!best) continue;
		// 覆盖 now 的全部期间（**当期判定不变**，与旧版同一集合），按结束时间升序排好供悬停排版。
		// 悬停文本由调用方按侧拼（卡池 `hoverPool` / 活动 `hoverEvent`）——本函数不再返回 hover，
		// 因为两侧排版不同（卡池要「池名：角色」+ 每池两行），旧版共用一份 hover 正是偏差来源之一。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=1006，单一 feed
		// typeId=1 卡池/活动混排，按标题分流）」「闪耀！优俊少女 国服 · 标题 + tz 推定」「▶ 支线」
		// 与「源站原文粘连 → 按 … 解析」全是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const active = parsed.items
			.filter((x) => coversNow(x, now))
			.sort(ns_biligame_activity_byEndAsc);
		return { title: dt, best, active, roles: want === "gacha" ? ns_biligame_activity_umaRoles(parsed.paragraphs) : [] };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全都失败 → 抛错
	return null;
}
// 卡池侧
async function ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, active, roles } = hit;
	const banner = ns_biligame_activity_cleanTitle(title) || best.label;
	const rolesText = roles.join("、");
	// 悬停 = 全部当期池（每池「池名：角色」+ 档期）；只有 1 个当期池 → "" → **不设** bannerHover，
	// 交回 UI 默认两行式（`banner：roles` ⏎ `bannerDates`）。
	const bannerHover = ns_biligame_activity_umaCnPoolHover(active, tz, rolesText, banner);
	return {
		banner,
		roles: rolesText,
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}
// 活动侧
async function ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, active } = hit;
	const event = ns_biligame_activity_cleanTitle(title) || best.label;
	// 悬停 = 全部当期期间，逐行「期间名 + 3 空格 + 档期」（档期由 fmtWindow 格式化：源站粘连笔误
	// `10/711:59` 在这里如实显示为 `10-07 11:59`）；只有 1 条 → "" → **不设** eventHover。
	const eventHover = ns_biligame_activity_umaCnEventHover(active, tz, event);
	return {
		event,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
}
//#endregion

// src/client/42-parsers-cygames.js —— Cygames 系（赛马娘 日服 / 国际服）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-umamusume-official.js   赛马娘 日服 / 国际服 官网公告
//      · 42-parsers-umapyoi.js              赛马场日服 umapyoi 第三方库（备选源）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-umamusume-official.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-umamusume-official.js
//
// 由 next-sources/parsers/umamusume-official.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_umamusume-official__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-umamusume-official.js —— 赛马娘 **官方公告**（日服 umamusume.jp + 国际服 umamusume.com）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null
//   卡池侧 { banner, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   null = 未公布（抓到了公告，但没有覆盖 now 的档期）；只有结构性损坏才 throw。
//   `bannerHover` / `eventHover` 只在**当期 ≥2 条**时出现（`hoverPool` / `hoverEvent` 返回空串 → 本文件不设该字段），
//   否则交回 UI 的默认单条两行式；内容只有「名称 + 档期」，**不含任何元信息**（见 `ns_umamusume_official_umaCurrentItems` 的说明）。
//
// ── 与既有源的关系（**并存，不替换**）────────────────────────────────────────
//   · 日服：既有 `parsers/umapyoi.js`（第三方 api.umapyoi.net，只有"卡级获取窗口"、无卡池名）
//     与本文件的 `uma-jp-official`（官网公告，有卡池名 + 完整活动/卡池文案）**并存**。
//   · 国际服：既有 `parsers/bwiki.js` 的 `eventsUmaJp` / `gachaUmaCn`（bwiki 表格，简中服）
//     与本文件的 `uma-global`（**国际服官方公告**）**并存**。谁是主源由 Lead 决定，本文件不擅自替换。
//
// ── 实测形态（2026-10-02 夹具，见 fixtures/p5-uma-*）─────────────────────────
// 日服（TZ = Asia/Tokyo，源站即日服官网）：
//   GET  /api/ajax/pr_info_index?format=json&page=<N>
//        → { response_code: 1, information_list: [{ announce_id, title, message, post_at, update_at,
//            announce_label, image, og_image, post_platform_flag }], total_page_count: 32 }
//        实测 page=1 → 10 条（**分页参数只有 `page` 有效**；p / page_no / limit / size 实测全无效），
//        total_page_count=32（page=2 同样 10 条，已抓夹具 p5-uma-jp-index-p2）。
//   GET  /api/ajax/pr_info_detail?format=json&announce_id=<id>
//        → { response_code: 1, detail: { announce_id, title, message, from_date, to_date, post_at, … } }
// 国际服（TZ = **UTC**，与日服不同；post_at 实测是 UTC，如 "2026-09-28 22:00:00" = 15:00 PDT）：
//   POST /api/ajax/pr_info_index?format=json   body {"announce_label":1,"limit":50,"offset":0}
//        → { response_code: 1, information_list: [ … 50 条 … ], show_more_button: 1 }
//        ⚠️ **必须 POST**：GET / 空 body → `{"response_code":102}`（实测）；只有 1 才是成功。
//        announce_label：1=Game / 0=All / 3=Media（本解析器只用 1）。
//   POST /api/ajax/pr_info_detail?format=json  body {"announce_id":<id>}
//
// ── ⚠️ 最重要的一条实测纠正：「档期不在 from_date/to_date 里」────────────────
//   `detail.from_date` / `detail.to_date` 是**该公告的展示/失效期**，不是卡池/活动档期：
//     日服 3470：from=2026-10-01 to=2027-01-31，而正文写「開催期間 10/1 12:00 ～ 11/2 11:59」；
//     日服 3477（进化技能追加，其实没有活动期）：from=10-01 to=**2027-01-31**（同批公告共用同一 to_date）；
//     国际服所有详情：to_date 一律 `2026-12-31 23:59:59`（年终哨兵）——连"问题修复"公告也是。
//   → 真正的档期只在 `detail.message` 正文里，且**日文正文还有第二段小期间**
//     （3472 的「販売期間 9/30 12:00 ～ 10/13 4:59」），所以**绝不能**拿 from/to 当档期，
//     否则会把"整批公告的展示期"当成卡池期，`bannerDates` 会是错的（这条是本文件存在的理由）。
//   本解析器因此：① 先从正文抽日期区间（统一 tokenizer，日文/英文共用）；
//                 ② 只有正文里**完全抽不到**区间时，才退化为 from_date ~ to_date
//                    （退化事实标在 `windows[].label` / `source="fallback"` 上，**供测试与排障**，
//                     绝不写进 hover —— 用户 2026-10-03 要求悬停里元信息彻底删掉）；
//                 ③ 外显取"覆盖 now 且开始最晚"的那条区间；一条都不覆盖 now → 返回 null。
//
// ── 分类（靠标题关键词，源站没有分类字段）──────────────────────────────────
//   日服：`ガチャ` → 卡池；`イベント` / `キャンペーン` → 活动。
//   国际服：scout / recruit / gacha / spotlight / pickup / banner → 卡池；
//            event / campaign / celebration / story → 活动；卡池优先。
//
// ── 传输：POST 只能自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────
//   走宿主同源代理 `/api/gacha-calendar-proxy`：代理读**请求体**并透传
//   （src/index.js proxyHandler：`method = body !== "" ? "POST" : "GET"`），
//   所以 POST 的最小形态是 `fetch(proxyUrl, { method:"POST", body: JSON.stringify(payload) })`。
//   ⚠️ 实测（2026-10-02）两个域名响应都**没有 ACAO**（CloudFront `Vary: Origin` 但不回 ACAO）
//   → 只能是 mode="proxy"；但 `umamusume.jp` / `umamusume.com` **不在** src/index.js 的
//   PROXY_ALLOW_HOSTS 白名单里 → 代理会回 403 `host not allowed`（本批次只写 next-sources/，
//   已上报 Lead 加白名单，未擅自改插件本体）。


// ── URL / 时区常量 ──
const ns_umamusume_official_UMA_JP_INDEX_URL = "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1";
const ns_umamusume_official_UMA_JP_DETAIL_URL = "https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=";
const ns_umamusume_official_UMA_JP_TZ = "Asia/Tokyo";
const ns_umamusume_official_UMA_GLOBAL_INDEX_URL = "https://umamusume.com/api/ajax/pr_info_index?format=json";
const ns_umamusume_official_UMA_GLOBAL_DETAIL_URL = "https://umamusume.com/api/ajax/pr_info_detail?format=json";
const ns_umamusume_official_UMA_GLOBAL_TZ = "UTC";                  // 实测：post_at 为 UTC（日服为 JST，两者不同）
const ns_umamusume_official_UMA_GLOBAL_LABEL_GAME = 1;              // 1=Game / 0=All / 3=Media

/** 每侧最多抓这么多条详情（列表每条候选一次请求，每个列表页最多 6 条候选） */
const ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS = 12;
/** 列表翻页上限（page=1 通常就够；只在第一页没找到覆盖 now 的档期时才翻页） */
const ns_umamusume_official_UMA_DEFAULT_MAX_PAGES = 3;
/** 每页候选（分类命中）上限 */
const ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE = 6;

// ── 分类关键词 ──
const ns_umamusume_official_JP_GACHA_RE = /ガチャ/;
const ns_umamusume_official_JP_EVENT_RE = /イベント|キャンペーン/;
const ns_umamusume_official_GL_GACHA_RE = /scout|recruit|gacha|spotlight|pickup|pick-?up|banner/i;
const ns_umamusume_official_GL_EVENT_RE = /event|campaign|celebration|story/i;

/**
 * 标题分流：返回 "gacha" | "event" | null（null = 与卡池/活动都无关，如「不具合」「功能更新」）。
 * mode="jp" 用日文关键词，mode="global" 用英文关键词；卡池优先于活动。
 */
function ns_umamusume_official_classifyUmaTitle(title, mode = "jp") {
	const t = String(title == null ? "" : title);
	const gacha = mode === "global" ? ns_umamusume_official_GL_GACHA_RE : ns_umamusume_official_JP_GACHA_RE;
	const event = mode === "global" ? ns_umamusume_official_GL_EVENT_RE : ns_umamusume_official_JP_EVENT_RE;
	if (gacha.test(t)) return "gacha";
	if (event.test(t)) return "event";
	return null;
}

// ── 日期区间 tokenizer（日文 / 英文共用）────────────────────────────────────
// 为什么用 tokenizer 而不是一条大正则：正文明日混杂、年份可省、时刻可省、
// 12 小时制的 am/pm 在月日之后、范围符有 `～`/`〜`/`-`/`–` 多种。
// ⚠️ 全部用具名捕获组。早期版本用 $n 下标（`endate` 里嵌了 `(Jan|…)` 与年份组），
//    导致后续下标整体错位（实测 `g[7].slice` 直接 TypeError）→ 换具名组。
const ns_umamusume_official_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ns_umamusume_official_AMPM = String.raw`(?:a\.?\s?m\.?|p\.?\s?m\.?)`;
const ns_umamusume_official_TOKEN_RE = new RegExp([
	// 日文：2026年10月1日 / 10月1日（"日"必带）
	String.raw`(?<jpdate>(?:(?<y1>\d{4})\s*年\s*)?(?<mo1>\d{1,2})\s*月\s*(?<d1>\d{1,2})\s*日)`,
	// 英文：Sep 28 / September 28, 2026（年份只在**同一段**里粘着才吃，所以 `,?\s*` 里不含 `<`）
	String.raw`(?<endate>\b(?<mon>Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?<d3>\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(?<y3>\d{4}))?)`,
	// 数字：2026/10/1 2026-10-01 10/1
	// ⚠️ 分隔符两侧**不能**用 `\b`（`/` `-` 是 non-word，`/\b\d/` 永不成立 → 实测整条 numdate 全不匹配）
	//    → 用数字边界 `(?<!\d)` / `(?!\d)`。`.` 形式必须两侧都有点（`10.1`）。
	String.raw`(?<numdate>(?<![\d\/\-.])(?:(?<y4>\d{4})[\/\-](?<mo4>\d{1,2})[\/\-](?<d4>\d{1,2})|(?<mo5>\d{1,2})[\/\-](?<d5>\d{1,2})|\.(?<mo6>\d{1,2})\.(?<d6>\d{1,2}))(?![\d\/\-.]))`,
	// 裸 4 位年份（英文写法把年份写在末尾：`Oct 12, 2026`）；不能用 `\b`（见上）
	String.raw`(?<yearonly>(?<![\d\/\-.])\d{4}(?![\d\/\-.]))`,
	// 时刻：10:00 / 9:59 + 可选 am/pm（`\b` 在 `:` 右侧不成立，左侧只用数字边界）
	String.raw`(?<time>(?<!\d)(?<hh>\d{1,2}):(?<mm>\d{2})(?!\d)(?:\s*(?<ampm>${ns_umamusume_official_AMPM}))?)`,
	// 范围符：必须是**独立 token**（早期版本漏了这一支 → `～` 不产生 token，窗口永远配不上，
	// 实测症状是所有详情都退化成 from_date～to_date）。
	//   · `～〜〰` 与 en/em dash：直接认（英文原文 `Sep 28–9:59 p.m.` 前面紧贴数字，不能加"前后非数字"断言）
	//   · 半角 `-`：只认两侧带空白的（`2026-10-01` 里紧贴数字的连字符绝不能被当范围符）
	String.raw`(?<sep>[~～〜〰–—]|(?<![\d\w])\s+-\s+(?![\d\w]))`
].join("|"), "g");

/** 文本 → token 流：[{k:"d"|"t"|"y"|"s", …, at, end}] */
function ns_umamusume_official_tokenizeUma(text) {
	const s = String(text == null ? "" : text);
	ns_umamusume_official_TOKEN_RE.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_umamusume_official_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_umamusume_official_TOKEN_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.jpdate) {
			toks.push({ k: "d", y: g.y1 ? +g.y1 : null, mo: +g.mo1, d: +g.d1, at, end });
		} else if (g.endate) {
			toks.push({ k: "d", y: g.y3 ? +g.y3 : null, mo: ns_umamusume_official_MONTHS[g.mon.slice(0, 3).toLowerCase()] || null, d: +g.d3, at, end });
		} else if (g.numdate) {
			toks.push(g.y4
				? { k: "d", y: +g.y4, mo: +g.mo4, d: +g.d4, at, end }
				: { k: "d", y: null, mo: +(g.mo5 != null ? g.mo5 : g.mo6), d: +(g.d5 != null ? g.d5 : g.d6), at, end });
		} else if (g.yearonly) {
			toks.push({ k: "y", y: +g.yearonly, at, end });
		} else if (g.time) {
			let h = +g.hh;
			const mi = +g.mm;
			const ap = String(g.ampm || "").replace(/[.\s]/g, "").toLowerCase();
			if (ap.startsWith("p") && h < 12) h += 12;
			if (ap.startsWith("a") && h === 12) h = 0;
			toks.push({ k: "t", h, mi, at, end });
		} else if (g.sep) {
			toks.push({ k: "s", at, end });
		}
	}
	return toks;
}
/** 调试用（测试可直接断言 token 流） */
// ── 档期区间的"标板"（plate）正则 ───────────────────────────────────────────
// 走「正则切候选串 → tokenizer 解释」两条腿：位置运算交给正则引擎，避免手工下标。
// ⚠️ 本文件早期版本在同一个 token 数组上手写 `j`/`firstSepIdx` 双重游标，实测出现
//    `j=4 但 seq=["d:11/2"]`（范围符凭空消失）这种自相矛盾状态，最后定位为下标耦合错误。
//    改成正则标板后，从结构上不可能再出现"范围符没被收进 seq"的情况。
const ns_umamusume_official_F_DATE = String.raw`(?:(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|(?:\d{4}[\/\-])?\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)`;
const ns_umamusume_official_F_TIME = String.raw`(?:\d{1,2}:\d{2}(?:\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))?)`;
const ns_umamusume_official_F_SEP = String.raw`(?:[~～〜〰–—]|\s-\s)`;
const ns_umamusume_official_F_ATOM = String.raw`(?:(?:${ns_umamusume_official_F_TIME}\s*,?\s*)?${ns_umamusume_official_F_DATE}(?:\s*,?\s*${ns_umamusume_official_F_TIME})?(?:\s*,?\s*\d{4})?|${ns_umamusume_official_F_TIME})`;
/** 用于"抹掉上下文里的日期/时刻"（取 label 时），以及定位相邻区间 */
const ns_umamusume_official_DATE_TIME_SPAN_RE = new RegExp(String.raw`${ns_umamusume_official_F_ATOM}|${ns_umamusume_official_F_TIME}\s*,`, "g");
const ns_umamusume_official_RANGE_PLATES = [
	new RegExp(String.raw`${ns_umamusume_official_F_ATOM}\s*${ns_umamusume_official_F_SEP}\s*${ns_umamusume_official_F_ATOM}`, "g"),
	// 兜底写法：「…10/1 12:00から11/2 11:59まで」（没有范围符，用「から」）
	/(?:(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2}[^\d]{0,8}から[^\d]{0,8}(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2})/g
];

/** 从正文里切出所有"日期[时刻] 范围符 日期[时刻]"候选串（含位置，供 label 取上下文）；去重叠 */
function ns_umamusume_official_extractUmaRangePlates(s) {
	const text = String(s == null ? "" : s);
	const found = [];
	for (const re of ns_umamusume_official_RANGE_PLATES) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			if (m[0] === "") { re.lastIndex++; continue; }
			found.push({ text: m[0], at: m.index });
		}
	}
	found.sort((a, b) => (a.at - b.at) || (b.text.length - a.text.length));
	const picked = [];
	for (const f of found) {
		if (picked.some((p) => f.at < p.at + p.text.length && p.at < f.at + f.text.length)) continue;
		picked.push(f);
	}
	return picked;
}

/**
 * 标签清洗（从"范围起点之前"的正文里取短标签，如「イベント開催期間」「Spotlight Scout Availability Period」）。
 *
 * ⚠️ 踩过的两个坑，顺序不能反：
 *   ① **先切段再去标签**会切在标签属性里（`<h2 class="heading">` 的最后一个 `>` 落在属性引号里）
 *      → 必须先 `strip tags`，再按句读/换行切段；
 *   ② 不能停在句读/"！"上取整段：日文长公告里"上一段正文 + 下一段标题"中间是句号
 *      （`…開催中です！ イベント開催期間 9/30 …`）→ 段内还有正文。所以段内再取
 *      **最后一个全角空格后的片段**（日文标题与正文之间正是全角空格），并把空白折叠成 `·`。
 *   最后掐掉段首引导词（`As of` / `until` / `まで`）与段尾连接词（`from` / `（UTC）`）。
 */
const ns_umamusume_official_LABEL_LEAD_RE = /^(?:as of|from|until|till|on|at|the|period|期間|日時)\s*[:：]?\s*/i;
const ns_umamusume_official_LABEL_TAIL_RE = /[\s（(]*(?:from|to|until|till|at|on|まで|から|より|以降|以前)[\s（()）]*$/i;
function ns_umamusume_official_labelBeforeUma(text, at) {
	const head = String(text == null ? "" : text).slice(Math.max(0, at - 180), at);
	const plain = head.replace(/<[^>]*>/g, " ").replace(ns_umamusume_official_DATE_TIME_SPAN_RE, " ");
	// ⚠️ 切段对象必须**先掐掉尾部空白**：`…Period</h2>\n ` 去标签后是 `…Period \n `，
	//    直接按最后一个 `\n` 切会只剩一个空格 → 标签全空（实测英文标签就是这么丢的）
	const trimmed = plain.replace(/\s+$/, "");
	const cut = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf("。"), trimmed.lastIndexOf("！"), trimmed.lastIndexOf("!"));
	const seg = trimmed.slice(cut >= 0 ? cut + 1 : 0);
	// 段内取最后一个全角空格后的片段（仅当该空格前面出现 CJK 时；否则英文标题会被切碎）
	const zs = seg.lastIndexOf("\u3000");
	const tail = zs >= 0 && /[぀-ヿ一-鿿]/.test(seg.slice(0, zs)) ? seg.slice(zs + 1) : seg;
	let x = tail.replace(/\s+/g, "·").trim();
	// ⚠️ 两端只能用**字符类**裁剪：`(?:connector)?\s*$` 这种"可选+空白"的正则会把整段吃掉
	//    （实测 `…Availability Period` 被整段删除，因为可选组匹配空 + `\s*$` 匹配了结尾）
	x = x.replace(/^[·\s■・:：、,，\-–—]+/, "").replace(/[·\s,、，■・:：–—-]+$/, "");
	x = x.replace(ns_umamusume_official_LABEL_LEAD_RE, "").replace(ns_umamusume_official_LABEL_TAIL_RE, "");
	x = x.replace(/^&nbsp;|^[·・]+/i, "").replace(/[·\s,、，■・:：–—&-]+$/i, "").trim();
	if (x.length > 40) x = x.slice(-40).trim();
	return x;
}

/**
 * 正文 → 档期窗口数组 [{ startTs, endTs, raw, label }]（按出现顺序，按绝对区间去重）。
 * tz = 源站墙钟时区；hintTs = 该公告 post_at 换算出的绝对时刻（用于补年份）。
 *
 * 两种语序都要吃（实测两种都存在）：
 *   日文 `開催期間 10/1 12:00 ～ 11/2 11:59`                        → [d,t] ～ [d,t]
 *   英文 `Period 10:00 p.m., Sep 28–9:59 p.m., Oct 12, 2026 (UTC)` → [t,d] ～ [t,d]，年份在末段末尾
 */
function ns_umamusume_official_parseUmaWindows(text, tz, hintTs = null) {
	const s = String(text == null ? "" : text);
	const hintParts = hintTs != null && Number.isFinite(hintTs) ? sourceWallParts(hintTs, tz) : null;
	// ⚠️ 这里**有意**不用共用 `inferYear`，理由有两条（不是漏改）：
	//   ① 本源的年份线索是**公告自己的时间戳**（`post_at`），生产路径上一定拿得到，
	//      所以"没有线索"分支实际不可达；退回 `new Date().getFullYear()` 只是兜底。
	//   ② `inferYear` 会做"起始月比线索月晚 6 个月以上 → 算**去年**"的修正 —— 那条规则是为
	//      **当期/近期**公告写的；而赛马娘日服会提前 1~2 个月公告未来活动，
	//      极端情况下（年初公告年末活动）套上去会把**今年**误判成去年。
	//   凡是要合并这条规则的场合，先确认该源的窗口不会远在 hints 之后。
	const hintYear = hintParts ? hintParts.y : new Date().getFullYear();
	const out = [];
	const seen = new Set();

	for (const plate of ns_umamusume_official_extractUmaRangePlates(s)) {
		const toks = ns_umamusume_official_tokenizeUma(plate.text);
		const sepIdx = toks.findIndex((t) => t.k === "s");
		if (sepIdx < 0) continue;
		const left = toks.slice(0, sepIdx);
		const right = toks.slice(sepIdx + 1);
		const startDate = left.find((t) => t.k === "d") || null;
		const startTime = left.find((t) => t.k === "t") || null;
		const endDate = right.find((t) => t.k === "d") || null;
		const endTime = right.find((t) => t.k === "t") || null;
		if (!startDate || (!endDate && !endTime)) continue;

		const y1 = startDate.y != null ? startDate.y : hintYear;
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo || startDate.mo;
			d2 = endDate.d;
			const ey = endDate.y != null ? endDate.y : (right.find((t) => t.k === "y") || {}).y;
			y2 = ey != null ? ey : y1;
			// 跨年：末段月日比起点早且没写年份 → +1 年
			if (ey == null && endsNextYear(startDate.mo, startDate.d, mo2, d2)) y2 = y1 + 1;
		} else {
			mo2 = startDate.mo; d2 = startDate.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, startDate.mo, startDate.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) continue;
		const key = startTs + "|" + endTs;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ startTs, endTs, raw: plate.text.replace(/\s+/g, " ").trim(), label: ns_umamusume_official_labelBeforeUma(s, plate.at) });
	}
	return out;
}

// ── 公告条目 / 详情 ─────────────────────────────────────────────────────────
/** `"2026-10-01 12:00:00"` 这种源站墙钟 → 绝对毫秒（按 tz 解释，**不**用 Date 直接解析） */
function ns_umamusume_official_parseUmaInstant(s, tz) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

/** 列表 JSON → [{ id, title, kind, postTs, postText }]（保持源站顺序：新→旧） */
function ns_umamusume_official_parseUmaIndex(json, mode = "jp", tz = ns_umamusume_official_UMA_JP_TZ) {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const list = json.information_list;
	if (!Array.isArray(list)) throw new Error("uma-bad-list");
	const out = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = it.announce_id;
		if (id == null) continue;
		const title = String(it.title == null ? "" : it.title).replace(/\s+/g, " ").trim();
		out.push({
			id,
			title,
			kind: ns_umamusume_official_classifyUmaTitle(title, mode),
			postTs: ns_umamusume_official_parseUmaInstant(it.post_at, tz),
			postText: it.post_at == null ? "" : String(it.post_at)
		});
	}
	return out;
}

/**
 * 详情 JSON → { id, title, windows, source, postTs, kind }。
 *   source = "body"    ：档期来自正文（正常路径）
 *   source = "fallback"：正文里一条区间都抽不到 → 退化为 from_date ~ to_date
 *                        （只在 `windows[].label` 上标注，**不进 hover**）
 *   source = "none"    ：正文与 from/to 都没有区间 → windows 为空
 */
function ns_umamusume_official_parseUmaDetail(json, tz = ns_umamusume_official_UMA_JP_TZ, classifyMode = "jp") {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const d = json.detail || json.information || null;
	if (!d || typeof d !== "object") throw new Error("uma-bad-detail");
	const title = String(d.title == null ? "" : d.title).replace(/\s+/g, " ").trim();
	const postTs = ns_umamusume_official_parseUmaInstant(d.post_at, tz);
	let windows = ns_umamusume_official_parseUmaWindows(d.message, tz, postTs);
	let source = windows.length ? "body" : "none";
	if (!windows.length) {
		const fromTs = ns_umamusume_official_parseUmaInstant(d.from_date, tz);
		const toTs = ns_umamusume_official_parseUmaInstant(d.to_date, tz);
		if (fromTs != null && toTs != null && toTs > fromTs) {
			windows = [{ startTs: fromTs, endTs: toTs, raw: `${d.from_date} ～ ${d.to_date}`, label: "from_date～to_date（正文无区间，退化；**非**真实档期）" }];
			source = "fallback";
		}
	}
	return { id: d.announce_id, title: title || "", windows, source, postTs, kind: ns_umamusume_official_classifyUmaTitle(title, classifyMode) };
}

// ── 选当期 / 悬停 ───────────────────────────────────────────────────────────
/**
 * 覆盖 now 的「公告 × 窗口」对，按固定偏好排序：
 *   ① startTs 最新（并列取 endTs 更早、id 更小）；
 *   ② 并列时**预告稿排后**：日服同一档期常有两篇（`【予告】…開催決定！` + 正式 `…開催！`），
 *      实测 3469/3470 的窗口完全一样（都是 10-01 12:00 ~ 11-02 11:59）→ 否则外显会显示预告稿。
 *
 * ⚠️ 一条都不覆盖 now → 空数组（`ns_umamusume_official_pickUmaWindow` 据此返回 null = 未公布，绝不把过期/未来档期硬凑成"当期"）。
 * ⚠️ 排序**同时**服务外显与悬停：`ns_umamusume_official_pickUmaWindow` 取第 0 项当外显；`hoverEvent` 不重排 →
 *    活动悬停的第一行就是外显的那条。`hoverPool` 自带"按结束时间升序"的规则（与本体一致），会重排卡池。
 */
function ns_umamusume_official_umaCurrentWindows(entries, now) {
	const active = [];
	for (const e of entries) for (const w of e.windows) if (coversNow(w, now)) active.push({ e, w });
	if (!active.length) return [];
	const previewRank = (e) => (/予告|coming soon/i.test(String(e.title || "")) ? 1 : 0);
	active.sort((x, y) =>
		(y.w.startTs - x.w.startTs)
		|| (previewRank(x.e) - previewRank(y.e))
		|| (x.w.endTs - y.w.endTs)
		|| (x.e.id - y.e.id));
	return active;
}

/**
 * 从多个详情的窗口里选当期：覆盖 now 的窗口里取 startTs 最新（并列取 endTs 更早、id 更小）。
 * 一条都不覆盖 → **返回 null**（未公布），绝不把过期/未来档期硬凑成"当期"。
 */
function ns_umamusume_official_pickUmaWindow(entries, now) {
	return ns_umamusume_official_umaCurrentWindows(entries, now)[0] || null;
}

/**
 * 当期项（交给 `lib/env.js` 的 `hoverPool` / `hoverEvent` 排版）：**一条公告最多一项**。
 *   · `name` = 公告标题（即卡池名 / 活动名）—— 与本体的 `banner：roles` / 活动名同构；
 *     ⚠️ 官方公告**只有标题、没有"角色"字段**，所以卡池悬停的 `name` 就是 `banner` 本身
 *     （本体是 `池名：角色`，这里退化成只有池名；**不**去正文猜角色，也不补任何前缀）。
 *   · 一条公告正文可能有**多段**覆盖 now 的小期间（实测 3472 有 3 段、3481 有 2 段）→ 只取
 *     `ns_umamusume_official_umaCurrentWindows` 里该公告的**第一段**（startTs 最新、并列取 endTs 更早），
 *     否则同名活动会在悬停里重复 2~3 行（本体一律一条目一行）。
 *   · 档期交给共用工具用**源站 tz**（日服 JST / 国际服 UTC）格式化成 `MM-DD HH:MM ~ MM-DD HH:MM`。
 *
 * ⚠️ 悬停里**只放名称与档期**（用户 2026-10-03：「元信息彻底删掉」）。以下信息一律**不进悬停文本**：
 *     来源站名 / URL / API 名 · 时区推定说明 · 抓取统计（`共扫描 N 条 / 取详情 M 条`）·
 *     内部公告 id（`[3470]`）· 源站字段名标签（`開催期間` / `Event·Availability·Period`）·
 *     游戏名+区服前缀 · fallback 退化说明与任何「（…）」实现说明。
 *     这些只留在**代码注释**与 `ns_umamusume_official_parseUmaDetail` 的 `source` / `windows[].label` 字段里（供测试与排障）。
 *     ⚠️ 所以这里**不传 `label`**：`hoverPool` 会用 `label` 顶掉 `name`，而 label 正是源站字段名。
 *
 * ⚠️ 抓取策略说明（"每条候选抓一次详情、每页最多 N 条候选"）写在 `ns_umamusume_official_collectSide` 的注释里，不进悬停。
 */
function ns_umamusume_official_umaCurrentItems(entries, now) {
	const seen = new Set();
	const out = [];
	for (const { e, w } of ns_umamusume_official_umaCurrentWindows(entries, now)) {
		const key = e.id != null ? "id:" + e.id : e;      // 同一条公告只留第一段（见上）
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name: e.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	return out;
}

// ── 传输：POST 自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────────
const ns_umamusume_official_PROXY_PREFIX = "/api/gacha-calendar-proxy";

/** 代理 URL（与 lib/env.js 同形态；测试夹具 harness 能识别该前缀并取出被代理的 url） */
function ns_umamusume_official_proxyUrlFor(url, referer = "", headers = null, contentType = null) {
	let api = ns_umamusume_official_PROXY_PREFIX + "?url=" + encodeURIComponent(url) + "&referer=" + encodeURIComponent(referer);
	if (headers) api += "&headers=" + encodeURIComponent(JSON.stringify(headers));
	if (contentType) api += "&contentType=" + encodeURIComponent(contentType);
	return api;
}

/**
 * POST JSON 的抓取封装。
 *   mode="proxy"（默认）：宿主代理读**请求体**并透传为 POST（见 src/index.js proxyHandler）
 *   mode="direct"       ：浏览器原生 fetch（本两源无 ACAO，实跑只能走 proxy）
 * 结构问题（坏 JSON / 非 200 / 代理拒绝）→ throw。
 */
async function ns_umamusume_official_postJsonUma(url, body, { referer = "", headers = null, signal, mode = "proxy", label = "uma" } = {}) {
	const fetchImpl = globalThis.fetch;
	if (typeof fetchImpl !== "function") throw new Error(label + "-no-fetch");
	const payload = JSON.stringify(body == null ? {} : body);
	if (mode === "direct") {
		const res = await fetchImpl(url, {
			method: "POST",
			signal,
			headers: { "content-type": "application/json; charset=utf-8", accept: "application/json, text/plain, */*", ...(headers || {}), ...(referer ? { referer } : {}) },
			body: payload
		});
		if (!res.ok) throw new Error(label + "-http-" + res.status);
		const text = await res.text();
		try { return JSON.parse(text); } catch { throw new Error(label + "-bad-json"); }
	}
	const api = ns_umamusume_official_proxyUrlFor(url, referer, headers, "application/json; charset=utf-8");
	const res = await fetchImpl(api, { method: "POST", signal, headers: { Accept: "application/json", "content-type": "application/json; charset=utf-8" }, body: payload });
	if (!res.ok) throw new Error(label + "-proxy-http-" + res.status);
	const text = await res.text();
	let j = null;
	try { j = JSON.parse(text); } catch { j = null; }
	if (!j || typeof j !== "object") throw new Error(label + "-proxy-bad-json");
	if (j.status !== 200 || typeof j.body !== "string") throw new Error(label + "-proxy:" + (j.error || j.status));
	try { return JSON.parse(j.body); } catch { throw new Error(label + "-bad-json"); }
}

function ns_umamusume_official_originOf(url) { try { return new URL(url).origin + "/"; } catch { return ""; } }
/** 日服列表 URL 构造函数：分页参数**只有 `page`**（实测 p / page_no / limit / size 全无效） */
function ns_umamusume_official_umaJpPageUrl(base, page) {
	const b = String(base || ns_umamusume_official_UMA_JP_INDEX_URL);
	if (/[?&]page=\d+/.test(b)) return b.replace(/([?&])page=\d+/, "$1page=" + page);
	return b + (b.includes("?") ? "&" : "?") + "page=" + page;
}

// ── 抓取主循环 ──────────────────────────────────────────────────────────────
/**
 * 通用主循环：列表新→旧，只看"卡池/活动"命中的条目；逐条抓详情抽窗口。
 *
 * ⚠️ 为什么**不**在"拿到第一个覆盖 now 的窗口"时就 break：
 *    同一页里可能有多条都覆盖 now（实测日服 page1：卡池 3470/3469 同窗口、活动 3481 与 3472 多段期间），
 *    而列表顺序 ≠ 档期新旧 → 提前 break 会让外显取决于"源站列表顺序"（不确定、且可能选到较旧的那条）。
 *    所以本函数**把本页所有分类命中的候选都扫完**（受 `pageSize`/`maxDetails` 约束），
 *    再由 `ns_umamusume_official_pickUmaWindow` 客观地取"覆盖 now 且 startTs 最新"的那条。
 *    只有"整页都没有覆盖 now 的窗口"时才翻下一页（更早的页只会有更旧的档期，没必要继续）。
 *
 * 错误处理：第一页列表失败 → throw（该侧算抓取失败）；后续页失败 → 当作"没有更多"停止翻页；
 *          单条详情失败 → 跳过并计数（不当成整侧失败）。
 */
async function ns_umamusume_official_collectSide({ side, kind, indexUrl, tz, now, signal, maxDetails, maxPages, pageSize, detailUrlFor }) {
	const details = [];
	const scanned = [];
	let detailCount = 0;
	let skipped = 0;
	const isGlobal = kind === "global";

	for (let page = 1; page <= maxPages && detailCount < maxDetails; page++) {
		const listUrl = isGlobal ? indexUrl : ns_umamusume_official_umaJpPageUrl(indexUrl, page);
		let listJson;
		try {
			listJson = isGlobal
				? await ns_umamusume_official_postJsonUma(indexUrl, { announce_label: ns_umamusume_official_UMA_GLOBAL_LABEL_GAME, limit: 50, offset: 0 }, { referer: ns_umamusume_official_originOf(indexUrl), signal, label: "uma-global-index" })
				: await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(listUrl) });
		} catch (e) {
			if (page === 1) throw e;
			break;
		}
		const items = ns_umamusume_official_parseUmaIndex(listJson, kind, tz);
		for (const it of items) scanned.push(it);
		const cands = items.filter((x) => x.kind === side).slice(0, pageSize);
		let covered = false;
		for (const c of cands) {
			if (detailCount >= maxDetails) break;
			const detailUrl = isGlobal ? ns_umamusume_official_UMA_GLOBAL_DETAIL_URL : detailUrlFor(c.id);
			let dj;
			try {
				dj = isGlobal
					? await ns_umamusume_official_postJsonUma(detailUrl, { announce_id: c.id }, { referer: ns_umamusume_official_originOf(detailUrl), signal, label: "uma-global-detail" })
					: await fetchJson(detailUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(detailUrl) });
			} catch { skipped++; detailCount++; continue; }
			detailCount++;
			let det;
			try { det = ns_umamusume_official_parseUmaDetail(dj, tz, kind); } catch { skipped++; continue; }
			if (!det.title) det.title = c.title;
			if (det.id == null) det.id = c.id;
			details.push(det);
			if (det.windows.some((w) => coversNow(w, now))) covered = true;
		}
		if (covered) break;                      // 本页已有覆盖 now 的候选 → 不再翻页（更早的页只会更旧）
	}
	return { details, scanned, detailCount, skipped };
	// ⚠️ `scanned` / `detailCount` / `skipped` 只作**诊断计数**（原来被拼进悬停首行「共扫描 N 条 / 取详情 M 条」，
	//    用户 2026-10-03 要求「元信息彻底删掉」→ 该首行已删，计数保留给排障与将来日志，**绝不进悬停文本**）。
}

// ── 日服 ────────────────────────────────────────────────────────────────────
/**
 * 赛马娘 日服 官方公告 卡池侧。
 * @param {string} url 列表 URL（默认 ns_umamusume_official_UMA_JP_INDEX_URL；分页参数 `page`）
 * @param {AbortSignal} signal
 * @param {string} tz 源站时区（默认 Asia/Tokyo）
 * @param {number} now 当前时刻（**第 4 参**；仓库历史 bug 是把 now 放第 2 参 → startTs<=now 恒假）
 * @param {{maxDetails?:number,maxPages?:number,pageSize?:number}} opts
 */
async function ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "gacha", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;                       // 抓到公告但当期没有覆盖 now 的卡池期 = 未公布
	// ≥2 个当期池才给悬停；只有 1 个 → **不设** bannerHover，交回 UI 默认两行式（`池名：角色` ⏎ 档期）
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 日服 官方公告 活动侧（イベント / キャンペーン）。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "event", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// ≥2 条当期活动才给悬停；只有 1 条 → **不设** eventHover，交回 UI 默认两行式（`名称` ⏎ 档期）
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 国际服（POST；时区 UTC）─────────────────────────────────────────────────
async function ns_umamusume_official_collectGlobal(side, url, tz, now, signal, opts) {
	const indexUrl = url || ns_umamusume_official_UMA_GLOBAL_INDEX_URL;
	return ns_umamusume_official_collectSide({
		side, kind: "global", indexUrl, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: () => ns_umamusume_official_UMA_GLOBAL_DETAIL_URL
	});
}

/** 赛马娘 国际服（Global）官方公告 卡池侧（Scout）。now 是第 4 参。 */
async function ns_umamusume_official_gachaUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("gacha", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同卡池侧：≥2 个当期池才给悬停，否则交回 UI 默认两行式
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 国际服（Global）官方公告 活动侧。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("event", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同活动侧：≥2 条当期活动才给悬停，否则交回 UI 默认两行式
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-umapyoi.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-umapyoi.js
//
// 由 next-sources/parsers/umapyoi.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_umapyoi__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-umapyoi.js —— 赛马娘 日服（第三方 API：api.umapyoi.net）
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? } | null
//
// ⚠️ 实测（2026-10-02 夹具 `b1-umapyoi-gacha`，704 条）与任务给的简化形态的差别：
//   GET https://api.umapyoi.net/api/v1/gacha → JSON **数组**，每条 =
//     { card_type: "Outfit" | "Support Card", id, start_date, end_date, type }
//   · `start_date` / `end_date` 是 **Unix 秒**（不是毫秒）。
//   · `end_date === 2147483647`（INT32_MAX）是**常驻哨兵**：源站用它表示"没有结束时间"（夹具里 38 条）。
//   · **源站只给"卡"（id + 卡类型）的获取窗口，没有卡池名** —— 所以 banner 只能合成：
//     本解析器把"同一 (start_date, end_date) 的一批新卡"当作一个卡池窗口，
//     banner 写成「赛马娘日服卡池（卡类型…）」。
//     ⚠️ 只按 `start_date` 分组是**错的**：实测 29 个 start_date 同时挂多组不同 end_date，
//        而且常驻卡（哨兵）与有界卡会共用同一个 start_date —— 按 start 分组会把"常驻"
//        混进窗口，从而把整组误判成已过期（2026-03-11 那批就是这样）。
//
// 时区：`Asia/Tokyo`。依据（两条）：
//   ① bwiki 正文硬标注「日服卡池时间记录统一为日本时间」；
//   ② 夹具自洽：666 个**有界** end_date 全部落在 02:59:59Z（= 11:59:59 JST，一个不差），
//      且 664/704 个 start_date 落在 03:00Z（= 12:00 JST，日服卡池 12:00 更新）——
//      只有 UTC+9 才能把这些渲染成"整点 12:00 / 11:59:59"。
//
// 选池规则（本项目 JSON 源的通用约定，见 registry-b1.js 注释）：
//   覆盖当前时刻的**有界窗口**里取 startTs 最新的那批（并列取结束更早、id 更小）。
//   常驻卡（哨兵）不构成"当期窗口"；当期没有任何有界窗口 → 返回 null（未公布）。


const ns_umapyoi_DEFAULT_URL = "https://api.umapyoi.net/api/v1/gacha";
// 供注册表引用（作为「备选源」时必须与 `altSourceId(alt) = alt.url` 的字符串**完全一致**才能命中）
const ns_umapyoi_PERMANENT_END = 2147483647;   // 源站常驻哨兵（Unix 秒 = INT32_MAX）

const ns_umapyoi_toNum = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
// ⚠️ 2026-10-03 收敛：本文件原有 `byNewestStart`，与 bestdori/sekai 那两份**是同一概念的第 3 种写法** ——
//    而且它 `(a.endTs - b.endTs)` **没有 null 守卫**，任一 endTs 为 null 就整条得 NaN、排序未定义。
//    已统一到 `41-sources-shared.js` 的 `byNewestStart`（带 Infinity 兜底），潜在 bug 一并修掉。

// 纯函数：夹具/单测可直接喂 JSON（不联网）
function ns_umapyoi_parseUmapyoiGacha(json, now = Date.now(), tz = "Asia/Tokyo") {
	if (!Array.isArray(json)) throw new Error("umapyoi-bad-shape");
	const rows = [];
	for (const it of json) {
		if (!it || typeof it !== "object") continue;
		const s = ns_umapyoi_toNum(it.start_date);
		if (s == null) continue;
		const e = ns_umapyoi_toNum(it.end_date);
		// 常驻哨兵（或缺失结束）→ endTs 记为 null：**绝不**把 2147483647 当成真实时刻
		const permanent = e == null || e >= ns_umapyoi_PERMANENT_END;
		rows.push({
			id: it.id,
			id0: ns_umapyoi_toNum(it.id) == null ? Number.MAX_SAFE_INTEGER : ns_umapyoi_toNum(it.id),
			cardType: String(it.card_type == null ? "" : it.card_type),
			type: it.type,
			startTs: s * 1000,
			endTs: permanent ? null : e * 1000,
			permanent
		});
	}
	if (rows.length === 0) throw new Error("umapyoi-no-rows");

	// 有界窗口 = 同一 (start_date, end_date) 的一批卡（见文件头：不能只按 start_date 分组）
	const merged = new Map();
	for (const r of rows) {
		if (r.permanent) continue;
		const k = r.startTs + "|" + r.endTs;
		let p = merged.get(k);
		if (!p) { p = { startTs: r.startTs, endTs: r.endTs, id0: r.id0, items: [] }; merged.set(k, p); }
		p.items.push(r);
		if (r.id0 < p.id0) p.id0 = r.id0;
	}
	const pools = [...merged.values()].map((p) => ({
		startTs: p.startTs,
		endTs: p.endTs,
		// `id` 供共用 `byNewestStart` 做末级 tie-break（原来叫 `id0`、只有本地比较器认它）。
		// 池已按 `startTs|endTs` 去重，所以这一级实际不会决出胜负 —— 只是让对象形状与别处一致。
		id: p.id0,
		items: p.items,
		ids: p.items.map((x) => x.id).filter((x) => x != null),
		cardTypes: [...new Set(p.items.map((x) => x.cardType).filter(Boolean))]
	}));

	const active = pools.filter((p) => coversNow(p, now)).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;   // 抓到数据但当期没有有界窗口（常驻卡不算） = 未公布

	const types = cur.cardTypes.join("、");
	const banner = types ? `赛马娘日服卡池（${types}）` : "赛马娘日服卡池";
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ⚠️ 2026-10-03 改：这里原本**手搓悬停**，且三处违反方案 A 的悬停规则 ——
	//    ① 档期在前（`档期  卡级明细`），本体一律「池名 ⏎ 档期」（卡池侧）
	//    ② 塞元信息：内部 id（`（id 30474、50248）`）、源站字段名（`end_date=2147483647 哨兵`）、
	//       来源与实现说明（`赛马娘日服（源站为卡级数据，无卡池名；起止＝该批新卡的获取窗口）`）、
	//       `另有 N 个同期窗口未列出`
	//    ③ 自带 20 行截断（`HOVER_MAX`）
	//    它会漏网是因为它只是 `uma-jp.altSources` 里的**备选源**，不在主源悬停审计的覆盖范围内。
	//    现在改用共用 hoverPool：池名与档期分开两行，无元信息，无截断。
	//    （源站没有卡池名 → 池名用「赛马娘日服卡池（卡级构成）」，与 banner 同构。）
	const hover = hoverPool(active.map((p) => ({
		name: p.cardTypes.length ? `赛马娘日服卡池（${p.cardTypes.join("、")}）` : "赛马娘日服卡池",
		startTs: p.startTs,
		endTs: p.endTs
	})), tz);

	return {
		banner,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// 抓取器：mode="direct"（实测 api.umapyoi.net 响应 ACAO=*）
async function ns_umapyoi_gachaUmapyoi(url, signal, tz = "Asia/Tokyo", now = Date.now()) {
	const data = await fetchJson(url || ns_umapyoi_DEFAULT_URL, { signal, mode: "direct" });
	return ns_umapyoi_parseUmapyoiGacha(data, now, tz);
}

// src/client/35-parsers-sekai.js
//
// 由 next-sources/parsers/sekai.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_sekai__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-sekai.js —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-sekai-gachas` 59 条 / `b1-sekai-events` 198 条）与任务给的形态的差别：
//   1. `gachas.json` 的 `gachaType` 是**字符串枚举**（beginner/normal/sureturn/subeginner/ceil/sunormal），
//      不是数字；`events.json` 的 `eventType` 也是字符串（marathon/cheerful_carnival/world_bloom）。
//   2. **`events.json` 里根本没有 `endAt` 字段**（这是任务给的字段形态里最需要纠正的一处）。
//      实测字段：startAt / aggregateAt / rankingAnnounceAt / distributionStartAt / closedAt / distributionEndAt。
//      本解析器把**活动游玩期**取为 `startAt ~ aggregateAt`（aggregateAt = 活动结束、开始统计的时刻），
//      并在 `eventDatesRaw` 里如实注明这个映射；`closedAt` 是结果公布时刻，不作窗口结束。
//   3. `gachas.json` 里有大量**长期池**：endAt 是 2099 哨兵（如 id 579「任务招募」2025-01-01 ~ 2099-12-30）。
//      它们不参与"当期"选择（见下），只在 hover 里报个数。
//
// 时区：UTC+8（`Asia/Shanghai`）。epoch 毫秒 = 绝对时刻，**不做时区换算**，`tz` 只用于渲染墙钟文本。
//   依据（夹具自洽，把"推测"变成了可验证的三条）：
//   ① 生日池 836「[桐谷遥]HAPPY BIRTHDAY 2026招募」startAt=1790784000000 → UTC+8 渲染正好是 2026-10-01 00:00
//      （桐谷遥生日当天 00:00；UTC+9 会渲染成 01:00，不成立）；
//   ② 月卡池 802「缤纷月卡招募」startAt=1788145200000 → UTC+8 是 2026-09-01 04:00（每月 1 日 04:00 换月卡）；
//   ③ 常规卡池轮换时刻 825/826… 都落在 UTC+8 的 12:00。
//
// ✅ 服区**已确认 = 国服（简体中文）**（2026-10-03 复核，推翻此前"存疑"的判断）：
//   · 仓库 description = "Project Sekai (Simplified Chinese) Master DB Difference"、
//     README = "Sekai Master Data Diff for CN server"（GitHub 原文）
//   · 同库 events / cards / cardEpisodes / characterProfiles **全为简体**
//     （`雨过天晴的启明星` / `卡牌剧情（上篇）` / `宫益坂女子学园`），
//     对照 `tc-diff` 同结构全繁体（`雨後的第一顆星` / `支線劇情（前篇）` / `宮益坂女子學園`）
//   · 官网 pjsk.nvsgames.cn 页脚 published by Nuverse；国服公测 2025-03-27
//
// ⚠️ 但两处**数据质量**问题必须知道（它们不是"区服标错"，是上游回填残留）：
//   ① `events.json` 首条 id=1「雨过天晴的启明星」startAt=1633762800000 = 2021-10-09 15:00(UTC+8)，
//      **早于国服公测**（2025-03-27）→ 该时间线是上游对齐/回填的产物，
//      拿它当"国服活动排期"会**失真**。
//   ② 部分条目名是繁体（59 条卡池里 18 条，如 gacha 16「新手應援起跑衝刺招募」）→
//      国服客户端为「世界」的回响回填 2020–2024 历史时**沿用了繁中串**（CN/TW 共用 Nuverse 6.4.0
//      结构）；2024-05 之后的记录全部是简体。
//      **不做机械繁转简**：两岸官方译法本就不同（`[新手应援]必定获得1名★4成员10连招募券招募`
//      vs 繁中服 `[新手應援]必中1名★4成員10連票券招募`），机械转换会产出第三种、非官方的字符串。


const ns_sekai_DEFAULT_GACHA = "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json";
const ns_sekai_DEFAULT_EVENT = "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json";
// 长期/常驻池阈值：**用本体那一条**（`LONG_TERM_MAX_WINDOW_DAYS`），不再自带数字。
// 旧值 400 天只够挡住 2099 哨兵值，会放过 365 天的**永久**池 ——
// 实测 `新手限定★4自选阶梯招募`（03-26 16:00 ~ 次年 03-26 15:59，整 365 天）就是这样漏进"当期招募"的
// （用户 2026-10-03 要求「规则和原来一致」）。限时招募最长约 1 个月，120 天阈值不会误伤。
const ns_sekai_LONG_MS = LONG_TERM_MAX_WINDOW_DAYS * 864e5;

// ⚠️ 2026-10-03 收敛：本文件原有 `toTs`（**严格版**：只接受 number，数字字符串返回 null）
//    与 `byNewestStart`（与 bestdori 那份逐字相同）。均已统一到 `41-sources-shared.js` 的
//    `numOrNull` / `byNewestStart`。取宽容版对本源无影响（`gachas.json`/`events.json` 里都是数字），
//    但若源站哪天改成字符串就能直接吃下，不必再改代码。

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**池里取 startTs 最新的一期当"当期招募"；长期池（2099 哨兵等）不参与"当期"，
// 也不进悬停（它们恒在架，列出来是噪音）。
function ns_sekai_parseSekaiGachas(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = numOrNull(g.startAt), e = numOrNull(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e, long: e - s > ns_sekai_LONG_MS });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => coversNow(x, now));
	const bounded = active.filter((x) => !x.long).sort(byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 悬停 = 全部当期**有界**池（长期池不参与"当期"，见上）。每池一行池名 + 档期，窗口完全相同则
	// 档期只在末尾写一遍 —— 排版交给共用工具 hoverPool（与本体 buildPoolHover 逐字一致）。
	// 源站没有角色名 → name 就用池名本身（对应本体的「池名：角色」里的池名位置）。
	// 池名里的「（ceil）」等后缀来自 `gachaType` 枚举，**不是源站原文** → 不进悬停；
	// 同名同窗的阶梯/高级礼物招募多条各自成行（源站如此，不再合并成 ×n）。
	const hover = hoverPool(bounded.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);
	// 只有 1 个当期池 → hover 为 ""，**不设 bannerHover**，由 UI 走默认两行式「banner ⏎ bannerDates」
	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
function ns_sekai_parseSekaiEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-event-bad-shape");
	const rows = [];
	for (const e of json) {
		if (!e || typeof e !== "object") continue;
		const s = numOrNull(e.startAt);
		const agg = numOrNull(e.aggregateAt);
		const end = agg != null ? agg : numOrNull(e.closedAt);   // 源站无 endAt：优先 aggregateAt
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name || s == null || end == null || end <= s) continue;
		rows.push({ id: e.id, name, type: String(e.eventType || ""), startTs: s, endTs: end, closedAt: numOrNull(e.closedAt) });
	}
	if (rows.length === 0) throw new Error("sekai-event-bad-shape");
	const active = rows.filter((x) => coversNow(x, now)).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ⚠️ 降级逻辑（保留）：源站 `events.json` **没有** `endAt` 字段，活动游玩期取 `startAt ~ aggregateAt`
	//    （aggregateAt = 活动结束、开始统计的时刻）；aggregateAt 缺失时退回 `closedAt`。
	//    这句说明是**实现细节**，只留在代码注释里，**不进悬停**。
	// `eventDatesRaw`：既有约定是"保留源站原文"，这里如实记录上面那次映射（本体也有条目这么做）。
	// `eventDatesRaw` 就写格式化档期本身：UI 的默认两行式会直接显示它
	// （`eventDatesRaw || eventDates`），所以**不能**在这儿夹带说明文字
	// —— 用户 2026-10-03 明确要求「元信息彻底删掉」。实测旧版把说明拼进来后，
	//    面板上出现了 `09-30 15:00 ~ 10-09 20:59（源站无 endAt：结束取 aggregateAt；…）` 这种尾巴。
	const raw = dates;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」（档期由共用工具 fmtWindow 格式化，
	// 与本体 buildEventHover 逐字一致）。**不排序**由工具负责 → 这里先排好序再传。
	// 只有 1 条 → 工具返回 ""，不设 eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	const ordered = active.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
	const hover = hoverEvent(ordered.map((x) => ({ name: x.name, startTs: x.startTs, endTs: x.endTs })), tz);
	return {
		event: cur.name,
		eventDates: dates,
		eventDatesRaw: raw,
		...(hover ? { eventHover: hover } : {})
	};
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
async function ns_sekai_gachaSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_GACHA, { signal, mode: "direct" });
	return ns_sekai_parseSekaiGachas(data, now, tz);
}
async function ns_sekai_eventsSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_EVENT, { signal, mode: "direct" });
	return ns_sekai_parseSekaiEvents(data, now, tz);
}

// src/client/35-parsers-gf2.js
//
// 由 next-sources/parsers/gf2.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_gf2__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-gf2.js —— 少女前线2：追放 国服（sunborngame 官方 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/gf2-*）────────────────────────
// 列表 API：GET /website/news_list/{typeId}?page=1&limit=10
//   → { code:0, msg:"", data:{ limit, page, total, list:[{Id,Type,Title,Date,Content,Marks,Site,GlobalTop}] } }
//   ⚠️ **列表里的 `Content` 恒为空字符串**（实测 4 个夹具都是 ""）：正文只在详情 API 里。
//      所以卡池/活动的「活动时间」必须再抓一次 /website/news/{Id}。
//      任务书里说的「Content 是 HTML 富文本」指的是**详情**响应，列表响应不是。
// 详情 API：GET /website/news/{Id} → { code:0, data:{ Id, Type, Title, Date, Content:"<p>…<br>…", … } }
//
// ── typeId 实测语义（与任务书的「简化版形态」有出入，以实测为准）──────────────
//   · typeId=1：资讯（艾莫远航 / 邮件赠礼 / 外观情报），1163 条。不是排期。
//   · typeId=2/5/6/7/8：**全为空**（total=0）。
//   · typeId=3：官方公告（版本更新公告 / 临时维护公告 / 封禁公告），83 条。**里面没有活动。**
//   · typeId=4：**活动与卡池混排**，536 条。同页既有【静默突触】【迭代回廊】这类主题活动，
//     也有「…限时概率UP活动现已开启！」「【新装采购·睡醒的人鱼】」「【重逢采购】」这类卡池公告。
//   ⇒ **两侧都读 typeId=4**，靠标题互补过滤分流：
//        命中 概率UP/采购/军备提升 → 卡池；其余 → 活动。
//     （GF2 的卡池就叫「采购」，装备池叫「军备提升」。）
//   ⚠️ 2026-10-03 修：活动侧原先读 typeId=3 并外显版本更新公告的**维护窗口**
//      （面板上出现「9月22日版本更新公告 · 09-22 09:00~12:00」= 停机维护 3 小时），
//      已改为读 typeId=4。详见 ns_gf2_eventsGf2 处的注释。
//
// ── `Date` 字段的真正含义（实测的交叉验证，非猜测）──────────────────────────
//   · 9/22 版本更新公告：Date="2026-09-21 18:31:03"（公告发布时刻），
//     正文「维护时间：2026年9月22日09:00~12:00」。
//   · 卡池公告 2128「代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！」：
//     Date="2026-09-22 12:00:00" = **当日维护结束 12:00**；正文「活动时间：
//     2026年9月22日 版本更新后~2026年10月13日 08:59」。
//   · 另一条【迭代回廊】Date="2026-10-01 05:00:00" —— 正是国服每日 05:00 刷新点。
//   ⇒ `Date` = **该条公告的生效时刻**，而正文里的「版本更新后」= 维护结束 = `Date` 的时刻部分。
//     所以「版本更新后」这类**起点不明确的窗口**用 `Date` 的时刻补齐（源站自身给出的值），
//     不去猜「凌晨4点」之类的惯例。日期不同日则视为无法解析、跳过该窗口（宁缺勿造）。
//
// ── 时区 UTC+8（Asia/Shanghai）**推定** ─────────────────────────────────────
//   源站正文未硬标注时区。推定依据：① API 的 Date 全部是北京时间口径（发布 18:31、
//   维护 09:00~12:00）；② 每日刷新点 05:00 是国服惯例；③ 同一条公告里的维护窗口与
//   卡池窗口同源同口径。属**推定**，报告里已注明（非硬证据）。


const ns_gf2_GF2_BASE = "https://gf2-web-preregister-api.sunborngame.com";
const ns_gf2_GF2_HOME = "https://gf2.sunborngame.com/";
const ns_gf2_GF2_TZ = "Asia/Shanghai";
// 注册表用的两个入口。
// ⚠️ 两侧**同一个 typeId=4**（活动与卡池混排），用互补过滤分流：
//    命中 ns_gf2_GF2_POOL_RE → 卡池；其余 → 活动。
//    曾经的 eventUrl 是 typeId=3（官方公告），那里面**只有版本更新/维护/封禁**，
//    导致活动侧外显成「9月22日版本更新公告 · 09-22 09:00~12:00」= 停机维护窗口（已修）。
const ns_gf2_GF2_GACHA_URL = `${ns_gf2_GF2_BASE}/website/news_list/4?page=1&limit=10`;
const ns_gf2_GF2_EVENT_URL = `${ns_gf2_GF2_BASE}/website/news_list/4?page=1&limit=10`;

// 依次试候选：单条失败（网络/404）不整体崩，留给下一条；**全部失败则抛出第一个错误**
// —— 不能把"源站挂了"静默降级成"未公布"（那会让上层以为当期真的没内容）。
async function ns_gf2_firstWorking(candidates, work) {
	let firstErr = null;
	for (const c of candidates) {
		try {
			const r = await work(c);
			if (r) return r;
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// 卡池类公告的标题特征（实测：采购 = 角色池，军备提升 = 装备池）
const ns_gf2_GF2_POOL_RE = /概率UP|采购|军备提升/;

// ── 列表解析 ──
// 容错：形状不对 → 抛错（= 该侧抓取失败）；list 为空数组 → 返回 []（= 当期无内容）
function ns_gf2_parseGf2List(json, tz = ns_gf2_GF2_TZ) {
	if (!json || typeof json !== "object") throw new Error("gf2-bad-json");
	if (json.code !== 0) throw new Error("gf2-code-" + json.code);
	const data = json.data;
	if (!data || !Array.isArray(data.list)) throw new Error("gf2-bad-json");
	return data.list
		.filter((x) => x && typeof x.Id === "number" && typeof x.Title === "string")
		.map((x) => ({
			id: x.Id,
			type: x.Type,
			title: x.Title,
			date: typeof x.Date === "string" ? x.Date : "",
			dateTs: ns_gf2_parseGf2Date(x.Date, tz)
		}));
}

// "2026-09-22 12:00:00" → 绝对毫秒（按 tz 解释源站墙钟）。解析不出 → null
function ns_gf2_parseGf2Date(s, tz = ns_gf2_GF2_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_gf2_gf2DetailUrl(id) { return `${ns_gf2_GF2_BASE}/website/news/${id}`; }

// ── 正文窗口解析 ──
// 令牌化：日期(必带年) / 时刻 / 「版本更新后」类短语 / 区间分隔符
// 为什么用令牌而不用一条大正则：GF2 的窗口有 3 种写法混排——
//   `2026年9月22日09:00~12:00`（同日，末段只有时刻）
//   `2026年9月22日 版本更新后~2026年11月3日 08:59`（起点是短语）
//   `2026年9月22日 版本更新后~2026年10月13日 08:59`
// 令牌走法可以把「起点未知」和「末段缺日期」分别处理，比分组的可选组好读也好测。
const ns_gf2_GF2_TOKEN = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?|(版本更新完成后|版本更新后|更新维护后|维护完成后|维护后|更新后)|([~～\-—－至])/g;

// 「维护后」类短语 → 用 dateHint（= 该条公告的 `Date`）的时刻补起点；
// 只有 hint 的**日历日**与窗口起点日一致时才敢用（否则宁可不解析这个窗口）
function ns_gf2_resolvePhrase(phrase, dateHint, tz, y, mo, d) {
	if (!phrase || !dateHint) return null;
	const hintParts = sourceWallParts(dateHint, tz);
	if (!hintParts) return null;
	if (hintParts.y !== y || hintParts.mo !== mo || hintParts.d !== d) return null;
	return { h: hintParts.h, mi: hintParts.mi };
}

// 从正文纯文本抽窗口。返回 [{ label, startTs, endTs, raw, openStart }]
//   · 只认**同一行内**的窗口（textOf 已把 <br> 变成 \n）——实测 GF2 的窗口都不跨行
//   · 单日期（如「补偿有效期：2026年9月28日23:59:59」）不构成窗口 → 不产出（不硬凑区间）
function ns_gf2_parseGf2Windows(text, tz = ns_gf2_GF2_TZ, dateHint = null) {
	const out = [];
	const lines = String(text == null ? "" : text).split("\n");
	let lastHeader = "";
	for (const lineRaw of lines) {
		const line = String(lineRaw);
		if (!line.trim()) continue;
		const toks = [];
		ns_gf2_GF2_TOKEN.lastIndex = 0;
		let m;
		while ((m = ns_gf2_GF2_TOKEN.exec(line)) !== null) {
			toks.push({
				date: m[1] ? { y: +m[1], mo: +m[2], d: +m[3] } : null,
				time: m[4] != null ? { h: +m[4], mi: +m[5], s: m[6] != null ? +m[6] : 0 } : null,
				phrase: m[7] || null,
				sep: m[8] || null,
				at: m.index,
				end: m.index + m[0].length
			});
			if (m[0] === "") ns_gf2_GF2_TOKEN.lastIndex++;   // 保险：零宽匹配不吞死循环
		}
		let i = 0;
		while (i < toks.length) {
			const t0 = toks[i];
			if (!t0.date) { i++; continue; }
			let j = i + 1;
			let startTime = null, startPhrase = null;
			if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { startPhrase = toks[j].phrase; j++; }
			if (!(toks[j] && toks[j].sep)) { i++; continue; }
			j++;
			let endDate = null, endTime = null, endPhrase = null;
			if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
			if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { endPhrase = toks[j].phrase; j++; }
			if (!endDate && !endTime && !endPhrase) { i++; continue; }

			const y1 = t0.date.y, mo1 = t0.date.mo, d1 = t0.date.d;
			// 末段没写日期（同日窗口，如 `09:00~12:00`）→ 日期同起点。
			// 注意：GF2 的日期令牌**必带年**（没有「9月22日」这种裸写法），所以 endDate 一定有 y。
			const eD = endDate || { y: y1, mo: mo1, d: d1 };
			const y2 = eD.y, mo2 = eD.mo, d2 = eD.d;

			// 起点时分
			let h1 = 0, mi1 = 0;
			if (startTime) { h1 = startTime.h; mi1 = startTime.mi; }
			else if (startPhrase) {
				const r = ns_gf2_resolvePhrase(startPhrase, dateHint, tz, y1, mo1, d1);
				if (!r) { i++; continue; }          // 短语无法定日 → 跳过，不猜
				h1 = r.h; mi1 = r.mi;
			}
			// 终点时分
			let h2 = 23, mi2 = 59;
			if (endTime) { h2 = endTime.h; mi2 = endTime.mi; }
			else if (endPhrase) {
				const r = ns_gf2_resolvePhrase(endPhrase, dateHint, tz, y2, mo2, d2);
				if (!r) { i++; continue; }
				h2 = r.h; mi2 = r.mi;
			}

			const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			if (!(endTs > startTs)) { i++; continue; }
			const pre = line.slice(0, t0.at);
			let label = pre.replace(/[\s\u00a0]+/g, "").replace(/[:：]+$/, "");
			// 行内标签过长（说明这行是正文句子而非「XX时间：」标签）→ 不用它
			if (label.length > 12) label = "";
			if (!label) label = lastHeader;
			out.push({
				label,
				startTs,
				endTs,
				raw: line.slice(t0.at, toks[j - 1].end).trim(),
				openStart: !!startPhrase
			});
			i++;
		}
		// 记忆「上一行是短标签行」（如单独一行的 `活动时间：`）→ 供下一行的窗口当 label。
		// 只认以「时间/日程/期间/期限/范围」结尾且不含数字的短行，避免把 `尊敬的指挥官：`
		// 这种称呼行当成标签（实测踩到：2142 的维护窗口被标成"尊敬的指挥官"）。
		const cleaned = line.replace(/[\s\u00a0★☆※]+/g, "");
		if (cleaned && /[:：]$/.test(cleaned) && cleaned.length <= 12) {
			const cand = cleaned.replace(/[:：]+$/, "");
			if (!/\d/.test(cand) && /(时间|日程|期间|期限|范围)$/.test(cand)) lastHeader = cand;
		}
	}
	return out;
}

// 卡池公告正文里的 UP 对象（人形）→ roles
function ns_gf2_parseGf2Roles(contentHtml) {
	const t = textOf(contentHtml);
	const a = t.indexOf("本期概率UP对象");
	const b = t.indexOf("访问说明");
	const scope = a >= 0 ? t.slice(a, b > a ? b : undefined) : t;
	const names = [];
	for (const m of scope.matchAll(/■\s*(?:精英|标准|旧式)?人形[「【]([^」】]{1,20})[」】]/g)) {
		const n = m[1].trim();
		if (n && !names.includes(n)) names.push(n);
	}
	return names.join("、");
}

function ns_gf2_cleanTitle(t) {
	return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

// 活动名（悬停行首用）：标题去掉「现已开启/限时开启/正式开启」这类**通用开启语**，其余原样保留。
//   `【静默突触】现已开启` → `【静默突触】`
// 为什么要去：一行里若写成「【静默突触】现已开启·玩法开启时间」，「开启」重复两次很难读。
// 去不掉（标题本身就是完整名称）时回退原标题，绝不返回空串。
// ⚠️ 副词组必须**含「现」**（实测夹具标题就是「现已开启」），且动词组必须**必需**：
//    若写成 `(?:已|限时)?(?:开启|上线|开放)?$`，因为整组可空，引擎会退化成只吃掉末尾的「开」，
//    把「现已开启」削成「现」（实测踩到）。
const ns_gf2_GF2_OPEN_SUFFIX = /[!！。.\s]*((?:现已|现已正式|正式|限时|即将|已)?(?:开启|上线|开放))[!！。.\s]*$/;
function ns_gf2_gf2EventName(title) {
	const s = ns_gf2_cleanTitle(title).replace(ns_gf2_GF2_OPEN_SUFFIX, "").trim();
	return s || ns_gf2_cleanTitle(title);
}

// 一个「活动名 + 该窗口的区分名（源站标签，如「玩法开启时间」/「奖励兑换时间」）」。
// 同一条公告里多个**不同名**的时间窗（玩法开启 / 奖励兑换）必须能互相区分，
// 且**行首必须可读名称而不是纯档期**（用户 2026-10-03 反馈的偏差②，少前2 最严重：
// 旧悬停里根本没有活动名，只有 `09-22 12:00 ~ 11-03 08:59   玩法开启时间`）。
// 拿不到标签的行退化为「活动名」+ 该行 raw 原文（由 hoverEvent 处理，不硬造标签）。
function ns_gf2_gf2WindowName(baseName, w) {
	const label = String((w && w.label) || "").trim();
	return label ? `${baseName}·${label}` : baseName;
}

// 选当期窗口：优先「覆盖 now」的（越快结束越该被盯住，与插件 selectCurrent 同口径），
// 其次未来最近要开的，最后退化为结束最晚的。
function ns_gf2_selectGf2Window(wins, now) {
	const list = Array.isArray(wins) ? wins : [];
	if (!list.length) return null;
	const covering = list.filter((w) => coversNow(w, now));
	if (covering.length) return covering.slice().sort((a, b) => a.endTs - b.endTs)[0];
	const future = list.filter((w) => w.startTs > now).sort((a, b) => a.startTs - b.startTs);
	if (future.length) return future[0];
	return list.slice().sort((a, b) => b.endTs - a.endTs)[0];
}

// ── 卡池侧 ──
// 取 typeId=4 列表 → 过滤卡池类公告（概率UP/采购/军备提升）→ 详情 → 抽窗口。
// 逐条最多试 3 条（一般第 1 条就命中），避免为了容错把请求数放大。
async function ns_gf2_gachaGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_GACHA_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const pools = list.filter((x) => ns_gf2_GF2_POOL_RE.test(x.title));
	const ordered = (pools.length ? pools : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	return ns_gf2_firstWorking(ordered.slice(0, 3), async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		return {
			banner: ns_gf2_cleanTitle(it.title),
			roles: ns_gf2_parseGf2Roles(d.Content || ""),
			bannerDates: fmtWindow(w.startTs, w.endTs, tz),
			bannerDatesRaw: w.raw,
			startTs: w.startTs,
			endTs: w.endTs
		};
	});
}

// ── 活动侧 ──
// ⚠️ 2026-10-03 修的真实 bug：原实现读 **typeId=3（官方公告栏目）**，取最新「版本更新公告」，
//   外显其**维护窗口** —— 面板上就出现了
//       「9月22日版本更新公告」  09-22 09:00 ~ 09-22 12:00
//   这是**停机维护的 3 小时**，跟"当前活动"毫无关系（用户反馈"少前2 活动有问题"）。
//   实测确认：typeId=3 里只有版本更新/临时维护/封禁公告，**没有活动**；
//   `typeId=2/5/6/7/8` 全为空，`typeId=1` 是资讯（艾莫远航）；**活动与卡池同在 typeId=4**。
//   例（typeId=4 实测）：
//     【静默突触】现已开启            玩法开启时间：2026年9月22日 版本更新后~2026年11月3日 08:59
//     代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！  活动时间：…~2026年10月13日 08:59
//   修法：活动侧与卡池侧**读同一个 typeId=4**，用**互补过滤**分流 ——
//     命中 ns_gf2_GF2_POOL_RE（概率UP/采购/军备提升）→ 卡池；其余 → 活动。
async function ns_gf2_eventsGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_EVENT_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	// 排除法：typeId=4 排掉卡池，剩下的就是活动
	const acts = list.filter((x) => !ns_gf2_GF2_POOL_RE.test(x.title));
	const ordered = (acts.length ? acts : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	// 逐条试，取**第一条能解出覆盖当前时刻窗口**的活动（列表按 Id 倒序 = 最新在前；
	// 版本大活动如【静默突触】排在最前，与官方"头条"一致）
	return ns_gf2_firstWorking(ordered.slice(0, 4), async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		// 悬停：只把**覆盖当前时刻**的窗口当作"当期"，其余（未来/已过）不列进 hover，避免误导。
		// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`。
		// 名称 = 活动名 + 该窗口的源站标签（「玩法开启时间」/「奖励兑换时间」），这样一条公告里的
		// 多个不同名窗口既**行首可读**（不再是纯档期打头），又能互相区分。
		// 只有 1 条窗口 → hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式。
		const baseName = ns_gf2_gf2EventName(it.title);
		const active = wins
			.filter((x) => coversNow(x, now))
			.sort((a, b) => a.endTs - b.endTs);
		const eventHover = hoverEvent(active.map((x) => ({
			name: ns_gf2_gf2WindowName(baseName, x),
			startTs: x.startTs,
			endTs: x.endTs,
			raw: x.raw
		})), tz);
		return {
			event: ns_gf2_cleanTitle(it.title),
			eventDates: fmtWindow(w.startTs, w.endTs, tz),
			eventDatesRaw: w.raw,
			...(eventHover ? { eventHover } : {})
		};
	});
}

// src/client/35-parsers-fgo.js
//
// 由 next-sources/parsers/fgo.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_fgo__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-fgo.js —— FGO 国服 · fgo.wiki（MediaWiki 1.43.9 + SemanticMediaWiki）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ══ 为什么最终选了「解析 HTML 表格」而不是 SMW `action=ask`（两条路都实测过）══
// 任务书提示该站启用了 SMW、`action=ask` 能拿结构化结果。实测结论：**ask 可用，但这条
// 路在本站选不出「国服当期」**，所以外显走 HTML 表格；SMW 只留作交叉验证时间口径。
//
//   ✅ ask 确实能用（2026-10-02 实测）：
//      https://fgo.wiki/api.php?action=ask&query=[[分类:活动]][[开始时间::>2026/09/01]]|?中文名称|?开始时间|?结束时间|?类型
//      返回 SMW 属性 `中文名称` / `开始时间` / `结束时间` / `类型`(Event|Campaign)，
//      且时间值带 `timestamp`（**UTC 秒**，例如 幕末武斗神话 开始 raw=1/2026/9/24/11/0/0/0
//      = 11:00Z ↔ 国服表 19:00 → +8）。这一点比仓库里原神那套（bwiki 的 raw 是服务器本地 +08，
//      需要按 tz 解释）更省事。
//   ❌ 但 `分类:活动` **同时含国服与日服的页面，且没有任何服务器判别字段**：
//      · 页面属性里确实有 `国服`/`日服`/`服务器` 三个 Property，实测**值全为空数组**
//        （printouts.国服 = []）→ 过滤不掉，`[[国服::+]]` 查询返回 0 条。
//      · 分类也一致：国服的「幕末武斗神话…」与日服的「见鬼去吧！南瓜农场屠杀」都是
//        `分类:活动` + `分类:主要活动` + `分类:活动信息`。
//      · 结果：2026-10-02 这一天，国服(9/24~10/15)与日服(9/16~10/7)两个 **Event** 都覆盖当期，
//        ask 无法回答"哪个是国服当期活动"。夹具 fgo-ask-activity 保留了这份证据。
//   ❌ 卡池侧 ask 更没用：`分类:推荐召唤` 的页面 printouts 只有一个畸形键 `{"3":[]}`，
//      **没有 开始时间/结束时间 属性**。
//   ✅ HTML 路（本文件采用）：`卡池一览` 的第一张表表头就写着 **「国服当前卡池」**；
//      `活动一览` 的国服表按年份分节（`2026年`），而日服表在页面最前面、表头明确标注
//      **「活动时间 （日本标准时间）」** —— 服务器归属是**页面自己标好的**，不用猜。
//      行内还带 `data-sort-value="2026-09-29 11:00"`（UTC）可交叉校验（本文件不依赖它）。
//
// ══ 实测形态（夹具 fgo-gacha-parse 115KB / fgo-event-parse 1.4MB）══
//   · `卡池一览`：3 张表 = [国服当前卡池, 日服当前卡池, 国服近未来卡池(带「预估」)]
//     列 = 卡池名 | 开始时间 ~ 结束时间 | 推荐召唤从者 | 推荐召唤概念礼装
//     窗口原文形如 `2026年9月22日(周二) 19:00 ~ 2026年10月6日(周二) 13:59`（同日用 <br> 分隔）
//   · `活动一览`：12 张表 = [日服当前(表头含「日本标准时间」), 2026年, 2025年, … 2016年]
//     国服表列 = 活动时间 | 名称 | 公告页面 | 类型
//     ⚠️ 国服表的**两个日期之间没有 `~`**，靠 `<br />` 换行分隔
//        （`<td data-sort-value="…">2026年9月29日(周二)19:00<br />2026年12月20日(周日)13:59`）
//        → 所以不按"分隔符"解析，而是「取该单元格里出现的**前两个** 日期+时刻」。
//
// ══ 时区 UTC+8（Asia/Shanghai）—— 有硬交叉验证 ══
//   国服表头不标时区，但：SMW 里同名活动的 `开始时间`(UTC) 与国服表墙钟**严格差 8 小时**
//   （幕末武斗神话：SMW=2026-09-24T11:00Z ↔ 国服表 9/24 19:00；南瓜农场屠杀同类吻合）
//   → 国服表就是 UTC+8，非推测。
//
// ══ 缓存警告 ══
//   两个页面顶部都有「该页面的信息或许并非最新 …刷新页面缓存」提示。任务书建议 `&action=purge`，
//   实测 **purge 必须 POST**（`{"error":{"code":"mustbeposted"}}`），而本目录的传输层
//   （lib/env.js `fetchText`/`fetchJson`）只有 GET —— 所以**不做 purge**。
//   好在 `action=parse` 是按当前 revision 重新渲染的（夹具里页面自带的刷新链接时间戳
//   `_=20261001172628` 正是抓取时刻），实测数据是新鲜的。


const ns_fgo_FGO_API = "https://fgo.wiki/api.php";
const ns_fgo_FGO_GACHA_PAGE = "卡池一览";
const ns_fgo_FGO_EVENT_PAGE = "活动一览";
const ns_fgo_FGO_TZ = "Asia/Shanghai";
const ns_fgo_FGO_REFERER = "https://fgo.wiki/";

function ns_fgo_fgoParseUrl(page) {
	// ⚠️ 这里对 page 做 encodeURIComponent —— registry-<batch>.js 里的 URL 必须用**同一个**构造方式，
	// 否则离线夹具（test/map.json / cases-b3.mjs 的 overrides 按整串匹配）会命中不到。
	return `${ns_fgo_FGO_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_fgo_FGO_GACHA_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE);
const ns_fgo_FGO_EVENT_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE);

// ── 只做 indexOf 扫描的表格切分（1.4MB 页面上不跑贪婪正则）──
function ns_fgo_fgoTables(html) {
	const heads = [];
	const hre = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g;
	let hm;
	while ((hm = hre.exec(html)) !== null) heads.push({ index: hm.index, text: stripTags(hm[2]) });
	const out = [];
	let i = html.indexOf("<table");
	while (i !== -1) {
		const end = html.indexOf("</table>", i);
		let head = null;
		for (let k = heads.length - 1; k >= 0; k--) if (heads[k].index < i) { head = heads[k].text; break; }
		out.push({ index: i, head, html: html.slice(i, end === -1 ? html.length : end + 8) });
		i = html.indexOf("<table", i + 1);
	}
	return out;
}

function ns_fgo_rowsOf(tableHtml) {
	return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}
function ns_fgo_cellsOf(rowHtml) {
	return [...rowHtml.matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/g)].map((m) => m[2]);
}
function ns_fgo_isHeaderRow(cells) {
	const first = stripTags(cells[0]);
	if (/国服当前卡池|日服当前卡池|国服近未来卡池/.test(first)) return true;
	const t = cells.map((c) => stripTags(c)).join(" ").trim();
	return /^活动时间/.test(t) && /名称/.test(t);
}

// ── 单元格里的「日期+时刻」对 ──
// 取该单元格中**前两个**「YYYY年M月D日(周X) HH:MM」；时刻可缺（近未来表写「预估 … ~ …」）
// → 缺起点时刻按 00:00、缺终点时刻按 23:59（只影响预估行，当期表都有明确时刻）
const ns_fgo_FGO_DT = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*周\s*[一二三四五六日天]\s*[）)])?(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/g;
function ns_fgo_parseFgoWindow(cellText, tz = ns_fgo_FGO_TZ) {
	const hits = [];
	ns_fgo_FGO_DT.lastIndex = 0;
	let m;
	while ((m = ns_fgo_FGO_DT.exec(String(cellText || ""))) !== null) {
		hits.push({ text: m[0].replace(/\s+/g, " ").trim(), y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null });
		if (m[0] === "") ns_fgo_FGO_DT.lastIndex++;
	}
	if (hits.length < 2) return null;
	const a = hits[0], b = hits[1];
	const startTs = sourceInstant(a.y, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
	const endTs = sourceInstant(b.y, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
	if (!(endTs > startTs)) return null;
	// raw 用两个匹配片段拼 `… ~ …`：国服活动表的两个日期之间**没有**分隔符（只有 <br />），
	// 拼接后既能当"源站原文"展示，也和卡池表的原文形态一致。
	return { startTs, endTs, raw: `${a.text} ~ ${b.text}` };
}

// 选当期：覆盖 now 的里按 (类型档位, 结束时间, 开始时间) 取第一 —— 与插件
// 30-parsers.js 的 sortEventItems/pickEventPrimary 同口径（越快结束越该被盯住）。
// 没有覆盖的 → 取最近要开的；再没有 → null（未公布，不硬造）。
function ns_fgo_pickRow(rows, now) {
	if (!rows.length) return null;
	const covering = rows.filter((r) => coversNow(r, now));
	const pool = covering.length ? covering : rows.filter((r) => r.startTs > now);
	if (!pool.length) return null;
	return pool.slice().sort((a, b) => {
		const t = (a.tier || 0) - (b.tier || 0);
		if (t !== 0) return t;
		if (a.endTs !== b.endTs) return a.endTs - b.endTs;
		return a.startTs - b.startTs;
	})[0];
}

// ── 卡池侧：国服当前卡池 ──
// 悬停里的角色名用「、」连接（与本体 buildPoolHover 的 `池名：角色` 观感一致）：
// wiki 表格用**空格**分隔从者名（`阿蒂拉 罗摩 兰斯洛特(Saber) …`），
// 直接塞进「池名：角色」会变成一长串空格分隔名，跟本体的「A、B、C」不一致。
function ns_fgo_formatFgoRoles(roles) {
	return String(roles || "").replace(/\s+/g, " ").trim().replace(/ +/g, "、");
}

function ns_fgo_parseFgoBannerTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const tables = ns_fgo_fgoTables(html);
	if (!tables.length) throw new Error("fgo-no-table");
	const tb = tables.find((t) => /国服当前卡池/.test(stripTags(ns_fgo_rowsOf(t.html)[0] || "")));
	if (!tb) throw new Error("fgo-no-current-banner-table");
	const rows = [];
	for (const r of ns_fgo_rowsOf(tb.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 2 || ns_fgo_isHeaderRow(cells)) continue;
		const name = stripTags(cells[0]).replace(/\s+/g, " ").trim();
		const w = ns_fgo_parseFgoWindow(stripTags(cells[1]), tz);
		if (!name || !w) continue;
		let roles = cells.length > 2 ? stripTags(cells[2]).replace(/\s+/g, " ").trim() : "";
		// wiki 在"推荐召唤从者>15 骑"时用一行占位提示顶替名单 → 不把它当角色名
		if (/请前往|大于15|详见|Template:/.test(roles)) roles = "";
		rows.push({ banner: name, roles, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return null;
	// 悬停（本体 buildPoolHover 格式）：当期主池每池「池名：角色」+ 档期两行，结束时间升序。
	// 「卡池一览」的这一张表 = **国服当前卡池**，表内解析出的行本就都是当期池，不需要再按 now 过滤。
	// 只有 1 个当期池时 hoverPool 返回 ""，此处**不设 bannerHover**，由 UI 走默认两行式。
	// 角色名过长（>8 骑，如「天草四郎时贞推荐召唤」动辄 20 骑）会淹掉档期行 → 不放进悬停。
	const pools = (rows.length < 2 ? [] : rows)
		.slice()
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs))
		.map((r) => {
			const names = ns_fgo_formatFgoRoles(r.roles);
			const short = names && names.split("、").length <= 8 ? names : "";
			return {
				name: r.banner,
				label: short ? `${r.banner}：${short}` : r.banner,
				startTs: r.startTs,
				endTs: r.endTs,
				raw: r.raw
			};
		});
	const bannerHover = hoverPool(pools, tz);
	return {
		...best,
		openCount: rows.length,
		...(bannerHover ? { bannerHover } : {})
	};
}

// ── 活动侧：国服当年那张表 ──
// 选表规则（三条同时成立）：① 表头含「活动时间」且含「名称」且含「类型」；
// ② **不得**含「日本标准时间」（那是日服表）；③ 表前最近的标题是 `YYYY年`，取年份最大的那张。
function ns_fgo_findFgoEventTable(html) {
	const tables = ns_fgo_fgoTables(html);
	let best = null;
	for (const t of tables) {
		const head = stripTags(ns_fgo_rowsOf(t.html)[0] || "");
		if (!/活动时间/.test(head) || !/名称/.test(head) || !/类型/.test(head)) continue;
		if (/日本标准时间/.test(head)) continue;
		const ym = /(\d{4})\s*年/.exec(t.head || "");
		if (!ym) continue;
		const year = +ym[1];
		if (!best || year > best.year) best = { year, table: t };
	}
	return best;
}

function ns_fgo_parseFgoEventTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const found = ns_fgo_findFgoEventTable(html);
	if (!found) throw new Error("fgo-no-cn-event-table");
	const rows = [];
	let skipped = 0;
	for (const r of ns_fgo_rowsOf(found.table.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 4 || ns_fgo_isHeaderRow(cells)) continue;
		const w = ns_fgo_parseFgoWindow(stripTags(cells[0]), tz);
		const name = stripTags(cells[1]).replace(/\s+/g, " ").trim();
		if (!w || !name) { skipped++; continue; }
		const type = stripTags(cells[3]).replace(/\s+/g, " ").trim();
		rows.push({ name, type, tier: /^Event/i.test(type) ? 0 : 1, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return { year: found.year, rows, skipped, event: null };
	// 悬停：只列**覆盖当前时刻**的行（该年的表含全年 57 行，全列会淹没当期；按结束时间升序）。
	// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`。
	// ⚠️ 表格第 4 列的**类型**（Event/Campaign）是源站的**分类词**，不是活动名 —— 旧实现把它塞在
	//    「档期」和「名称」之间（`09-24 19:00 ~ 10-15 13:59   Event   幕末…`），既把档期放在了行首，
	//    又把分类词冒充成名称的一部分。用户 2026-10-03 反馈后**彻底删掉**（分类只用于 `tier` 排序，
	//    保留在 rows 里供外部使用，不进悬停文本）。
	const active = rows
		.filter((x) => coversNow(x, now))
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs));
	// <2 条时 hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式
	const eventHover = hoverEvent(active, tz);
	return {
		year: found.year,
		rows,
		skipped,
		activeCount: active.length,
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 抓取器 ──
// ⚠️ mode 必须与 registry-b3.js 里声明的 "proxy" 一致（fgo.wiki 的 ACAO 为空，不能直连）
async function ns_fgo_fetchPageText(url, signal) {
	if (!/^https?:\/\//.test(String(url || ""))) throw new Error("fgo-bad-url");
	return fetchMediaWikiText(url, { referer: ns_fgo_FGO_REFERER, signal, mode: "proxy" });
}

async function ns_fgo_gachaFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE), signal);
	const r = ns_fgo_parseFgoBannerTable(html, tz, Date.now());
	if (!r) return null;
	return {
		banner: r.banner,
		roles: r.roles || "",
		bannerDates: fmtWindow(r.startTs, r.endTs, tz),
		bannerDatesRaw: r.raw,
		startTs: r.startTs,
		endTs: r.endTs,
		// 有 ≥2 个当期池才有值；1 个池时 ns_fgo_parseFgoBannerTable 不设该字段（UI 走默认两行式）
		...(r.bannerHover ? { bannerHover: r.bannerHover } : {})
	};
}

async function ns_fgo_eventsFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE), signal);
	const r = ns_fgo_parseFgoEventTable(html, tz, Date.now());
	if (!r || !r.event) return null;
	return {
		event: r.event,
		eventDates: r.eventDates,
		eventDatesRaw: r.eventDatesRaw,
		// ≥2 条当期活动才有值；只有 1 条时不设该字段（UI 走默认两行式「名称 ⏎ 档期」）
		...(r.eventHover ? { eventHover: r.eventHover } : {})
	};
}

// src/client/35-parsers-miyoushe.js
//
// 由 next-sources/parsers/miyoushe.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_miyoushe__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-miyoushe.js —— 米哈游系官方公告（米游社 BBS API）
//
// 覆盖 4 个游戏（gids 实测四个都 200 且返回对应游戏的正确公告）：
//   1 = 崩坏3 / 2 = 原神 / 6 = 崩坏：星穹铁道 / 8 = 绝区零
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null
//   卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   ⚠️ **now 必须是第 4 个参数**。本仓库历史 bug：now 收到 tz 字符串 → `startTs <= now` 恒假
//      → 静默显示"未公布"。本文件全部命中判定都用传入的 now，不读全局时钟。
//   ⚠️ 这是**官方补充源**，与既有 bwiki 条目（`genshin` / `hsr` / `zzz`）**并存**，
//      所以 id 加 `-official` 后缀、不撞车。
//
// ══════════════════════════════════════════════════════════════════════════════
// 一、端点与实测形态（夹具 2026-10-02 抓，见 fixtures/p4-*）
// ══════════════════════════════════════════════════════════════════════════════
//  列表  GET /painter/wapi/getNewsList?gids=<gid>&type=<1|2|3>&page_size=20
//        type=1 公告/补给、type=2 活动、type=3 资讯
//        → { retcode:0, message:"OK", data:{ list:[ { post:{ post_id, subject,
//            created_at(epoch 秒), images[], content:"", summary:"", structured_content:"" },
//            news_meta:null, text_summary:"", brief_structured_content:"" }, … ],
//            last_id, is_last } }
//  详情  GET /post/wapi/getPostFull?post_id=<post_id>
//        → { retcode:0, data:{ post:{ post:{ post_id, subject, created_at, content(HTML) } } } }
//
//  ⚠️ `post_id` 在 JSON 里是**字符串**（"78549971"），不能用 `===` 跟数字比。
//  ⚠️ `created_at` 是 **epoch 秒**（不是毫秒），且是**绝对时刻**（可直接用，不必按 tz 解释）。
//
//  ⚠️⚠️ **列表里没有"档期文本"字段**：实测各游戏的 **type=1（公告/补给）** 列表里，
//      `post.content` / `post.summary` / `post.structured_content` / `post.meta_content` /
//      `text_summary` / `brief_structured_content` 全为空，`news_meta` 恒为 **null**
//      （夹具 p4-{bh3,genshin,hsr,zzz}-news：0/20 条 post.content，news_meta 全 null）。
//      → **卡池侧必须再抓详情正文**才能拿到档期。这是本解析器"抓列表 → 抓详情 → 从正文抽档期"
//        两步形态的原因（与 ournotes.js 同形）。
//
//  ✅ **但 type=2（活动）列表有一层被低估的显式字段**（实测发现，任务书原话"该 API 没有显式
//      档期字段"**只对 type=1 成立**）：每条的 `news_meta` 都带
//         { activity_status: 1|2|3, start_at_sec: "…", end_at_sec: "…" }   （**epoch 秒的字符串**）
//      20/20 条齐全（夹具 p4-{bh3,genshin,hsr,zzz}-events）。`activity_status` 与"是否已结束"相关
//      （实测 bh3：进行中的两条=1，其余历史条目=3）。
//      ⚠️ 但它的**结束时刻口径各游戏不一致**，所以**没有**拿它当外显：
//        · 崩坏3  `09-28 12:00 ~ 10-07 23:59` = 正文「9.28 12:00~10.7 23:59」**完全一致**
//        · 星铁   `09-28 18:44 ~ 10-13 00:00` ≈ 正文「9月28日 - 10月12日 23:59」+1 分钟（= 参与截止）
//        · 原神   `10-02 12:00 ~ 11-10 20:00` ← 正文写「10月2日-10月31日23:59」、**开奖时间 11月10日**
//                  → 这里的 end 是**开奖时刻**，不是参与截止（口径不同）
//      结论：外显仍取**公告正文**（玩家看到的活动时间就是正文那句），
//      `news_meta` 只作**兜底**：当正文一个可解析窗口都抽不到时，用它的显式档期顶上，
//      并在 `eventDatesRaw` / `bannerDatesRaw` 里标明来源是 news_meta（不冒充正文）。
//      ⚠️ 这句来源说明**只进 raw 字段**（既有约定：本体也有条目这么做）；**悬停里不写**（见 §五）。
//
//  ⚠️ **详情端点有 Referer 门（实测）**：不带 Referer 一律 `HTTP 403 / body "Forbidden"`：
//        · 桌面 UA + 无 Referer                     → 403
//        · 桌面 UA + Referer: www.miyoushe.com      → 200
//        · 桌面 UA + Referer: bbs-api.miyoushe.com（宿主代理的默认值） → 200
//        · 只有 Origin、没有 Referer                 → 403   ← 门是 Referer，不是 UA
//      → 本文件显式传 `referer: https://www.miyoushe.com/`；**列表**端点不需要 Referer（200）。
//
//  🚨 生产环境前置条件（**Lead 集成时必须处理，本文件不越界改 src/**）：
//      `src/index.js` 的 `PROXY_ALLOW_HOSTS` **当前不含 `bbs-api.miyoushe.com`**
//      （白名单里只有同门的 `api-takumi-static.mihoyo.com`）。本目录新源一律 `mode="proxy"`，
//      所以离线夹具测试能全绿，但**真机上会拿到 `{error:"host not allowed"}`**。
//      → 需 Lead 在 `PROXY_ALLOW_HOSTS` 里加 `"bbs-api.miyoushe.com"`（一行，属插件本体改动）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 二、时区 = Asia/Shanghai（UTC+8）—— **推测**
// ══════════════════════════════════════════════════════════════════════════════
//  正文里的时刻（`2026-09-30 12:00`、`9.28 12:00`）都是**国服墙钟原文**，源站**没有**标注时区。
//  按国服惯例取 UTC+8。可佐证的旁证（非硬证据）：
//    · 绝区零 3.2 限时频段 `2026-09-30 12:00 ~ 2026-10-20 14:59` —— 12:00 开池 / 14:59 收池，
//      是国服"中午开、下午收"的典型口径（与 bwiki 各源一致）；
//    · 官方公告的发布时刻 `created_at` 落在 UTC+8 的整点/半点（10:00、04:00、12:00 等），
//      而按 UTC+9 渲染会变成 11:00、05:00、13:00（不整）。
//  → 因此本文件把 `tz` 默认写成 `Asia/Shanghai`，并在**注释**里如实标"推测"
//    （⚠️ 悬停里**不写**时区说明 —— 用户 2026-10-03：「元信息彻底删掉」，见 §五）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 三、正文档期抽取（**实测的格式清单**，全部来自 p4-*-detail-* 夹具）
// ══════════════════════════════════════════════════════════════════════════════
//   ✅ 能抽到：
//     · `9.28 12:00~10.7 23:59`                       崩坏3 有奖活动（**无年份**，取公告年）
//     · `2026-09-30 12:00 ~ 2026-10-20 14:59`         绝区零 3.2 限时频段
//     · `参与时间：即日起 - 2026年10月18日 23:59`      绝区零 有奖活动（起点"即日起"）
//     · `2026年10月2日-2026年10月31日23:59`           原神 有奖活动（分隔符是**紧贴的 `-`**）
//     · `2026年9月28日 - 2026年10月12日 23:59`        星铁 有奖活动
//     · `2026/09/28 4.6版本更新后 - 2026/11/10 15:00`  星铁 活动跃迁（起点是**版本锚点**）
//     · `整体活动时间：2026/09/30 10:00 ~ 2026/11/03 03:59` 原神 type=1 活动说明
//   ❌ **抽不到（正文里根本没有日期，时间画在配图里）→ 本侧如实返回 null**：
//     · 崩坏3 补给（`p4-bh3-detail-gacha` / `-char`）：正文只有 `>>开放等级`、
//       `>>补给信息`（**一张图**）、`>>补给规则`（`每10次装备补给必定获得4★武器或圣痕`）
//       → 全文 0 个日期。**绝不拿 `created_at` 当档期、绝不硬凑**。
//     · 原神 祈愿（`p4-genshin-detail-wish` / `-wish2`）：正文只有 `〓祈愿介绍〓`，
//       全程写"活动期间"却**不给日期**，全文 0 个日期。
//
//  抽取策略（令牌化 + 配对，而不是一条大正则）：
//    ① 扫令牌：ABS(YYYY-MM-DD/./年 的完整日期[+HH:MM])、VER(`X.Y版本更新后`/`X.Y版本结束`)、
//       BARE(无年份 `M.D HH:MM`)、OPEN(`即日起`)；
//    ② 相邻两令牌之间只允许"连接符"`~ ～ 〜 〰 - – — － 至 到`（可带空白）→ 配对成窗口；
//       紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）视作**同一个起点**；
//    ③ 缺时刻：起点按 00:00、终点按 23:59；
//    ④ 无年份 `M.D` 的年份取**公告发布年**（按 tz 渲染）；终点月日早于起点 → 终点进一年；
//    ⑤ `即日起` → 起点取公告 `created_at`（并标 `inferred`）；`X.Y版本更新后` → 起点取
//       **同列表里 `X.Y版本更新说明` 的发布时刻**（版本锚点，标 `inferred`）；
//       锚点找不到才退回正文里的字面日期 00:00；
//    ⑥ `endTs > startTs` 才产出；按**时间区间**去重（保留 raw 更全的那条）；**文档顺序**保留。
//  选当期：候选公告按 `created_at` **倒序**，逐篇抓详情，取**第一条覆盖 now 的窗口**；
//          没有覆盖 now 的窗口 → 返回 `null`（未公布），**不退回过期档期**。
//
//  候选筛选（标题关键词分流，见 ns_miyoushe_classifyMiyousheTitle）：
//    · 卡池侧 补给/祈愿/跃迁/频段/调频/招募…
//    · 活动侧 活动/征集/赛事/签到/有奖/话题…
//    同一标题同时命中两边时**卡池关键词优先**（实例：`4.6版本活动跃迁（其一）` 是卡池公告，
//    虽然字面含"活动"）。命不中的（版本更新说明、封禁名单、商城上新…）直接跳过。
//
//  成本：列表 1 次请求 + **最多 ns_miyoushe_MIYOUSHE_MAX_DETAILS 篇正文**（顺序、间隔 ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS，
//        对 WAF 友好）；候选已按时间倒序，覆盖 now 的窗口一旦出现即被采用。
//
// ══════════════════════════════════════════════════════════════════════════════
// 四、失败口径（"只有结构性损坏才 throw"）
// ══════════════════════════════════════════════════════════════════════════════
//   · HTTP 非 2xx / 响应不是 JSON / `retcode !== 0`          → **throw**（该侧算抓取失败）
//   · 列表为空（实测 `gids=99999` → `retcode:0, list:[]`）    → 返回 null（未公布）
//   · 单篇详情 `retcode 1101/1102`（"post not exist"，实测）  → **跳过该篇**（不算失败）
//   · 单篇详情 HTTP 404/410                                   → 跳过该篇
//   · 全部候选都失败且出现过**硬错**（403/567/坏 JSON…）      → **throw**（别把封禁静默成"未公布"）
//     （实测详情缺 Referer 就是 403 "Forbidden" —— 这种必须能被看见）
//
// ══════════════════════════════════════════════════════════════════════════════
// 五、悬停排版（用户 2026-10-03：「元信息彻底删掉」）
// ══════════════════════════════════════════════════════════════════════════════
//  排版**不再本地实现**，一律调 `lib/env.js` 的 `hoverPool` / `hoverEvent`
//  （与本体 `buildPoolHover` / `buildEventHover` 逐字一致），本文件只负责：
//    · 卡池侧：每池一项 `{ name: 公告标题, label: 「池名：角色」, startTs, endTs }` → hoverPool
//      （角色名空 → label 退化成池名；与本体 `banner：roles` 同构）
//    · 活动侧：每条 `{ name: 公告标题, startTs, endTs }`，**先按结束时间升序排好**再传给 hoverEvent
//      （`hoverEvent` 自己不排序，与本体一致）
//    · 当期**不足 2 项**时两个工具返回 `""` → **不设** `bannerHover` / `eventHover` 字段，
//      让 UI 走默认两行式（卡池 `池名：角色` ⏎ 档期；活动 `名称` ⏎ 档期）
//
//  🚫 以下信息**一律不进悬停文本**（只留在本文件的代码注释里）：
//     · 来源站名 / 域名 / URL / API 名（米游社官方公告、bbs-api.miyoushe.com、getNewsList…）
//     · 时区推定说明（"国服墙钟按 UTC+8 换算 —— 源站未标注时区＝推测"）
//     · 抓取统计（"本轮有 N 篇公告正文抓取失败"）
//     · 内部 id / 源站字段名（post_id、start_at_sec、end_at_sec、activity_status、news_meta…）
//     · 游戏名 + 区服前缀（悬停里不重复游戏名）
//     · 任何「（…）」形式的实现说明（"本篇第 N 段档期"、"起点为推断"、"源站 news_meta 显式档期"…）
//  ⇒ 用户明确要求"直接删掉"：**删除**，不要把这些信息改放到悬停的别的行/字段里。
//     （`bannerDatesRaw` / `eventDatesRaw` 是**既有**的"源站原文 / 溯源说明"约定字段，
//      本次维持现状 —— 那不是"迁移目的地"，只是原本就长这样。）


const ns_miyoushe_MIYOUSHE_TZ = "Asia/Shanghai";                     // **推测**（理由见文件头 §二）
const ns_miyoushe_MIYOUSHE_REFERER = "https://www.miyoushe.com/";    // 详情端点的 Referer 门（实测）
// ⚠️ 这里**曾**导出 `MIYOUSHE_PROVENANCE`（"米游社官方公告（档期由公告正文抽出；国服墙钟按 UTC+8 换算
//    —— 源站未标注时区＝推测）"），专门塞进悬停首行。用户 2026-10-03 要求「元信息彻底删掉」→
//    常量与悬停首行**一并删除**。来源站名 / 时区推定这类信息只留在**本文件注释**里（§一/§二）。

const ns_miyoushe_LIST_BASE = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList";
const ns_miyoushe_DETAIL_BASE = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";

// gids（实测：1=崩坏3 / 2=原神 / 6=星穹铁道 / 8=绝区零）
const ns_miyoushe_MIYOUSHE_GIDS = { bh3: 1, genshin: 2, hsr: 6, zzz: 8 };
// type（实测：1=公告/补给、2=活动、3=资讯）
const ns_miyoushe_MIYOUSHE_TYPES = { GACHA: 1, EVENT: 2, INFO: 3 };

const ns_miyoushe_MIYOUSHE_MAX_DETAILS = 5;        // 每侧最多抓几篇正文
const ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS = 200;  // 篇间隔（顺序抓，避免把源站打急）

// ⚠️ registry-p4.js 里声明的 url 必须由这两个函数生成，否则离线夹具（map.json 按整串匹配）命中不到。
function ns_miyoushe_miyousheListUrl(gids, type, pageSize = 20) {
	return `${ns_miyoushe_LIST_BASE}?gids=${gids}&type=${type}&page_size=${pageSize}`;
}
function ns_miyoushe_miyousheDetailUrl(postId) {
	return `${ns_miyoushe_DETAIL_BASE}?post_id=${encodeURIComponent(String(postId))}`;
}

//#region 列表 / 详情解析（纯函数）
// type=2 列表每条都带 `news_meta`（显式档期，epoch 秒**字符串**）→ 解析成绝对毫秒；type=1 恒 null。
function ns_miyoushe_parseNewsMeta(nm) {
	if (!nm || typeof nm !== "object") return null;
	const s = Number(nm.start_at_sec), e = Number(nm.end_at_sec);
	if (!Number.isFinite(s) || !Number.isFinite(e) || !(s > 0) || !(e > s)) return null;
	const st = Number(nm.activity_status);
	return { startTs: s * 1000, endTs: e * 1000, status: Number.isFinite(st) ? st : null };
}

function ns_miyoushe_parseMiyousheList(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const list = json.data && json.data.list;
	if (!Array.isArray(list)) throw new Error("miyoushe-bad-list");
	const out = [];
	for (const it of list) {
		const p = it && it.post;
		if (!p || p.post_id == null || p.post_id === "") continue;
		const sec = Number(p.created_at);
		out.push({
			// ⚠️ 保留字符串形态（源站就是字符串；夹具 map 的 URL 也按它拼）
			postId: String(p.post_id),
			subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
			// created_at 是 **epoch 秒**，转毫秒；源站的绝对时刻，不需要按 tz 解释
			createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
			// 只有 type=2 列表才有（type=1 恒 null）；epoch 秒的**字符串**，要 Number() 一下
			newsMeta: ns_miyoushe_parseNewsMeta(it && it.news_meta)
		});
	}
	return out;
}

function ns_miyoushe_parseMiyousheDetail(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const p = json.data && json.data.post && json.data.post.post;
	if (!p || p.post_id == null) throw new Error("miyoushe-bad-post");
	const sec = Number(p.created_at);
	return {
		postId: String(p.post_id),
		subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
		createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
		content: String(p.content || "")
	};
}

// "这篇拿不到"≠"这一侧抓取失败"：实测详情对不存在的 post 回 **HTTP 200 + retcode 1101/1102**
// （`{"data":null,"message":"post not exist","retcode":1102}`），不是 HTTP 404。
function ns_miyoushe_isMiyousheMissing(err) {
	const m = String((err && err.message) || err || "");
	return /\b(404|410)\b/.test(m) || /miyoushe-retcode-(1101|1102)\b/.test(m);
}
//#endregion

//#region 标题关键词分流
// 冲突时卡池优先：`4.6版本活动跃迁（其一）` 是**卡池**公告（字面含"活动"）。
const ns_miyoushe_BANNER_KW = /祈愿|补给|跃迁|频段|调频|招募|概率UP|概率提升|扭蛋|蛋池/;
const ns_miyoushe_EVENT_KW = /活动|征集|赛事|签到|登录|庆典|有奖|话题|抽奖|投票|答题|委托|福利/;

function ns_miyoushe_classifyMiyousheTitle(subject) {
	const t = String(subject == null ? "" : subject);
	if (ns_miyoushe_BANNER_KW.test(t)) return "gacha";
	if (ns_miyoushe_EVENT_KW.test(t)) return "event";
	return "unknown";
}
//#endregion

//#region 版本锚点（`X.Y版本更新后` → 该版本更新公告的发布时刻）
// 实测（p4-hsr-news）：`4.6版本更新说明` created_at=2026-09-28 07:00:11 +08 → 4.6 的起点。
// 必须排除「预下载开启&更新通知」（比正式更新早 1~2 天）与《云•XX》的更新说明。
const ns_miyoushe_VER_UPD_RE = /(\d{1,2}\.\d{1,2})\s*版本(?:更新说明|更新公告|更新通知|更新预告)/;
function ns_miyoushe_miyousheVersionStarts(items) {
	const map = {};
	for (const it of items || []) {
		const t = String((it && it.subject) || "");
		if (/预下载|前瞻|预约|预抽|云[•·]/.test(t)) continue;
		const m = ns_miyoushe_VER_UPD_RE.exec(t);
		if (!m) continue;
		if (map[m[1]] == null && it.createdTs != null) map[m[1]] = it.createdTs;
	}
	return map;
}
// 版本锚点 → 绝对时刻。`更新后` = 该版本的起点（没有 → 不可解）；`结束` = 下一个已知版本起点 − 1 分钟。
function ns_miyoushe_resolveVersionAnchor(ver, kind, verStarts) {
	const cur = verStarts ? verStarts[ver] : null;
	if (cur == null) return null;
	if (kind === "更新后") return cur;
	if (kind === "结束") {
		const later = Object.keys(verStarts)
			.filter((v) => verStarts[v] > cur)
			.sort((a, b) => verStarts[a] - verStarts[b])[0];
		return later == null ? null : verStarts[later] - 60000;
	}
	return null;
}
//#endregion

//#region 正文档期抽取
// 令牌化：ABS 完整日期 | VER 版本锚点 | BARE 无年份 M.D HH:MM | OPEN 即日起
// 组序号：1-5 = ABS(y,mo,d,h,mi)，6-7 = VER(num,kind)，8-11 = BARE(mo,d,h,mi)
const ns_miyoushe_ABS_SRC = "(20\\d{2})\\s*[-\\/年.]\\s*(\\d{1,2})\\s*[-\\/月.]\\s*(\\d{1,2})\\s*日?"
	+ "(?:\\s*[（(]\\s*周?[一二三四五六日天]\\s*[）)])?"
	+ "(?:\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2}))?";
const ns_miyoushe_VER_SRC = "(\\d{1,2}\\.\\d{1,2})\\s*版本(更新后|结束)";
const ns_miyoushe_BARE_SRC = "(\\d{1,2})\\s*[.\\/]\\s*(\\d{1,2})\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
const ns_miyoushe_OPEN_SRC = "即日起";
const ns_miyoushe_TOKEN_RE = new RegExp([ns_miyoushe_ABS_SRC, ns_miyoushe_VER_SRC, ns_miyoushe_BARE_SRC, ns_miyoushe_OPEN_SRC].join("|"), "g");
// 两个日期之间只允许"连接符"（可带空白）。**故意不允许空串**：避免把相邻但无关的日期配成窗口。
const ns_miyoushe_CONNECTOR_RE = /^\s*[~～〜〰\-–—－至到]\s*$/;

function ns_miyoushe_tokenizeMiyoushe(s) {
	const toks = [];
	ns_miyoushe_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_miyoushe_TOKEN_RE.lastIndex++; continue; }
		const start = m.index, end = m.index + m[0].length;
		if (m[1] != null) {
			toks.push({ kind: "abs", start, end, y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null, ver: null });
		} else if (m[6] != null) {
			toks.push({ kind: "ver", start, end, ver: m[6], verKind: m[7] });
		} else if (m[8] != null) {
			toks.push({ kind: "bare", start, end, y: null, mo: +m[8], d: +m[9], h: +m[10], mi: +m[11] });
		} else {
			toks.push({ kind: "open", start, end });
		}
	}
	return toks;
}

/**
 * 从一段公告正文（HTML 或纯文本）里抽出所有「起 ~ 止」档期。
 * @param {string} text 详情正文（HTML 会先 textOf 去标签；已是纯文本也安全）
 * @param {string} tz 源站墙钟时区
 * @param {{hintTs?:number, verStarts?:Record<string,number>}} opts
 *        hintTs = 公告发布时刻（**无年份**日期的年份来源 + `即日起` 的起点）
 *        verStarts = `X.Y版本更新后` 的版本锚点表（见 ns_miyoushe_miyousheVersionStarts）
 * @returns {Array<{startTs:number,endTs:number,raw:string,at:number,inferred:boolean,note:string}>}
 */
function ns_miyoushe_collectMiyousheWindows(text, tz = ns_miyoushe_MIYOUSHE_TZ, opts = {}) {
	const html = String(text == null ? "" : text);
	const s = /<[a-z!/]/i.test(html) ? textOf(html) : html;
	const hintTs = opts.hintTs != null && Number.isFinite(opts.hintTs) ? opts.hintTs : null;
	const verStarts = opts.verStarts || {};
	const hint = hintTs != null ? sourceWallParts(hintTs, tz) : null;
	const toks = ns_miyoushe_tokenizeMiyoushe(s);

	// 起点令牌 → 绝对时刻
	const startOf = (info) => {
		if (info.kind === "abs") {
			let ts = sourceInstant(info.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
			if (info.ver) {
				// `2026/09/28 4.6版本更新后` → 用版本更新公告时刻（更准）；锚点缺失才退回字面日期 00:00
				const v = ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind || "更新后", verStarts);
				if (v != null) ts = v;
			}
			return ts;
		}
		if (info.kind === "bare") {
			if (!hint) return null;      // 没有公告年份可借 → 不解（不猜当前年）
			return sourceInstant(hint.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
		}
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return hintTs;   // `即日起` → 公告发布时刻
		return null;
	};
	// 终点令牌 → 绝对时刻（无年份时按起点年，月日更早则进一年）
	const endOf = (info, startTs) => {
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return null;
		const h = info.h == null ? 23 : info.h, mi = info.mi == null ? 59 : info.mi;
		let y = info.y;
		if (y == null) {
			const sw = sourceWallParts(startTs, tz);
			y = sw.y;
			// 月日排在起点之前 → 跨年（共用判定）
			if (endsNextYear(sw.mo, sw.d, info.mo, info.d)) y += 1;
		}
		return sourceInstant(y, info.mo, info.d, h, mi, tz);
	};

	const byKey = new Map();
	// 去重键用**时间区间**而不是 raw 文本：同一段区间在正文里常有"全写"与"只写版本锚点"两种形态
	// （实测星铁：`2026/09/28 4.6版本更新后 ~ …` 与 `4.6版本更新后 ~ …` 是同一段），
	// 只按 raw 去重会重复列出。保留 raw 更长的那条（信息更全），插入顺序即文档顺序。
	const addWindow = (w) => {
		const key = w.startTs + "|" + w.endTs;
		const prev = byKey.get(key);
		if (!prev) { byKey.set(key, w); return; }
		if (w.raw.length > prev.raw.length) {
			prev.raw = w.raw;
			prev.at = w.at;
			prev.inferred = w.inferred;
			prev.note = w.note;
		}
	};
	let i = 0;
	while (i < toks.length) {
		const a = toks[i];
		const info = { kind: a.kind, y: a.y, mo: a.mo, d: a.d, h: a.h, mi: a.mi, ver: a.ver, verKind: a.verKind };
		let aEnd = a.end;
		let j = i + 1;
		// 紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）= 同一个起点
		if (a.kind === "abs" && a.h == null && toks[j] && toks[j].kind === "ver" && /^\s*$/.test(s.slice(a.end, toks[j].start))) {
			info.ver = toks[j].ver;
			info.verKind = toks[j].verKind;
			aEnd = toks[j].end;
			j++;
		}
		const b = toks[j];
		i++;
		if (!b) continue;
		if (!ns_miyoushe_CONNECTOR_RE.test(s.slice(aEnd, b.start))) continue;
		if (b.kind !== "abs" && b.kind !== "bare" && b.kind !== "ver") continue;

		const st = startOf(info);
		if (st == null) continue;
		const en = endOf(b, st);
		if (en == null || !(en > st)) continue;
		const raw = s.slice(a.start, b.end).replace(/\s+/g, " ").trim();
		const inferredVer = info.kind === "ver" || (info.kind === "abs" && !!info.ver);
		addWindow({
			startTs: st,
			endTs: en,
			raw,
			at: a.start,
			inferred: info.kind === "open" || inferredVer,
			note: info.kind === "open" ? "起点「即日起」＝取公告发布时刻"
				: inferredVer ? "起点「版本更新后」＝取该版本更新公告的发布时刻"
					: ""
		});
	}
	return [...byKey.values()];
}

// 当期 = 文档顺序里**第一条覆盖 now** 的窗口；没有就是没有（不退回过期档期）
// 卡池名册：优先只看"首个档期之前"的引言（那才是本期名单），引言里没有才退回全文。
// 例：星铁跃迁引言 → 「真珠」；绝区零频段引言没有名单 → 全文取「洛克茜、普罗米娅」。
const ns_miyoushe_ROLE_RE = /限定\s*(?:[5S]\s*[星级])?\s*(?:角色|代理人|女武神)\s*[「【\[]([^」】\]]+)[」】\]]/g;
function ns_miyoushe_extractRoles(s) {
	const names = [];
	ns_miyoushe_ROLE_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_ROLE_RE.exec(s)) !== null) {
		const n = m[1].replace(/[（(].*$/, "").trim();
		if (n && !names.includes(n)) names.push(n);
		if (names.length >= 6) break;
	}
	return names.join("、");
}
function ns_miyoushe_miyousheRoles(text, stopAt = null) {
	const s = String(text == null ? "" : text);
	const plain = /<[a-z!/]/i.test(s) ? textOf(s) : s;
	const head = stopAt != null && stopAt > 0 ? plain.slice(0, stopAt) : "";
	return (head ? ns_miyoushe_extractRoles(head) : "") || ns_miyoushe_extractRoles(plain);
}
//#endregion

//#region 抓取
const ns_miyoushe_sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 源站原文（`bannerDatesRaw` / `eventDatesRaw` 用）。
// ⚠️ 这两个字段**会被 UI 的默认两行式直接显示**（面板取 `bannerDatesRaw || bannerDates`、
//    `eventDatesRaw || eventDates`）—— 所以它们**只能放档期文本本身**，
//    绝不能夹带「这来自哪个字段」之类的说明（用户 2026-10-03：「元信息彻底删掉」）。
//    旧实现在 news_meta 兜底时返回 `news_meta 档期（源站显式字段，非正文）：…`，
//    一旦兜底路径触发，这句话就会原样出现在面板上 —— 已修。
//    「本窗口来自 news_meta 兜底」这一事实保留在 `p.source`（不显示）+ 代码注释里。
function ns_miyoushe_rawOf(p, tz) {
	if (p.source === "news_meta") return fmtWindow(p.startTs, p.endTs, tz);
	return p.raw;
}

// ── 悬停条目 ──────────────────────────────────────────────────────────────────
// 排版交给 lib/env.js 的 `hoverPool` / `hoverEvent`（与本体 buildPoolHover / buildEventHover 逐字一致）。
// 用户 2026-10-03：「悬停里的元信息彻底删掉」→ 这里**只**产出名称与档期，别的一概不传。
// 池名与本体 `banner：roles` 同构：有角色名 →「池名：角色」，没有 → 只写池名。
const ns_miyoushe_hoverPoolName = (w) => (w.roles ? `${w.subject}：${w.roles}` : w.subject);
// 活动悬停顺序：结束时间升序（无/未知结束排在最后），并列再按开始时间 —— 与 lib/env.js 内部规则一致
function ns_miyoushe_byEndTs(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// `raw` 只在"缺起止"时才会被 hoverEvent 印出来；news_meta 兜底行的 raw 是内部字段说明
// （`start_at_sec=…`）→ 不给它，免得内部字段名有机会漏进悬停。
const ns_miyoushe_hoverRaw = (w) => (w.source === "news_meta" ? "" : w.raw);

// 列表 → 候选 → 逐篇详情 → 抽档期。返回值可能是 null（未公布）；结构性损坏直接抛。
async function ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, want) {
	const listJson = await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER });
	const items = ns_miyoushe_parseMiyousheList(listJson);
	if (items.length === 0) return null;                       // 实测 gids=99999 → retcode 0 + 空 list
	const verStarts = ns_miyoushe_miyousheVersionStarts(items);
	const cands = items
		.filter((it) => ns_miyoushe_classifyMiyousheTitle(it.subject) === want)
		.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0))
		.slice(0, ns_miyoushe_MIYOUSHE_MAX_DETAILS);
	if (cands.length === 0) return null;                       // 该列表里没有本侧公告

	const covering = [];
	let okCount = 0, firstHardErr = null;
	for (let idx = 0; idx < cands.length; idx++) {
		if (idx > 0 && ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS > 0) await ns_miyoushe_sleep(ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS);
		const it = cands[idx];
		let d;
		try {
			d = ns_miyoushe_parseMiyousheDetail(await fetchJson(ns_miyoushe_miyousheDetailUrl(it.postId), { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER }));
		} catch (e) {
			if (!ns_miyoushe_isMiyousheMissing(e) && !firstHardErr) firstHardErr = e;
			continue;
		}
		okCount++;
		const hintTs = d.createdTs != null ? d.createdTs : it.createdTs;
		const wins = ns_miyoushe_collectMiyousheWindows(d.content, tz, { hintTs, verStarts });
		const roles = ns_miyoushe_miyousheRoles(d.content, wins.length ? wins[0].at : null);
		for (const w of wins) {
			w.subject = d.subject || it.subject;
			w.postId = d.postId;
			w.roles = roles;
			w.source = "content";
			// 候选已按 created_at 倒序、窗口按文档顺序 → covering[0] 就是"最新一篇公告里的第一条当期窗口"
			if (coversNow(w, now)) covering.push(w);
		}
	}
	// 一篇正文都没拿到、且出现过硬错（403/567/坏 JSON）→ 抛出去，让界面显示"抓取失败"
	// 而不是把封禁静默成"未公布"。全是"post not exist"（1101/1102）则不算失败 → null。
	if (okCount === 0) {
		if (firstHardErr) throw firstHardErr;
		return null;
	}
	// 兜底：正文一个覆盖 now 的窗口都抽不到时，退回源站**显式**字段 news_meta（只有 type=2 列表有）。
	// 口径与正文可能不同（实测原神的 end 是开奖时刻）→ 悬停/raw 里**标明来源**，不冒充正文。
	if (covering.length === 0) {
		for (const it of cands) {
			const nm = it.newsMeta;
			if (!nm || !(coversNow(nm, now))) continue;
			covering.push({
				startTs: nm.startTs, endTs: nm.endTs,
				// ⚠️ 不留「news_meta start_at_sec=… end_at_sec=…」这种内部字段说明：内部字段名不进数据
				//    （`eventDatesRaw` 的溯源说明由 ns_miyoushe_rawOf 统一给；悬停由 ns_miyoushe_hoverRaw 屏蔽）
				raw: fmtWindow(nm.startTs, nm.endTs, tz),
				subject: it.subject, postId: it.postId, roles: "",
				inferred: false, note: "", source: "news_meta", status: nm.status
			});
		}
	}
	if (covering.length === 0) return null;                    // 抓到正文但没有覆盖 now 的档期 = 未公布
	return { primary: covering[0], covering };
}

/** 卡池侧（type=1 公告/补给；标题按卡池关键词分流） */
async function ns_miyoushe_gachaMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = Date.now()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.GACHA);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "gacha");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期池，每池「池名：角色」一行 + 档期（排版交给共用工具 hoverPool，≥2 池才有内容）。
	// 只有 1 个当期池 → "" → **不设** bannerHover，由 UI 走默认两行式「banner ⏎ bannerDates」。
	const bannerHover = hoverPool(r.covering.map((w) => ({
		name: w.subject,
		label: ns_miyoushe_hoverPoolName(w),
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	})), tz);
	return {
		banner: p.subject,
		roles: p.roles || "",
		bannerDates: fmtWindow(p.startTs, p.endTs, tz),
		bannerDatesRaw: ns_miyoushe_rawOf(p, tz),
		startTs: p.startTs,
		endTs: p.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 活动侧（type=2 活动；标题按活动关键词分流） */
async function ns_miyoushe_eventsMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = Date.now()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.EVENT);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "event");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」
	// （排版交给共用工具 hoverEvent；它自己**不排序** → 这里先排好再传）。
	// 只有 1 条 → "" → **不设** eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	const eventHover = hoverEvent(r.covering.slice().sort(ns_miyoushe_byEndTs).map((w) => ({
		name: w.subject,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	})), tz);
	return {
		event: p.subject,
		eventDates: fmtWindow(p.startTs, p.endTs, tz),
		eventDatesRaw: ns_miyoushe_rawOf(p, tz),
		...(eventHover ? { eventHover } : {})
	};
}
//#endregion

// src/client/35-parsers-stellasora.js
//
// 由 next-sources/parsers/stellasora.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_stellasora__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-stellasora.js —— 星塔旅人 国服（悠星官方 CMS API）
//
// 来源（2026-10-02 实测「已验证可达」）：
//   类型目录  GET /api/resource/news-type
//   列表      GET /api/resource/news?index=1&size=N&type=<latest|notice|news|activity>
//   详情      GET /api/resource/news/<id>
//   同源反代 —— bundle 原文：`const Ye="/"; function j(s){return x({url:`${Ye}api/${s}`})}`
//   （⚠️ 真实 host 是**官网同源**，不是独立 API 域名；我先前试 `*.yostar.net` 等全 DNS 不可达）
//
// 可抓取性：服务端裸 GET，**无 token / 无签名**；响应 **无 ACAO** → 必须 mode:"proxy"
//
// 时区：Asia/Shanghai
//   · publishTime 是 epoch ms，直接是绝对时刻，无需换算
//   · 正文档期是**国服墙钟**（如 `2026/10/01 04:00 ~ 2026/10/31 03:59`，04:00 日切 = 国服特征）
//   · ⚠️ 源站**未显式标注时区** → 标「推测」
//     ⚠️ 「时区是推测」这类实现说明**只留在代码注释里**，**绝不进悬停文本**
//        （用户 2026-10-03：悬停里的元信息——来源站名/URL/时区推定/抓取条数/内部 id/实现说明——彻底删掉）。
//
// ── 列表里哪个分类装什么（实测）──────────────────────────────
//   type=notice   (349 条)  ← **卡池 + 活动说明**都在这里，本解析器主用
//   type=latest   (366 条)  同上 + 新闻
//   type=activity (15 条)   基本是**线下/周边**（BW 展会、联动、周边上新）→ 不作为游戏内活动
//   type=news     (2 条)    首曝/定档类新闻
//
// ── 详情正文的档期形态（实测）────────────────────────────────
//   `▌招募时间<br>2026/09/29 维护结束后 ~ 2026/10/20 10:59<br>`
//   `▌开放时间<br>2026/09/01 04:00 ~ 2026/10/01 03:59<br>`
//   `▌售卖时间<br>2026/10/01 04:00 ~ 2026/10/31 03:59<br>`
//   ⇒ 统一形态：`▌<环节>时间<br> <起点> ~ <终点>`；起点可能是「维护结束后」（相对锚点）
//
//   ⚠️ 起点是「维护结束后」时**没有绝对时刻**：用该公告的 publishTime 当锚点，
//      并标 `startInferred: true`。绝不硬造一个假时刻。

const ns_stellasora_STELLA_BASE = "https://stellasora.yostar.cn";
const ns_stellasora_STELLA_TZ = "Asia/Shanghai";   // 推测：源站未标注，但 04:00 日切与国服一致

function ns_stellasora_stellaListUrl(type = "notice", size = 20, index = 1) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news?index=${index}&size=${size}&type=${type}`;
}
function ns_stellasora_stellaDetailUrl(id) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news/${id}`;
}

// ── 正文 → 纯文本（保留 `<br>` 换行；档期是 `<br>` 分隔的，不能直接压成空格）──
function ns_stellasora_brText(html) {
	let t = String(html == null ? "" : html);
	t = t.replace(/<br\s*\/?>/gi, "\n");
	t = t.replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n");
	t = t.replace(/<[^>]+>/g, "");
	t = decodeEntities(t);
	t = t.replace(/[ \t\u00a0\u3000]+/g, " ");
	return t.trim();
}

// ── 日期令牌子 ──
// `2026/09/29 09:00` / `2026-09-29 09:00` / `09/29 09:00`（省年份，用锚点年）
const ns_stellasora_YMD_RE = /(?:(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}))(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_MD_RE = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_REL_START_RE = /维护结束后|维护后|更新结束后|更新后/;

// ⚠️ 必须先"挖掉"已匹配的完整年月日，再找省略年份的月日。
//    否则 `2026/09/29 维护结束后` 里的 `09/29` 会被 ns_stellasora_MD_RE 当成"省年份的月日"匹配到，
//    于是走错分支、把「维护结束后」的相对锚点丢掉（本仓库实测踩过这个坑）。
function ns_stellasora_maskYmd(s) {
	return s.replace(new RegExp(ns_stellasora_YMD_RE.source, "g"), (m) => "\u0000".repeat(m.length));
}

// 从一段文本解析一个「起点 ~ 终点」区间。返回 { startTs, endTs, raw, startInferred } 或 null
function ns_stellasora_parseStellaWindow(segText, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const s = String(segText == null ? "" : segText).replace(/\s*\n\s*/g, " ").trim();
	if (!s) return null;
	// 先看有没有显式区间分隔符
	const sepMatch = /[~～〜－—–]/.exec(s);
	const anchorParts = anchorTs != null ? sourceWallParts(anchorTs, tz) : null;

	// ① 起点：相对锚点（「维护结束后」）优先于裸日期 → 绝对日期（完整年月日） → 绝对日期（省年份）
	//
	// ⚠️ 顺序很重要：源站写的是 `2026/09/29 维护结束后 ~ 2026/10/20 10:59` —— **日期与「维护结束后」同时出现**。
	//    若让 ns_stellasora_YMD_RE 先命中，起点会变成 `09-29 00:00`（那天零点），但真实开局是**维护结束**那一刻。
	//    故「维护结束后」优先，用公告发布时刻当锚点并标 startInferred
	//    （与仓库既有惯例一致：FGO 的 `即日起` / 绝区零的 `4.6版本更新后` 起点都标 inferred 并写进 raw）。
	//    未出现该词时，`2026/10/01 04:00` 这类显式起点照常按原样解析。
	//    ⚠️ 2026-10-03：`startInferred` **只作内部标记**（供 raw / 调试用），**不再写进悬停** ——
	//       旧悬停里的「（起点按公告发布时刻推断）」是**实现说明**，用户要求元信息彻底删掉。
	let startTs = null, startInferred = false, startRaw = "";
	const relMatch = ns_stellasora_REL_START_RE.exec(s);
	const head = sepMatch ? s.slice(0, sepMatch.index) : s;
	const ymd1 = ns_stellasora_YMD_RE.exec(head);
	const md1 = !ymd1 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(head)) : null;

	if (relMatch && anchorTs != null) {
		// 「维护结束后」：用公告发布时刻当锚点，并标记为推断值
		startTs = anchorTs;
		startInferred = true;
		startRaw = relMatch[0];
	} else if (ymd1) {
		startTs = sourceInstant(+ymd1[1], +ymd1[2], +ymd1[3], ymd1[4] != null ? +ymd1[4] : 0, ymd1[5] != null ? +ymd1[5] : 0, tz);
		startRaw = ymd1[0];
	} else if (md1 && anchorParts) {
		startTs = sourceInstant(anchorParts.y, +md1[1], +md1[2], md1[3] != null ? +md1[3] : 0, md1[4] != null ? +md1[4] : 0, tz);
		startRaw = md1[0];
	} else if (relMatch) {
		// 「维护结束后」但**没有锚点** → 无法定位绝对时刻 → 交给下面的 null 分支（不硬造）
		startTs = null;
	}

	// ② 终点（必须在分隔符之后）
	let endTs = null, endRaw = "";
	if (sepMatch) {
		const tail = s.slice(sepMatch.index + sepMatch[0].length);
		const ymd2 = ns_stellasora_YMD_RE.exec(tail);
		const md2 = !ymd2 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(tail)) : null;
		if (ymd2) {
			endTs = sourceInstant(+ymd2[1], +ymd2[2], +ymd2[3], ymd2[4] != null ? +ymd2[4] : 23, ymd2[5] != null ? +ymd2[5] : 59, tz);
			endRaw = ymd2[0];
		} else if (md2) {
			// 省年份：月份比起点小（或同月日更小）→ 跨年
			let y = anchorParts ? anchorParts.y : null;
			const sParts = startTs != null ? sourceWallParts(startTs, tz) : null;
			if (sParts) {
				y = sParts.y;
				if (+md2[1] < sParts.mo || (+md2[1] === sParts.mo && +md2[2] < sParts.d)) y = sParts.y + 1;
			}
			if (y != null) {
				endTs = sourceInstant(y, +md2[1], +md2[2], md2[3] != null ? +md2[3] : 23, md2[4] != null ? +md2[4] : 59, tz);
				endRaw = md2[0];
			}
		}
	}

	if (startTs == null || endTs == null) return null;
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, startInferred };
}

// ── 正文 → 全部带标签的档期 ──
// 返回 [{ label, startTs, endTs, raw, startInferred }]，按出现顺序
function ns_stellasora_parseStellaWindows(html, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const text = ns_stellasora_brText(html);
	const out = [];
	// `▌<标签>时间` 后面紧跟一段（到下一个 ▌ 或结尾）
	const marks = [...text.matchAll(/▌\s*([^\n]{0,20}?时间)\s*\n?([^\n]*)/g)];
	for (const m of marks) {
		const label = m[1].replace(/\s+/g, "");
		const seg = (m[2] || "").trim();
		const w = ns_stellasora_parseStellaWindow(seg, tz, anchorTs);
		if (w) out.push({ label, ...w });
	}
	// 兜底：正文里存在「A ~ B」但没有 ▌标签
	if (out.length === 0) {
		for (const line of text.split("\n")) {
			const w = ns_stellasora_parseStellaWindow(line, tz, anchorTs);
			if (w) out.push({ label: "", ...w });
		}
	}
	return out;
}

// ── 分类：招募（卡池） / 活动 ──
// 实测标题形态：
//   卡池  「空白的稚梦」限时招募开启 / 「沐于温情笑意中」限时招募开启
//   活动  「猎影合围Beta」活动说明 / 「月华窃梦人」活动说明 / 「联合讨伐」活动说明
//   排除  维护更新说明 / 版本内容一览 / 版本活动一览 / 概率公示
function ns_stellasora_stellaIsGacha(title) {
	return /招募/.test(String(title || ""));
}
function ns_stellasora_stellaIsEvent(title) {
	const t = String(title || "");
	if (ns_stellasora_stellaIsGacha(t)) return false;
	if (/维护|更新说明|版本内容|版本活动一览|概率公示|封禁|处罚|问卷/.test(t)) return false;
	return /活动说明|活动开启|活动一览|活动预告/.test(t) || /活动/.test(t);
}
// 卡池标题 → 干净的卡池名：去掉「限时招募开启」等尾巴
function ns_stellasora_stellaGachaName(title) {
	return String(title || "").replace(/(限时|限定)?招募(开启|说明|一览)?[！!。.]?$/, "").trim() || String(title || "").trim();
}

// 卡池正文 → 该池的 UP 角色/秘纹名（悬停里「池名：角色」的右半边）。
// 实测形态（详情首段，**招募说明**里紧跟其后）：
//   「…全新5星旅人「艾蕾」招募概率提升！」          → 艾蕾
//   「…全新5星秘纹「睡前童话」招募概率提升！」      → 睡前童话
// 只取**首个**匹配（4 星行一定写在 5 星行之后，如「活动期间，4星旅人「师渺」「璟麟」…」）；
// 抓不到就返回 ""，悬停行退回只写池名 —— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构，
// **绝不臆造**一个角色名。
const ns_stellasora_STELLA_NEW_FIVE_STAR_RE = /全新\s*5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
const ns_stellasora_STELLA_FIVE_STAR_RE = /5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
function ns_stellasora_stellaFeaturedName(html) {
	const t = ns_stellasora_brText(html);
	const m = ns_stellasora_STELLA_NEW_FIVE_STAR_RE.exec(t) || ns_stellasora_STELLA_FIVE_STAR_RE.exec(t);
	return m ? m[1].trim() : "";
}

// ── 列表解析 ──
function ns_stellasora_parseStellaList(json) {
	if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.rows)) throw new Error("stella-bad-json");
	return json.data.rows
		.filter((x) => x && x.id != null)
		.map((x) => ({
			id: x.id,
			title: decodeEntities(String(x.title || "")).trim(),
			publishTs: typeof x.publishTime === "number" ? x.publishTime : null,
			type: x.type || "",
			typeLabel: x.typeLabel || "",
			url: x.link || ""
		}))
		.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
}

// ── 抓详情并按标题分流，选出「覆盖 now」的条目 ──
// side: "gacha" | "event"
// 返回 { entry, win, candidates } 或 null
async function ns_stellasora_collectStellaSide(url, signal, tz, now, side) {
	const listUrl = url || ns_stellasora_stellaListUrl("notice");
	const list = ns_stellasora_parseStellaList(await fetchJson(listUrl, { signal, mode: "proxy" }));
	const want = side === "gacha" ? ns_stellasora_stellaIsGacha : ns_stellasora_stellaIsEvent;
	const candidates = [];
	// 列表按时间倒序；只扫前若干条，每篇抓一次详情
	for (const row of list.slice(0, 20)) {
		if (!want(row.title)) continue;
		let detail = null;
		try {
			const dj = await fetchJson(ns_stellasora_stellaDetailUrl(row.id), { signal, mode: "proxy" });
			detail = dj && dj.code === 0 && dj.data && dj.data.news ? dj.data.news : null;
		} catch { continue; }   // 单篇失败不拖垮整体
		if (!detail) continue;
		const anchorTs = row.publishTs != null ? row.publishTs : null;
		const wins = ns_stellasora_parseStellaWindows(detail.content, tz, anchorTs);
		// featured：该篇正文里的 UP 主推（卡池悬停「池名：角色」用；活动侧不用）
		const featured = ns_stellasora_stellaFeaturedName(detail.content);
		for (const w of wins) candidates.push({ row, win: w, featured });
	}
	if (candidates.length === 0) return null;
	// 覆盖 now 的里，取「起点最新」的那条（并列时取终点更晚的）
	const covering = candidates.filter((c) => coversNow(c.win, now));
	if (covering.length === 0) return null;
	covering.sort((a, b) => (b.win.startTs - a.win.startTs) || (b.win.endTs - a.win.endTs) || (b.row.id - a.row.id));
	return { picked: covering[0], covering };
}

// ── 悬停 ──────────────────────────────────────────────────────────
// 一律走 `lib/env.js` 的 hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover **逐字同格式**）。
//
// 为什么不再自己拼字符串（2026-10-03 修，用户点名「新增游戏的悬停样式/格式/规则和原来的差别很大」）：
//   ① 旧实现把**元信息/实现说明**塞进了悬停 —— 主要是行尾的「（起点按公告发布时刻推断）」，
//      那本是 `startInferred` 的**实现说明**。本体条目**从不**在悬停里写这些 →
//      **直接删掉，且不改放到别的字段**；说明只留在本文件注释里（见 ns_stellasora_parseStellaWindow 与下方 ③）。
//   ② 旧实现是「档期在前、名称在后」；本体一律 `名称 + 3 空格 + 档期` → 交回 hoverEvent 排版。
//   ③ `startInferred` 的**判定逻辑原样保留**（「维护结束后」→ 用该公告 publishTime 当锚点，
//      不硬造时刻）；变的只是"不再把它写成悬停文案"。
//
// 卡池池项：`{ name, label, startTs, endTs, raw }`。
//   name  = 池名（与面板外显 `banner` 同一个字符串）
//   label = 「池名：角色」（角色抓不到就 = 池名）—— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构
function ns_stellasora_stellaPoolItems(covering) {
	return covering.map((c) => {
		const name = ns_stellasora_stellaGachaName(c.row.title);
		return {
			name,
			label: c.featured ? `${name}：${c.featured}` : name,
			startTs: c.win.startTs,
			endTs: c.win.endTs,
			raw: c.win.raw
		};
	});
}

// 活动项：`{ name, startTs, endTs, raw }`。**排序由调用方负责**（hoverEvent 不排序），
// 这里照本体 sortEventItems 同序：结束时间升序（越快结束越靠前），同结束时间再按开始时间升序。
function ns_stellasora_stellaEventItems(covering) {
	return covering
		.map((c) => ({ name: c.row.title, startTs: c.win.startTs, endTs: c.win.endTs, raw: c.win.raw }))
		.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
}

// ── 卡池侧 ──
async function ns_stellasora_gachaStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "gacha");
	if (!got) return null;
	const { picked, covering } = got;
	// ⚠️ 卡池列的悬停字段是 **bannerHover**（面板 `title: g.bannerHover || gachaTitle`；
	//    50-refresh 的 `pickFields(g.data, GACHA_FIELDS)` 也只留 bannerHover）——
	//    旧实现写的是 `eventHover`，运行时被丢弃 = 卡池悬停**根本没生效**。
	const hover = hoverPool(ns_stellasora_stellaPoolItems(covering), tz);
	const out = {
		banner: ns_stellasora_stellaGachaName(picked.row.title),
		bannerDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		bannerDatesRaw: picked.win.raw,
		startTs: picked.win.startTs,
		endTs: picked.win.endTs,
		event: "",
		eventDates: ""
	};
	// hoverPool 在「当期池 < 2」时返回 ""：此时**不设** bannerHover，交回 UI 的默认两行式
	// 「池名：角色」⏎「档期」—— 不要自己再补一行，那正是与本体不一致的来源。
	if (hover) out.bannerHover = hover;
	return out;
}

// ── 活动侧 ──
async function ns_stellasora_eventsStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "event");
	if (!got) return null;
	const { picked, covering } = got;
	const hover = hoverEvent(ns_stellasora_stellaEventItems(covering), tz);
	const out = {
		// 外显 = 该公告标题（源站的活动名写法；本次**不改**外显与档期字段的内容）。
		// 悬停里的名称与它同源同字，故「外显能看到的活动名」在悬停里也一定看得到。
		event: picked.row.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw
	};
	// hoverEvent 在「当期活动 < 2」时返回 ""：此时**不设** eventHover，
	// 交回 UI 的默认两行式「活动名」⏎「档期|原文」。
	if (hover) out.eventHover = hover;
	return out;
}

// 供测试：从一篇详情 JSON 直接算档期
function ns_stellasora_stellaWindowsFromDetail(detailJson, tz = ns_stellasora_STELLA_TZ) {
	const n = detailJson && detailJson.data && detailJson.data.news;
	if (!n) throw new Error("stella-bad-detail");
	const anchorTs = typeof n.publishTime === "number" ? n.publishTime : null;
	return ns_stellasora_parseStellaWindows(n.content, tz, anchorTs);
}

// src/client/43-sources-register.js —— 新增来源的「条目声明 + 抓取器登记」
//
// 三件事：
//   ① 把 **17 条**新增来源追加进 `SOURCES`（16 条在 `NS_SOURCES` + 1 条 `bh3` 单独 push）
//   ② 登记主抓取器到 `GACHA_FETCHERS` / `EVENT_FETCHERS`
//   ③ 登记备选源抓取器，并把「米游社公告」挂成既有条目（原神/星铁/绝区零）的备选源 + 新建 `bh3`
//
// ⚠️ 数字口径（2026-10-03 核实，原文写的是「20 条」—— 不对）：
//   `20-sources.js` 内置 **11** 条 + 本文件 **17** 条 = 最终 `SOURCES` **28** 条。
//   合并规则见下方 `for (const s of NS_SOURCES)`：**按 id 找，命中就 `Object.assign` 覆盖、否则 push**。
//   那条"覆盖"分支当前**不会触发**（现存 17 条与内置 11 条无一重名），它是留给
//   "新增来源要接管某条内置条目"的升级路径 —— 历史上 `wuhuamixin` / `uma-cn` 的默认源
//   就从 bwiki 换成了 biligame 官方公告，靠的正是它。**别因为"跑不到"就删掉。**
//
// 位置说明：本文件排在 `40-fetchers.js` **之后**（ORDER），因为它要往那两张表里登记、往 SOURCES 里追加。
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）

		// ===== 追加来源进 SOURCES（对齐原有格式：name=游戏名 / source=中文来源名 / tz）=====

		// 注意：米游社那 4 条（bh3 / *-official）不在此列 —— 它们只作为**备选源**挂在下方。

		const NS_SOURCES = [

			{
				id: "p5x",
				tz: "Asia/Shanghai",
				name: "女神异闻录：夜幕魅影",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "官网公告",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "官网公告",
			},

			{
				id: "pjsk",
				tz: "Asia/Shanghai",
				name: "初音未来：缤纷舞台·国服",
				icon: "https://p16-sg.dailygn.com/obj/g-marketing-assets-sg/2021_12_15_07_41_24/icon_s54607.png",
				url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
				// 站点名 + 资源名（对齐本体惯例：`Bwiki 往期祈愿` / `Bwiki 活动一览`）
				// 旧值写的是「第三方数据」——那是**类别**不是站点名，用户 2026-10-03 要求改成网站名称。
				source: "Sekai World 卡池表",
				eventUrl: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
				eventSource: "Sekai World 活动表",
			},

			{
				id: "wuhuamixin",
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "uma-cn",
				tz: "Asia/Shanghai",
				name: "闪耀！优俊少女",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/23/bc/ca23bc1f-5dff-c21a-1881-66c48d02f5b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
				altSources: [{"label":"Bwiki 简中卡池（社区推算，非官方）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2","fetcher":"uma-cn-bwiki"}],
			},

			{
				id: "zspms",
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				eventSource: "Bwiki",
			},

			{
				id: "czn",
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json",
				source: "Bwiki",
			},

			{
				id: "gf2",
				tz: "Asia/Shanghai",
				name: "少女前线2：追放",
				icon: "https://gf2-cn.cdn.sunborngame.com/website/official_zf/mobile/image/logo.png",
				url: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				source: "官方公告",
				eventUrl: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				eventSource: "官方公告",
			},

			{
				id: "bandori",
				tz: "Asia/Shanghai",
				name: "BanG Dream！少女乐团派对·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/ae/11/cbae1132-58ee-8b5c-3016-dfd2f5e91e51/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				eventSource: "官方公告",
				altSources: [{"label":"Bestdori 扭蛋（社区数据库）","url":"https://bestdori.com/api/gacha/all.5.json","fetcher":"bandori-bestdori-gacha"}],
				eventAltSources: [{"label":"Bestdori 活动（社区数据库）","url":"https://bestdori.com/api/events/all.5.json","fetcher":"bandori-bestdori-event"}],
			},

			{
				id: "ournotes",
				tz: "Asia/Tokyo",
				name: "BanG Dream！OurNotes·日服",
				icon: "https://bang-dream-on.bushimo.jp/wordpress/wp-content/themes/bang-dream-on_prod/assets/images/common/apple-touch-icon-180x180.png",
				defaultHidden: true,
				eventUrl: "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				eventSource: "官方公告（日文）",
			},

			{
				id: "fgo",
				tz: "Asia/Shanghai",
				name: "Fate/Grand Order",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/db/d4/19/dbd4196a-68cb-8a74-ca0b-045d0795e10c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://fgo.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://fgo.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki",
			},

			{
				id: "uma-jp",
				tz: "Asia/Tokyo",
				name: "赛马娘·日服",
				icon: "https://umamusume.jp/apple-touch-icon.png",
				url: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				source: "官方公告（日文）",
				eventUrl: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				eventSource: "官方公告（日文）",
				altSources: [{"label":"umapyoi（第三方，无卡池名）","url":"https://api.umapyoi.net/api/v1/gacha","fetcher":"uma-jp-umapyoi"}],
				eventAltSources: [{"label":"Bwiki 活动（往期归档）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2","fetcher":"uma-jp-bwiki"}],
			},

			{
				id: "uma-global",
				tz: "UTC",
				name: "赛马娘·国际服",
				icon: "https://play-lh.googleusercontent.com/yN6cCSP7UB_2bsvlCxrtv-FUpEt1IvEFwr0Ucb3wr39QsAd5PLsueSVXuCinDbE4rifhMlX4YNtpLpkGnpsLhCQ=s64-rw",
				url: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				// 英文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				source: "官方公告（英文）",
				eventUrl: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				eventSource: "官方公告（英文）",
			},

			{
				id: "ddlezj",
				tz: "+540",
				name: "嘟嘟脸恶作剧",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/64/f0/21/64f02145-182e-857a-133c-8de0151425d9/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "kedr",
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
				altSources: [{"label":"Bwiki 卡池信息（台架测试占位）","url":"https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2","fetcher":"kedr-kaxi"}],
			},

			{
				id: "stellasora",
				tz: "Asia/Shanghai",
				name: "星塔旅人",
				icon: "https://webcnstatic.yostar.net/stellasora/stellasora-cn-official-frontend/main/h5/favicon.png?x-oss-process=image/resize,w_128",
				url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				source: "官方公告",
				eventUrl: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				eventSource: "官方公告",
				eventAltSources: [{"label":"Bwiki 首页活动日历（低可用）","url":"https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2","fetcher":"stellasora-bwiki"}],
			},

			{
				id: "ournotes-global",
				tz: "Asia/Shanghai",
				name: "BanG Dream！OurNotes·国际服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ca/da/3a/cada3a9a-491a-fbe5-5494-9be7390e3a9b/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				altSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-gacha"}],
				eventAltSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-event"}],
			},

		];

		for (const s of NS_SOURCES) {

			// 同名条目已存在时不要再 push（例如 bandori/fgo 本体已有），改为**就地覆盖**

			const i = SOURCES.findIndex((x) => x.id === s.id);

			if (i >= 0) { Object.assign(SOURCES[i], s); } else { SOURCES.push(s); }

		}

		// ===== 登记抓取器（键 = 条目 id）=====

		Object.assign(GACHA_FETCHERS, {

			"p5x": (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz),

			"pjsk": (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz),

			"wuhuamixin": (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz),

			"uma-cn": (url, signal, tz) => ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz),

			"zspms": (url, signal, tz) => ns_bwiki_wikitext_gachaZspms(url, signal, tz),

			"czn": (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz),

			"gf2": (url, signal, tz) => ns_gf2_gachaGf2(url, signal, tz),

			"bandori": (url, signal, tz) => ns_bandori_gachaBandori(url, signal, tz),

			"fgo": (url, signal, tz) => ns_fgo_gachaFgo(url, signal, tz),

			"uma-jp": (url, signal, tz) => ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz),

			"uma-global": (url, signal, tz) => ns_umamusume_official_gachaUmaGlobal(url, signal, tz),

			"ddlezj": (url, signal, tz) => ns_biligame_announce_gachaDdlezj(url, signal, tz),

			"kedr": (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz),

			"stellasora": (url, signal, tz) => ns_stellasora_gachaStellasora(url, signal, tz),

		});

		Object.assign(EVENT_FETCHERS, {

			"p5x": { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) },

			"pjsk": { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) },

			"wuhuamixin": { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) },

			"uma-cn": { default: (url, signal, tz) => ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz) },

			"zspms": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsZspms(url, signal, tz) },

			"gf2": { default: (url, signal, tz) => ns_gf2_eventsGf2(url, signal, tz) },

			"bandori": { default: (url, signal, tz) => ns_bandori_eventsBandori(url, signal, tz) },

			"ournotes": { default: (url, signal, tz) => ns_ournotes_eventsOurNotes(url, signal, tz) },

			"fgo": { default: (url, signal, tz) => ns_fgo_eventsFgo(url, signal, tz) },

			"uma-jp": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz) },

			"uma-global": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaGlobal(url, signal, tz) },

			"ddlezj": { default: (url, signal, tz) => ns_biligame_announce_eventsDdlezj(url, signal, tz) },

			"kedr": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) },

			"stellasora": { default: (url, signal, tz) => ns_stellasora_eventsStellasora(url, signal, tz) },

		});

		// ===== 登记备选源抓取器（键 = altSources/eventAltSources 的 fetcher 字段）=====

		// GACHA_FETCHERS 是**扁平**表 → 卡池备选源注册在顶层即可；

		// EVENT_FETCHERS 是**按条目 id 分组**的表 → 活动备选源必须注册进 EVENT_FETCHERS[<条目id>]。

		Object.assign(GACHA_FETCHERS, {

			"uma-jp-umapyoi": (url, signal, tz) => ns_umapyoi_gachaUmapyoi(url, signal, tz),

			"bandori-bestdori-gacha": (url, signal, tz) => ns_bestdori_gachaBestdori(url, signal, tz),

			"kedr-kaxi": (url, signal, tz) => ns_bwiki_gachaKedr(url, signal, tz),

			"uma-cn-bwiki": (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz),

			"ournotes-global-gacha": (url, signal, tz) => ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz),

		});

		EVENT_FETCHERS["uma-jp"] = EVENT_FETCHERS["uma-jp"] || {};

		Object.assign(EVENT_FETCHERS["uma-jp"], {

			"uma-jp-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsUmaJp(url, signal, tz) },

		});

		EVENT_FETCHERS["bandori"] = EVENT_FETCHERS["bandori"] || {};

		Object.assign(EVENT_FETCHERS["bandori"], {

			"bandori-bestdori-event": { default: (url, signal, tz) => ns_bestdori_eventsBestdori(url, signal, tz) },

		});

		EVENT_FETCHERS["stellasora"] = EVENT_FETCHERS["stellasora"] || {};

		Object.assign(EVENT_FETCHERS["stellasora"], {

			"stellasora-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsStellasora(url, signal, tz) },

		});

		EVENT_FETCHERS["ournotes-global"] = EVENT_FETCHERS["ournotes-global"] || {};

		Object.assign(EVENT_FETCHERS["ournotes-global"], {

			"ournotes-global-event": { default: (url, signal, tz) => ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz) },

		});

		//#region 米游社公告（挂成**备选源**，不改默认主源）
		// 用户 2026-10-02 明确要求：「米游社来源全部改名米游社公告，且降级备选，恢复原默认来源」。
		// 所以这里**只加备选**：原神/星铁保持 Bwiki，绝区零保持官方公告（api-takumi-static）。
		// 命中规则 `altSourceId = (alt) => alt.url` 与当前 url 字符串相等；下面是各游戏**专属 gids URL**，不会串。

		{

			const e = SOURCES.find((s) => s.id === "genshin");

			if (!e) { console.warn("[next-sources] 找不到既有条目 genshin，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=2&page_size=20";

				GACHA_FETCHERS["genshin-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["genshin"], { "genshin-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "genshin-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "genshin-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "hsr");

			if (!e) { console.warn("[next-sources] 找不到既有条目 hsr，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=2&page_size=20";

				GACHA_FETCHERS["hsr-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["hsr"], { "hsr-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "hsr-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "hsr-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "zzz");

			if (!e) { console.warn("[next-sources] 找不到既有条目 zzz，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=2&page_size=20";

				GACHA_FETCHERS["zzz-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["zzz"], { "zzz-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "zzz-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "zzz-miyoushe" }];

			}

		}

		// 崩坏3：插件本体此前无来源 → 新建条目且**默认未配置**（用户要求）。

		// 未配置的语义（50-refresh.js）：`if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`

		// → 不抓取、不计成功也不计失败；UI 显示「未配置（不抓取卡池/活动）」。设置页选「米游社公告」即可启用。

		if (!SOURCES.some((s) => s.id === "bh3")) {

			const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20";

			const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20";

			GACHA_FETCHERS["bh3-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

			EVENT_FETCHERS["bh3"] = { default: null, "bh3-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } };

			SOURCES.push({

				id: "bh3",

				tz: "Asia/Shanghai",

				name: "崩坏3",

				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f4/BH3_icon.png!/fw/64",

				// 出厂默认不勾选展示（用户要求）：默认未配置时面板恒空，不该占版面

				defaultHidden: true,

				// 默认**未配置**：不给 url / eventUrl

				source: "",

				eventSource: "",

				altSources: [{ label: "米游社公告", url: G, fetcher: "bh3-miyoushe" }],

				eventAltSources: [{ label: "米游社公告", url: E, fetcher: "bh3-miyoushe" }]

			});

		}

		//#endregion

		//#endregion

// src/client/44-test-exports.js —— 回归测试出口（外层作用域）
//
// 为什么单独一个文件：解析器与 env 工具声明在**外层**，而 engine-api.js 的 __test 是
// createEngine 的返回值（只能闭包拿到引擎内部函数）。这里把「解析器 + env 工具 + 来源/抓取器表」
// 集中成一个对象，由 99-tail.js 挂到 exports.__regression；测试脚本 build 后加载 lib/client.js
// 即可取到，不再需要把解析器写成 ESM 模块。
//
// 名字刻意不叫 __test：现有 22 套门禁脚本会**插桩** exports.__test（替换 exports.apply 那一行），
// 用不同名字避免互相覆盖。
//
// 与 engine-api.js 的 __test 分工：那边是引擎内部函数（fetchEntry / resolveSide / …），
// 这边是纯解析器、工具与来源表。两边都如实暴露函数引用、不含数据，不做环境变量门控。

		const __regression = {
			// ── 新增来源解析器（压平自 next-sources/parsers/*；公开名 → 内部 ns_<域>_ 前缀名）──
			// 按模块分命名空间：17 个解析器之间有 28 处公开名相同（如 cleanTitle / plain / toTs），
			// 摊平成一个对象会互相覆盖，所以保持「每个源一个子对象」。
			parsers: {
			"p5x": {
				eventsP5x: ns_p5x_eventsP5x,
				gachaP5x: ns_p5x_gachaP5x,
				p5xBodyText: ns_p5x_p5xBodyText,
				parseP5xBlocks: ns_p5x_parseP5xBlocks,
				parseP5xList: ns_p5x_parseP5xList,
				parseP5xWindows: ns_p5x_parseP5xWindows,
			},
			"bwiki": {
				detectOrientation: ns_bwiki_detectOrientation,
				eventsStellasora: ns_bwiki_eventsStellasora,
				eventsUmaJp: ns_bwiki_eventsUmaJp,
				eventsWhmx: ns_bwiki_eventsWhmx,
				gachaCzn: ns_bwiki_gachaCzn,
				gachaKedr: ns_bwiki_gachaKedr,
				gachaUmaCn: ns_bwiki_gachaUmaCn,
				gachaWhmx: ns_bwiki_gachaWhmx,
				gachaZspms: ns_bwiki_gachaZspms,
				parseCznGacha: ns_bwiki_parseCznGacha,
				parseKedrGacha: ns_bwiki_parseKedrGacha,
				parsePoints: ns_bwiki_parsePoints,
				parseStellasoraEvents: ns_bwiki_parseStellasoraEvents,
				parseUmaCnGacha: ns_bwiki_parseUmaCnGacha,
				parseUmaJpEvents: ns_bwiki_parseUmaJpEvents,
				parseWhmxEvents: ns_bwiki_parseWhmxEvents,
				parseWhmxGacha: ns_bwiki_parseWhmxGacha,
				parseZspmsGacha: ns_bwiki_parseZspmsGacha,
				windowsFromCell: ns_bwiki_windowsFromCell,
			},
			"umapyoi": {
				PERMANENT_END: ns_umapyoi_PERMANENT_END,
				gachaUmapyoi: ns_umapyoi_gachaUmapyoi,
				parseUmapyoiGacha: ns_umapyoi_parseUmapyoiGacha,
			},
			"bestdori": {
				BESTDORI_CN_INDEX: ns_bestdori_CN_INDEX,
				BESTDORI_LONG_MS: ns_bestdori_LONG_MS,
				eventsBestdori: ns_bestdori_eventsBestdori,
				gachaBestdori: ns_bestdori_gachaBestdori,
				parseBestdoriEvents: ns_bestdori_parseBestdoriEvents,
				parseBestdoriGacha: ns_bestdori_parseBestdoriGacha,
			},
			"sekai": {
				SEKAI_LONG_MS: ns_sekai_LONG_MS,
				eventsSekai: ns_sekai_eventsSekai,
				gachaSekai: ns_sekai_gachaSekai,
				parseSekaiEvents: ns_sekai_parseSekaiEvents,
				parseSekaiGachas: ns_sekai_parseSekaiGachas,
			},
			"gf2": {
				GF2_BASE: ns_gf2_GF2_BASE,
				GF2_EVENT_URL: ns_gf2_GF2_EVENT_URL,
				GF2_GACHA_URL: ns_gf2_GF2_GACHA_URL,
				GF2_TZ: ns_gf2_GF2_TZ,
				eventsGf2: ns_gf2_eventsGf2,
				gachaGf2: ns_gf2_gachaGf2,
				gf2DetailUrl: ns_gf2_gf2DetailUrl,
				gf2EventName: ns_gf2_gf2EventName,
				parseGf2Date: ns_gf2_parseGf2Date,
				parseGf2List: ns_gf2_parseGf2List,
				parseGf2Roles: ns_gf2_parseGf2Roles,
				parseGf2Windows: ns_gf2_parseGf2Windows,
				selectGf2Window: ns_gf2_selectGf2Window,
			},
			"bandori": {
				BANDORI_LIST_URL: ns_bandori_BANDORI_LIST_URL,
				BANDORI_TZ: ns_bandori_BANDORI_TZ,
				bandoriActiveGachaSections: ns_bandori_bandoriActiveGachaSections,
				bandoriActiveSections: ns_bandori_bandoriActiveSections,
				bandoriDetailUrl: ns_bandori_bandoriDetailUrl,
				bandoriRolesFromSection: ns_bandori_bandoriRolesFromSection,
				bandoriSectionItem: ns_bandori_bandoriSectionItem,
				bandoriTitle: ns_bandori_bandoriTitle,
				eventsBandori: ns_bandori_eventsBandori,
				gachaBandori: ns_bandori_gachaBandori,
				parseBandoriDate: ns_bandori_parseBandoriDate,
				parseBandoriList: ns_bandori_parseBandoriList,
				parseBandoriSections: ns_bandori_parseBandoriSections,
				parseBandoriWindow: ns_bandori_parseBandoriWindow,
				pickBandoriEventSection: ns_bandori_pickBandoriEventSection,
				pickBandoriGachaSection: ns_bandori_pickBandoriGachaSection,
			},
			"ournotes": {
				OURNOTES_LIST_URL: ns_ournotes_OURNOTES_LIST_URL,
				OURNOTES_TZ: ns_ournotes_OURNOTES_TZ,
				eventsOurNotes: ns_ournotes_eventsOurNotes,
				ournotesTitle: ns_ournotes_ournotesTitle,
				parseOurNotesInstant: ns_ournotes_parseOurNotesInstant,
				parseOurNotesPosts: ns_ournotes_parseOurNotesPosts,
				parseOurNotesWindows: ns_ournotes_parseOurNotesWindows,
				selectOurNotesPrimary: ns_ournotes_selectOurNotesPrimary,
			},
			"fgo": {
				FGO_API: ns_fgo_FGO_API,
				FGO_EVENT_PAGE: ns_fgo_FGO_EVENT_PAGE,
				FGO_EVENT_URL: ns_fgo_FGO_EVENT_URL,
				FGO_GACHA_PAGE: ns_fgo_FGO_GACHA_PAGE,
				FGO_GACHA_URL: ns_fgo_FGO_GACHA_URL,
				FGO_TZ: ns_fgo_FGO_TZ,
				eventsFgo: ns_fgo_eventsFgo,
				fgoParseUrl: ns_fgo_fgoParseUrl,
				fgoTables: ns_fgo_fgoTables,
				findFgoEventTable: ns_fgo_findFgoEventTable,
				formatFgoRoles: ns_fgo_formatFgoRoles,
				gachaFgo: ns_fgo_gachaFgo,
				parseFgoBannerTable: ns_fgo_parseFgoBannerTable,
				parseFgoEventTable: ns_fgo_parseFgoEventTable,
				parseFgoWindow: ns_fgo_parseFgoWindow,
			},
			"miyoushe": {
				MIYOUSHE_DETAIL_DELAY_MS: ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS,
				MIYOUSHE_GIDS: ns_miyoushe_MIYOUSHE_GIDS,
				MIYOUSHE_MAX_DETAILS: ns_miyoushe_MIYOUSHE_MAX_DETAILS,
				MIYOUSHE_REFERER: ns_miyoushe_MIYOUSHE_REFERER,
				MIYOUSHE_TYPES: ns_miyoushe_MIYOUSHE_TYPES,
				MIYOUSHE_TZ: ns_miyoushe_MIYOUSHE_TZ,
				classifyMiyousheTitle: ns_miyoushe_classifyMiyousheTitle,
				collectMiyousheWindows: ns_miyoushe_collectMiyousheWindows,
				eventsMiyoushe: ns_miyoushe_eventsMiyoushe,
				gachaMiyoushe: ns_miyoushe_gachaMiyoushe,
				isMiyousheMissing: ns_miyoushe_isMiyousheMissing,
				miyousheDetailUrl: ns_miyoushe_miyousheDetailUrl,
				miyousheListUrl: ns_miyoushe_miyousheListUrl,
				miyousheRoles: ns_miyoushe_miyousheRoles,
				miyousheVersionStarts: ns_miyoushe_miyousheVersionStarts,
				parseMiyousheDetail: ns_miyoushe_parseMiyousheDetail,
				parseMiyousheList: ns_miyoushe_parseMiyousheList,
				parseNewsMeta: ns_miyoushe_parseNewsMeta,
			},
			"umamusume-official": {
				UMA_DEFAULT_MAX_DETAILS: ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
				UMA_DEFAULT_MAX_PAGES: ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
				UMA_DEFAULT_PAGE_SIZE: ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
				UMA_GLOBAL_DETAIL_URL: ns_umamusume_official_UMA_GLOBAL_DETAIL_URL,
				UMA_GLOBAL_INDEX_URL: ns_umamusume_official_UMA_GLOBAL_INDEX_URL,
				UMA_GLOBAL_LABEL_GAME: ns_umamusume_official_UMA_GLOBAL_LABEL_GAME,
				UMA_GLOBAL_TZ: ns_umamusume_official_UMA_GLOBAL_TZ,
				UMA_JP_DETAIL_URL: ns_umamusume_official_UMA_JP_DETAIL_URL,
				UMA_JP_INDEX_URL: ns_umamusume_official_UMA_JP_INDEX_URL,
				UMA_JP_TZ: ns_umamusume_official_UMA_JP_TZ,
				classifyUmaTitle: ns_umamusume_official_classifyUmaTitle,
				eventsUmaGlobal: ns_umamusume_official_eventsUmaGlobal,
				eventsUmaJpOfficial: ns_umamusume_official_eventsUmaJpOfficial,
				extractUmaRangePlates: ns_umamusume_official_extractUmaRangePlates,
				gachaUmaGlobal: ns_umamusume_official_gachaUmaGlobal,
				gachaUmaJpOfficial: ns_umamusume_official_gachaUmaJpOfficial,
				labelBeforeUma: ns_umamusume_official_labelBeforeUma,
				parseUmaDetail: ns_umamusume_official_parseUmaDetail,
				parseUmaIndex: ns_umamusume_official_parseUmaIndex,
				parseUmaInstant: ns_umamusume_official_parseUmaInstant,
				parseUmaWindows: ns_umamusume_official_parseUmaWindows,
				pickUmaWindow: ns_umamusume_official_pickUmaWindow,
				postJsonUma: ns_umamusume_official_postJsonUma,
				proxyUrlFor: ns_umamusume_official_proxyUrlFor,
				tokenizeUma: ns_umamusume_official_tokenizeUma,
				umaCurrentItems: ns_umamusume_official_umaCurrentItems,
				umaJpPageUrl: ns_umamusume_official_umaJpPageUrl,
			},
			"biligame-announce": {
				DDLEZJ_CMS_TZ: ns_biligame_announce_DDLEZJ_CMS_TZ,
				DDLEZJ_GAME_EXTENSION_ID: ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID,
				DDLEZJ_HOME: ns_biligame_announce_DDLEZJ_HOME,
				DDLEZJ_LIST_URL: ns_biligame_announce_DDLEZJ_LIST_URL,
				DDLEZJ_TZ: ns_biligame_announce_DDLEZJ_TZ,
				ddlezjDetailUrl: ns_biligame_announce_ddlezjDetailUrl,
				ddlezjParagraphs: ns_biligame_announce_ddlezjParagraphs,
				eventsDdlezj: ns_biligame_announce_eventsDdlezj,
				gachaDdlezj: ns_biligame_announce_gachaDdlezj,
				parseDdlezjAnnouncement: ns_biligame_announce_parseDdlezjAnnouncement,
				parseDdlezjDate: ns_biligame_announce_parseDdlezjDate,
				parseDdlezjList: ns_biligame_announce_parseDdlezjList,
				parseDdlezjStamp: ns_biligame_announce_parseDdlezjStamp,
				parseDdlezjWindows: ns_biligame_announce_parseDdlezjWindows,
				pickDdlezjEvent: ns_biligame_announce_pickDdlezjEvent,
				pickDdlezjGacha: ns_biligame_announce_pickDdlezjGacha,
			},
			"kedr-wiki": {
				KEDR_API: ns_kedr_wiki_KEDR_API,
				KEDR_ARCHIVE_PAGE: ns_kedr_wiki_KEDR_ARCHIVE_PAGE,
				KEDR_ARCHIVE_URL: ns_kedr_wiki_KEDR_ARCHIVE_URL,
				KEDR_REFERER: ns_kedr_wiki_KEDR_REFERER,
				KEDR_TZ: ns_kedr_wiki_KEDR_TZ,
				gachaKedrWiki: ns_kedr_wiki_gachaKedrWiki,
				kedrParseUrl: ns_kedr_wiki_kedrParseUrl,
				kedrPools: ns_kedr_wiki_kedrPools,
				kedrRoles: ns_kedr_wiki_kedrRoles,
				kedrSections: ns_kedr_wiki_kedrSections,
				kedrStamp: ns_kedr_wiki_kedrStamp,
				parseKedrArchive: ns_kedr_wiki_parseKedrArchive,
			},
			"stellasora": {
				STELLA_BASE: ns_stellasora_STELLA_BASE,
				STELLA_TZ: ns_stellasora_STELLA_TZ,
				eventsStellasora: ns_stellasora_eventsStellasora,
				gachaStellasora: ns_stellasora_gachaStellasora,
				parseStellaList: ns_stellasora_parseStellaList,
				parseStellaWindow: ns_stellasora_parseStellaWindow,
				parseStellaWindows: ns_stellasora_parseStellaWindows,
				stellaDetailUrl: ns_stellasora_stellaDetailUrl,
				stellaFeaturedName: ns_stellasora_stellaFeaturedName,
				stellaGachaName: ns_stellasora_stellaGachaName,
				stellaIsEvent: ns_stellasora_stellaIsEvent,
				stellaIsGacha: ns_stellasora_stellaIsGacha,
				stellaListUrl: ns_stellasora_stellaListUrl,
				stellaWindowsFromDetail: ns_stellasora_stellaWindowsFromDetail,
			},
			"bwiki-wikitext": {
				CZN_MODULE_PAGE: ns_bwiki_wikitext_CZN_MODULE_PAGE,
				CZN_MODULE_URL: ns_bwiki_wikitext_CZN_MODULE_URL,
				CZN_RECORD_PAGE: ns_bwiki_wikitext_CZN_RECORD_PAGE,
				CZN_RECORD_URL: ns_bwiki_wikitext_CZN_RECORD_URL,
				CZN_REFERER: ns_bwiki_wikitext_CZN_REFERER,
				CZN_TZ: ns_bwiki_wikitext_CZN_TZ,
				KEDR_REFERER: ns_bwiki_wikitext_KEDR_REFERER,
				KEDR_TEMPLATE_PAGE: ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE,
				KEDR_TEMPLATE_URL: ns_bwiki_wikitext_KEDR_TEMPLATE_URL,
				KEDR_TZ: ns_bwiki_wikitext_KEDR_TZ,
				ZSPMS_ASK_QUERY: ns_bwiki_wikitext_ZSPMS_ASK_QUERY,
				ZSPMS_ASK_URL: ns_bwiki_wikitext_ZSPMS_ASK_URL,
				ZSPMS_REFERER: ns_bwiki_wikitext_ZSPMS_REFERER,
				ZSPMS_TZ: ns_bwiki_wikitext_ZSPMS_TZ,
				cznStamp: ns_bwiki_wikitext_cznStamp,
				eventsKedrTemplate: ns_bwiki_wikitext_eventsKedrTemplate,
				eventsZspms: ns_bwiki_wikitext_eventsZspms,
				gachaCzn: ns_bwiki_wikitext_gachaCzn,
				gachaKedrTemplate: ns_bwiki_wikitext_gachaKedrTemplate,
				gachaZspms: ns_bwiki_wikitext_gachaZspms,
				kedrIsEvent: ns_bwiki_wikitext_kedrIsEvent,
				kedrIsGacha: ns_bwiki_wikitext_kedrIsGacha,
				kedrRoleFromName: ns_bwiki_wikitext_kedrRoleFromName,
				kedrStamp: ns_bwiki_wikitext_kedrStamp,
				kedrTemplateCalls: ns_bwiki_wikitext_kedrTemplateCalls,
				kedrTemplateUrl: ns_bwiki_wikitext_kedrTemplateUrl,
				mediaWikiWikitext: ns_bwiki_wikitext_mediaWikiWikitext,
				parseCznLua: ns_bwiki_wikitext_parseCznLua,
				parseCznRecord: ns_bwiki_wikitext_parseCznRecord,
				parseKedrTemplate: ns_bwiki_wikitext_parseKedrTemplate,
				parseZspmsAnnouncement: ns_bwiki_wikitext_parseZspmsAnnouncement,
				parseZspmsAsk: ns_bwiki_wikitext_parseZspmsAsk,
				zspmsEventTier: ns_bwiki_wikitext_zspmsEventTier,
				zspmsHeadings: ns_bwiki_wikitext_zspmsHeadings,
				zspmsLatestNotice: ns_bwiki_wikitext_zspmsLatestNotice,
				zspmsMaintenanceWindow: ns_bwiki_wikitext_zspmsMaintenanceWindow,
				zspmsNameAt: ns_bwiki_wikitext_zspmsNameAt,
				zspmsNormalize: ns_bwiki_wikitext_zspmsNormalize,
				zspmsParseUrl: ns_bwiki_wikitext_zspmsParseUrl,
			},
			"biligame-activity": {
				BILIGAME_ACTIVITY_TZ: ns_biligame_activity_BILIGAME_ACTIVITY_TZ,
				UMA_CN_GAME_EXTENSION_ID: ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID,
				UMA_CN_HOME: ns_biligame_activity_UMA_CN_HOME,
				UMA_CN_LIST_URL: ns_biligame_activity_UMA_CN_LIST_URL,
				WHMX_GAME_EXTENSION_ID: ns_biligame_activity_WHMX_GAME_EXTENSION_ID,
				WHMX_HOME: ns_biligame_activity_WHMX_HOME,
				WHMX_LIST_URL: ns_biligame_activity_WHMX_LIST_URL,
				WHMX_LIST_URLS: ns_biligame_activity_WHMX_LIST_URLS,
				WHMX_TYPE_IDS: ns_biligame_activity_WHMX_TYPE_IDS,
				biligameDetailUrl: ns_biligame_activity_biligameDetailUrl,
				biligameListUrl: ns_biligame_activity_biligameListUrl,
				biligameParagraphs: ns_biligame_activity_biligameParagraphs,
				classifyUmaCnTitle: ns_biligame_activity_classifyUmaCnTitle,
				cleanTitle: ns_biligame_activity_cleanTitle,
				coveringWhmxEvents: ns_biligame_activity_coveringWhmxEvents,
				deglueDateTimes: ns_biligame_activity_deglueDateTimes,
				eventsUmaCnOfficial: ns_biligame_activity_eventsUmaCnOfficial,
				eventsWhmxOfficial: ns_biligame_activity_eventsWhmxOfficial,
				extractWindowsDetailed: ns_biligame_activity_extractWindowsDetailed,
				gachaUmaCnOfficial: ns_biligame_activity_gachaUmaCnOfficial,
				mergeBiligameLists: ns_biligame_activity_mergeBiligameLists,
				parseBiligameList: ns_biligame_activity_parseBiligameList,
				parseCmsStamp: ns_biligame_activity_parseCmsStamp,
				parseUmaCnAnnouncement: ns_biligame_activity_parseUmaCnAnnouncement,
				parseWhmxActivity: ns_biligame_activity_parseWhmxActivity,
				pickUmaWindow: ns_biligame_activity_pickUmaWindow,
				pickWhmxEvent: ns_biligame_activity_pickWhmxEvent,
				quotedName: ns_biligame_activity_quotedName,
				siblingListUrl: ns_biligame_activity_siblingListUrl,
				umaCnEventHover: ns_biligame_activity_umaCnEventHover,
				umaCnPoolHover: ns_biligame_activity_umaCnPoolHover,
				umaRoles: ns_biligame_activity_umaRoles,
				whmxEventHover: ns_biligame_activity_whmxEventHover,
				whmxListUrls: ns_biligame_activity_whmxListUrls,
			},
			"ournotes-global": {
				OURNOTES_GLOBAL_GAME_BASE_ID: ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID,
				OURNOTES_GLOBAL_HOME: ns_ournotes_global_OURNOTES_GLOBAL_HOME,
				OURNOTES_GLOBAL_LANGS: ns_ournotes_global_OURNOTES_GLOBAL_LANGS,
				OURNOTES_GLOBAL_LIST_URL: ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL,
				OURNOTES_GLOBAL_TZ: ns_ournotes_global_OURNOTES_GLOBAL_TZ,
				classifyOurNotesGlobalTitle: ns_ournotes_global_classifyOurNotesGlobalTitle,
				cleanTitle: ns_ournotes_global_cleanTitle,
				eventsOurNotesGlobal: ns_ournotes_global_eventsOurNotesGlobal,
				extractOurNotesGlobalWindows: ns_ournotes_global_extractOurNotesGlobalWindows,
				gachaOurNotesGlobal: ns_ournotes_global_gachaOurNotesGlobal,
				isOurNotesGlobalEmpty: ns_ournotes_global_isOurNotesGlobalEmpty,
				langOf: ns_ournotes_global_langOf,
				ournotesGlobalDetailText: ns_ournotes_global_ournotesGlobalDetailText,
				ournotesGlobalDetailUrl: ns_ournotes_global_ournotesGlobalDetailUrl,
				ournotesGlobalListUrl: ns_ournotes_global_ournotesGlobalListUrl,
				ournotesGlobalStructuredWindow: ns_ournotes_global_ournotesGlobalStructuredWindow,
				ournotesGlobalTitle: ns_ournotes_global_ournotesGlobalTitle,
				parseOurNotesGlobalPage: ns_ournotes_global_parseOurNotesGlobalPage,
				parseOurNotesGlobalStamp: ns_ournotes_global_parseOurNotesGlobalStamp,
				pickOurNotesGlobalWindow: ns_ournotes_global_pickOurNotesGlobalWindow,
			},
			},
			// 共用工具 / env（测试原先从 next-sources/lib/env.js 取）
			fmtWindow,
			fmtMdHm,
			pad2,
			decodeEntities,
			stripTags,
			textOf,
			hoverPool,
			hoverEvent,
			sourceInstant,
			sourceWallParts,
			sourceOffsetMinutes,
			tzOffsetMinutesAt,
			setCoreEnv,
			// 来源表与抓取器表（测试直接用它们核对条目/登记，不再需要 registry 模块）
			SOURCES,
			GACHA_FETCHERS,
			EVENT_FETCHERS,
			DEFAULT_SETTINGS,
		};

		//#region refresh
		// 两侧各自只允许写自己的字段：某些来源的载荷同时含卡池与活动字段（如 GameKee），
		// 若把整对象直接合并，活动源的数据会污染卡池列（反之亦然）——解耦契约的一部分。
		const GACHA_FIELDS = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover"];
		const EVENT_FIELDS = ["event", "eventDates", "eventDatesRaw", "eventHover"];
		function pickFields(src, fields) {
			const out = {};
			if (!src) return out;
			for (const k of fields) if (src[k] !== void 0) out[k] = src[k];
			return out;
		}
		// 抓取单侧字段：自带解析器优先；**用户自己填的地址**（自定义条目 / 自带条目的自定义网址）
		// 才允许通用解析兜底——内置默认源不兜底：代理源直连必被 CORS 拦，那个错误不该算到来源头上。
		// 返回 { data, fail }：fail=null 表示该侧成功，否则 { kind: "down"|"nomatch", reason }。
		// data 一律原样带回（未命中时也可能附带可供同 URL 复用的其它字段）。
		// `tz`（可选）= 源站墙钟时区，透传给抓取器/解析器（不传 = 本机时区，向后兼容）。
		async function resolveSide(side, { fetcher, url, allowGeneric, signal, tz }) {
			const emptyOf = (d) => (side === "gacha" ? !d || !d.banner : !d || !d.event);
			const parseGeneric = () => (side === "gacha"
				? tryParseGenericGacha(url, signal, tz)
				: tryParseGenericEvent(url, signal, tz));
			let data = null;
			let fail = null;
			if (fetcher) {
				try {
					data = await fetcher(url, signal, tz);
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					fail = { kind: "down", reason: normErr(err) };
				}
			}
			if (emptyOf(data) && allowGeneric) {
				try {
					const g = await parseGeneric();
					if (!emptyOf(g)) { data = g; fail = null; } // 兜底成功 → 该侧按成功算
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					if (!fail) fail = { kind: "down", reason: normErr(err) };
				}
			}
			// 有地址、但既没注册抓取器、也不允许通用解析 → 这一侧根本没有可用来源：
			// 如实记"无可用来源"（既不冒充"未公布"，也不去发注定被 CORS 拦的直连——历史 bug）
			if (emptyOf(data) && !fetcher && !allowGeneric) return { data: data || null, fail: { kind: "down", reason: "无可用来源" } };
			if (emptyOf(data)) return { data: data || null, fail: fail || { kind: "nomatch" } };
			return { data, fail: null };
		}
		// 抓取单个条目：卡池字段与活动字段分别由各自来源产出（见"统一来源注册表"契约）。
		// 两个来源独立选择：同 URL 且载荷已带活动字段 → 单次请求复用；否则各自独立抓取。
		// 返回 { ok, data, gachaFail, eventFail }：ok = 两侧都没有 down（只有 nomatch 仍算 ok）。
		async function fetchEntry(source, signal) {
			// 无任何来源的条目：跳过（不计成功也不计失败）
			if (!source.url && !source.eventUrl) return { ok: true, reason: "skipped" };
			// 来源标识统一归一（老配置的 proxy:/gk-*: 写法 → 真实地址 / 内部来源 id）：
			// 抓取器一律只拿到"干净地址"，不再需要在抓取层剥前缀
			const gachaUrl = normalizeSourceId(source.url);
			const eventUrl = normalizeSourceId(source.eventUrl);
			try {
				let g = { data: null, fail: null };
				if (source.url) {
					g = await resolveSide("gacha", {
						fetcher: gachaFetcherFor(source, gachaUrl),
						url: gachaUrl,
						allowGeneric: !!(source.custom || source.allowGenericGacha),
						signal,
						tz: source.tz
					});
				}
				let evData = null;
				let eventFail = null;
				if (source.eventUrl) {
					// 活动侧自己的抓取器（与卡池侧各自独立选择，来源可以完全不同）。
					// 注意：**默认路径就是"活动侧自己抓"** —— 解耦是常态，复用只是优化。
					const evFetcher = eventFetcherFor(source, eventUrl);
					// ── 两侧同一条 URL 时的请求复用：**命中才触发**的分支 ───────────
					// 只有两个条件**同时**成立才复用，否则一律走下面的独立抓取：
					//   ① 两侧是**同一条 URL**（按**完整 URL 含查询参数**比，不是「同一个网站」）
					//      —— 例如星铁的卡池与活动都是 wiki.biligame.com/sr/api.php，
					//         但 `page=历史跃迁` vs `page=活动一览`，**不是**同一条 URL；
					//         而绝区零/鸣潮两侧是字面完全相同的 URL，一次请求的响应完全一样。
					//   ② 卡池那次的载荷**确实带了活动字段**（`event`）
					// 复用只是"省掉一次**同一 URL** 的重复请求"，**不是解耦的腿**：
					// 活动侧的抓取器、失败归因、来源选择都保持独立（见 §53）。
					//
					// 2026-10-01 实测（11 内置条目逐条）：复用支命中 5 次
					//   （wuwa / nte / r1999 / ba-cn / ba-global —— 它们的卡池载荷本身就含活动字段），
					// 其余 6 条目（zzz / genshin / hsr / arknights / ba-jp / endfield）走独立抓取。
					const reuseSameRequest = eventUrl === gachaUrl && !!(g.data && g.data.event);
					if (reuseSameRequest) {
						// 同 URL：活动字段就在卡池载荷里，不重复抓
						evData = {
							event: g.data.event,
							eventDates: g.data.eventDates || "",
							eventDatesRaw: g.data.eventDatesRaw || g.data.bannerDatesRaw || "",
							eventHover: g.data.eventHover || ""
						};
					} else if (eventUrl === gachaUrl && !evFetcher) {
						// ── 两侧同一条 URL、但活动侧**没有自己的抓取器**（该条目就只有这一份载荷可用）──
						// ⚠️ **这一支不是死代码，别删**：**自定义条目**可以没有注册抓取器 ——
						//   `getAllEntries` 里 customEntries 带 `custom:true` + 用户填的 url/eventUrl，
						//   而 GACHA_FETCHERS / EVENT_FETCHERS 里没有它们的 id → `eventFetcherFor` 返回 null。
						//
						// 语义（2026-10-01 修）：
						//  · 卡池那次**成功**（g.data 非空）→ 用**同一份 HTML** 再跑一次通用活动解析。
						//    为什么必须试：卡池那次的载荷里可能只有卡池字段（没有 event），但**同一个页面**
						//    里就写着活动表。此前这里直接判 nomatch，于是自定义条目"卡池列有内容、活动列恒空"
						//    （用户点名，与卡池侧新加的普通表兜底不对称 —— 同一张表两侧口径必须一致）。
						//    复用 HTML 而不是重新抓：这条分支的初衷就是"省掉同一条 URL 的重复请求"。
						//  · 复用没解析出活动、或卡池那次本身失败 → 记 nomatch；
						//    后者沿用**同一次请求**的失败原因（如 HTTP 567），而不是笼统报"无可用来源"。
						// 教训：我一度只按"内置 11 条目命中 0 次"就判它死代码 —— **错的**，
						// 把"当前没命中"当成了"不可达"。`_batch1` A3 用合成条目（sim-nte）刻意覆盖这两条语义。
						// 取同一份文本：**只读缓存**（`peekHtmlText` 命中才返回，绝不发动新请求）。
						// 为什么不能调 fetchHtmlText：卡池那次若是走注册抓取器、或直连取到的，
						// 缓存里就没有它 —— 那时再去取就等于**打一次必被 CORS 拦的直连**，
						// 而这条分支的既有语义恰恰是"不打直连、如实记未公布"（`_batch1` A3 守护着）。
						// 只有"卡池那次确实经 fetchHtmlText 取过同一 URL"（自定义条目的常态）才复用。
						const sameHtml = g.data ? peekHtmlText(gachaUrl) : null;
						const reusedEvent = sameHtml ? genericEventPayloadFromHtml(sameHtml, source.tz) : null;
						if (reusedEvent) {
							evData = reusedEvent;
						} else {
							eventFail = g.data ? { kind: "nomatch" } : (g.fail || { kind: "nomatch" });
						}
					} else {
						// 活动侧独立抓取（含"两侧不是同一条 URL"与"同一条 URL 但载荷无活动字段"两种情形）
						const ev = await resolveSide("event", {
							fetcher: evFetcher,
							url: eventUrl,
							allowGeneric: !!(source.custom || source.allowGenericEvent),
							signal,
							tz: source.tz
						});
						evData = ev.data;
						eventFail = ev.fail;
					}
				}
				const data = pickFields(g.data, GACHA_FIELDS);
				if (evData) Object.assign(data, pickFields(evData, EVENT_FIELDS));
				const gachaFail = g.fail;
				return {
					ok: !isDown(gachaFail) && !isDown(eventFail),
					reason: "ok",
					data,
					gachaFail,
					eventFail
				};
			} catch (err) {
				// 顶层异常（含 12 秒超时中断）：两侧按"报错"记，面板照实提示
				const aborted = !!err && err.name === "AbortError";
				const reason = aborted ? "超时" : normErr(err);
				const fail = { kind: "down", reason };
				return {
					ok: false,
					reason,
					gachaFail: source.url ? fail : null,
					eventFail: source.eventUrl ? fail : null
				};
			}
		}

		// 合并本轮抓取结果与上次缓存（统一机制，不针对任何游戏）：
		// - 展示字段按列兜底：本次某列没拿到就沿回旧值，并标记该列"显示的是旧值"（gachaStale/eventStale）
		// - 抓取状态（gachaFail/eventFail）永远来自本轮，既不继承也不删除
		// - okAt = 最近一次"两侧都拿到新数据"的时间；有任一侧没拿到就不刷新
		function mergeEntryRecord(r, prevRec, nowTs) {
			const gachaFail = (r && r.gachaFail) || null;
			const eventFail = (r && r.eventFail) || null;
			const rec = { ...((r && r.data) || {}), gachaFail, eventFail };
			if (prevRec) {
				if (!rec.banner && prevRec.banner) {
					rec.banner = prevRec.banner;
					rec.roles = prevRec.roles || "";
					if (!rec.bannerDates) rec.bannerDates = prevRec.bannerDates || "";
					if (!rec.bannerDatesRaw) rec.bannerDatesRaw = prevRec.bannerDatesRaw || prevRec.bannerDates || "";
					if (!rec.bannerHover) rec.bannerHover = prevRec.bannerHover || "";
					rec.gachaStale = true;
				}
				if (!rec.event && prevRec.event) {
					rec.event = prevRec.event;
					if (!rec.eventDates) rec.eventDates = prevRec.eventDates || "";
					if (!rec.eventDatesRaw) rec.eventDatesRaw = prevRec.eventDatesRaw || prevRec.eventDates || "";
					if (!rec.eventHover) rec.eventHover = prevRec.eventHover || "";
					rec.eventStale = true;
				}
			}
			// "两侧都拿到新数据"才算 okAt；被跳过的条目（两侧都没配来源）本轮根本没抓，不能算新数据
			const skipped = !!(r && r.reason === "skipped");
			rec.okAt = (!skipped && !gachaFail && !eventFail) ? nowTs : (prevRec && prevRec.okAt) || 0;
			return rec;
		}

		// 一轮刷新的总预算（毫秒）。注意：这只是"到点收尾"的兜底——被掐断的前提是 transport 理会 signal；
		// 宿主代理等不理会 signal 的实现靠 runEntriesWithDeadline 的兜底收尾，不会让调用方永远等下去。
		const REFRESH_TIMEOUT_MS = 12000;

		// 跑一批 fetchEntry，并施加"到点即超时"的兜底：
		// · 到点时**已经回来**的条目保留自己的结果；
		// · 还没回来的条目按该条目"有哪一侧来源"记成 {kind:"down", reason:"超时"}（与 fetchEntry 顶层 catch 同口径）；
		// 这样即使 transport 完全不理会 signal（宿主代理就是这样），刷新也一定会结束、面板不会永远"刷新中"。
		async function runEntriesWithDeadline(targets, timeoutMs) {
			const ms = timeoutMs || REFRESH_TIMEOUT_MS;
			const controller = typeof AbortController === "function" ? new AbortController() : null;
			const signal = controller ? controller.signal : void 0;
			const timeoutResult = (t) => {
				const fail = { kind: "down", reason: "超时" };
				return { ok: false, reason: "超时", gachaFail: t.url ? fail : null, eventFail: t.eventUrl ? fail : null };
			};
			let timer = 0;
			const deadline = new Promise((resolve) => {
				timer = coreEnv.timer.setTimeout(() => {
					if (controller) { try { controller.abort(); } catch { /* ignore */ } }
					resolve(null);
				}, ms);
			});
			try {
				const raced = targets.map(async (t) => {
					const r = await Promise.race([fetchEntry(t, signal), deadline]);
					return r || timeoutResult(t);   // null ⇒ 到点时这条还没回来
				});
				return await Promise.all(raced);
			} finally {
				coreEnv.timer.clearTimeout(timer);
			}
		}

		async function refreshAll(entries, s, timeoutMs) {
			// 每轮清空 HTML 文本缓存：两侧同址的复用必须落在**同一轮内**，
			// 跨轮复用会拿到过期页面（见 30-parsers.js 的 fetchHtmlText）
			resetHtmlTextCache();
			// 自定义爬取地址覆盖默认；克隆避免污染原始对象（卡池源+活动源分别覆盖）
			// allowGeneric*：只有"用户自己填的地址"（custom:<url>）或自定义条目才允许通用解析兜底
			const targets = entries.map((e) => ({
				...e,
				url: getEntryUrl(s, e.id, e.url),
				eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
				allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
				allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
			}));
			const results = await runEntriesWithDeadline(targets, timeoutMs);
			// 被跳过的条目（两侧都没配来源）不算成功——与外壳 buildScrapeInfo 的口径一致
			const okCount = results.filter((r) => r.ok && r.reason !== "skipped").length;
			return {
				okCount,
				total: entries.length,
				at: nowMs(),
				status: okCount > 0 ? "ok" : "unreachable",
				results
			};
		}
		//#endregion

		//#region helpers（core 与外壳共用：纯函数、零宿主依赖）
		// —— 抓取状态与错误归一（统一机制，不做任何游戏特判）——
		// 每一侧（卡池/活动）只有三种状态：
		//   ok      ：本次抓到当期内容
		//   down    ：抓取器报错（网络错误 / CORS 被拦 / 超时 / HTTP 非 2xx / 解析崩，都算）
		//   nomatch ：请求成功，但源站里没有当期内容（"未命中"，不是失败）
		// 判定口径：任一侧 down → 整条 ok=false；只有 nomatch → 仍算 ok（面板提示"未公布"）。
		// 环境原文（fetch failed / Failed to fetch / NetworkError…）一律归一成简短中文，不再外显。
		// 放在 helpers（而非 core 内部）是因为**外壳也要用**：面板要在列悬停里显示失败原因、
		// 要在顶部拼"成功 N/M + 五类归类"，这些都只依赖失败对象本身，与抓取无关。
		const SIDE_TEXT = {
			gacha: { fail: "卡池失败", nomatch: "新卡池未公布", nomatchUser: "未解析出内容" },
			event: { fail: "活动失败", nomatch: "新活动未公布", nomatchUser: "未解析出内容" }
		};

		// —— 配置表单写入被拒时的归因（纯函数）——
		// DSH 0.1.7 的 configForms 表单有四种"能读不能写"的状态，肉眼在界面上完全分不出来
		// （控件点一下弹回原值、没有任何提示）。这里按快照如实说清是哪一种，让下次出问题能一眼定位：
		//   memory  = 本次连接不是本机回环 → 宿主压根不接受持久化写入（只读）
		//   loading = 表单数据还没送到（点太早了）
		//   unavailable = 宿主没在 serve 本插件的条目（多半是条目 id 对不上 / 没进 describe）
		//   其它    = 宿主明确拒绝（字段没进表单，或修订号冲突）
		function formRejectHint(scope, key) {
			var snap = null;
			try { snap = scope && scope.getSnapshot ? scope.getSnapshot() : null; } catch (e) { snap = null; }
			const status = snap && snap.status ? snap.status : "unknown";
			const mode = snap && snap.mode ? snap.mode : "unknown";
			const rev = snap && typeof snap.revision === "number" ? " (rev " + snap.revision + ")" : "";
			const id = scope && scope.entryId ? scope.entryId : "(未解析)";
			if (mode === "memory") return "本次连接不是本机，宿主不接受写入（只读模式）";
			if (status === "loading") return "配置表单还没送到，请稍后重试";
			if (status === "unavailable") return "宿主未 serve 条目「" + id + "」" + servedNamespacesText(scope.configForms);
			return "宿主拒绝了该写入（表单状态 " + status + " / " + mode + rev + "）";
		}

		// 把宿主**真正 serve 的**设置 namespace 列出来。这一条是给"地址对不上"这类故障留的现场：
		// 只说"没提供配置条目"定位不了，列出真实 id 就能一眼看出该用哪个。
		function servedNamespacesText(configForms) {
			try {
				const mirror = configForms && typeof configForms.describe === "function" ? configForms.describe() : null;
				const view = mirror && typeof mirror.getSnapshot === "function" ? mirror.getSnapshot().view : null;
				const rows = view && Array.isArray(view.namespaces) ? view.namespaces : [];
				const names = rows.map((r) => r && r.ns).filter((ns) => typeof ns === "string");
				return names.length ? "（宿主当前 serve：" + names.join(", ") + "）" : "（宿主当前一个设置条目都没 serve）";
			} catch (e) {
				return "";
			}
		}
		function normErr(err) {
			const name = String((err && err.name) || "");
			const msg = String((err && err.message) || err || "");
			if (name === "AbortError" || /abort/i.test(msg)) return "超时";
			if (/^proxy-bad:/.test(msg)) return "代理响应异常";
			const m = msg.match(/^(?:proxy-http|http)-(\d{3})$/);
			if (m) return "HTTP " + m[1];
			if (/^bad-json$/.test(msg)) return "响应格式异常";
			if (/fetch failed|Failed to fetch|NetworkError|net::|Load failed|network error/i.test(msg)) return "网络不通";
			if (/^no-source$/.test(msg)) return "无可用来源";
			// 解析器用 throw 表达"页面结构变了/一条都没解析出来"（哨兵错误名见各解析器，统一带
			// shape-changed / layout-changed / no-table / no-timer / no-chunk / no-section 这类后缀）：
			// 给一句比"抓取异常"更有信息量的归因 —— 让"源站改版"在面板上**看得见**，
			// 而不是伪装成"新卡池未公布"（终末地上次长期静默失灵就是这么来的）
			if (/shape-changed|layout-changed|no-table|no-timer|no-chunk|no-section|no-banner|no-dates|no-activities|parse-empty/.test(msg)) {
				return "页面结构变了（解析出 0 条）";
			}
			return "抓取异常";
		}
		const isDown = (f) => !!f && f.kind === "down";
		const isNomatch = (f) => !!f && f.kind === "nomatch";
		// 兼容老版本缓存：旧 lastData 里 eventFail 是**字符串**（"event-down" / "no-match" / 错误原文），
		// 读到时升级成 { kind, reason }；新格式原样返回（否则老缓存会把"失败"错显成"未公布"）。
		function normalizeFail(f) {
			if (!f) return null;
			if (typeof f === "string") {
				return /nomatch|no-match/i.test(f) ? { kind: "nomatch" } : { kind: "down", reason: normErr(f) };
			}
			return f.kind === "down" || f.kind === "nomatch" ? f : null;
		}
		// 一侧状态的单行文案：down → "卡池失败：网络不通"；nomatch → "新卡池未公布"；ok → ""
		// opts.userSupplied：该侧地址由用户自己填（自定义条目 / 自定义网址）时，"未命中"多半意味着
		// "你填的这个地址读不出卡池内容"，而不是"官方还没公布"——文案换一句更贴切的，状态仍是"未公布"
		function sideFailText(side, fail, opts) {
			const f = normalizeFail(fail);
			if (!f) return "";
			if (f.kind === "down") return SIDE_TEXT[side].fail + "：" + (f.reason || "抓取异常");
			return (opts && opts.userSupplied) ? SIDE_TEXT[side].nomatchUser : SIDE_TEXT[side].nomatch;
		}
		// 逐条归类（固定顺序：卡池在前、活动在后；每侧至多一条）
		function entryFailParts(r) {
			const parts = [];
			const gf = normalizeFail(r && r.gachaFail);
			const ef = normalizeFail(r && r.eventFail);
			if (gf) parts.push({ side: "gacha", kind: gf.kind, text: sideFailText("gacha", gf) });
			if (ef) parts.push({ side: "event", kind: ef.kind, text: sideFailText("event", ef) });
			return parts;
		}
		// —— 备选源（altSources / eventAltSources）字段约定 ——
		//   label   设置页显示名
		//   fetcher 抓取器键名（GACHA_FETCHERS / EVENT_FETCHERS[条目 id] 里注册）
		//   url     该来源要抓的地址（大多数备选源）
		//   id      抓取器自带地址的内部来源（如 GameKee）的稳定标识
		// 设置页持久化的"当前来源"就是 url ?? id（不再用伪地址或前缀编码语义）。
		// 老配置里的两种旧写法在读取时自动翻译，无需迁移脚本：
		//   "proxy:<url>"（旧版本用前缀标记"经 host 代理"）、"gk-jp:" / "gk-global:"（旧伪地址）
		const altSourceId = (alt) => alt.url || alt.id || "";
		const LEGACY_ALT_IDS = { "gk-jp:": "ba-jp:gamekee", "gk-global:": "ba-global:gamekee" };
		function normalizeSourceId(v) {
			const s = String(v ?? "");
			const mapped = Object.prototype.hasOwnProperty.call(LEGACY_ALT_IDS, s) ? LEGACY_ALT_IDS[s] : s;
			return mapped.startsWith("proxy:") ? mapped.slice("proxy:".length) : mapped;
		}
		// 顶部提示（**只读 Result JSON**，不碰抓取内部状态）：行内给"分类 + 条目名"（段间空格，
		// 零项不显示），悬停明细逐条分行给原因。games 为按显示顺序排列的条目元信息（含 name）。
		function buildScrapeInfo(games, result) {
			const list = Array.isArray(games) ? games : [];
			const rec = (result && result.games) || {};
			// "成功"口径 = 两侧都没有**报错**（down）；只有 nomatch（未命中）仍算成功
			const okCount = list.filter((g) => {
				const r = rec[g.id];
				if (!r || r.skipped) return false;
				return !isDown(r.gachaFail) && !isDown(r.eventFail);
			}).length;
			// 无任何来源的条目（skipped）既不算成功也不算失败，单独给一句"（跳过 k 个）"
			const skippedCount = list.filter((g) => rec[g.id] && rec[g.id].skipped).length;
			const skippedNote = skippedCount > 0 ? `（跳过 ${skippedCount} 个）` : "";
			// 固定类别顺序：卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布
			const CATS = [
				["gachaFail", "down", SIDE_TEXT.gacha.fail],
				["eventFail", "down", SIDE_TEXT.event.fail],
				["gachaFail", "nomatch", SIDE_TEXT.gacha.nomatch],
				["eventFail", "nomatch", SIDE_TEXT.event.nomatch]
			];
			const groups = CATS.map(([field, kind, label]) => ({
				label,
				names: list.filter((g) => {
					const f = normalizeFail(rec[g.id] && rec[g.id][field]);
					return f && f.kind === kind;
				}).map((g) => g.name)
			})).filter((grp) => grp.names.length > 0);
			let info = `成功 ${okCount}/${list.length}${skippedNote}`;
			groups.forEach((grp) => { info += ` ${grp.label}：${grp.names.join("、")}`; });
			const lines = list.map((g) => {
				const parts = entryFailParts(rec[g.id] || {});
				return parts.length > 0 ? `${g.name} ${parts.map((p) => p.text).join("、")}` : "";
			}).filter(Boolean);
			return { info, lines };
		}

		// 按设置中的排序（order: id 数组）重排；未设置时保持 SOURCES 顺序
		function applyOrder(sources, order) {
			if (!Array.isArray(order) || order.length === 0) return sources;
			const byId = new Map(sources.map((s) => [s.id, s]));
			const out = [];
			for (const id of order) if (byId.has(id)) out.push(byId.get(id));
			for (const s of sources) if (!out.includes(s)) out.push(s);
			return out;
		}

		// 安全解析 JSON 字符串
		function parseJsonStr(str, fallback) {
			try { return JSON.parse(str || "") ?? fallback; } catch { return fallback; }
		}

		// 全部条目 = 内置(去除已删除) + 自定义条目
		// ⚠️ 这里是**白名单重建**：每加一个内置条目支持的新字段，都必须同步加到这里，
		// 否则自定义条目上写了也会被静默丢掉（2026-10-01 踩到：`tz` 不在列表里，
		// 用户给自定义条目配的源站时区被丢弃，永远退回本机时区）。
		function getAllEntries(s) {
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const base = SOURCES.filter((x) => !removed.includes(x.id));
			const customs = parseJsonStr(s.customEntries, []);
			if (!Array.isArray(customs)) return base;
			const out = base.slice();
			for (const c of customs) {
				if (!c || typeof c.id !== "string") continue;
				out.push({
					id: c.id,
					name: c.name || c.id,
					banner: c.banner || "",
					bannerDates: c.bannerDates || "",
					event: c.event || "",
					eventDates: c.eventDates || "",
					next: c.next || "",
					icon: c.icon || "",
					source: c.source || "",
					url: c.url || "",
					eventUrl: c.eventUrl || "",
					// 源站墙钟时区（可选）：留空/不写 → 沿用本机时区（与改造前一致）
					tz: c.tz || null,
					custom: true
				});
			}
			return out;
		}

		// 蔚蓝档案三服角色名特例（一处规则、两个效果合并）：
		// 1) 括号后缀是换装版本标识（桔梗（泳装）、椿(導覽員)、Shiroko (Cycling)），不去除——去掉会与基础版撞名；
		// 2) 括号一律归一为半角（全角（）、半角() 都写成 ()），与日服/国际服源站写法对齐。
		// 其它游戏仍按原规则删掉（属性/职业）后缀（如 克拉蕾（锋御·电）→ 克拉蕾）。
		const BA_ROLE_IDS = ["ba-cn", "ba-global", "ba-jp"];

		function baRoleName(name) {
			return String(name || "").replace(/（/g, "(").replace(/）/g, ")");
		}

		// 角色名精简（面板外显用）：去「」装饰、去（属性/职业）后缀；
		// 「称号·名字」按分隔符去称号（· U+00B7 不限字数；• U+2022 仅 4 字前缀）。
		// 悬停全文仍用原始 roles。
		function cleanRoleNames(roles, gameId) {
			const isBa = BA_ROLE_IDS.includes(gameId);
			return String(roles || "")
				.split(/[、,，]/)
				.map((n) => {
					let s = n.replace(/[「」【】]/g, "");
					if (isBa) s = baRoleName(s); // 蔚蓝三服：保留括号后缀 + 统一半角
					else s = s.replace(/[（(][^）)]*[）)]/g, "");
					s = s.trim();
					// 称号去前缀，按分隔符区分（避免误删角色名）：
					// ·  U+00B7 居中点 = 称号分隔（原神「轰隆雷鸣波·伊涅芙」→ 伊涅芙），不限称号字数；
					// •  U+2022 间隔号 = 角色·变体（星铁「砂金•戏浪」→ 保留），仅在旧规则（4 字前缀）下才去
					const mDot = s.match(/^([\u4e00-\u9fff]{2,10})[\u00B7](.+)$/);
					if (mDot && mDot[2].trim()) {
						s = mDot[2].trim();
					} else {
						const mBullet = s.match(/^([\u4e00-\u9fff]{4})[\u2022](.+)$/);
						if (mBullet) s = mBullet[2].trim();
					}
					return s;
				})
				.filter(Boolean)
				.join("、");
		}

		// 默认爬取源显示名（设置页下拉默认项）
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		// 卡池源：source 字段，否则域名；活动源：eventSource 标签，否则域名
		// 该侧压根没配来源时（只抓另一侧的自定义条目会这样）→ 就写"未配置"。
		// ⚠️ 曾经写成"未配置（不抓取卡池/活动）"以免看着像坏了；用户 2026-10-03 明确要求**去掉括号注释**
		//    （下拉里那一列本来就窄，括号反而喧宾夺主）→ 保持裸"未配置"。
		function getDefaultSourceName(g, urlField) {
			const isEvent = urlField === "eventUrl";
			const u = isEvent ? g.eventUrl : g.url;
			if (isEvent) {
				if (g.eventSource && g.eventSource.trim() !== "") return g.eventSource.trim();
				if (u && u.trim() !== "") {
					try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
				}
				return "未配置";
			}
			if (g.source && g.source.trim() !== "") return g.source.trim();
			if (u && u.trim() !== "") {
				try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
			}
			return "未配置";
		}

		// 可见条目 = 全部条目 - 隐藏条目
		//
		// ── 出厂默认隐藏（`defaultHidden`）──
		// 有些来源"能用但不可靠/信息量低"（如 p5x 只有版本公告里的契约块、卡厄斯数据已过期、
		// OurNotes 日服没有卡池源），出厂不该占用面板版面，但**必须仍能在设置页勾选启用**。
		// 用**两个列表**表达三态，避免"默认值只在首次安装生效"这个坑：
		//   · `hidden` —— 用户**明确关掉**的（出厂默认即为空）
		//   · `shown`  —— 用户**明确打开**的（用来覆盖 defaultHidden）
		// 判定：`hidden` 里有 → 隐；`defaultHidden` 且 `shown` 里没有 → 隐；否则显。
		// 这样**老用户**（配置里只有 hidden=[]、没有 shown）也能立刻生效，不必等配置重置。
		function isEntryHidden(x, s) {
			const hidden = Array.isArray(s && s.hidden) ? s.hidden : [];
			if (hidden.includes(x.id)) return true;
			if (!x.defaultHidden) return false;
			const shown = Array.isArray(s && s.shown) ? s.shown : [];
			return !shown.includes(x.id);
		}
		function getVisibleEntries(s) {
			return getAllEntries(s).filter((x) => !isEntryHidden(x, s));
		}

		// 某条目的实际爬取地址：自定义覆盖默认；urlField 区分卡池源(customUrls)/活动源(customEventUrls)
		// 存储值约定：custom:<url>（用户自定义输入，剥前缀返回 url）；其它值经 normalizeSourceId 归一
		// （备选源的标识就是它的 url 或 id，老配置的 proxy:/gk-*: 写法在这里翻译）
		function getEntryUrl(s, id, fallbackUrl, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			if (typeof u !== "string" || u.trim() === "") return fallbackUrl;
			if (u.startsWith("custom:")) {
				const v = u.slice("custom:".length).trim();
				return v !== "" ? v : fallbackUrl;
			}
			const normalized = normalizeSourceId(u.trim());
			return normalized !== "" ? normalized : fallbackUrl;
		}
		// 该条目的来源地址是否由用户自己填的（设置里存的是 custom:<url>）：
		// 自定义网址允许通用解析兜底（用户在设置页粘 api.php 等页面时，内置解析器可能吃不下）
		function isCustomSource(s, id, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			return typeof u === "string" && u.startsWith("custom:");
		}

		// 解析面板展示的时间段（mm-dd hh:mm ~ mm-dd hh:mm，无年份，如 "08-12 06:00 ~ 09-01 17:59"）
		// → { startTs, endTs }；无法解析返回 null。年份按当前年补全，跨年（end 月份 < start 月份）自动 +1 年。
		function parseDisplayRange(str, now) {
			if (typeof str !== "string") return null;
			const parts = str.split(/~/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const parsePart = (p) => {
				const m = p.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (!m) return null;
				const mo = Number(m[1]), d = Number(m[2]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				const h = m[3] ? Number(m[3]) : 0;
				const mi = m[4] ? Number(m[4]) : 0;
				return { mo, d, h, mi, base: new Date(now.getFullYear(), mo - 1, d, h, mi).getTime() };
			};
			const a = parsePart(parts[0]);
			const b = parsePart(parts[1]);
			if (!a || !b) return null;
			const startTs = a.base;
			let endTs = b.base;
			// 跨年：结束月份小于开始月份（如 12-20 ~ 01-05）→ 结束端按"下一年的同月同日同时刻"重算。
			// 注意不能用 +365 天近似：闰年会差 1 天（实测 2028-12-31 看 "12-30 ~ 01-05" 会少 1 天）。
			if (b.mo < a.mo) endTs = new Date(now.getFullYear() + 1, b.mo - 1, b.d, b.h, b.mi).getTime();
			return { startTs, endTs };
		}

		// 游戏名/图标悬停：这行数据的刷新时间（= 最近一次整行都拿到新数据的时间；
		// 有列沿用旧值时保持旧时间，不谎报新时间）；没有成功记录则只显示名称
		function buildRowTitle(g) {
			return g._okAt ? g.name + "\n刷新时间 " + new Date(g._okAt).toLocaleString() : g.name;
		}

		// 剩余时间文本："X 天 X 小时 X 分钟"；负数（已过）返回 null 由调用方处理
		function formatRemaining(ts, now) {
			const diff = ts - now.getTime();
			if (diff < 0) return null;
			const days = Math.floor(diff / 86400000);
			const hours = Math.floor((diff % 86400000) / 3600000);
			const mins = Math.floor((diff % 3600000) / 60000);
			return `${days}\u5929${hours}\u5C0F\u65F6${mins}\u5206\u949F`;
		}

		// 面板时间列展示：未开始→"还有 X 天 X 小时 X 分钟开始"；进行中→"还剩 X 天 X 小时 X 分钟"；已结束→"已结束"
		function displayTimeCell(raw, now) {
			const r = parseDisplayRange(raw, now);
			if (!r) return raw || "";
			if (now.getTime() < r.startTs) {
				const t = formatRemaining(r.startTs, now);
				return t === null ? raw : `\u8FD8\u6709 ${t} \u5F00\u59CB`;
			}
			if (now.getTime() > r.endTs) return "\u5DF2\u7ED3\u675F";
			const t = formatRemaining(r.endTs, now);
			return t === null ? raw : `\u8FD8\u6709 ${t}`;
		}

		// "这次启动要不要自动刷新一次" —— 纯函数（面板挂载时判定一次；core 不联网、不做决定）。
		// 规则（按优先级）：
		//   ① 版本哨兵对不上 → **强制**刷一次，**不看自动刷新开关**：
		//      · lastVersion 为空 = 首次安装（或装了本功能之前的旧缓存、上次刷新没成功）
		//      · 否则 = 插件已更新（悬停格式、来源地址、解析器、样式等改动不刷新就看不到效果）
		//   ② 到点（lastRefresh + refreshMinutes 已过） → 仅当自动刷新开关为开时刷
		// 为什么必须有它：定时器只按"本次运行时长"计时（重启即归零，谁也不会一直不关电脑），
		// 所以"启动时判一次"才是间隔设置真正生效的地方。UI 只负责照做与提示。
		function autoRefreshPlan(input) {
			const s = input || {};
			const pluginVersion = String(s.pluginVersion || "");
			const cachedVersion = String(s.lastVersion || "");
			if (pluginVersion && cachedVersion !== pluginVersion) {
				return { due: true, force: true, reason: cachedVersion ? "\u63D2\u4EF6\u5DF2\u66F4\u65B0" : "\u9996\u6B21\u542F\u52A8" };
			}
			if (!s.autoRefresh) return { due: false, force: false, reason: "" };
			const minutes = Number(s.refreshMinutes);
			const at = Number(s.lastRefresh) || 0;
			if (!Number.isFinite(minutes) || minutes <= 0 || at <= 0) return { due: false, force: false, reason: "" };
			if (at + minutes * 60000 <= (Number(s.now) || 0)) return { due: true, force: false, reason: "\u5DF2\u5230\u5237\u65B0\u95F4\u9694" };
			return { due: false, force: false, reason: "" };
		}
		//#endregion
		//#endregion

		//#region engine（core 对外唯一入口：createEngine）
		// core = 环境无关的"抓取 + 解析 + 缓存合并"逻辑。宿主（DSH 插件 / 浏览器扩展 / Windows /
		// Android / iOS / 鸿蒙）只需注入三样东西，然后读它返回的 Result JSON 画界面：
		//   transport: { fetchRaw(url, opts), fetchViaProxy(url, { referer, headers, body }) }
		//   storage:   { get(key), set(key, value) }      —— 配置与缓存都走它（键名见 CONFIG_KEYS）
		//   now:       () => 毫秒时间戳（可注入 → 单测能固定时间）
		//   timer:     { setTimeout, clearTimeout }（可选；不传就用宿主全局的）
		// 硬约束（交接文档 §13.3）：core 内部不得出现 window / document / Node API / 直接 fetch /
		// 直接 Date.now —— 全部经 15-env.js 的 coreEnv。违反此约束会让 Android/iOS/鸿蒙 无法嵌入。
		const ENGINE_SCHEMA_VERSION = 1;

		function createEngine(env) {
			const engineEnv = env || {};
			// 各平台自己实现这两个方法；缺省实现只保证"不崩"，不联网、不落盘
			const storage = engineEnv.storage || {
				async get() { return undefined; },
				async set() { /* 无存储：算完就返回，不持久化 */ }
			};
			// engine 会读取的存储键（宿主按自己的方式实现即可；读不到就用 DEFAULT_SETTINGS 的默认值）
			//   order / hidden / shown / removed / customEntries / customUrls / customEventUrls —— 配置
			//   lastData / lastRefresh / lastSource / lastVersion                            —— 缓存
			//   （lastVersion = 产出该缓存的插件版本，用于"更新插件后首次启动强制刷新"，见 autoRefreshPlan）
			//
			// ⚠️ 2026-10-03 修：这里**漏了 `shown`**，后果是「出厂默认隐藏的条目，勾上也不抓」。
			//    链路：设置页勾选 → 写入 `shown`（宿主表单）→ 面板直接读表单快照 `snapshot.value`，
			//    所以**行能显示出来**；但引擎的 `readSettings()` 走这份 `CONFIG_KEYS`，
			//    读不到 `shown`（永远回落到 DEFAULT_SETTINGS 的 `[]`）→ `isEntryHidden` 对
			//    `defaultHidden` 条目恒为 true → `getVisibleEntries` 里没有它 → **refresh 一轮
			//    一个请求都不给它发**。表现就是用户报的"勾了 p5x、点刷新，这条不刷新"。
			//    受影响的正是 6 个 defaultHidden 条目：p5x / czn / ournotes / ddlezj /
			//    ournotes-global / bh3（它们都在 43-sources-register.js，core 侧没有，
			//    所以这个 bug 只在 DSH 插件里显现）。
			//    防回归见 test/cases-rule-lint.mjs 的「DEFAULT_SETTINGS 的键必须都在 CONFIG_KEYS 里」。
			const CONFIG_KEYS = [
				"order", "hidden", "shown", "removed", "customEntries", "customUrls", "customEventUrls",
				"autoRefresh", "refreshMinutes", "lastData", "lastRefresh", "lastSource", "lastVersion"
			];

			// 读取配置（缺失项回落到 10-config.js 的 DEFAULT_SETTINGS）
			async function readSettings() {
				const out = { ...DEFAULT_SETTINGS };
				for (const k of CONFIG_KEYS) {
					const v = await storage.get(k);
					if (v !== undefined && v !== null) out[k] = v;
				}
				return out;
			}

			// 解析器版本号（代码元信息，不随缓存走）：无服务端分发时用来定位
			// 「坏了的是哪个版本的用户、哪个源」（交接文档 §13.4）。自定义条目没有维护中的解析器，故不出现在这里。
			function parserVersionsOf(entries) {
				const out = {};
				for (const e of entries) if (typeof e.parserVersion === "number") out[e.id] = e.parserVersion;
				return out;
			}

			// 记录归一：**Result JSON 的形状必须固定**（这才是"冻结契约"）——
			// 内容字段无论抓没抓到都存在（缺就是空串），消费方不必到处 `?? ""`；
			// 状态字段永远在（gachaFail / eventFail / okAt，可选 gachaStale / eventStale / skipped）。
			// 判断"是没抓到还是源站没内容"要把内容字段与 gachaFail/gachaStale 一起看。
			const CONTENT_FIELDS = [
				"banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
				"event", "eventDates", "eventDatesRaw", "eventHover"
			];
			function normalizeRecord(rec, name) {
				const src = rec || {};
				const out = { name: name || src.name || "" };
				for (const f of CONTENT_FIELDS) out[f] = typeof src[f] === "string" ? src[f] : "";
				// 老缓存的 fail 是**字符串**（"event-down" / "no-match" / 错误原文）：必须在这里就归一成
				// { kind, reason }，否则按契约实现的其它消费者（扩展/CLI）用 isDown() 会把字符串判成成功
				// （"失败被错显成未公布"）。键名与值域不变，不需要升 schemaVersion。
				out.gachaFail = normalizeFail(src.gachaFail);
				out.eventFail = normalizeFail(src.eventFail);
				out.gachaStale = !!src.gachaStale;
				out.eventStale = !!src.eventStale;
				if (src.skipped) out.skipped = true;
				out.okAt = typeof src.okAt === "number" ? src.okAt : 0;
				return out;
			}

			// 上次结果（Result JSON 形态；没有缓存时 games 为空对象，UI 直接显示静态默认值即可）
			async function getCached() {
				const raw = await storage.get("lastData");
				const parsed = raw ? parseJsonStr(raw, {}) : {};
				const byId = parsed && typeof parsed === "object" ? parsed : {};
				const games = {};
				// 老缓存也补齐成同一形状（缺字段填空串）——消费方只需认一种形状
				for (const [id, rec] of Object.entries(byId)) games[id] = normalizeRecord(rec, rec && rec.name);
				const at = await storage.get("lastRefresh");
				const entries = getAllEntries(await readSettings());
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: Number(at) || 0,
					parserVersions: parserVersionsOf(entries),
					games
				};
			}

			// 条目元信息（名字 / 图标 / 来源标签 / 可选来源清单 / 静态默认值 / 是否隐藏）。
			// 各平台 UI 用它画列表；**不含抓取结果**（结果在 getCached() / refresh() 里）。
			async function listGames() {
				const s = await readSettings();
				const hidden = Array.isArray(s.hidden) ? s.hidden : [];
				return getAllEntries(s).map((g) => ({
					id: g.id,
					name: g.name,
					icon: g.icon,
					source: g.source,
					eventSource: g.eventSource,
					altSources: (g.altSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					eventAltSources: (g.eventAltSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					custom: !!g.custom,
					hidden: hidden.includes(g.id),
					defaults: {
						banner: g.banner || "",
						roles: g.roles || "",
						bannerDates: g.bannerDates || "",
						event: g.event || "",
						eventDates: g.eventDates || ""
					}
				}));
			}

			// —— 环境注入：把宿主给的三样东西接到 coreEnv（15-env.js）——
			// 必须放在 core 段之后：coreEnv 是 let 声明，提前调用会踩 TDZ。
			// 保存成本引擎自己的一份（含**完整的** timer 默认实现），并在每个公开方法入口重新注入：
			// coreEnv 是模块级单例，同一进程里建第二个引擎会把它覆盖；不重注入就会出现
			// "第一个引擎的时钟/传输/计时器被第二个引擎偷走"（安静串台，最难查）。
			const DEFAULT_TIMER = {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			};
			const ENGINE_ENV = {
				transport: engineEnv.transport,
				now: engineEnv.now || (() => Date.now()),
				// 补全默认实现：宿主只注入 setTimeout 时，clearTimeout 也必须是配套的那一个
				timer: { ...DEFAULT_TIMER, ...(engineEnv.timer || {}) }
			};
			function useEnv() {
				setCoreEnv(ENGINE_ENV);
			}
			useEnv();

			// 抓取一轮：读配置 → 逐条抓取（卡池/活动各自独立）→ 与上次缓存按列合并 →
			// 写回缓存 → 返回 Result JSON（这就是"产品接口"，各平台 UI 只读它）。
			// 在途保护：同一引擎并发调用时复用同一轮（否则两轮各自无条件写缓存，慢的那轮会用更旧的数据
			// 盖掉快的那轮，而 lastRefresh 却是更晚的时间戳 = "旧内容配新时间"）。
			let refreshInFlight = null;
			function refresh() {
				useEnv();
				if (refreshInFlight) return refreshInFlight;
				refreshInFlight = (async () => {
					const s = await readSettings();
				// 只抓"选中展示"的条目（getVisibleEntries = 全部 - hidden）：
				// 面板本就只渲染可见条目（80-components 用同一个函数），抓隐藏条目是**纯浪费**——
				// 每轮都为它们发请求、解析、写缓存（自定义条目 404 还会一直计入失败统计）。
				// 隐藏条目的**旧数据原样保留**，所以取消隐藏时仍能立刻看到上次内容（见下面 forEach 的 else 支）。
				//
				// ⚠️ 索引必须**按 id 映射**，不能用 `entries.indexOf(e)`：
				// `getVisibleEntries(s)` 内部自己又调了一次 `getAllEntries(s)`，返回的是**另一批对象**，
				// 与这里的 `allEntries` 元素不是同一个引用 → `indexOf` 恒为 -1 →
				// `result.results[-1]` 是 undefined → 刷新直接抛 TypeError。
				// （2026-10-01 实测踩到：**没有隐藏条目的用户一刷新就崩**，正是最普遍的那种配置。）
				const allEntries = getAllEntries(s);
				const entries = getVisibleEntries(s);
				const resultByIndex = new Map(entries.map((e, i) => [e.id, i]));
				const result = await refreshAll(entries, s);
				const prev = await getCached();
				const games = {};
				allEntries.forEach((e) => {
					const i = resultByIndex.get(e.id);
					if (i === void 0) {
						// 隐藏（未选中展示）→ 本轮**不抓、也不判定**，但要把两件事分开处理：
						//
						// · **内容字段与 okAt 原样保留** —— 取消隐藏时仍能立刻看到上次内容（既有体验）。
						// · **失败状态（gachaFail/eventFail）与 stale 标记一律清空** ——
						//   隐藏期间我们**没有发起请求**，所以"失败"这个判断**根本不成立**：
						//   保留一个未经验证的旧失败等于在说谎。更要命的是它会被**冻结**：
						//   这里只做 `normalizeRecord(prev.games[e.id])` 的搬运、从不重新判定，
						//   于是那条失败原因会一直是"隐藏前最后一次抓取"留下的值——
						//   实测：源站恢复后连刷 3 轮，隐藏记录里的 `抓取异常` 依然不动。
						//   后果：用户取消隐藏后，会先看到一条**可能早已过期**的失败原因。
						//   （2026-10-01 用户追问"失败原因是哪来的"后定为方案 B。）
						const kept = prev.games[e.id];
						const blank = { ...(kept || {}) };
						delete blank.gachaFail;
						delete blank.eventFail;
						delete blank.gachaStale;
						delete blank.eventStale;
						games[e.id] = normalizeRecord(blank, e.name);
						return;
					}
					const r = result.results[i] || { reason: "skipped" };
					const rec = mergeEntryRecord(r, prev.games[e.id], nowMs());
					if (r.reason === "skipped") rec.skipped = true;
					// 统一成固定形状（内容字段缺失填空串）——见 engine-head.js 的 normalizeRecord
					games[e.id] = normalizeRecord(rec, e.name);
				});
				await storage.set("lastData", JSON.stringify(games));
				await storage.set("lastRefresh", result.at);
				await storage.set("lastSource", result.status === "ok" ? "web" : "none");
				// 版本哨兵：只要这一轮**真的抓到了东西**（okCount > 0）就记当前插件版本。
				// 为什么不要求"整轮全绿"：长期挂掉的源（最常见的是用户自己填错的自定义条目）会永远失败，
				// 那样哨兵永远盖不上章 → 每次启动都强制刷一次（实测踩到：3 个自定义条目 404，11 个内置源全绿）。
				// 为什么不无条件写：整轮全失败（断网/全局故障）时不盖章 → 下次启动自动重试。
				if (result.okCount > 0) await storage.set("lastVersion", PLUGIN_VERSION);
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: result.at,
					parserVersions: parserVersionsOf(entries),
					games
				};
				})();
				return refreshInFlight.finally(() => { refreshInFlight = null; });
			}

			// 解析器自检（交接文档 §13.4）：对每个条目的两侧来源各跑一次，报告「解析出什么 / 报错原因」。
			// 用途：源站改版时快速定位「哪个源解析出 0 条、哪个源 403/超时」——各平台都能调用
			// （将来扩展里做「自检」按钮、CLI、CI 都行）。**只读**：不写缓存、不动设置。
			//
			// 口径与刷新一致：**只自检"选中展示"的条目**（同 getVisibleEntries）。
			// 理由：自检的用途是"定位当前实际在用的源"，而隐藏条目既不在面板显示、也不参与刷新；
			// 把它们一起报出来只会让结论里混进与当前无关的失败（如已隐藏的自定义条目 404）。
			async function selfCheck(options) {
				useEnv();
				const timeoutMs = (options && options.timeoutMs) || REFRESH_TIMEOUT_MS;
				const s = await readSettings();
				const entries = getVisibleEntries(s);
				const targets = entries.map((e) => ({
					...e,
					url: getEntryUrl(s, e.id, e.url),
					eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
					allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
					allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
				}));
				// 与刷新同一套"到点收尾"兜底：transport 不理会 signal 时，自检也不会永远转圈
				const results = await runEntriesWithDeadline(targets, timeoutMs);
				// 一侧的结论：ok=有内容；nomatch=抓到页面但没当期内容；down=抓取/解析报错；
				// unconfigured=该侧压根没配来源（合法状态，**不算失败**——面板把它当"没这回事"，
				// 自检也必须同口径：单列一类，否则"没配"会混进"报错"数字里，用户去修也无从下手）
				const describe = (kind, fail, data, url) => {
					if (!url) return { state: "unconfigured", reason: "未配置来源", text: "未配置来源" };
					const f = normalizeFail(fail);
					if (!f) {
						const text = kind === "gacha"
							? [data.roles || data.banner, data.bannerDates].filter(Boolean).join(" / ")
							: [data.event, data.eventDates].filter(Boolean).join(" / ");
						return { state: "ok", reason: "", text: text || "解析结果为空" };
					}
					// 状态词写成「无匹配/未公布」：既说清"解析没命中"，也保留面板那边的"未公布"口径
					if (f.kind === "nomatch") return { state: "nomatch", reason: "", text: "无匹配/未公布" };
					return { state: "down", reason: f.reason || "抓取异常", text: "抓取失败：" + (f.reason || "抓取异常") };
				};
				const games = {};
				const summary = { ok: 0, nomatch: 0, unconfigured: 0, down: 0 };
				entries.forEach((e, i) => {
					const r = results[i] || {};
					const d = r.data || {};
					const t = targets[i] || {};
					const gacha = describe("gacha", r.gachaFail, d, t.url);
					const event = describe("event", r.eventFail, d, t.eventUrl);
					games[e.id] = { name: e.name, parserVersion: e.parserVersion, custom: !!e.custom, gacha, event };
					for (const side of [gacha, event]) summary[side.state]++;
				});
				const problems = [];
				for (const [id, v] of Object.entries(games)) {
					const bad = [];
					if (v.gacha.state !== "ok") bad.push("卡池 " + v.gacha.text);
					if (v.event.state !== "ok") bad.push("活动 " + v.event.text);
					// 内部 id 只对自定义条目有意义（用户要靠它区分自己加的条目）；内置条目写游戏名即可
					if (bad.length) problems.push(`${v.name}${v.custom ? `(${id})` : ""}: ${bad.join("；")}`);
				}
				return { at: nowMs(), total: entries.length, summary, problems, games };
			}

			// 测试出口：给回归脚本用。**如实暴露**（不做隐藏门控/环境变量开关）：
			// 它只是内部函数的引用、不含任何数据，而"测试看得见、生产看不见"两套行为反而更容易埋坑；
			// 各平台的 UI 只应使用 createEngine 返回的公开方法。
			const __test = {
				fetchEntry,
				resolveSide,
				mergeEntryRecord,
				buildScrapeInfo,
				entryFailParts,
				sideFailText,
				normalizeFail,
				normErr,
				isDown,
				isNomatch,
				refreshAll,
				gachaFetcherFor,
				eventFetcherFor,
				normalizeSourceId,
				altSourceId,
				getEntryUrl,
				isCustomSource,
				readSettings,
				getCached,
				listGames,
				GACHA_FETCHERS,
				EVENT_FETCHERS,
				SOURCES,
				DEFAULT_SETTINGS,
				// 启动自动刷新判定（纯函数）与当前插件版本（注入自 package.json）：回归脚本据此验收
				autoRefreshPlan,
				formRejectHint,
				PLUGIN_VERSION
			};

			return {
				schemaVersion: ENGINE_SCHEMA_VERSION,
				listGames,
				getCached,
				refresh,
				selfCheck,
				__test
			};
		}
		//#endregion

		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;padding:0 10px 0 8px;margin:4px -2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:12px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-align:left}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn svg{flex:none;width:16px;height:16px}
			/* 这里曾有一条指向宿主内部 CSS Modules 类名的覆盖：
			 *   .hHd-Xa_footerActions{flex-wrap:wrap;align-content:flex-start;align-items:stretch}
			 * 它来自 v0.9.1「源码恢复」（从手改过的 lib/client.js 回填 src/），**不属于我们的契约**。
			 * dsh-client-ui-sidebar 升级后该类名换成了别的哈希（0.2.0 实装为 l4U6KG_footerActions），
			 * 覆盖静默失效——哈希随构建变，写死它必然迟早断，且断了没有任何提示。
			 * 故删除：页脚动作区的排布交还给宿主，我们只保证自己那个按钮的样式。
			 * 若将来需要影响父容器，请用不依赖哈希的方式（例如容器上的稳定属性）。 */
			.gacha-cal-pop{position:fixed;z-index:9999;width:690px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			/* flex-basis 用 0（不是 auto）：长文案不会整块掉到下一行，而是留在本行被省略号截断；
			   cursor:help + title 引导用户悬停看逐条原因 */
			.gacha-cal-scrape{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
			.gacha-cal-refresh{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-spin{animation:gacha-cal-rotate 0.8s linear infinite}
			@keyframes gacha-cal-rotate{to{transform:rotate(360deg)}}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			/* 所有列居中：图标列水平居中，文本列 text-align:center，时间列等宽数字 */
			.gacha-cal-row > *{text-align:center}
			.gacha-cal-row > :first-child{justify-self:center}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			/* 截断文字悬停自动滚动显示全文（marquee）：
			   统一由 JS 计算超宽与精确距离（gacha-cal-marq + --gacha-marq-d），仅超宽才滚动；
			   面板保持原速 3.5s，设置页单独慢速 6s */
			.gacha-cal-inner{display:inline-block;white-space:nowrap;will-change:transform}
			.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s ease-in-out infinite}
			@keyframes gacha-cal-marquee{0%,10%{transform:translateX(0)}45%,75%{transform:translateX(var(--gacha-marq-d,-80px))}100%{transform:translateX(0)}}
			.gacha-cal-settings-name.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee-slow 6s ease-in-out infinite}
			@keyframes gacha-cal-marquee-slow{0%,14%{transform:translateX(0)}40%,72%{transform:translateX(var(--gacha-marq-d,-80px))}93%,100%{transform:translateX(0)}}
			/* 时间列（卡池起止/活动起止，第 4/6 列）：等宽数字，不同位数倒计时左右对齐 */
			.gacha-cal-row > :nth-child(4), .gacha-cal-row > :nth-child(6) { font-variant-numeric: tabular-nums }
			.gacha-cal-h{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:6px 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
			.gacha-cal-h > *{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sort-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-sort-row img{width:22px;height:22px;border-radius:5px;object-fit:cover}
			.gacha-cal-sort-name{flex:1;font-size:13px}
			.gacha-cal-sort-btn{padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer}
			.gacha-cal-sort-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-sort-btn:disabled{opacity:.35;cursor:default}
			.gacha-cal-del-btn{color:#e5484d;padding:1px 6px}
			.gacha-cal-del-btn:hover{background:rgba(229,72,77,.12)}
		`;
		//#endregion

		//#region components
		// 本插件在 DSH 设置面板里的导航名；面板按钮与弹层标题也用它（唯一事实来源，90-plugin.js 注册分区时共用）。
		const SETTINGS_SECTION_LABEL = "\u4E8C\u6E38\u65E5\u5386";
		// 面板上那个「设置」按钮：**临时隐藏**（用户要求）。函数与样式都保留，
		// 改回 true 即可恢复，不用重写逻辑。
		const SETTINGS_BUTTON_VISIBLE = false;
		// DSH 设置面板是"点了才挂载"，打开后要等导航渲染出来才能切页；预算给足但不无限等。
		const SETTINGS_NAV_TIMEOUT_MS = 600;
		const SETTINGS_NAV_POLL_MS = 30;

		// 打开 DSH 设置面板并切到本插件的分区（面板上的「设置」按钮用，注释见按钮处）。
		// DSH 没有给插件"跳转设置页"的官方 API：面板是 modal，open 与 activeId 都是组件私有 state，
		// 且 activeId 每次打开都重置为 undefined，面板按 rows[0] 兜底（= 导航第一项）。所以只能：
		// ① 点侧边栏那个设置触发器；② 等面板挂载出来，按导航名点本插件那一项。
		function openPluginSettingsSection() {
			const all = [...document.querySelectorAll('[aria-haspopup="dialog"]')];
			const visible = all.filter((el) => typeof el.getClientRects === "function" && el.getClientRects().length > 0);
			const named = visible.find((el) => {
				const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
				return /\u8BBE\u7F6E|\u8A2D\u5B9A|Settings/i.test(label);
			});
			const trigger = named || visible[0] || all[0];
			if (!trigger || typeof trigger.click !== "function") return;
			trigger.click();
			const deadline = Date.now() + SETTINGS_NAV_TIMEOUT_MS;
			// 在给定根节点里找「二游排期」那一项：先按 aria-label，再按自身文本。
			// 不写死 `nav button` 结构 —— 设置外壳换布局时（0.1.7 把插件配置挪到了
			// 「插件」页）这种硬结构选择器会静默失效，表现为"点设置跳错页"。
			//
			// 必须排除本插件自己的面板：面板的开关按钮 aria-label 就是同一个标签，
			// 文档级兜底会先命中它 → 点下去变成"自己开自己"（典型症状：点设置没反应/跳错）。
			const inOwnPanel = (el) => {
				for (let n = el; n; n = n.parent) if (n.classList && n.classList.contains("gacha-cal-pop")) return true;
				return false;
			};
			const findItem = (root) => {
				if (!root || typeof root.querySelectorAll !== "function") return null;
				const items = [...root.querySelectorAll("button, a")]
					.filter((el) => el !== trigger && !inOwnPanel(el));
				const byAttr = items.find((el) => {
					const l = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
					return l === SETTINGS_SECTION_LABEL;
				});
				if (byAttr) return byAttr;
				return items.find((el) => (el.textContent || "").trim() === SETTINGS_SECTION_LABEL) || null;
			};
			const tick = () => {
				// 只在设置面板（dialog）里找，**不做整篇文档的兜底搜索**：
				// 本插件面板的开关按钮 aria-label 就是同一个标签，文档级搜索会先命中它，
				// 一点就变成"自己把自己打开"（实测就是这样：点设置只弹本插件面板、不跳页）。
				const dialogs = [...document.querySelectorAll('[role="dialog"]')];
				for (const d of dialogs) {
					const hit = findItem(d);
					if (hit) { hit.click(); return; }
				}
				if (Date.now() < deadline) window.setTimeout(tick, SETTINGS_NAV_POLL_MS);
			};
			window.setTimeout(tick, 0);
		}

		// ── 游戏图标（含**降级兜底**）──
		// 为什么需要：图标全是**外链**（README 承诺"不存储任何游戏资源"，故不打包进仓库）。
		// 外链随时可能挂掉、改路径、或对第三方来源防盗链 —— 没有这一层，面板上就是一排裂图。
		// 所以：没配图标 / 图片加载失败 → 退化成「游戏名首字」小方块，信息不丢、观感不崩。
		// 换 URL 后要能重试（自定义条目改图标时），故用 useEffect 按 icon 复位 failed。
		function gameIconGlyph(name) {
			const s = String(name == null ? "" : name).replace(/[\s\u3000]+/g, "");
			if (!s) return "?";
			// 优先取第一个汉字/假名/字母/数字（跳过「·」「：」「！」这类分隔符与符号）
			const m = s.match(/[\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/);
			return m ? m[0].toUpperCase() : s.charAt(0);
		}
		function GameIcon({ icon, name, size }) {
			const px = size || 20;
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => { setFailed(false); }, [icon]);
			const box = { width: px, height: px, borderRadius: 5, flex: "none" };
			if (!icon || failed) {
				return (0, react_jsx_runtime.jsx)("span", {
					className: "gacha-cal-icon-fb",
					"aria-label": name,
					title: name,
					style: Object.assign({}, box, {
						display: "inline-flex", alignItems: "center", justifyContent: "center",
						background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.2))",
						color: "var(--dsw-alias-text-l2, inherit)",
						fontSize: Math.round(px * 0.55), fontWeight: 600, lineHeight: 1,
						userSelect: "none", overflow: "hidden"
					}),
					children: gameIconGlyph(name)
				});
			}
			return (0, react_jsx_runtime.jsx)("img", {
				src: icon, alt: name, loading: "lazy", style: Object.assign({}, box, { objectFit: "cover" }),
				onError: () => setFailed(true)
			});
		}

		// engine：core 引擎（抓取/解析/缓存合并都在里面）。面板只读它返回的 Result JSON。
		function CalendarPanel({ wide, scope, engine }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [scrapeInfo, setScrapeInfo] = (0, react.useState)("");
			// 顶部提示的悬停明细：逐条分行（分类只在行内，原因放这里）
			const [scrapeLines, setScrapeLines] = (0, react.useState)([]);
			// 当前时间：每分钟刷新一次，驱动"还剩 X 天 X 小时 X 分钟"倒计时
			const [now, setNow] = (0, react.useState)(() => new Date());
			const triggerRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const [anchor, setAnchor] = (0, react.useState)();

			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => setNow(new Date()), 60000);
				return () => window.clearInterval(timer);
			}, []);

			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 最近一次抓取结果按游戏 id 索引；解析失败/未联网时为 {}
			let scrapedById = {};
			try { scrapedById = JSON.parse(s.lastData || "{}") || {}; } catch { scrapedById = {}; }
			// 清理历史抓取数据中残留的版本号字段（新版解析器已不产出）
			for (const k of Object.keys(scrapedById)) {
				const v = scrapedById[k];
				if (v && typeof v === "object" && "version" in v) delete v.version;
			}
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池/活动列
			const visible = getVisibleEntries(s);
			const games = applyOrder(visible, s.order).map((g) => {
				const sc = scrapedById[g.id];
				if (!sc) return g;
				return {
					...g,
					// 悬停游戏名/图标：显示这行数据的更新时间（见 buildRowTitle）
					_okAt: sc.okAt || 0,
					// 本次抓取状态：失败（down）或未命中（nomatch）时，在该列悬停里补一行说明；
					// gachaStale/eventStale 表示该列显示的是沿回的旧值（决定说明是否另起一行）
					gachaFail: sc.gachaFail || null,
					eventFail: sc.eventFail || null,
					gachaStale: !!(sc.gachaStale || sc.stale),
					eventStale: !!(sc.eventStale || sc.stale),
					// 卡池名与角色名分开保留：卡池列外显角色名、悬停显示卡池全名
					banner: sc.banner || g.banner,
					roles: sc.roles || g.roles || "",
					bannerDates: sc.bannerDates || g.bannerDates,
					// 源站原文（补全前）：悬停起止列时显示原文而非补全后的时间
					bannerDatesRaw: sc.bannerDatesRaw || "",
					// 逐池悬停文本（如鸣潮并行多池：每池一行）
					bannerHover: sc.bannerHover || "",
					event: sc.event || g.event,
					eventDates: sc.eventDates || g.eventDates,
					eventDatesRaw: sc.eventDatesRaw || "",
					// 活动列逐条悬停文本（并行活动：每条一行；仅 1 条时为空 → UI 退回单条展示）
					eventHover: sc.eventHover || ""
				};
			});

			// 在途锁用 ref 而不是 state：state 更新是异步的，"自动刷新与手动点击落在同一 tick"时
			// 两次调用可能都看到 refreshing=false 而并发跑两轮（请求翻倍，且慢的那轮会用更旧的数据盖掉新的）
			const refreshLock = (0, react.useRef)(false);
			// 启动自动刷新的"一次提示"（如"插件已更新"）与"同挂载只试一次"闸（防断网时无限重刷）
			const autoNoteRef = (0, react.useRef)("");
			const startupGuardRef = (0, react.useRef)("");
			// ⚠️ 最新设置的 ref —— `doRefresh` **必须**通过它读设置，不能直接闭包读 `s`。
			//
			// 为什么：`s`（见上面 `const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) }`）
			// **每次渲染都是新对象**，而 `doRefresh` 被 `useCallback` 记忆化在 `[scope, engine]` 上
			// —— 于是它闭包里那个 `s` 会**永远停在首次渲染那一刻**。
			// 症状（2026-10-03 用户报「面板显示 23 条条目，计数只有 22」）：
			//   · 渲染那一条路用的是**当次** `s`（`getVisibleEntries(s)` → 23 行）✓
			//   · `doRefresh` 里算顶部计数用的是**冻结**的 `s`（→ 只数到 22）✗
			//   挂载后才勾选的条目会被**整个漏出报告**：既不计入分母，失败时也不会出现在明细里。
			//
			// 为什么不能简单地把 `s` 加进 `useCallback` 依赖：那样 `doRefresh` 每次渲染都换身份，
			// 而下面两个 effect（依赖里带 `doRefresh`）会**每次渲染都重跑** —— 定时刷新那个
			// effect 每次都会 clear 再 setTimeout，递归计时器被反复重置（渲染频繁时可能永不触发）。
			// 用 ref 读最新值，`doRefresh` 的身份保持不变，两边都满足。
			const sRef = (0, react.useRef)(s);
			sRef.current = s;
			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshLock.current) return;
				refreshLock.current = true;
				setRefreshing(true);
				try {
					// 抓取/解析/合并/写缓存全部交给 core 引擎（面板不再自己编排）
					const result = await engine.refresh();
					// 顶部提示：只读 Result JSON（按游戏顺序取 name，交给共用提示函数分类）。
					// ⚠️ **必须只统计"选中展示"的条目**：`result.games` 里含隐藏条目 ——
					// 引擎为了"取消隐藏立刻有数据"会保留隐藏条目的旧缓存记录（含旧失败原因，如 HTTP 404）。
					// 若把全部条目交给 buildScrapeInfo，就会出现：
					//   · `成功 N/M` 的 M 偏大（把隐藏条目算进分母，而它们本轮根本没抓）
					//   · 失败分类与悬停明细里列出**隐藏条目**的旧失败 —— 用户看到的"没生效"就是这个。
					// ⚠️ 用 `sRef.current`（最新设置），**不能**用闭包里的 `s`：后者被 useCallback
					// 冻结在首次渲染那一刻 → 挂载后才勾选的条目不计入分母、失败也不进明细。
					// 详见 sRef 声明处的注释。
					const visibleIds = new Set(getVisibleEntries(sRef.current).map((g) => g.id));
					const games = Object.entries(result.games)
						.filter(([id]) => visibleIds.has(id))
						.map(([id, g]) => ({ id, name: g.name || id }));
					const { info, lines } = buildScrapeInfo(games, result);
					// 自动刷新时说明原因（只消费一次）："成功 N/M …（插件已更新，已自动刷新）"
					const note = autoNoteRef.current;
					autoNoteRef.current = "";
					setScrapeInfo(note ? `${info}\uFF08${note}\uFF0C\u5DF2\u81EA\u52A8\u5237\u65B0\uFF09` : info);
					setScrapeLines(lines);
					// 引擎已把 lastData/lastRefresh/lastSource 写进 settings，刷新快照即可重渲染
					setSnapshot(scope.getSnapshot());
				} catch (err) {
					// 刷新失败必须说出来：否则顶部还挂着上一次的"成功 N/M"，看起来像是刷新成功了
					const msg = String((err && err.message) || err || "未知错误");
					setScrapeInfo("\u5237\u65B0\u5931\u8D25\uFF1A" + msg);
					setScrapeLines([msg]);
				} finally {
					refreshLock.current = false;
					setRefreshing(false);
				}
			}, [scope, engine]);

			// 定时自动刷新（按设置频率）。
			// 注意：setTimeout/setInterval 的 delay 上限为 2^31-1 ms（约 24.86 天），
			// 42 天选项会溢出并变成 1ms 疯狂触发，故用"目标时间 + 递归 setTimeout"实现精确周期。
			(0, react.useEffect)(() => {
				if (!(s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh)) return;
				const minutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
				if (!Number.isFinite(minutes) || minutes <= 0) return;
				const MAX_DELAY = 2147483647;
				const intervalMs = minutes * 60 * 1000;
				let disposed = false;
				let timer = 0;
				// 锚点＝**上次成功刷新的时刻**，而不是"本次挂载时刻"：否则重启就把计时清零，
				// 设置成 7 天等于"连续开机 7 天"才刷一次（谁也不会一直不关电脑）。
				// 0 / 非法 / 未来时间戳（时钟回拨）都退回挂载时刻，避免刚启动就疯狂刷。
				const anchorAt = Number(s.lastRefresh) || 0;
				let last = anchorAt > 0 && anchorAt <= Date.now() ? anchorAt : Date.now();
				const tick = () => {
					if (disposed) return;
					const now = Date.now();
					if (now - last >= intervalMs) {
						last = now;
						doRefresh();
					}
					timer = window.setTimeout(tick, Math.min(Math.max(last + intervalMs - Date.now(), 1000), MAX_DELAY));
				};
				timer = window.setTimeout(tick, 1000);
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [s.autoRefresh, s.refreshMinutes, s.lastRefresh, doRefresh]);

			// 启动时判定一次"要不要自动刷新"（定时器管不到的场景：插件更新、首次安装、重启后已过间隔）。
			// 版本变化与首次安装是**强制**的（不看自动刷新开关）——见 autoRefreshPlan 的注释。
			// 三个防坑点：
			//  ① 等设置真的送到（快照非空）再判，否则"还没加载"会被当成"首次安装"而多刷一轮；
			//  ② 同一次挂载对同一 (版本|原因) 只尝试一次——refresh 失败也会写 lastRefresh，
			//     依赖里带着它会让 effect 重跑 → 变成断网时无限重刷；
			//  ③ 提示只消费一次（autoNoteRef），不常驻。
			(0, react.useEffect)(() => {
				if (!snapshot.value || Object.keys(snapshot.value).length === 0) return;
				const plan = autoRefreshPlan({
					autoRefresh: s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh,
					refreshMinutes: s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes,
					lastRefresh: s.lastRefresh,
					lastVersion: s.lastVersion,
					pluginVersion: PLUGIN_VERSION,
					now: Date.now()
				});
				if (!plan.due) return;
				const key = `${PLUGIN_VERSION}|${plan.reason}`;
				if (startupGuardRef.current === key) return;
				startupGuardRef.current = key;
				autoNoteRef.current = plan.reason;
				doRefresh();
			}, [snapshot, s.autoRefresh, s.refreshMinutes, s.lastRefresh, s.lastVersion, doRefresh]);

			// 锚定面板到 trigger 上方
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect !== void 0) setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);

			// 点击 dismiss：仅当点击既不在 trigger 也不在 pop 内部时关闭（修复弹层内按钮点不到的问题）
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (e) => {
					const t = e.target;
					if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
					setOpen(false);
				};
				document.addEventListener("pointerdown", onDown);
				return () => document.removeEventListener("pointerdown", onDown);
			}, [open]);

			const lastRefreshText = s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : "\u2014";
			const dataStatus = s.lastSource === "web" ? "\u8054\u7F51\u6570\u636E" : "\u2014";
			const label = SETTINGS_SECTION_LABEL;

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: "gacha-cal-btn",
						"aria-label": label,
						onClick: () => setOpen((v) => !v),
						children: [
							(0, react_jsx_runtime.jsx)("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
								]
							}) }),
							wide === false ? null : (0, react_jsx_runtime.jsx)("span", { children: label })
						]
					}),
					open && anchor !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						ref: popRef,
						className: "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						children: [
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: SETTINGS_SECTION_LABEL }),
							(0, react_jsx_runtime.jsxs)("p", { className: "gacha-cal-meta", children: [
								(0, react_jsx_runtime.jsx)("span", { children: "\u6570\u636E\uFF1A" + dataStatus }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\uFF1A" + lastRefreshText }),
								// 刷新按钮（SVG 图标：循环箭头）
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									disabled: refreshing,
									title: refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									"aria-label": refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									onClick: doRefresh,
									children: (0, react_jsx_runtime.jsx)("svg", {
										className: refreshing ? "gacha-cal-spin" : "",
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2.2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-2.64-6.36L21 8" }),
												(0, react_jsx_runtime.jsx)("polyline", { points: "21 3 21 8 16 8" })
											]
										})
									})
								}),
								// 设置按钮：打开 DSH 设置面板并切到本插件的设置页，同时关闭本面板。
								// **当前按用户要求临时隐藏**（SETTINGS_BUTTON_VISIBLE = false）；
								// 下面这段逻辑与说明全部保留，改回 true 即可恢复。
								// 为什么这么绕：DSH 没给插件"跳转设置页"的官方 API——面板是 modal，open/activeId 都是组件
								// 私有 state（dsh-client-ui-settings-general 的 SettingsRoot），打开后按 rows[0] 兜底，也就是停在
								// 导航第一项「通用」；插件拿不到 openSection。只能点侧边栏那个设置触发器（aria-haspopup="dialog"
								// 是它的契约属性：全客户端带这个属性的有 6 个 dialog 类 + 12 个 menu/listbox/tree，所以按
								// "可见 + 无障碍名匹配 设置/Settings" 挑，挑不到才退回第一个），再交给 openPluginSettingsSection
								// 等面板挂载后按导航名切到本插件那一节。
								SETTINGS_BUTTON_VISIBLE && (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									title: "\u8BBE\u7F6E",
									"aria-label": "\u8BBE\u7F6E",
									onClick: () => {
										setOpen(false);
										openPluginSettingsSection();
									},
									children: (0, react_jsx_runtime.jsx)("svg", {
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
												(0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
											]
										})
									})
								}),
								// 抓取提示：放在设置按钮右边（行内只给分类，悬停分行看原因）
								scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-scrape", title: scrapeLines.join("\n"), children: scrapeInfo }) : null
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-h", children: [
								(0, react_jsx_runtime.jsx)("span", {}),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u5361\u6C60" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5361\u6C60\u8D77\u6B62" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u6D3B\u52A8" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6D3B\u52A8\u8D77\u6B62" })
							] }),
							games.map((g) => {
								// 卡池列：外显纯角色名（cleanRoleNames 去称号·前缀/属性后缀；蔚蓝档案三服保留括号换装后缀；
								// 无角色名时显示卡池名），悬停弹出卡池全名+角色；无数据时显示占位符 "—"
								const gachaVisible = g.roles ? cleanRoleNames(g.roles, g.id) : (g.banner || "—");
								const gachaTitle = (g.roles ? `${g.banner}\uFF1A${g.roles}` : (g.banner || "")) + (g.bannerDates ? `\n${g.bannerDatesRaw || g.bannerDates}` : "");
								// 活动列：外显活动名称，悬停弹出活动全名+起止（起止显示源站原文）；无数据时显示 "—"
								const eventName = g.event || "—";
								const eventTitle = g.event
									? (g.eventDates ? `${g.event}\n${g.eventDatesRaw || g.eventDates}` : g.event)
									: (g.eventDatesRaw || g.eventDates || "");
								// 该列本次没拿到新内容（失败/未命中）时，把它补进悬停：
								// 括号包住；若该列显示的是沿回的旧值，则另起一行补在旧内容下面
								const withFailNote = (base, side, fail, stale, userSupplied) => {
									const text = sideFailText(side, fail, { userSupplied });
									const note = text ? "（" + text + "）" : "";
									if (!note) return base || "";
									return stale && base ? base + "\n" + note : note;
								};
								// 该侧地址是否由用户自己填（自定义条目 / 自定义网址）：是的话"未命中"多半意味着
								// "你填的这个地址读不出内容"，文案换一句更贴切的（状态仍是"未公布"，不改三态语义）
								const gachaUser = !!g.custom || isCustomSource(s, g.id);
								const eventUser = !!g.custom || isCustomSource(s, g.id, "eventUrl");
								// 游戏名/图标悬停：这行数据的"上次成功"时间（+ 哪列沿用了旧数据）
								const rowTitle = buildRowTitle(g);
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									title: rowTitle,
									children: [
										(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: rowTitle, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerHover || gachaTitle, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: gachaVisible }) }),
										// 起止列：倒计时用补全后的时间；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerDatesRaw || g.bannerDates, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventHover || eventTitle, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventDatesRaw || g.eventDates, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(g.eventDates || "", now) }) })
									]
								});
							})
						]
					}) : null
				]
			});
		}

		// engine：core 引擎（设置页的「解析器自检」用它跑 selfCheck()）
		function CalendarSettingsPage({ scope, engine }) {
			// 设置表单服务本体（用于在写不进去时列出宿主真正 serve 的 namespace，见 formStateText）
			const ctxConfigForms = scope && scope.configForms ? scope.configForms : null;
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "" });
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			// 解析器自检（只读）：运行中标记 + 上一次的报告
			const [selfChecking, setSelfChecking] = (0, react.useState)(false);
			const [selfReport, setSelfReport] = (0, react.useState)(null);
			// 逐个来源跑一遍，报告「解析出 0 条 / 抓取报错」；不改动设置与缓存
			const runSelfCheck = async () => {
				if (selfChecking) return;
				setSelfChecking(true);
				try {
					const started = Date.now();
					const report = await engine.selfCheck();
					setSelfReport({ ...report, elapsedMs: Date.now() - started });
				} catch (err) {
					setSelfReport({ error: String((err && err.message) || err) });
				} finally {
					setSelfChecking(false);
				}
			};
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 表单可用性（写不进去时在页面上如实说明，见下面渲染处）。
			// 文案与 formRejectHint 同源：只解释"为什么写不了"，不猜。
			const formReady = snapshot.status === "ready" && snapshot.mode !== "memory";
			const formStateText = snapshot.mode === "memory"
				? "本次连接不是本机，宿主不接受写入"
				: snapshot.status === "loading"
					? "配置表单还没送到，请稍后重试"
					: snapshot.status === "unavailable"
						? "宿主未 serve 条目「" + (scope.entryId || "?") + "」" + servedNamespacesText(ctxConfigForms)
						: "宿主拒绝了写入（表单状态 " + String(snapshot.status) + "）";

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const shown = Array.isArray(s.shown) ? s.shown : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			const sorted = applyOrder(allEntries, order);
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);

			// 保存失败必须可见：旧实现只 await 不 catch，写被宿主拒绝时控件弹回原值、
			// 用户只会觉得"点了没反应"（「重置排序」写 null 被拒就是这种病的极端例子）
			//
			// DSH 0.1.7 起这里多了一个坑：`configForms` 的 set() **返回布尔值而不是抛错**
			// （旧 settingsScope 的 set() 失败会抛）。所以只写 try/catch 的话，
			// "宿主拒绝写入"会被当成成功，控件照样弹回、依旧没有任何提示。
			// 必须显式判返回值：false = 宿主没接受（多半是该字段没进表单 / 修订号冲突 / 页面只读）。
			const [saveError, setSaveError] = (0, react.useState)("");
			const commit = async (key, value) => {
				try {
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error(formRejectHint(scope, key));
					setSaveError("");
				} catch (err) {
					setSaveError("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String((err && err.message) || err || "未知错误"));
				}
				setSnapshot(scope.getSnapshot());
			};

			const setOrder = async (nextIds) => { await commit("order", nextIds); };
			const move = async (id, delta) => {
				// order 可能缺少新条目的 id（如新增的 ba-jp），按默认顺序补齐后再移动
				let base = order;
				const allIds = allEntries.map((x) => x.id);
				if (allIds.some((x) => !base.includes(x))) {
					base = base.slice();
					for (const x of allIds) if (!base.includes(x)) base.push(x);
				}
				const idx = base.indexOf(id);
				const target = idx + delta;
				if (idx < 0 || target < 0 || target >= base.length) return;
				const next = base.slice();
				next.splice(idx, 1);
				next.splice(target, 0, id);
				await setOrder(next);
			};
			// 重置排序：写空数组而不是 null —— 宿主 settings schema 是 z.array(z.string())，
			// 写 null 会被校验拒绝（旧实现因此永久点不动，还抛未捕获 rejection）；applyOrder 对空数组等价"未设置"
			const resetOrder = async () => { await commit("order", []); };

			// 展示开关（勾选/取消勾选）
			// 三态语义见 60-helpers.js 的 isEntryHidden：hidden = 明确关掉，shown = 明确打开
			// （shown 用来把「出厂默认隐藏 defaultHidden」的条目重新打开）。
			// 每次切换都把 id 从**另一个**列表里摘掉，避免两边同时存在造成判定歧义。
			const toggleHidden = async (id) => {
				const isHiddenNow = isEntryHidden(allEntries.find((x) => x.id === id) || {}, s);
				if (isHiddenNow) {
					// 打开：从 hidden 摘掉，并记进 shown（这样 defaultHidden 的条目也能被打开）
					await commit("hidden", hidden.filter((x) => x !== id));
					if (!shown.includes(id)) await commit("shown", [...shown, id]);
				} else {
					// 关掉：记进 hidden，并从 shown 摘掉（否则 defaultHidden 条目会出现"勾了却仍然显示"的矛盾）
					if (!hidden.includes(id)) await commit("hidden", [...hidden, id]);
					if (shown.includes(id)) await commit("shown", shown.filter((x) => x !== id));
				}
			};
			// 删除条目：内置条目记入 removed；自定义条目从 customEntries 移除
			const removeEntry = async (g) => {
				if (g.custom) {
					const next = customs.filter((c) => c.id !== g.id);
					await commit("customEntries", JSON.stringify(next));
				} else {
					await commit("removed", [...removed, g.id]);
				}
			};
			// 恢复条目：清空删除记录与自定义条目
			const restoreAll = async () => {
				await commit("removed", []);
				await commit("customEntries", "[]");
			};
			// 爬取地址：默认/备选源/自定义。customUrls[id] 存选中值：
			// - 无 key → 默认源；- 值 === "custom:<用户输入>" → 自定义输入；- 其它（如 "proxy:https://..."）→ 备选源值
			const entryUrlMode = (id, g) => {
				const urls = parseJsonStr(s.customUrls, {});
				if (!urls || typeof urls !== "object" || !Object.prototype.hasOwnProperty.call(urls, id)) return "default";
				const v = urls[id];
				if (typeof v === "string" && v.startsWith("custom:")) return "custom";
				return normalizeSourceId(v); // 备选源标识（老配置的 proxy:/gk-*: 在这里翻译成新标识）
			};
			const setUrlMode = async (id, mode, g) => {
				const next = { ...(urls || {}) };
				if (mode === "default") delete next[id];
				else if (mode === "custom") next[id] = "custom:" + (customInputs[id] ?? "");
				else next[id] = mode; // 备选源标识（url 或 id）
				await commit("customUrls", JSON.stringify(next));
			};
			const setCustomUrl = async (id, value) => {
				setCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(urls || {}) };
				next[id] = "custom:" + value;
				await commit("customUrls", JSON.stringify(next));
			};
			// 活动来源地址：默认/自定义（存 customEventUrls），判定同上（custom: 前缀）
			const eventUrls = parseJsonStr(s.customEventUrls, {});
			const eventUrlMode = (id) => {
				const eu = parseJsonStr(s.customEventUrls, {});
				if (!eu || typeof eu !== "object" || !Object.prototype.hasOwnProperty.call(eu, id)) return "default";
				const v = eu[id];
				return String(v ?? "").startsWith("custom:") ? "custom" : normalizeSourceId(v);
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = "custom:" + (eventCustomInputs[id] ?? "");
				else delete next[id];
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = "custom:" + value;
				await commit("customEventUrls", JSON.stringify(next));
			};
			// 添加自定义条目：名称/图标手动填，卡池与活动内容由链接解析产出
			const addEntry = async () => {
				if (!form.name.trim() || !form.url.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", url: "", eventUrl: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

			// 选择器/输入框统一样式；textOverflow/overflow 让长选项文本省略截断，避免与下拉箭头重叠
			const inputStyle = { padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12, maxWidth: "100%", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" };
			const labelStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "none" };

			return (0, react_jsx_runtime.jsxs)("div", {
				style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 720, fontSize: 13, padding: "2px 0 8px" },
				children: [
					(0, react_jsx_runtime.jsx)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: SETTINGS_SECTION_LABEL })
					] }),
					saveError ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: saveError }) : null,
					// 配置表单本身的状态：只在"写不进去"时才出现，平时不占位。
					// 这一行是给"控件点了弹回原值、却没有任何提示"这类问题留的现场：
					// memory = 非本机连接（只读）；loading/unavailable = 宿主没把表单送到；
					// ready 但写仍被拒 = 该字段没进表单或修订号冲突。
					(formReady ? null : (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: "\u914D\u7F6E\u53EA\u8BFB\uFF1A" + formStateText })),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { children: "自动刷新" })
						] }),
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "刷新频率" }),
							(0, react_jsx_runtime.jsxs)("select", { value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
								!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "自定义（" + currentMinutes + " 分钟）" }) : null,
								REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
							] })
						] })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "游戏列表" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: resetOrder, children: "重置排序" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: restoreAll, children: "恢复条目" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制显示；「↑↓」调整顺序；来源可切换或自定义。" }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u64CD\u4F5C" })
						] }),
						sorted.map((g, i) => {
							const mode = entryUrlMode(g.id, g);
							const evMode = eventUrlMode(g.id);
							const showGachaInput = mode === "custom";
							const showEventInput = evMode === "custom";
							return (0, react_jsx_runtime.jsxs)("div", {
								key: g.id,
								style: { borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "4px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size: 22 }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !isEntryHidden(g, s), onChange: () => toggleHidden(g.id) }),
												(0, react_jsx_runtime.jsx)("span", { children: "\u5C55\u793A" })
											] }),
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setUrlMode(g.id, e.target.value, g),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
													(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.label)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
												]
											}),
											// 活动来源选择器（未配置活动源默认项为"未配置"，选择"自定义"后展开输入行）
											(0, react_jsx_runtime.jsxs)("select", {
												value: evMode,
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setEventUrlMode(g.id, e.target.value),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.fetcher)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
												]
											}),
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0A\u79FB", disabled: i === 0, onClick: () => move(g.id, -1), children: "\u2191" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0B\u79FB", disabled: i === sorted.length - 1, onClick: () => move(g.id, 1), children: "\u2193" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-del-btn", title: "\u5220\u9664", onClick: () => removeEntry(g), children: (0, react_jsx_runtime.jsx)("svg", {
													width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M3 6h18" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "10", y1: "11", x2: "10", y2: "17" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "14", y1: "11", x2: "14", y2: "17" })
													]
												}) })
											] })
										]
									}),
									// 自定义输入行：选择"自定义"后整行展开（全宽，不挤压列）
									showGachaInput || showEventInput ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 4px 6px" }, children: [
										showGachaInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "卡池来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? String(eventUrls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomEventUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null
									] }) : null
								]
							});
						}),
						adding ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginTop: 6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" }),
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称与图标手动填写；卡池与活动由来源链接解析产出。" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "名称（必填）", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "图标 URL（可选）", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "卡池来源链接（必填）", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "活动来源链接（可选）", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					// 解析器自检：逐源检查「没内容 / 报错」，源站改版后用来定位问题。只读（core 的 selfCheck() 保证）
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "解析器自检" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", disabled: selfChecking, onClick: runSelfCheck, children: selfChecking ? "自检中…" : (selfReport ? "重新自检" : "开始自检") })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "逐个来源检查，区分「无匹配/未公布」与「失败」。" }),
						selfReport ? (selfReport.error
							? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: "自检失败：" + selfReport.error })
							: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }, children: [
								(0, react_jsx_runtime.jsx)("div", { children: selfReport.total + " 款游戏 · " + (selfReport.summary.ok + selfReport.summary.nomatch + selfReport.summary.unconfigured + selfReport.summary.down) + " 个来源：成功 " + selfReport.summary.ok + " / 无匹配/未公布 " + selfReport.summary.nomatch + " / 未配置 " + selfReport.summary.unconfigured + " / 失败 " + selfReport.summary.down + " · 用时 " + (selfReport.elapsedMs / 1000).toFixed(1) + "s" }),
								selfReport.problems.length === 0
									? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-business-primary)" }, children: "✓ 所有来源都正常" })
									: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
										(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "需要关注：" }),
										selfReport.problems.map((p, i) => (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-primary)" }, children: "· " + p }, i))
									] })
							] })) : null
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来自各游戏官方公告、官方 Wiki 与第三方站；无数据时对应列留空。" })
				]
			});
		}
		//#endregion

		//#region plugin
		// configForms = DSH 0.1.7 起的设置表单服务；0.1.6 及以前叫 settingsScope。
		// 两者都是"按 profile 条目 id 取一个表单"，本插件的条目 id 就是 NS。
		const inject = ["slots", "configForms", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-gacha-calendar";
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-gacha-calendar: styles");

			// 设置页左侧导航的 section 图标由 navIcon 硬编码（未知 id 一律默认齿轮），
			// 插件无法通过 settings.section 配置图标；这里在设置面板打开后，把
			// "二游日历" 导航项的齿轮图标替换为日历图标（Lucide 风格 16px，幂等）。
			// 性能：MutationObserver 回调只置脏标记，用 requestAnimationFrame 合并执行；
			// patch 先查 dialog 是否存在，不存在立即返回（Web 端高频 DOM 变化时开销极小）。
			ctx.effect(() => {
				const LABEL = SETTINGS_SECTION_LABEL;
				const CAL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
				let raf = 0;
				const patch = () => {
					raf = 0;
					const dialog = document.querySelector('[role="dialog"]');
					if (!dialog) return;
					const buttons = dialog.querySelectorAll("nav button");
					for (const btn of buttons) {
						const labelEl = btn.querySelector("span");
						if (!labelEl || labelEl.textContent.trim() !== LABEL) continue;
						if (btn.dataset.gachaCalIcon === "1") continue;
						const icon = btn.querySelector("svg");
						if (icon) {
							icon.style.display = "none"; // 隐藏 DSH 默认齿轮
							const wrap = document.createElement("span");
							wrap.setAttribute("aria-hidden", "true");
							wrap.innerHTML = CAL_ICON_SVG;
							// 插到按钮第一个子元素位置（与 DSH 图标同级，flex 子项对齐一致）
							btn.insertBefore(wrap.firstChild, btn.firstChild);
							btn.dataset.gachaCalIcon = "1";
						}
					}
				};
				const schedule = () => {
					if (raf) return;
					raf = requestAnimationFrame(patch);
				};
				schedule();
				const mo = new MutationObserver(schedule);
				mo.observe(document.body, { childList: true, subtree: true });
				return () => {
					mo.disconnect();
					if (raf) cancelAnimationFrame(raf);
				};
			}, "dsh-gacha-calendar: settings nav icon");

			// 全局截断文字悬停 marquee（面板 + 设置页共用）：内容超出容器时加
			// gacha-cal-marq 并计算滚动距离，让内层 span 来回滚动显示全文（未超宽不加）。
			ctx.effect(() => {
				const onOver = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (!cell) return;
					const inner = cell.querySelector(".gacha-cal-inner");
					if (!inner) return;
					const dist = inner.scrollWidth - cell.clientWidth;
					if (dist > 0) {
						cell.style.setProperty("--gacha-marq-d", `-${dist + 8}px`);
						cell.classList.add("gacha-cal-marq");
					}
				};
				const onOut = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (!cell) return;
					// mouseout 会在"从格子移到它内部的 span"时也触发（并冒泡到这里）：
					// 只有真的离开这整块区域才停滚动，否则悬停滚动会在格子里抖一下/被打断
					if (e.relatedTarget && cell.contains(e.relatedTarget)) return;
					cell.classList.remove("gacha-cal-marq");
				};
				document.addEventListener("mouseover", onOver);
				document.addEventListener("mouseout", onOut);
				return () => {
					document.removeEventListener("mouseover", onOver);
					document.removeEventListener("mouseout", onOut);
				};
			}, "dsh-gacha-calendar: marquee");

			// 取本插件的配置表单：读走镜像快照，写由表单自己排队并带修订号。
			// 条目 id 从宿主**真正 serve 的** namespace 列表里解析（候选见 10-config.js 的
			// SETTINGS_ENTRY_IDS）—— 不写死的原因见 92-dsh-env.js 的 resolveSettingsEntryId 注释。
			const settingsEntryId = resolveSettingsEntryId(ctx.configForms, SETTINGS_ENTRY_IDS);
			const scope = ctx.configForms.get(settingsEntryId);
			// 把解析结果与表单服务挂到 scope 上：设置页要靠它们说明"为什么写不进去"，
			// 以及列出宿主真正 serve 的条目（排障用，见 60-helpers.js 的 servedNamespacesText）。
			scope.entryId = settingsEntryId;
			scope.configForms = ctx.configForms;
			// core 引擎：抓取/解析/缓存合并都在 engine 里（面板只读它返回的 Result JSON）。
			// 存储适配（settings scope）与传输适配（直连 + 宿主代理）见 92-dsh-env.js。
			const engine = createDshEngine(scope);

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-gacha-calendar",
				priority: -10,
				locale: NS,
				inject: () => ({ scope, engine })
			}, CalendarPanel));

			// 设置页单开一个 section（左侧导航独立页面，参照 dsh-cost-meter 的 settings.section 用法）
			// 也把 engine 注入进去：设置页的「解析器自检」要调 engine.selfCheck()
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "gacha-calendar",
				order: 25,
				label: SETTINGS_SECTION_LABEL,
				locale: NS,
				inject: () => ({ scope, engine })
			}, CalendarSettingsPage));
		}
		//#endregion

		//#region DSH 环境适配（外壳专属，不进 core）
		// 把 DSH 的运行环境注入上一步定义的 core env：
		//   fetchRaw      → 浏览器原生 fetch（bwiki / PRTS 等 CORS 放行的源直接抓）
		//   fetchViaProxy → 宿主代理 /api/gacha-calendar-proxy（绕过 CORS 与 Referer 反爬）
		// 换到浏览器扩展 / 原生平台时，只需替换本文件的内容，core 一行都不用改。
		const DSH_PROXY_PREFIX = "/api/gacha-calendar-proxy";

		// 直连抓取：原样转发浏览器的 fetch（response 形态不变，调用点无需改）
		async function dshFetchRaw(url, opts) {
			return fetch(url, opts);
		}

		// 经宿主代理抓取：GET/POST + referer + 可选额外请求头 → 返回目标站原始 body 字符串。
		// 宿主侧会做白名单校验（见 lib/index.js 的 PROXY_ALLOW_HOSTS），未列入白名单的主机一律拒绝。
		//
		// ⚠️ POST 时**必须把 Content-Type 也放进 query 的 `contentType`**：
		//    宿主 `src/index.js` 的 proxyHandler 只在 `body !== ""` 时设置请求头，且取的是
		//    `parsed.searchParams.get("contentType") || "application/json; charset=utf-8"`。
		//    表面上默认值就是 JSON，但**一旦 body 为空就不会进那个分支**，
		//    而赛马娘国际服（umamusume.com）对"无 Content-Type 的 POST"回 `{"response_code":200}`
		//    （实测：带 content-type → 170KB 正常；不带 → 21B 报错）。故这里显式带上，别依赖默认值。
		async function dshFetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body, contentType } = {}) {
			let api = DSH_PROXY_PREFIX + "?url=" + encodeURIComponent(proxyUrl) + "&referer=" + encodeURIComponent(referer || "");
			if (extraHeaders) api += "&headers=" + encodeURIComponent(JSON.stringify(extraHeaders));
			const opts = { headers: { "Accept": "application/json" } };
			if (body !== void 0) {
				const ct = contentType || "application/json; charset=utf-8";
				api += "&contentType=" + encodeURIComponent(ct);
				opts.method = "POST";
				opts.headers["Content-Type"] = ct;
				opts.body = typeof body === "string" ? body : JSON.stringify(body);
			}
			const res = await fetch(api, opts);
			if (!res.ok) throw new Error("proxy-http-" + res.status);
			const j = await res.json();
			if (!j || j.status !== 200 || typeof j.body !== "string") throw new Error("proxy-bad:" + (j?.error || j?.status));
			return j.body;
		}

		// 默认注入一次（供直接调用 core 内部函数的场景，如回归脚本）；正式路径由 createDshEngine 注入
		const DSH_TRANSPORT = { fetchRaw: dshFetchRaw, fetchViaProxy: dshFetchViaProxy };
		setCoreEnv({ transport: DSH_TRANSPORT });

		// 解析本插件的设置条目 id：从 configForms 的 describe 镜像里读**宿主真正 serve 的** namespace 列表，
		// 在候选里挑第一个匹配。为什么不能直接写死：0.1.7 按条目 id 寻址，而条目 id、包名、插件名
		// 三者未必同名；写死一旦对不上，表现就是"表单永远 unavailable、所有写入被拒、
		// 面板只显示 schema 默认值"——症状和"数据被清空"极像，其实只是地址找错了。
		// 拿不到镜像时回退到第一个候选，保持原行为、不更坏。
		function listServedNamespaces(configForms) {
			try {
				const mirror = configForms && typeof configForms.describe === "function" ? configForms.describe() : null;
				const view = mirror && typeof mirror.getSnapshot === "function" ? mirror.getSnapshot().view : null;
				const rows = view && Array.isArray(view.namespaces) ? view.namespaces : [];
				return rows.map((r) => r && r.ns).filter((ns) => typeof ns === "string");
			} catch (e) {
				return [];
			}
		}
		function resolveSettingsEntryId(configForms, candidates) {
			const served = listServedNamespaces(configForms);
			for (const id of candidates) if (served.indexOf(id) >= 0) return id;
			return candidates[0];
		}

		// DSH 的存储适配：插件配置表单（profile 条目 id）→ engine 的 storage 接口。
		// engine 只认 get(key)/set(key, value)，键名沿用既有设置键，所以设置页与历史缓存都不用迁移。
		//
		// DSH 0.1.7 起这个表单由 `configForms` 服务给出（旧名 `settingsScope`，已改名），
		// 快照形态也从「恒有 value」变成带状态机的 `{ status, value, base, user, revision, writable, mode }`：
		// 只有 status === "ready" 时 value 才可信（其余是 loading / unavailable）。
		// 取不到值一律回 undefined —— engine 会把 undefined 回落成 DEFAULT_SETTINGS，
		// 绝不能回落成 {} 之外的东西，否则"读不到"会被当成"读到了空配置"。
		function dshStorage(scope) {
			return {
				async get(key) {
					const snap = scope.getSnapshot();
					if (!snap || snap.status !== "ready") return undefined;
					const value = snap.value;
					if (!value || typeof value !== "object") return undefined;
					return value[key];
				},
				async set(key, value) {
					// set 返回"宿主是否接受本次写入"；engine 不消费该布尔值，
					// 但失败时抛错比静默丢数据好（静默会把"没存上"伪装成"已存"）。
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error("settings-write-rejected:" + key);
				}
			};
		}

		// 组装 DSH 侧的 core 引擎（面板只通过它拿 Result JSON，不再自己抓取/合并）
		function createDshEngine(scope) {
			return createEngine({
				transport: DSH_TRANSPORT,
				storage: dshStorage(scope),
				now: () => Date.now()
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.__regression = __regression;
		return module.exports;
	}
});
