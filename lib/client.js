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
		// 刷新频率选项：按天（存分钟），与 host 端 Config.refreshMinutes 对应
		const REFRESH_OPTIONS = [
			{ label: "1 天", minutes: 1 * 24 * 60 },
			{ label: "5 天", minutes: 5 * 24 * 60 },
			{ label: "7 天", minutes: 7 * 24 * 60 },
			{ label: "15 天", minutes: 15 * 24 * 60 },
			{ label: "24 天", minutes: 24 * 24 * 60 },
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
			// 不展示的条目 id 列表（设置页开关）
			hidden: [],
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

		//#region data sources
		// 数据源声明：不含任何内置快照数据（无联网抓取时对应列显示为空）。
		// 卡池来源（url/altSources）与活动来源（eventUrl/eventAltSources）完全独立、各自单独选择；
		// 默认活动源与卡池源相同时（ba-*/r1999 的公告同时含卡池与活动），仍作为独立来源存在，
		// 抓取时同 URL 单次请求复用，换用其他来源时独立抓取。
		const SOURCES = [
			{
				id: "genshin",
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
				name: "绝区零",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/64",
				source: "Bwiki \u5F80\u671F\u8C03\u9891",
				url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2",
				// 独立活动源：绝区零活动一览（api.php 带 origin=* 可直连；「活动时间」表含当期活动）
				eventUrl: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "wuwa",
				name: "鸣潮",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				source: "Bwiki \u89D2\u8272\u8F6E\u6362\u6C60",
				url: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2",
				// 独立活动源：鸣潮活动日历页（与卡池源不同）
				eventUrl: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki 活动日历"
			},
			{
				id: "arknights",
				name: "明日方舟",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				source: "PRTS \u5361\u6C60\u4E00\u89C8",
				url: "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				// 独立活动源：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）
				eventUrl: "https://prts.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "PRTS \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "endfield",
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
						value: "https://gachatracker.app/games/endfield/banners/",
						fetcher: "endfield-gachatracker"
					},
					{
						label: "wiki.gg\uff08\u82F1\u6587\uff09",
						// wiki.gg 校验 Referer，需经 host 代理（代理默认 Referer=目标 origin 满足要求）
						value: "proxy:https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
						fetcher: "endfield-wiki-gg"
					}
				],
				// 独立活动源：FZ Wiki（中文社区维护，经 host 代理抓 RSC 数据；当期并行活动选结束最晚）
				eventUrl: "https://fz.wiki/wiki/%E6%B4%BB%E5%8A%A8",
				eventSource: "FZ Wiki",
				// 活动备选来源：Game8（英文，经 host 代理）
				eventAltSources: [
					{ label: "Game8\uff08\u82F1\u6587\uff09", value: "https://game8.co/games/Arknights-Endfield/archives/535443", fetcher: "endfield-game8" }
				]
			},
			{
				id: "ba-cn",
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
				name: "蔚蓝档案·国际服",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				source: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 经 host 代理抓取（nexon CORS 只允许同源）；「更新日誌」board(3352) 同时含当期卡池与活动排期
				url: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				// 卡池备选：GameKee（中文标题含排期；默认仍是 Nexon 官方更新日誌）
				altSources: [
					{ label: "GameKee \u5F53\u671F\u5361\u6C60", value: "gk-global:", fetcher: "ba-global-gamekee" }
				],
				// 活动默认源与卡池源相同（更新日誌解析活动排期），可独立切换（如 GameKee）
				eventUrl: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				eventSource: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 活动备选来源
				eventAltSources: [
					{ label: "GameKee \u5F53\u671F\u6D3B\u52A8", value: "gk-global:", fetcher: "ba-global-gamekee" }
				]
			},
			{
				id: "ba-jp",
				name: "蔚蓝档案·日服",
				icon: "https://play-lh.googleusercontent.com/H975s6W1-boCSogzpF5_rIyawbjiXfG842ncgjIRiVGzhXHFTCVut0DkBhlDR4CgN1nn98OOC1fWN-LE7kUHnQ=s64",
				source: "GameKee \u5F53\u671F\u5361\u6C60",
				// 经 host 代理抓取（GameKee 需 game-alias 头 + CDN 反爬）；当期卡池/活动条目同源
				url: "https://www.gamekee.com/ba/huodong/15",
				eventUrl: "https://www.gamekee.com/ba/huodong/15",
				eventSource: "GameKee \u5F53\u671F\u6D3B\u52A8"
			},
			{
				id: "r1999",
				name: "重返未来：1999",
				icon: "https://play-lh.googleusercontent.com/LwcueZMBbLq6aELtqJVn61ToKkJUgxEO8O4KgK_5052hfYoDAglQJIzqSu8srUJeaOZwv36Qi5YKtsXZjo-JPg=s64",
				source: "\u5B98\u7F51\u516C\u544A",
				// 经 host 代理 POST 抓取（官网新闻 API，征集名另经小米官方资讯流增强）；维护公告同时含当期卡池与活动
				url: "https://re.bluepoch.com/activity/official/websites/information/query",
				eventUrl: "https://re.bluepoch.com/activity/official/websites/information/query",
				eventSource: "\u5B98\u7F51\u516C\u544A"
			},
			{
				id: "nte",
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
					{ label: "LDSHOP", value: "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html", fetcher: "nte-ldshop" }
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
				.replace(/\s+/g, " ")
				.trim();
		}

		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		function parseTime(s) {
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (!m) return { ts: null, text: null };
			const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
			const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text };
		}

		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		function parseRange(raw) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0]);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0]);
			const b = parseTime(parts[1]);
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
		function parseAllBwiki(html) {
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
				const range = parseRange(timeM[1]);
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
		function parseArknights(html) {
			const out = [];
			// 标准（干员轮换卡池）+ 中坚（中坚甄选）：行内 title="寻访模拟/干员轮换卡池N" 或 "寻访模拟/中坚甄选N"
			for (const rm of html.matchAll(/<tr(?:[^>]*)>([\s\S]*?)<\/tr>/g)) {
				const row = rm[1];
				const tier = /干员轮换卡池/.test(row) ? ("标准") : (/中坚甄选/.test(row) ? "中坚" : null);
				if (!tier) continue;
				const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
				if (tds.length < 3) continue;
				const titleM = (tds[1] || "").match(/title="([^"]*)"/);
				if (!titleM) continue;
				const banner = String(titleM[1]).replace(/^寻访模拟\//, ""); // 干员轮换卡池192 / 中坚甄选14
				const roles = [...((tds[3] || "") + (tds[4] || "")).matchAll(/<a[^>]*title="([^"]+)"/g)]
					.map((m) => m[1]).filter(Boolean);
				const range = parseRange(tds[2]);
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
						const range = parseRange(tds[1]);
						out.push({ tier: "限时", banner, roles, ...range, isMain: true });
					}
				}
			}
			return out;
		}

		// 明日方舟当期卡池：外显按 限时 > 标准 > 中坚 优先级选一个；悬停 bannerHover 列出三种。
		function selectArknights(html) {
			const now = Date.now();
			const items = parseArknights(html);
			fillMissingStarts(items);
			const tiers = ["限时", "标准", "中坚"];
			const curByTier = {};
			for (const t of tiers) {
				curByTier[t] = items.filter((it) => it.tier === t && it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			}
			let winner = null;
			for (const t of tiers) {
				if (curByTier[t].length > 0) { winner = curByTier[t][0]; break; }
			}
			if (!winner) return null;
			const lines = tiers.map((t) => {
				const arr = curByTier[t];
				if (arr.length === 0) return `${t}：（无）`;
				const it = arr.slice().sort((a, b) => b.startTs - a.startTs)[0];
				return `${t}：${it.banner}${it.roles ? `\u00B7${it.roles}` : ""}\n${it.rawOriginal || it.raw}`;
			});
			return {
				banner: winner.banner,
				roles: winner.roles,
				bannerDates: winner.raw,
				bannerDatesRaw: winner.rawOriginal || winner.raw,
				bannerHover: lines.join("\n")
			};
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
		// 同期多张主池（如 104期+104-2期）合并角色。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			fillMissingStarts(items);
			const exact = items.filter((it) => it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			const loose = items.filter((it) => it.startTs == null && it.endTs != null && it.endTs >= now);
			const pool = (exact.length > 0 ? exact : loose).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			const first = pool[0];
			const sameRange = pool.filter((it) => it.startTs === first.startTs && it.endTs === first.endTs);
			const roles = [...new Set(sameRange.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				roles,
				bannerDates: first.raw,
				bannerDatesRaw: first.rawOriginal || first.raw
			};
		}

		// 鸣潮：角色轮换池页 → data-start/data-end + 当期角色
		function parseWuwaPool(html) {
			const tm = html.match(/data-start="([^"]+)"\s+data-end="([^"]+)"/);
			if (!tm) return null;
			const start = parseTime(tm[1]);
			const end = parseTime(tm[2]);
			const chars = [...new Set([...html.matchAll(/共鸣者\/([^"]+)"/g)].map((m) => m[1]))].slice(0, 6);
			return {
				banner: "\u89D2\u8272\u6362\u53EC\u6C60",
				roles: chars.join("、"),
				startTs: start.ts, endTs: end.ts,
				bannerDates: start.text && end.text ? `${start.text} ~ ${end.text}` : ""
			};
		}

		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const cur = selectCurrent(items, Date.now());
			if (!cur) return null;
			return { banner: cur.banner, roles: "", bannerDates: cur.bannerDates, bannerDatesRaw: cur.bannerDatesRaw || cur.bannerDates };
		}

		// 终末地（wiki.gg）：Headhunting/Banners 页 Current 分节 → 当期卡池
		// 该源经 host 代理抓取（fetchEndfieldWikiGg → proxyFetchText 设 Referer=wiki.gg origin），
		// 满足 Wiki.gg 的 Referer 校验，不会触发 403；本解析器仅处理代理返回的 HTML。
		function parseEndfieldCurrent(html) {
			const i = html.indexOf('id="Current"');
			if (i < 0) return null;
			const seg = html.slice(i);
			const tableEnd = seg.indexOf("</table>");
			const table = tableEnd >= 0 ? seg.slice(0, tableEnd) : seg;
			const nameM = table.match(/class="header"[^>]*>([^<]+)</);
			const asiaM = table.match(/Asia:<\/b>([\s\S]*?)<\/span>/);
			const upM = [...table.matchAll(/<li>[\s\S]*?title="([^"]+)"[\s\S]*?\(Drop Rate-UP\)/g)];
			const banner = nameM ? nameM[1].trim() : "";
			let startTs = null, endTs = null, startText = null, endText = null;
			if (asiaM) {
				const parts = stripTags(asiaM[1]).split(/[–-]/).map((x) => x.trim());
				if (parts.length >= 2) {
					const a = parseTime(parts[0]);
					const b = parseTime(parts[1]);
					if (a) { startTs = a.ts; startText = a.text; }
					if (b) { endTs = b.ts; endText = b.text; }
				}
			}
			// 不依赖 isMain 过滤的当期选择：直接按覆盖 now 判断
			if (!(startTs != null && endTs != null && startTs <= Date.now() && endTs >= Date.now())) return null;
			return {
				banner,
				roles: [...new Set(upM.map((m) => m[1]))].join("、"),
				bannerDates: startText && endText ? `${startText} ~ ${endText}` : ""
			};
		}

		// 终末地（GachaTracker）：banners 表格 → 当期卡池（卡池名/干员/起止）
		// GachaTracker 提供 CORS=[*]，浏览器端可直接抓取（替代被 Referer 反爬拦截的 wiki.gg）
		function parseGachaTracker(html) {
			const rows = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
			const items = [];
			for (const rm of rows) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				const charM = [...body.matchAll(/\/games\/endfield\/characters\/[^"]+" title="([^"]+)"/g)];
				if (!nameM || dateM.length < 2) continue;
				const start = dateM[0][1];
				const end = dateM[1][1];
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set(charM.map((m) => m[1]))].join("、"),
					startTs: new Date(start + "T00:00:00+08:00").getTime(),
					endTs: new Date(end + "T23:59:59+08:00").getTime()
				});
			}
			const now = Date.now();
			const cur = items.find((it) => it.startTs <= now && it.endTs >= now) || null;
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
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
		// 当期数据形如 d={梨诺:{windows:[{start,end,version,period,isRerun}]}},u=[...]
		// 历史数据形如 p=[{id,title,subtitle,version,periodStart,periodEnd,featured:[...]}]
		// 返回 { banner, roles, bannerDates }；无法识别返回 null。
		// 从 canmoe chunk JS 提取当期卡池：只采用"时间窗口覆盖当前时刻"的条目。
		// 当期在 d={角色:{windows:[{start,end,version,period,isRerun}]}}；过期/下一期在 p=[{title,subtitle,version,periodStart,periodEnd,featured}]。
		function currentFromCanmoe(js, now) {
			now = now || Date.now();
			const fmt = (iso) => {
				const d = new Date(iso);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			// 1) 当期 d：windows 覆盖当前 → 直接用
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) return { banner: `\u3010${w[3]}\u3011${roles}`, roles, bannerDates: `${fmt(w[1])} ~ ${fmt(w[2])}` };
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）
			const arr = extractCanmoeP(js);
			if (arr) {
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (a <= now && now <= b) {
						const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
						const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
						const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
						const roles = subtitle || title;
						return { banner: title || `\u3010${version}\u3011${subtitle}`, roles, bannerDates: `${fmt(ps)} ~ ${fmt(pe)}`, bannerDatesRaw: `${fmt(ps)} ~ ${fmt(pe)}` };
					}
				}
			}
			return null;
		}

		// 提取 canmoe chunk 中 p=[...] 数组（含 periodStart 的那个，平衡括号解析），返回元素子串数组
		function extractCanmoeP(js) {
			for (let s = js.indexOf("p=["); s >= 0; s = js.indexOf("p=[", s + 1)) {
				const start = js.indexOf("[", s);
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
				if (!/periodStart/.test(body)) continue;
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

		// 兼容旧调用：parseCanmoe / parseCanmoeLoose 均走统一的"当期选择"逻辑
		function parseCanmoe(js) { return currentFromCanmoe(js, Date.now()); }
		function parseCanmoeLoose(js) { return currentFromCanmoe(js, Date.now()); }

		// 终末地（canmoe 经 host 代理）：页面 HTML → 定位 BannerCalendar chunk → 抓 chunk JS → 解析当期
		// canmoe 无 CORS 头，两步都经 host 代理（referer 用页面 origin 满足反爬）
		// 数据在某一组件的 chunk 里（含当期 d={...} 与历史 p=[...]），需遍历组件引用的所有 chunk
		async function fetchCanmoeEndfield(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://end.canmoe.com/");
			const chunks = nextJsChunkUrls(html, "BannerCalendar", pageUrl);
			if (chunks.length === 0) return null;
			for (const c of chunks) {
				try {
					const js = await proxyFetchText(c, "https://end.canmoe.com/");
					const d = parseCanmoe(js) || parseCanmoeLoose(js);
					if (d) return d;
				} catch { /* 下一个 chunk */ }
			}
			return null;
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
			const base = now || new Date();
			const y = base.getFullYear();
			const a = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
			let b = new Date(y, Number(m[3]) - 1, Number(m[4]), 23, 59);
			if (b < a) b = new Date(y + 1, Number(m[3]) - 1, Number(m[4]), 23, 59);
			const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			return { startTs: a.getTime(), endTs: b.getTime(), startText: fmt(a), endText: fmt(b), raw: `${fmt(a)} ~ ${fmt(b)}` };
		}

		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		async function fetchLdshopNte(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html);
			if (pools.length === 0) return null;
			return selectCurrent(pools, Date.now());
		}

		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		async function fetchNteWanmei(listUrl, signal) {
			const ref = "https://yh.wanmei.com/";
			const list = await proxyFetchText(listUrl, ref);
			// 定位最新"维护/更新"公告链接
			const links = [...list.matchAll(/<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g)];
			const maint = links.find((x) => /维护公告|更新公告|停服维护/.test(x[2])) || links[0];
			if (!maint) return null;
			const detail = await proxyFetchText("https://yh.wanmei.com" + maint[1], ref);
			return parseNteWanmei(detail);
		}

		// 解析官网公告正文 → 当期卡池（全新限定S级角色所属限定棋盘）+ 当期活动（限时活动）
		function parseNteWanmei(html) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：全新限定S级角色「X」→「Y」限定棋盘, 开放时间 M月D日维护更新后-M月D日05:59
			const newRole = text.match(/全新限定S级角色「([^」]+)」[\s\S]{0,400}?可通过「([^」]+)」限定棋盘获得[\s\S]{0,300}?开放时间：(\d+)月(\d+)日维护更新后-(\d+)月(\d+)日05:59/);
			if (newRole) {
				const mo = +newRole[3], d = +newRole[4], emo = +newRole[5], ed = +newRole[6];
				data.banner = `「${newRole[2]}」限定棋盘`;
				data.roles = newRole[1];
				data.bannerDates = `${fmt(mo, d, 11, 0)} ~ ${fmt(emo, ed, 5, 59)}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护更新后|hh:mm)-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:维护更新后|(\d{2}):(\d{2}))-(\d+)月(\d+)日(\d{2}):(\d{2})/);
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
		async function fetchHtmlText(url, signal) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return text;
			}
			return res.text();
		}

		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericCard(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const now = Date.now();
			const cur = selectCurrent(parseAllBwiki(html), now) || selectCurrent(parseArknights(html), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					const d = parseCanmoe(js) || parseCanmoeLoose(js);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			return null;
		}

		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function parseGenericEvents(html) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
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
					const range = parseRange(time);
					// 起始可为 null（"版本更新后"），结束时间必须有效
					if (range.endTs == null) continue;
					items.push({ banner: name, ...range, isMain: true });
				}
			}
			return selectCurrent(items, Date.now());
		}

		// 明日方舟（PRTS 活动一览）：表格含「活动开始时间」列 + 隐藏 data-time="开始秒,结束秒"（Unix 秒）。
		// 开始时间用第一列文本（"2026-08-22 04:00"），结束时间用 data-time 第二个值（UTC 秒 → +08）。
		// 注意 data-time 第一个值是页面缓存时刻（非开始时间），故开始以文本列为准。
		// 活动名带核心分类前缀（"支线故事：墟·复刻"）：分类取第三列 <a title="分类:XXX"> 链接，
		// 核心分类 = 排除"复刻活动"（修饰词）后的第一个。
		function parsePrtsEvents(html) {
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
					const st = parseTime(stripTags(tds[0]).trim());
					items.push({
						banner: label,
						...range2(st, endTs),
						isMain: true
					});
				}
			}
			return selectCurrent(items, Date.now());
		}
		// PRTS 起止 → 统一文本（parsePrtsEvents 内部用）
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
		function parseGame8Events(html) {
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
			const now = Date.now();
			// 当期（进行中）选结束最晚；无当期时返回 null
			const cur = items
				.filter((it) => it.startTs <= now && it.endTs >= now)
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
		function parseGame8EventsLoose(html) {
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
			const now = Date.now();
			const cur = items.filter((it) => it.startTs <= now && it.endTs >= now).sort((x, y) => y.endTs - x.endTs)[0];
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
		async function fetchGame8Endfield(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://game8.co/");
			return parseGame8Events(html) || parseGame8EventsLoose(html);
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

		// 终末地（FZ Wiki /wiki/活动）：页面 RSC payload → 当期结束最晚的活动（open/close 时间区间）。
		// 只取"已开放且未结束"（close 非空）的活动；时间格式为 "2026/9/2 7:00:00"。
		function parseFzWikiActivities(html, now) {
			const obj = extractFzContentJson(html);
			if (!obj) return null;
			const acts = [];
			(function walk(n) {
				if (!n || typeof n !== "object") return;
				if (Array.isArray(n)) { n.forEach(walk); return; }
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.attrs?.activities)) {
					for (const a of n.attrs.activities) {
						if (!Array.isArray(a.timeRanges) || a.timeRanges.length === 0) continue;
						const tr = a.timeRanges[a.timeRanges.length - 1];
						if (!tr || !tr.open || !tr.close) continue;
						acts.push({ name: a.name, tags: a.tags || [], open: tr.open, close: tr.close });
					}
				}
				for (const k of Object.keys(n)) walk(n[k]);
			})(obj);
			if (acts.length === 0) return null;
			const parseT = (s) => new Date(String(s).replace(/\//g, "-")).getTime();
			const t0 = now || Date.now();
			const cur = acts
				.filter((a) => parseT(a.open) <= t0 && parseT(a.close) >= t0)
				.sort((x, y) => parseT(y.close) - parseT(x.close))[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const o = parseT(cur.open), c = parseT(cur.close);
			return {
				banner: cur.name,
				bannerDatesRaw: `${fmt(o)} ~ ${fmt(c)}`,
				bannerDates: `${fmt(o)} ~ ${fmt(c)}`
			};
		}

		// 终末地（FZ Wiki 经 host 代理，无 CORS）：活动排期页
		async function fetchFzWikiEndfield(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://fz.wiki/");
			const d = parseFzWikiActivities(html, Date.now());
			if (d) return d;
			throw new Error("fz-wiki-parse-empty");
		}

		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → parseGenericEvents → {event, eventDates}
		async function tryParseGenericEvent(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const cur = parseGenericEvents(html);
			if (cur && cur.banner) return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
			return null;
		}

		// 原神（bwiki SMW 语义查询）：活动一览页数据在 JS 动态加载（Dquery + SMW），
		// 改用 api.php?action=ask 直接查询「分类:活动」的开始/结束时间，选当期。
		// 属性：名称/开始时间/结束时间/所属版本；结束时间 9999/01/01 为永久活动占位（跳过）。
		// 查询 URL 由 fetchYsActivity 构造，浏览器直连（api.php 带 origin=* 有 CORS）。
		function parseSmwActivity(json) {
			const results = json?.query?.results || {};
			const now = Date.now();
			let best = null;
			// SMW timestamp 是 UTC 秒，raw 形如 "1/2026/8/28/10/0/0/0"（服务器本地时间 +08）。
			// 用 raw 直接构造本地时间，避免 UTC 秒被本地时区再偏移。
			const parseRaw = (v) => {
				if (!v) return null;
				if (v.raw != null) {
					const p = String(v.raw).split("/");
					if (p.length >= 8) {
						const y = Number(p[1]), mo = Number(p[2]), d = Number(p[3]), h = Number(p[4]), mi = Number(p[5]);
						if (y && mo && d) return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
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
					best = { banner: name, startTs, endTs };
					break;
				}
			}
			if (!best) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: best.banner,
				roles: "",
				bannerDates: `${fmt(best.startTs)} ~ ${fmt(best.endTs)}`,
				bannerDatesRaw: `${fmt(best.startTs)} ~ ${fmt(best.endTs)}`
			};
		}

		// 原神 SMW 活动查询（经 origin=* 直连）
		// 返回 EVENT_FETCHERS 契约格式 {event, eventDates, eventDatesRaw}（parseSmwActivity 产出卡池格式，这里转换）
		async function fetchYsActivity(signal) {
			const nowYear = new Date().getFullYear();
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || ""
			};
		}

		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// mkProxy：经 host 同源代理抓取（绕过 CORS / Referer 反爬，蔚蓝系列/终末地 wiki.gg）
		// 抓取器签名：async (url, signal) → 数据对象 | null
		function mkMediaWiki(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text);
			};
		}
		function mkRaw(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text());
			};
		}
		function mkProxy(fn) {
			return async (url, signal) => fn(url, signal);
		}
		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), Date.now());
		//#endregion

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

		// 经 host 代理抓取文本（fetch 同源 /api/gacha-calendar-proxy）→ 返回原始 body 字符串
		// extraHeaders：可选额外请求头（对象，如 GameKee 的 game-alias）
		// body：可选（对象）；提供时以 POST + JSON body 请求目标（如重返未来官网资讯 API）
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(proxyUrl) + "&referer=" + encodeURIComponent(referer || "");
			if (extraHeaders) api += "&headers=" + encodeURIComponent(JSON.stringify(extraHeaders));
			const opts = { headers: { "Accept": "application/json" } };
			if (body !== void 0) {
				opts.method = "POST";
				opts.headers["Content-Type"] = "application/json; charset=utf-8";
				opts.body = JSON.stringify(body);
			}
			const res = await fetch(api, opts);
			if (!res.ok) throw new Error("proxy-http-" + res.status);
			const j = await res.json();
			if (!j || j.status !== 200 || typeof j.body !== "string") throw new Error("proxy-bad:" + (j?.error || j?.status));
			return j.body;
		}

		// 经 host 代理抓取 JSON（body 为 JSON 时；body 参数同 proxyFetchText）
		async function proxyFetchJson(proxyUrl, referer, extraHeaders, body) {
			return JSON.parse(await proxyFetchText(proxyUrl, referer, extraHeaders, body));
		}

		// 解析繁体时间段："8月18日(二)維護後 ~ 9月1日(二)上午9點59分"
		function parseBaZhRange(raw, nowYear) {
			const s = stripTags(raw);
			const parts = s.split(/[~～]/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const a = parseZhTime(parts[0], nowYear);
			const b = parseZhTime(parts[1], nowYear);
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
				const range = parseBaZhRange(cells[0], nowYear);
				items.push({ cat, name, range, dateRaw: cells[0] });
			}
			return items;
		}

		// 蔚蓝档案·国际服：nexon 官方「更新日誌」board(3352) → 当期卡池 + 当期活动
		// 一次请求拿到更新日誌正文，从日程表同时提取 特選招募（卡池）与 活動劇情/總力戰（活动）
		async function fetchBaGlobal(logListUrl, signal) {
			const ref = "https://forum.nexon.com/bluearchiveTW/";
			const list = await proxyFetchJson(logListUrl, ref);
			const threads = Array.isArray(list?.threads) ? list.threads : [];
			// 最新一期更新日誌（标题含"更新日誌"）
			const logThread = threads.find((t) => /更新日誌/.test(t.title || ""));
			if (!logThread?.threadId) return null;
			const detail = await proxyFetchJson(`https://forum.nexon.com/api/v1/thread/${logThread.threadId}?alias=bluearchiveTW&countryCode=KR`, ref);
			const content = typeof detail?.content === "string" ? detail.content : "";
			if (!content) return null;
			const nowYear = new Date().getFullYear();
			const rows = parseBaLogRows(content, nowYear);
			const now = Date.now();
			// 当期卡池：特別特選招募 / 特選招募（时间覆盖 now）
			const bannerRow = rows.find((r) => /特選招募/.test(r.cat) && r.range && r.range.startTs <= now && r.range.endTs >= now);
			// 当期活动：活動劇情（优先）或 總力戰/制約解除決戰
			const eventRow = rows.find((r) => /活動劇情/.test(r.cat) && r.range && r.range.startTs <= now && r.range.endTs >= now)
				|| rows.find((r) => /總力戰|制約解除決戰|綜合戰術考試/.test(r.cat) && r.range && r.range.startTs <= now && r.range.endTs >= now);
			const data = {
				banner: "",
				roles: "",
				bannerDates: "",
				event: "",
				eventDates: ""
			};
			if (bannerRow) {
				data.banner = bannerRow.cat; // 如「特別特選招募」「特選招募」
				data.roles = bannerRow.name;
				data.bannerDates = bannerRow.range.raw;
			} else if (eventRow) {
				// 无卡池行时至少给出活动
				data.banner = eventRow.name;
				data.bannerDates = eventRow.range.raw;
			}
			if (eventRow) {
				data.event = eventRow.name; // 活动名（去掉"活動劇情："类类别前缀，精简展示）
				data.eventDates = eventRow.range.raw;
			}
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 终末地（wiki.gg 经 host 代理）：抓取 Headhunting/Banners HTML → parseEndfieldCurrent
		// wiki.gg 校验 Referer（非 wiki.gg 域名 403），经代理后 Referer=目标 origin 满足要求
		async function fetchEndfieldWikiGg(proxyUrl) {
			const html = await proxyFetchText(proxyUrl, "https://endfield.wiki.gg/");
			return parseEndfieldCurrent(html);
		}

		// ---- GameKee（蔚蓝档案）----
		// 解析标题里的排期：【8/18~9/01】 / 【8月26日 ~ 9月9日】 → {startText, endText, startTs, endTs}
		function parseGkRange(title, nowYear) {
			const m = String(title).match(/【([^】]+)】/);
			if (!m) return null;
			const inner = m[1].replace(/\s+/g, "");
			const parts = inner.split(/[~～\-—]/);
			if (parts.length < 2) return null;
			const parseGkTime = (p) => {
				// 8/18 或 8月18日（日服可能带 日）
				const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/);
				if (!md) return null;
				const mo = Number(md[1]), d = Number(md[2]);
				const ts = new Date(nowYear, mo - 1, d, 0, 0).getTime();
				return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00` };
			};
			const a = parseGkTime(parts[0]);
			const b = parseGkTime(parts[1]);
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
			const nowYear = new Date().getFullYear();
			const data = { banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
			if (bannerTitle) {
				const rng = parseGkRange(bannerTitle, nowYear);
				if (rng) {
					// 卡池名：去掉前缀和后缀排期（如 "日服当期卡池：DIVE into OCEAN！【...】"）
					data.banner = String(bannerTitle).replace(/^.*?[:：]\s*/, "").replace(/【[^】]*】.*$/, "").trim();
					data.bannerDates = rng.raw;
				}
			}
			if (eventTitle) {
				const rng = parseGkRange(eventTitle, nowYear);
				if (rng) {
					// 活动名：去前后缀（"日服活动 X 活动一图攻略整理【...】" → "X"）
					const cleaned = String(eventTitle)
						.replace(/【[^】]*】.*$/, "")
						.replace(/^(日服|国际服)?\s*(当期)?\s*(活动|卡池)[^：:]*[:：]\s*/, "")
						.replace(/^(日服|国际服)\s*(当期)?\s*活动\s*/, "")
						.replace(/活动攻略整理|活动一图攻略整理|攻略整理$/, "")
						.trim();
					data.event = cleaned || String(eventTitle).replace(/【[^】]*】.*$/, "").trim();
					data.eventDates = rng.raw;
				}
			}
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 蔚蓝国服（官网 bluearchive-cn.com）：news/list → 最新维护更新说明 → 当期卡池/活动名 + 维护起止
		// 时间：维护日 14:00 ~ 下次维护前（约 +14 天，取维护日开始、预加载下一期预告前）
		async function fetchBaCn(listUrl) {
			const H = { "game-alias": "ba" };
			const ref = "https://bluearchive-cn.com/";
			const list = await proxyFetchJson(listUrl, ref, H);
			const rows = list?.data?.rows || [];
			const maintTitle = rows.find((n) => /维护更新说明/.test(n.title || ""));
			if (!maintTitle?.id) return null;
			const detail = await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${maintTitle.id}`, ref, H);
			const content = detail?.data?.news?.content || "";
			if (!content) return null;
			// HTML → 文本
			const text = String(content)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 当期卡池名（第一个"更新限时招募【X】"或复刻）
			const bannerM = text.match(/更新限时招募【([^】]+)】/);
			const bannerR = text.match(/更新限时复刻招募【([^】]+)】/);
			// 当期活动名（第一个"更新限时活动【X】"）
			const eventM = text.match(/更新限时活动【([^】]+)】/);
			// 维护开始时间 "08月20日 14:00"
			const maintM = text.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
			const nowYear = new Date().getFullYear();
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
			const data = {
				banner: bannerM ? bannerM[1] : (bannerR ? `复刻·${bannerR[1]}` : ""),
				roles: "",
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates
			};
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
			const now = Date.now();
			const nowYear = new Date().getFullYear();
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
				const endTs = new Date(em < sm ? nowYear + 1 : nowYear, em - 1, ed, eh, emi).getTime();
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

		// 重返未来：1999（官网 re.bluepoch.com 新闻 API，POST 经 host 代理）
		// 列表接口（informationType=2 资讯）按上线时间倒序返回含全文的公告，
		// 取最新一期「版本更新维护公告」：当期卡池（首位6星角色名，官网无征集名）/ 当期活动 / 维护起止 + 下一期维护日
		async function fetchR99(listUrl, signal) {
			const ref = "https://re.bluepoch.com/";
			const list = await proxyFetchJson(listUrl, ref, {}, { current: 1, pageSize: 30, informationType: 2 });
			const items = list?.data?.pageData || [];
			const maint = items.find((n) => /版本更新维护公告/.test(n.title || ""));
			if (!maint?.content) return null;
			const text = String(maint.content)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 当期卡池：新增角色首位 6 星（"6星角色「赫多涅（岩）」" → "赫多涅"；官网不发布征集名，只显示角色名）
			const roleM = text.match(/6星角色「([^」]+)」/);
			const bannerName = roleM ? cleanRoles(roleM[1]).replace(/[（）()].*$/, "") : "";
			// 官网新增角色名单（当期两位 6 星，如 赫多涅/纳西索斯）——用于小米征集公告的主池判定
			const sixStars = [...text.matchAll(/6星角色「([^」]+)」/g)]
				.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
				.filter(Boolean);
			// 维护时间："【维护时间】2026/8/13 6:00 - 2026/8/13 10:00"
			const maintM = text.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
			// 下一期维护：心相观测上新"可在9月3日上午5点之后兑换"（当期卡池结束日 = 其前一日 04:59）
			const nextM = text.match(/可在(\d{1,2})月(\d{1,2})日上午5点之后/);
			// 当期活动：新增活动列表第 2 项（首位6星角色剧情活动，"「赫多涅·凡人或英雄」"）
			const actM = text.match(/活动正篇[，,]\s*「([^」]+)」/);
			const nowYear = new Date().getFullYear();
			const fmt = (y, mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let bannerDates = "";
			if (maintM) {
				const my = Number(maintM[1]), mm = Number(maintM[2]), md = Number(maintM[3]);
				// 卡池/活动在维护完成后开启 → 起点取维护结束时间（如 2026/8/13 10:00）
				const start = fmt(Number(maintM[6]), Number(maintM[7]), Number(maintM[8]), Number(maintM[9]), Number(maintM[10]));
				// 结束：下一期维护日前 04:59（无提示时按 +21 天兜底）
				let end = new Date(nowYear, mm - 1, md + 21, 4, 59);
				if (nextM) {
					const base = new Date(nowYear, mm - 1, md);
					let ey = nowYear;
					if (new Date(nowYear, Number(nextM[1]) - 1, Number(nextM[2])) < base) ey = nowYear + 1;
					end = new Date(ey, Number(nextM[1]) - 1, Number(nextM[2]), 4, 59);
				}
				bannerDates = `${start} ~ ${fmt(end.getFullYear(), end.getMonth() + 1, end.getDate(), 4, 59)}`;
			}
			const eventName = actM ? String(actM[1]).replace(/^[^·]+·/, "") : "";
			const data = {
				banner: bannerName,
				roles: "",
				bannerDates,
				event: eventName,
				eventDates: bannerDates
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
		// - CARD_FETCHERS[id]：卡池字段抓取器（async (url, signal) → 数据对象 | null），
		//   数据对象形如 {banner, roles?, bannerDates, event?, eventDates?}；
		//   当活动源与卡池源同 URL 时，event/eventDates 由卡池载荷复用（避免重复请求）。
		// - EVENT_FETCHERS[id]：活动源注册表（{ 默认抓取器, 备选抓取器... }），
		//   抓取器同 CARD_FETCHERS 契约；fetchEntry 只取其中的 event/eventDates 字段。
		//   活动源与卡池源不同 URL 时独立抓取（来源选择互不影响）。
		// - altSources[].fetcher / eventAltSources[].fetcher：各字段备选源的抓取器键名，
		//   设置页选择备选源后按此路由（兼容旧配置存储的 proxy:/gk-global: 值）。
		const CARD_FETCHERS = {
			genshin: mkMediaWiki(pickCurrent(parseAllBwiki)),
			hsr: mkMediaWiki(pickCurrent(parseAllBwiki)),
			zzz: mkMediaWiki(pickCurrent(parseAllBwiki)),
			arknights: mkMediaWiki(selectArknights),
			wuwa: mkMediaWiki(parseWuwaPool),
			// 终末地默认：Canmoe（中文，Next.js 数据经 host 代理两步抓取）
			endfield: mkProxy((url, signal) => fetchCanmoeEndfield(url)),
			// 终末地备选：GachaTracker（英文，浏览器直连）/ wiki.gg（英文，经 host 代理）
			"endfield-gachatracker": mkRaw(parseGachaTracker),
			"endfield-wiki-gg": mkProxy((url, signal) => fetchEndfieldWikiGg(url)),
			// 异环：ldshop（繁体，静态表格经 host 代理）
			nte: mkProxy((url, signal) => fetchNteWanmei(url, signal)),
			"nte-ldshop": mkProxy((url, signal) => fetchLdshopNte(url)),
			"ba-cn": mkProxy((url, signal) => fetchBaCn(url)),
			"ba-global": mkProxy((url, signal) => fetchBaGlobal(url, signal)),
			"ba-global-gamekee": mkProxy(() => fetchGameKeeBa("global")),
			"ba-jp": mkProxy(() => fetchGameKeeBa("jp")),
			"r1999": mkProxy((url, signal) => fetchR99(url, signal))
		};
		// 活动源注册表：条目 → { 默认 + 备选抓取器 }。没有独立活动源的条目活动来源显示"未配置"。
		const EVENT_FETCHERS = {
			// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
			genshin: {
				default: (url, signal) => fetchYsActivity(signal)
			},
			// 星铁：活动一览（静态「活动时间」表，api.php 可直连）
			hsr: {
				default: mkMediaWiki((html) => {
					const d = parseGenericEvents(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null;
				})
			},
			// 绝区零：活动一览（静态「活动时间」表，api.php 可直连）
			zzz: {
				default: mkMediaWiki((html) => {
					const d = parseGenericEvents(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null;
				})
			},
			// 明日方舟：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）
			arknights: {
				default: mkMediaWiki((html) => {
					const d = parsePrtsEvents(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null;
				})
			},
			// 终末地：FZ Wiki（中文，经 host 代理、抓 RSC 数据；当期并行活动选结束最晚）
			endfield: {
				default: (url, signal) => fetchFzWikiEndfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				),
				"endfield-game8": (url, signal) => fetchGame8Endfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				)
			},
			// 鸣潮：活动日历页（独立 eventUrl 源）
			wuwa: {
				default: mkMediaWiki((html) => {
					const d = parseWuwaCalendar(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null;
				})
			},
			// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
			"ba-cn": {
				default: mkProxy((url, signal) => fetchBaCn(url))
			},
			// 蔚蓝国际服：默认与卡池同 URL（更新日誌含活动排期）；备选 GameKee
			"ba-global": {
				default: mkProxy((url, signal) => fetchBaGlobal(url, signal)),
				"ba-global-gamekee": mkProxy(() => fetchGameKeeBa("global"))
			},
			// 蔚蓝日服：默认与卡池同 URL（GameKee 当期活动条目）
			"ba-jp": {
				default: mkProxy(() => fetchGameKeeBa("jp"))
			},
			// 重返未来：默认与卡池同 URL（维护公告含活动）
			"r1999": {
				default: mkProxy((url, signal) => fetchR99(url, signal))
			}
		};

		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器
		function cardFetcherFor(source, url) {
			const alt = (source.altSources || []).find((a) => a.value === url && CARD_FETCHERS[a.fetcher]);
			if (alt) {
				const f = CARD_FETCHERS[alt.fetcher];
				// 备选源值带 proxy: 前缀（标记经 host 代理），调用时剥掉前缀再交给代理抓取器
				return String(alt.value).startsWith("proxy:")
					? (u, signal) => f(String(u).replace(/^proxy:/, ""), signal)
					: f;
			}
			return CARD_FETCHERS[source.id] || null;
		}

		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const alt = (source.eventAltSources || []).find((a) => a.value === url && table[a.fetcher]);
			if (alt) {
				const f = table[alt.fetcher];
				return String(alt.value).startsWith("proxy:")
					? (u, signal) => f(String(u).replace(/^proxy:/, ""), signal)
					: f;
			}
			return table.default || null;
		}
		//#endregion

		//#region refresh
		// 抓取单个条目：卡池字段与活动字段分别由各自来源产出（见"统一来源注册表"契约）。
		// 卡池/活动字段均"条目自带解析优先；失败或无解析器时尝试通用解析"（自定义条目/自定义来源地址）。
		// 活动来源与卡池来源独立选择：同 URL 时单次请求复用卡池载荷，不同 URL 时独立抓取。
		async function fetchEntry(source, signal) {
			// 无任何来源的条目：跳过（不计成功也不计失败）
			if (!source.url && !source.eventUrl) return { ok: true, reason: "skipped" };
			try {
				const cardFetcher = cardFetcherFor(source, source.url);
				let data = null;
				// —— 卡池字段：自带解析失败/无解析器时，尝试通用解析（自定义来源地址等）——
				if (source.url) {
					if (cardFetcher) {
						try {
							data = await cardFetcher(source.url, signal);
						} catch (err) {
							if (err?.name === "AbortError") throw err;
						}
						if (!data || !data.banner || !data.bannerDates) {
							// 自带解析未命中 → 通用解析兜底（自定义地址可能指向其它结构的页面）
							try { data = await tryParseGenericCard(source.url, signal); } catch { data = null; }
						}
						// 卡池为空不提前判失败：若还有活动源则继续抓活动（如明日方舟跨期空档但活动仍在）
					} else {
						// 自定义条目（无内置解析器）：通用解析；解析不出内容即失败（不做健康检查兜底）
						try { data = await tryParseGenericCard(source.url, signal); }
						catch (err) {
							if (err?.name === "AbortError") throw err;
							return { ok: false, reason: String(err?.message ?? err) };
						}
						// 自定义条目：卡池为空但仍有活动源时，继续尝试活动字段（避免"卡池空 → 整条失败"把有效活动也丢了）
					}
				}
				// —— 活动字段：自带活动解析优先；失败/无解析器时尝试通用活动解析（自定义地址）——
				if (source.eventUrl) {
					// 活动源与卡池源同 URL → 单次请求，复用卡池载荷中的 event/eventDates
					if (source.eventUrl === source.url && data && data.event) {
						data.eventDates = data.eventDates || "";
						if (data.bannerDatesRaw) data.eventDatesRaw = data.bannerDatesRaw;
					} else {
						let evName = "", evDates = "", evDatesRaw = "", gErr = null;
						const eventFetcher = eventFetcherFor(source, source.eventUrl);
						if (eventFetcher) {
							try {
								const ev = await eventFetcher(source.eventUrl, signal);
								evName = ev && typeof ev.event === "string" ? ev.event : "";
								evDates = ev && typeof ev.eventDates === "string" ? ev.eventDates : "";
								evDatesRaw = ev && typeof ev.eventDatesRaw === "string" ? ev.eventDatesRaw : "";
							} catch (err) {
								if (err?.name === "AbortError") throw err;
							}
						}
						if (!evName) {
							// 自带活动解析未命中/无解析器 → 通用活动解析兜底
							try {
								const g = await tryParseGenericEvent(source.eventUrl, signal);
								if (g && g.event) {
									evName = g.event;
									evDates = g.eventDates || "";
									evDatesRaw = g.eventDatesRaw || "";
								}
							} catch (err) { gErr = err; }
						}
						if (evName) {
							data = data || {};
							data.event = evName;
							data.eventDates = evDates;
							if (evDatesRaw) data.eventDatesRaw = evDatesRaw;
						} else {
							// 活动源失败：若卡池已解析出内容则宽容处理（记录原因供面板提示）；
							// 卡池也未解析出内容 → 整个条目判失败（不做可达性健康检查）
							if (data && (data.banner || data.event)) {
								data.eventFail = gErr
									? String(gErr.message ?? gErr).slice(0, 60)
									: "no-match";
							} else {
								return {
									ok: false,
									reason: gErr ? String(gErr.message ?? gErr).slice(0, 60) : "no-match"
								};
							}
						}
					}
				}
				if (!data) {
					// 无任何来源且未解析出内容：直接判失败（不做可达性健康检查）
					return { ok: false, reason: "no-source" };
				}
				return { ok: true, reason: "ok", data };
			} catch (err) {
				return { ok: false, reason: err?.name === "AbortError" ? "aborted" : String(err?.message ?? err) };
			}
		}

		async function refreshAll(entries, s) {
			const controller = new AbortController();
			const timeout = window.setTimeout(() => controller.abort(), 12000);
			// 自定义爬取地址覆盖默认；克隆避免污染原始对象（卡池源+活动源分别覆盖）
			const targets = entries.map((e) => ({
				...e,
				url: getEntryUrl(s, e.id, e.url),
				eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl")
			}));
			const results = await Promise.all(targets.map((t) => fetchEntry(t, controller.signal)));
			window.clearTimeout(timeout);
			const okCount = results.filter((r) => r.ok).length;
			const failed = entries.filter((s2, i) => !results[i].ok).map((x) => x.name);
			return {
				okCount,
				total: entries.length,
				failed,
				at: Date.now(),
				status: okCount > 0 ? "ok" : "unreachable",
				results
			};
		}
		//#endregion

		//#region helpers
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
					custom: true
				});
			}
			return out;
		}

		// 角色名精简（面板外显用）：去「」装饰、去（属性/职业）后缀；
		// "称号·名字"仅当称号为 4 字时去掉称号前缀（如 翾风回雪·奥黛塔 → 奥黛塔；
		// 知更鸟•晴歌 这类"角色•变体"保留完整名）。悬停全文仍用原始 roles。
		function cleanRoleNames(roles) {
			return String(roles || "")
				.split(/[、,，]/)
				.map((n) => {
					let s = n.replace(/[「」【】]/g, "").replace(/[（(][^）)]*[）)]/g, "").trim();
					const m = s.match(/^([\u4e00-\u9fff]{4})[·•](.+)$/);
					if (m) s = m[2].trim();
					return s;
				})
				.filter(Boolean)
				.join("、");
		}

		// 默认爬取源显示名（设置页下拉默认项）
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		// 卡池源：source 字段，否则域名/未配置
		// 活动源：eventSource 标签（或域名）；无活动源 → "未配置"
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
		function getVisibleEntries(s) {
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			return getAllEntries(s).filter((x) => !hidden.includes(x.id));
		}

		// 某条目的实际爬取地址：自定义覆盖默认；urlField 区分卡池源(customUrls)/活动源(customEventUrls)
		// 存储值约定：custom:<url>（用户自定义输入，剥前缀返回 url）、proxy:<url>（备选源，保留前缀供抓取层路由）、其它原样
		function getEntryUrl(s, id, fallbackUrl, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			if (typeof u !== "string" || u.trim() === "") return fallbackUrl;
			if (u.startsWith("custom:")) {
				const v = u.slice("custom:".length).trim();
				return v !== "" ? v : fallbackUrl;
			}
			return u.trim(); // 默认原样：proxy:... 备选源或普通 url
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
				return { mo, d, base: new Date(now.getFullYear(), mo - 1, d, h, mi).getTime() };
			};
			const a = parsePart(parts[0]);
			const b = parsePart(parts[1]);
			if (!a || !b) return null;
			let startTs = a.base;
			let endTs = b.base;
			// 跨年：结束月份小于开始月份（如 12-20 ~ 01-05），结束补下一年
			if (b.mo < a.mo) endTs += 365 * 24 * 60 * 60 * 1000;
			return { startTs, endTs };
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
		//#endregion
		//#endregion

		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;padding:0 10px 0 8px;margin:4px -2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:12px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-align:left}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn svg{flex:none;width:16px;height:16px}
			.hHd-Xa_footerActions{flex-wrap:wrap;align-content:flex-start;align-items:stretch}
			.gacha-cal-pop{position:fixed;z-index:9999;width:690px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			.gacha-cal-scrape{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
		function CalendarPanel({ wide, scope }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [scrapeInfo, setScrapeInfo] = (0, react.useState)("");
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
					// 单次抓取失败沿用缓存时提示上次成功时间（悬停）
					_cached: !!sc.stale,
					_okAt: sc.stale ? sc.okAt || "" : "",
					// 卡池名与角色名分开保留：卡池列外显角色名、悬停显示卡池全名
					banner: sc.banner || g.banner,
					roles: sc.roles || g.roles || "",
					bannerDates: sc.bannerDates || g.bannerDates,
					// 源站原文（补全前）：悬停起止列时显示原文而非补全后的时间
					bannerDatesRaw: sc.bannerDatesRaw || "",
					event: sc.event || g.event,
					eventDates: sc.eventDates || g.eventDates,
					eventDatesRaw: sc.eventDatesRaw || ""
				};
			});

			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshing) return;
				setRefreshing(true);
				try {
					// 函数内部读取最新 snapshot，避免把 s 放进依赖数组导致定时器频繁重建
					const snap = scope.getSnapshot();
					const sNow = { ...DEFAULT_SETTINGS, ...(snap.value ?? {}) };
					const entries = getAllEntries(sNow);
					const result = await refreshAll(entries, sNow);
					const prevById = JSON.parse(sNow.lastData || "{}") || {};
					const dataById = {};
					result.results.forEach((r, i) => {
						const id = entries[i].id;
						// 本次抓取失败但此前有成功结果时沿用最近一次成功数据，避免单次失败整行变空
						if (r.ok && r.data) dataById[id] = { ...r.data, okAt: Date.now() };
						else if (prevById[id]) dataById[id] = { ...prevById[id], stale: true };
					});
					await scope.set("lastData", JSON.stringify(dataById));
					await scope.set("lastRefresh", result.at);
					await scope.set("lastSource", result.status === "ok" ? "web" : "none");
					// 抓取详情（成功数 + 跳过无源条目 + 失败游戏 + 活动源失败提示），供面板顶部展示
					const okNames = entries.filter((x, i) => result.results[i]?.ok && result.results[i]?.reason !== "skipped").map((x) => x.name);
					const skippedCount = entries.filter((x, i) => result.results[i]?.reason === "skipped").length;
					const skippedNote = skippedCount > 0 ? `（跳过 ${skippedCount} 个）` : "";
					const eventFails = result.results
						.map((r, i) => r.ok && r.data?.eventFail ? `${entries[i].name}(活动:${r.data.eventFail})` : "")
						.filter(Boolean);
					const fallbackCount = entries.filter((x, i) => !result.results[i]?.ok && prevById[entries[i].id]).length;
					let info = result.failed.length === 0
						? `抓取成功 ${okNames.length}/${result.total}${skippedNote}`
						: `抓取成功 ${okNames.length}/${result.total}${skippedNote}；失败：${result.failed.join("、")}`;
					if (eventFails.length > 0) info += `；${eventFails.join("、")}`;
					if (fallbackCount > 0) info += `；${fallbackCount} 项失败沿用最近成功数据`;
					setScrapeInfo(info);
					setSnapshot(scope.getSnapshot());
				} finally {
					setRefreshing(false);
				}
			}, [refreshing, scope]);

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
				let last = Date.now();
				const tick = () => {
					if (disposed) return;
					const now = Date.now();
					if (now - last >= intervalMs) {
						last = now;
						doRefresh();
					}
					timer = window.setTimeout(tick, Math.min(Math.max(last + intervalMs - Date.now(), 1000), MAX_DELAY));
				};
				timer = window.setTimeout(tick, Math.min(intervalMs, MAX_DELAY));
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [s.autoRefresh, s.refreshMinutes, doRefresh]);

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
			const label = "\u4E8C\u6E38\u6392\u671F";

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
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: "\u4E8C\u6E38\u6392\u671F" }),
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
								// 设置按钮：跳转到 DSH 设置页并关闭本面板。
								// DSH 设置面板是 modal、打开状态组件私有（无官方跳转 API），
								// 通过触发侧边栏设置触发器（aria-haspopup="dialog" 是设置对话框的标准契约属性）打开面板。
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									title: "\u8BBE\u7F6E",
									"aria-label": "\u8BBE\u7F6E",
									onClick: () => {
										setOpen(false);
										const t = document.querySelector('[aria-haspopup="dialog"]');
										if (t && typeof t.click === "function") t.click();
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
								// 抓取提示：放在设置按钮右边（meta 行内，过长自动换行）
								scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-scrape", children: scrapeInfo }) : null
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
								// 卡池列：外显纯角色名（cleanRoleNames 去称号·前缀/属性后缀；无角色名时显示卡池名），
								// 悬停弹出卡池全名+角色；无数据时显示占位符 "—"
								const cardVisible = g.roles ? cleanRoleNames(g.roles) : (g.banner || "—");
								const cardTitle = (g.roles ? `${g.banner}·${g.roles}` : (g.banner || "")) + (g.bannerDates ? `\n${g.bannerDatesRaw || g.bannerDates}` : "");
								// 活动列：外显活动名称，悬停弹出活动全名+起止（起止显示源站原文）；无数据时显示 "—"
								const eventName = g.event || "—";
								const eventTitle = g.event
									? (g.eventDates ? `${g.event}\n${g.eventDatesRaw || g.eventDates}` : g.event)
									: (g.eventDatesRaw || g.eventDates || "");
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									children: [
										(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: g.name + (g._cached ? `\n（上次成功 ${g._okAt ? new Date(g._okAt).toLocaleString() : "—"}）` : ""), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: (g.bannerHover || cardTitle), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: cardVisible }) }),
										// 起止列：倒计时用补全后的时间；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.bannerDatesRaw || g.bannerDates, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: eventTitle, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.eventDatesRaw || g.eventDates, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(g.eventDates || "", now) }) })
									]
								});
							})
						]
					}) : null
				]
			});
		}

		function CalendarSettingsPage({ scope }) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "" });
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			const sorted = applyOrder(allEntries, order);
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);

			const commit = async (key, value) => {
				await scope.set(key, value);
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
			const resetOrder = async () => { await commit("order", null); };

			// 展示开关
			const toggleHidden = async (id) => {
				const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
				await commit("hidden", next);
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
			// 恢复默认条目：清空删除记录与自定义条目
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
				return v; // 备选源 value（如 "proxy:https://..."）
			};
			const setUrlMode = async (id, mode, g) => {
				const next = { ...(urls || {}) };
				if (mode === "default") delete next[id];
				else if (mode === "custom") next[id] = "custom:" + (customInputs[id] ?? "");
				else next[id] = mode; // 备选源 value
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
				return String(eu[id] ?? "").startsWith("custom:") ? "custom" : eu[id];
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
					(0, react_jsx_runtime.jsxs)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: "\u4E8C\u6E38\u6392\u671F" }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginTop: 2 }, children: "\u5361\u6C60\u65E5\u5386\u63D2\u4EF6\u8BBE\u7F6E" })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u5237\u65B0\u6392\u671F\u6570\u636E" })
						] }),
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "\u5237\u65B0\u9891\u7387" }),
							(0, react_jsx_runtime.jsxs)("select", { value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
								!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "\u81EA\u5B9A\u4E49 (" + currentMinutes + " \u5206\u949F)" }) : null,
								REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u5728\u4FA7\u8FB9\u680F\u9762\u677F\u6253\u5F00\u671F\u95F4\uFF0C\u6309\u6B64\u9891\u7387\u81EA\u52A8\u5237\u65B0\u6E90\u6570\u636E\u3002" })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "\u6761\u76EE\u7BA1\u7406" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: resetOrder, children: "\u6062\u590D\u9ED8\u8BA4\u987A\u5E8F" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: restoreAll, children: "\u6062\u590D\u9ED8\u8BA4\u6761\u76EE" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制面板是否显示；「↑↓」调整顺序；「自定义」可覆盖来源地址；卡池来源与活动来源各自独立选择；删除后可恢复默认。" }),
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
							const showCardInput = mode === "custom";
							const showEventInput = evMode === "custom";
							return (0, react_jsx_runtime.jsxs)("div", {
								key: g.id,
								style: { borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "4px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, style: { width: 22, height: 22, borderRadius: 5, objectFit: "cover", flex: "none" } }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !hidden.includes(g.id), onChange: () => toggleHidden(g.id) }),
												(0, react_jsx_runtime.jsx)("span", { children: "\u5C55\u793A" })
											] }),
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setUrlMode(g.id, e.target.value, g),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
													(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: a.value, children: a.label }, a.label)),
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
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: a.value, children: a.label }, a.fetcher)),
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
									showCardInput || showEventInput ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 4px 6px" }, children: [
										showCardInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "卡池来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "MediaWiki api.php URL",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "MediaWiki api.php URL",
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
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称/图标手动填写；卡池与活动内容由链接解析产出（MediaWiki api.php 或含排期的网页），刷新时自动解析。" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u540D\u79F0 *", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u56FE\u6807 URL", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5361\u6C60\u6765\u6E90\u94FE\u63A5 * (MediaWiki api.php)", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u6D3B\u52A8\u6765\u6E90\u94FE\u63A5 (\u53EF\u9009)", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来源：官方公告 / 官方Wiki（bwiki、PRTS 等）；无联网抓取数据时对应列显示为空。自定义条目的链接会尝试解析（MediaWiki/常见卡池与活动表格），解析失败时该列显示为空。" })
				]
			});
		}
		//#endregion

		//#region plugin
		const inject = ["slots", "settingsScope", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-gacha-calendar";
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-gacha-calendar: styles");

			// DSH 设置页左侧导航的 section 图标由 navIcon 硬编码（未知 id 一律默认齿轮），
			// 插件无法通过 settings.section 配置图标；这里在设置面板打开后，把
			// "二游排期" 导航项的齿轮图标替换为日历图标（Lucide 风格 16px，幂等）。
			// 性能：MutationObserver 回调只置脏标记，用 requestAnimationFrame 合并执行；
			// patch 先查 dialog 是否存在，不存在立即返回（Web 端高频 DOM 变化时开销极小）。
			ctx.effect(() => {
				const LABEL = "\u4E8C\u6E38\u6392\u671F";
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
					if (cell) cell.classList.remove("gacha-cal-marq");
				};
				document.addEventListener("mouseover", onOver);
				document.addEventListener("mouseout", onOut);
				return () => {
					document.removeEventListener("mouseover", onOver);
					document.removeEventListener("mouseout", onOut);
				};
			}, "dsh-gacha-calendar: marquee");

			const scope = ctx.settingsScope.bind({ namespace: NS });

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-gacha-calendar",
				priority: -10,
				locale: NS,
				inject: () => ({ scope })
			}, CalendarPanel));

			// 设置页单开一个 section（左侧导航独立页面，参照 dsh-cost-meter 的 settings.section 用法）
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "gacha-calendar",
				order: 25,
				label: "\u4E8C\u6E38\u6392\u671F",
				locale: NS,
				inject: () => ({ scope })
			}, CalendarSettingsPage));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
