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
			lastSource: "builtin",
			// 最近一次联网抓取的解析结果（JSON：{ [gameId]: {banner,bannerDates,version,roles} }）
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
		const SOURCES = [
			{
				id: "genshin",
				name: "原神",
				version: "7.0「无神怜爱的雪国」",
				banner: "上半：奥黛塔+阿蕾奇诺",
				bannerDates: "08-12 06:00 ~ 09-01 17:59",
				event: "夏日怪谈冒险会",
				eventDates: "08-17 ~ 09-04 03:59",
				next: "下半 09-01~09-22；7.1≈09-23",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/b/b0/%E5%8E%9F%E7%A5%9E%E5%9B%BE%E6%A0%87.png!/fw/64",
				source: "Bwiki",
				url: "https://wiki.biligame.com/ys/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&prop=text&format=json&formatversion=2",
				eventUrl: ""
			},
			{
				id: "hsr",
				name: "崩坏：星穹铁道",
				version: "4.5「挥掷千星的筹码」",
				banner: "上半：知更鸟·晴歌+风堇",
				bannerDates: "08-26 ~ 09-12 11:59",
				event: "超限：狂飙大奖赛",
				eventDates: "08-26 ~ 09-28 03:59",
				next: "下半 09-12~09-28；4.6≈09-29",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/64",
				source: "Bwiki",
				url: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2",
				eventUrl: ""
			},
			{
				id: "zzz",
				name: "绝区零",
				version: "3.1「漫长的告别」",
				banner: "下期：希格莉德",
				bannerDates: "08-19 12:00 ~ 09-08 14:59",
				event: "嗯呢大派送(周年)/咔滋酥脆/恰浪花",
				eventDates: "08-19 ~ 09-08",
				next: "3.2≈09-09（克拉蕾/洛克茜）",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/64",
				source: "Bwiki",
				url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2",
				eventUrl: ""
			},
			{
				id: "wuwa",
				name: "鸣潮",
				version: "3.6「蜃云灯影，凡尘剑心」",
				banner: "一期：清宵",
				bannerDates: "08-20 ~ 09-10",
				event: "版本主线+梦州探索",
				eventDates: "08-20 ~ 09-30",
				next: "二期 09-10~09-29；3.7≈10-01",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				source: "Bwiki",
				url: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2",
				eventUrl: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2",
				// 独立活动源显示名（设置页"活动来源"下拉默认项）
				eventLabel: "Bwiki 活动日历"
			},
			{
				id: "arknights",
				name: "明日方舟",
				version: "2026夏活(已收官)",
				banner: "常驻标准寻访：提丰/引星棘刺",
				bannerDates: "08-27 04:00 ~ 09-10 03:59",
				event: "「墟」复刻 / 奇象巡展",
				eventDates: "墟 08-22 ~ 09-05",
				next: "P3R联动 09-04（结束日未发布）",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				source: "PRTS Wiki",
				url: "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventUrl: ""
			},
			{
				id: "endfield",
				name: "明日方舟：终末地",
				version: "1.4「向渊行」（正式服）",
				banner: "晨星于此闪耀：梨诺",
				bannerDates: "08-09 12:00 ~ 09-02",
				event: "明耀晨星签到 / 泉流无声",
				eventDates: "随 1.4 版本",
				next: "1.5 09-02~10-15；重构寻访#1(伊冯) 09-24",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f1/ArknightsEndfieldAppIcon.png!/fw/64",
				source: "GachaTracker",
				url: "https://gachatracker.app/games/endfield/banners/",
				// 备选来源（设置页下拉可切换；值带 proxy: 前缀表示经 host 代理抓取，fetcher 指定对应抓取器）
				altSources: [
					{
						label: "wiki.gg",
						// wiki.gg 校验 Referer，需经 host 代理（代理默认 Referer=目标 origin 满足要求）
						value: "proxy:https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
						fetcher: "endfield-wiki-gg"
					}
				],
				eventUrl: ""
			},
			{
				id: "ba-cn",
				name: "蔚蓝档案·国服",
				version: "Ver 3.0.2",
				banner: "三角复刻：莲华UP",
				bannerDates: "08-20 ~ 09-03 13:59",
				event: "获刻玛·重装甲",
				eventDates: "08-28 开启",
				next: "看 gamekee 千里眼",
				icon: "https://webcnstatic.yostar.net/ba_cn_web/prod/web/favicon.png?x-oss-process=image/resize,w_64",
				source: "\u5B98\u7F51",
				// 经 host 代理抓取（官网 CORS=null + 动态 SPA；维护说明一次产出卡池+活动，组合源）
				url: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				eventUrl: ""
			},
			{
				id: "ba-global",
				name: "蔚蓝档案·国际服",
				version: "Act 2「联邦学生会篇」",
				banner: "FOX小队：妮可+库玛",
				bannerDates: "08-18 11:00 ~ 09-01 10:59",
				event: "Lore Pursuit",
				eventDates: "随 Act2 08-18/20",
				next: "Sumire/Rei复刻 09-01~09-08",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				source: "Nexon \u5B98\u65B9\u8BBA\u575B",
				// 经 host 代理抓取（nexon CORS 只允许同源，浏览器直连会被拦）；
				// 数据源为「更新日誌」board(3352)，一次请求同时含当期卡池与活动排期（组合源）
				url: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				// 备选来源：GameKee（中文标题，标题含排期；默认仍是 Nexon 官方更新日誌）
				altSources: [
					{ label: "GameKee", value: "gk-global:", fetcher: "ba-global-gamekee" }
				],
				eventUrl: ""
			},
			{
				id: "ba-jp",
				name: "蔚蓝档案·日服",
				version: "",
				banner: "",
				bannerDates: "",
				event: "",
				eventDates: "",
				next: "GameKee \u4E09\u56FD\u670D\u5148\u884C\u770B\u7248",
				icon: "https://play-lh.googleusercontent.com/H975s6W1-boCSogzpF5_rIyawbjiXfG842ncgjIRiVGzhXHFTCVut0DkBhlDR4CgN1nn98OOC1fWN-LE7kUHnQ=s64",
				source: "GameKee",
				// 经 host 代理抓取（GameKee 需 game-alias 头 + CDN 反爬，浏览器直连不可行；组合源）
				url: "https://www.gamekee.com/ba/huodong/15",
				eventUrl: ""
			},
			{
				id: "r1999",
				name: "重返未来：1999",
				version: "3.9「重燃！流金之海」",
				banner: "赫多涅UP",
				bannerDates: "08-13 10:00 ~ 09-03 04:59",
				event: "凡人或英雄/小黄鸭联动",
				eventDates: "08-13 起",
				next: "纳西索斯 09-03 起；4.0≈09-23后",
				icon: "https://play-lh.googleusercontent.com/LwcueZMBbLq6aELtqJVn61ToKkJUgxEO8O4KgK_5052hfYoDAglQJIzqSu8srUJeaOZwv36Qi5YKtsXZjo-JPg=s64",
				source: "官网",
				// 经 host 代理 POST 抓取（官网新闻 API；最新版本维护公告一次产出卡池+活动，组合源）
				url: "https://re.bluepoch.com/activity/official/websites/information/query",
				eventUrl: ""
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
				const verM = body.match(/<th[^>]*>\s*版本\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				const charM = body.match(/<th[^>]*>\s*(?:5星角色|S级代理人|6星干员|5星干员)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				if (!timeM) continue;
				const range = parseRange(timeM[1]);
				out.push({
					banner,
					version: verM ? stripTags(verM[1]) : "",
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}

		// 方舟：解析「限时寻访」表所有数据行
		function parseArknights(html) {
			const i = html.indexOf("限时寻访");
			if (i < 0) return [];
			const seg = html.slice(i);
			const tableM = seg.match(/<table[^>]*>([\s\S]*?)<\/table>/);
			if (!tableM) return [];
			const body = tableM[1];
			const out = [];
			for (const rm of body.matchAll(/<tr>([\s\S]*?<td[\s\S]*?)<\/tr>/g)) {
				const row = rm[1];
				const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
				if (tds.length < 2) continue;
				const banner = stripTags(tds[0]);
				const roles = tds.length > 2
					? [...tds[2].matchAll(/<a[^>]*href="\/w\/[^"]*"[^>]*title="([^"]*)"/g)]
						.map((m) => m[1].trim())
						.filter(Boolean)
						.join("、")
					: "";
				const range = parseRange(tds[1]);
				out.push({ banner, version: "限时寻访", roles, ...range, isMain: true });
			}
			return out;
		}

		// 选当期：优先"起始明确且覆盖 now"的主池；
		// 其次"起始未知（版本更新后）但结束在未来"的主池（星铁/zzz 上半）；
		// 同期多张主池（如 104期+104-2期）合并角色。返回 null 时调用方回退内置数据。
		function selectCurrent(items, now) {
			const exact = items.filter((it) => it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			const loose = items.filter((it) => it.startTs == null && it.endTs != null && it.endTs >= now);
			const pool = (exact.length > 0 ? exact : loose).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			const first = pool[0];
			const sameRange = pool.filter((it) => it.startTs === first.startTs && it.endTs === first.endTs);
			const roles = [...new Set(sameRange.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				version: first.version,
				roles,
				bannerDates: first.raw
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
				version: "",
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
			return { banner: cur.banner, version: "", roles: "", bannerDates: cur.bannerDates };
		}

		// 终末地（wiki.gg）：Headhunting/Banners 页 Current 分节 → 当期卡池
		// 注意：wiki.gg 校验 Referer 头（非 wiki.gg 域名的 Referer 返回 403），浏览器跨域 fetch 必带
		// 指向本应用的 Referer → 被反爬拦截，实际刷新会失败并回退内置数据；解析器保留以备后续方案。
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
				version: "",
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
				version: "",
				roles: cur.roles,
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
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
			const rows = [...content.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
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
				version: "",
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
				data.event = `${eventRow.cat}：${eventRow.name}`;
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
			const data = { version: "", banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
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
			let bannerDates = "";
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const start = fmt(mo, d, Number(maintM[3]), Number(maintM[4]));
				// 结束：约 14 天后（下一期维护）
				const end = new Date(nowYear, mo - 1, d + 14, 13, 59);
				bannerDates = `${start} ~ ${fmt(end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`;
			}
			const data = {
				version: "",
				banner: bannerM ? bannerM[1] : (bannerR ? `复刻·${bannerR[1]}` : ""),
				roles: "",
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates: bannerDates
			};
			if (!data.banner) return null;
			return data;
		}

		// 重返未来：1999（官网 re.bluepoch.com 新闻 API，POST 经 host 代理）
		// 列表接口（informationType=2 资讯）按上线时间倒序返回含全文的公告，
		// 取最新一期「版本更新维护公告」：版本名 / 当期卡池（首位6星UP）/ 当期活动 / 维护起止 + 下一期维护日
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
			// 版本名：标题 "3.9「重燃！流金之海」版本更新维护公告"
			const verM = String(maint.title).match(/(\d+\.\d+「[^」]+」)/);
			// 当期卡池：新增角色首位 6 星（"6星角色「赫多涅（岩）」" → "赫多涅UP"）
			const roleM = text.match(/6星角色「([^」]+)」/);
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
				version: verM ? verM[1] : "",
				banner: roleM ? `${cleanRoles(roleM[1]).replace(/[（）()].*$/, "")}UP` : "",
				roles: "",
				bannerDates,
				event: eventName,
				eventDates: bannerDates
			};
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// ---- 统一来源注册表 ----
		// 每个条目的 卡池/活动 两个字段各有独立来源，契约如下：
		// - CARD_FETCHERS[id]：卡池字段抓取器（async (url, signal) → 数据对象 | null），
		//   数据对象形如 {version?, banner, roles?, bannerDates, event?, eventDates?}；
		//   组合源（COMBINED_IDS 中的条目）一次抓取同时产出 event/eventDates。
		// - EVENT_FETCHERS[id]：独立活动源抓取器（async (url, signal) → {event, eventDates} | null），
		//   只在条目配置了 eventUrl 时抓取；无独立活动源的条目活动数据跟随卡池源或保持内置。
		// - altSources[].fetcher：备选源的抓取器键名（与 CARD_FETCHERS 对齐），
		//   设置页选择备选源后按此路由（兼容旧配置存储的 proxy:/gk-global: 值）。
		const CARD_FETCHERS = {
			genshin: mkMediaWiki(pickCurrent(parseAllBwiki)),
			hsr: mkMediaWiki(pickCurrent(parseAllBwiki)),
			zzz: mkMediaWiki(pickCurrent(parseAllBwiki)),
			arknights: mkMediaWiki(pickCurrent(parseArknights)),
			wuwa: mkMediaWiki(parseWuwaPool),
			endfield: mkRaw(parseGachaTracker),
			"endfield-wiki-gg": mkProxy((url, signal) => fetchEndfieldWikiGg(url)),
			"ba-cn": mkProxy((url, signal) => fetchBaCn(url)),
			"ba-global": mkProxy((url, signal) => fetchBaGlobal(url, signal)),
			"ba-global-gamekee": mkProxy(() => fetchGameKeeBa("global")),
			"ba-jp": mkProxy(() => fetchGameKeeBa("jp")),
			"r1999": mkProxy((url, signal) => fetchR99(url, signal))
		};
		const EVENT_FETCHERS = {
			// 鸣潮：活动日历页（独立 eventUrl 源）
			wuwa: mkMediaWiki((html) => {
				const d = parseWuwaCalendar(html);
				return d ? { event: d.banner, eventDates: d.bannerDates || "" } : null;
			})
		};
		// 组合源：活动与卡池同源产出（蔚蓝三服 + 重返未来官网公告），设置页活动来源标注"跟随卡池来源"
		const COMBINED_IDS = new Set(["ba-cn", "ba-global", "ba-jp", "r1999"]);

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
		//#endregion

		//#region refresh
		// 抓取单个条目：卡池字段与活动字段分别由各自来源产出（见"统一来源注册表"契约）
		async function fetchEntry(source, signal) {
			// 无任何来源的条目（如重返未来·纯内置数据）：不参与抓取，也不算失败
			if (!source.url && !source.eventUrl) return { ok: true, reason: "builtin" };
			try {
				const cardFetcher = cardFetcherFor(source, source.url);
				let data = null;
				// —— 卡池字段：有解析器 → 抓取解析；无解析器（自定义条目）→ 仅健康检查 ——
				if (source.url) {
					if (cardFetcher) {
						// 组合源（蔚蓝三服）抓取结果自带 event/eventDates，活动字段随卡池源产出
						data = await cardFetcher(source.url, signal);
						if (!data || !data.banner || !data.bannerDates) return { ok: false, reason: "no-match" };
					} else {
						// 无解析器的自定义条目：自定义地址仅做健康检查，HTTP 200 即联网成功
						const apiUrl = source.url + (source.url.includes("?") ? "&" : "?") + "origin=*";
						const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
						if (!res.ok) return { ok: false, reason: "http-" + res.status };
						return { ok: true, reason: "reachable" };
					}
				}
				// —— 活动字段：仅当条目有独立活动源（EVENT_FETCHERS）且配置了 eventUrl 时单独抓取 ——
				const eventFetcher = EVENT_FETCHERS[source.id];
				if (source.eventUrl && eventFetcher) {
					try {
						const ev = await eventFetcher(source.eventUrl, signal);
						if (ev && ev.event) {
							data = data || {};
							data.event = ev.event;
							data.eventDates = ev.eventDates || "";
						} else {
							data = data || {};
							data.eventFail = "no-match";
						}
					} catch (err) {
						// 活动源失败不影响卡池结果，但记录原因供面板提示
						data = data || {};
						data.eventFail = err?.name === "AbortError" ? "aborted" : String(err?.message ?? err).slice(0, 60);
					}
				}
				if (!data) {
					// 无卡池源但配了活动源：仅验证可达，不解析内容
					if (source.eventUrl) {
						try {
							const apiUrl = source.eventUrl + (source.eventUrl.includes("?") ? "&" : "?") + "origin=*";
							const res = await fetch(apiUrl, { signal, headers: { Accept: "application/json" } });
							return res.ok ? { ok: true, reason: "event-ok" } : { ok: false, reason: "event-http-" + res.status };
						} catch (err) {
							return { ok: false, reason: err?.name === "AbortError" ? "aborted" : String(err?.message ?? err) };
						}
					}
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
					version: c.version || "",
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

		// 默认爬取源显示名（设置页下拉默认项）
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		// 卡池源：内置条目用 source 字段，否则域名/内置数据
		// 活动源：组合源 → "跟随卡池来源"；独立活动源 → eventLabel/域名；无 → "内置数据"
		function getDefaultSourceName(g, urlField) {
			const isEvent = urlField === "eventUrl";
			const u = isEvent ? g.eventUrl : g.url;
			if (isEvent) {
				if (COMBINED_IDS.has(g.id)) return "跟随卡池来源";
				if (EVENT_FETCHERS[g.id] && g.eventLabel && g.eventLabel.trim() !== "") return g.eventLabel.trim();
				if (u && u.trim() !== "") {
					try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
				}
				return "内置数据";
			}
			if (g.source && g.source.trim() !== "") return g.source.trim();
			if (u && u.trim() !== "") {
				try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
			}
			return "内置数据";
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
			return t === null ? raw : `\u8FD8\u5269 ${t}`;
		}
		//#endregion
		//#endregion

		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:6px;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;font-size:12px;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-pop{position:fixed;z-index:9999;width:560px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			.gacha-cal-refresh{padding:2px 10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 128px 1fr 108px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			.gacha-cal-h{display:grid;grid-template-columns:22px 96px 1fr 128px 1fr 108px;gap:6px;align-items:center;padding:6px 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
			.gacha-cal-h span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池/活动列
			const visible = getVisibleEntries(s);
			const games = applyOrder(visible, s.order).map((g) => {
				const sc = scrapedById[g.id];
				if (!sc) return g;
				return {
					...g,
					version: sc.version || g.version,
					// 卡池名与角色名分开保留：卡池列外显角色名、悬停显示卡池全名
					banner: sc.banner || g.banner,
					roles: sc.roles || g.roles || "",
					bannerDates: sc.bannerDates || g.bannerDates,
					event: sc.event || g.event,
					eventDates: sc.eventDates || g.eventDates
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
					const dataById = {};
					result.results.forEach((r, i) => {
						if (r.ok && r.data) dataById[entries[i].id] = r.data;
					});
					await scope.set("lastData", JSON.stringify(dataById));
					await scope.set("lastRefresh", result.at);
					await scope.set("lastSource", result.status === "ok" ? "web" : "builtin");
					// 抓取详情（成功数 + 内置免抓取 + 失败游戏 + 活动源失败提示），供面板顶部展示
					const okNames = entries.filter((x, i) => result.results[i]?.ok && result.results[i]?.reason !== "builtin").map((x) => x.name);
					const builtinCount = entries.filter((x, i) => result.results[i]?.reason === "builtin").length;
					const builtinNote = builtinCount > 0 ? `（内置 ${builtinCount} 个）` : "";
					const eventFails = result.results
						.map((r, i) => r.ok && r.data?.eventFail ? `${entries[i].name}(活动:${r.data.eventFail})` : "")
						.filter(Boolean);
					let info = result.failed.length === 0
						? `抓取成功 ${okNames.length}/${result.total}${builtinNote}：${okNames.join("、")}`
						: `抓取成功 ${okNames.length}/${result.total}${builtinNote}；失败：${result.failed.join("、")}`;
					if (eventFails.length > 0) info += `；${eventFails.join("、")}`;
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
			const dataStatus = s.lastSource === "web" ? "\u8054\u7F51\u6570\u636E" : s.lastSource === "builtin" ? "\u5185\u7F6E\u6570\u636E" : "\u2014";
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
							(0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\uD83D\uDCC5" }),
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
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", disabled: refreshing, onClick: doRefresh, children: refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u8BBE\u7F6E\u8BF7\u5230\u8BBE\u7F6E\u9875" })
							] }),
							scrapeInfo ? (0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-meta", style: { marginBottom: 6 }, children: scrapeInfo }) : null,
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-h", children: [
								(0, react_jsx_runtime.jsx)("span", {}),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u5361\u6C60" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5361\u6C60\u8D77\u6B62" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u6D3B\u52A8" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6D3B\u52A8\u8D77\u6B62" })
							] }),
							games.map((g) => {
								// 卡池列：外显角色名称（无角色名时显示卡池名），悬停弹出卡池全名+角色
								const cardVisible = g.roles ? g.roles.replace(/[「」【】]/g, "") : g.banner;
								const cardTitle = g.roles ? `${g.banner}·${g.roles}` : g.banner;
								// 活动列：外显活动名称，悬停弹出活动全名+起止
								const eventTitle = g.event
									? (g.eventDates ? `${g.event}\n${g.eventDates}` : g.event)
									: (g.eventDates || "");
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									children: [
										(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: g.name, children: g.name }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: cardTitle, children: cardVisible }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.bannerDates, children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates, now) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: eventTitle, children: g.event }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.eventDates, children: displayTimeCell(g.eventDates, now) })
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
			// 添加表单临时值
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", version: "", banner: "", bannerDates: "", event: "", eventDates: "", url: "", eventUrl: "" });
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
			// 添加自定义条目
			const addEntry = async () => {
				if (!form.name.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					version: form.version.trim(),
					banner: form.banner.trim(),
					bannerDates: form.bannerDates.trim(),
					event: form.event.trim(),
					eventDates: form.eventDates.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", version: "", banner: "", bannerDates: "", event: "", eventDates: "", url: "", eventUrl: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

			const inputStyle = { padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12 };
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
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制面板是否显示；「↑↓」调整顺序；「自定义」可覆盖卡池来源地址；活动来源仅独立活动源条目（鸣潮）可自定义；删除后可恢复默认。" }),
						// 表头行（与数据行同 grid 列）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "end" }, children: "\u64CD\u4F5C" })
						] }),
						sorted.map((g, i) => {
							const mode = entryUrlMode(g.id, g);
							const evMode = eventUrlMode(g.id);
							// 活动来源性质：independent（独立活动源，可自定义）/ combined（与卡池同源）/ none（无，内置数据）
							const evKind = g.custom
								? (EVENT_FETCHERS[g.id] || g.eventUrl ? "independent" : "none")
								: (EVENT_FETCHERS[g.id] ? "independent" : (COMBINED_IDS.has(g.id) ? "combined" : "none"));
							return (0, react_jsx_runtime.jsxs)("div", {
								style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								key: g.id,
								children: [
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
										(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, style: { width: 22, height: 22, borderRadius: 5, objectFit: "cover", flex: "none" } }),
										(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, title: g.name, children: g.name })
									] }),
									(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
										(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !hidden.includes(g.id), onChange: () => toggleHidden(g.id) }),
										(0, react_jsx_runtime.jsx)("span", { children: "\u5C55\u793A" })
									] }),
									// 卡池来源列
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, justifySelf: "center", minWidth: 0 }, children: [
										(0, react_jsx_runtime.jsxs)("select", {
											value: mode,
											style: inputStyle,
											onChange: (e) => setUrlMode(g.id, e.target.value, g),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
												(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: a.value, children: a.label }, a.label)),
												(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
											]
										}),
										mode === "custom" ? (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											placeholder: "MediaWiki api.php URL",
											value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
											onChange: (e) => setCustomUrl(g.id, e.target.value),
											style: { ...inputStyle, flex: "1 1 120px", minWidth: 90 }
										}) : null
									] }),
									// 活动来源列（仅独立活动源可自定义；组合源/内置数据只读展示）
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, justifySelf: "center", minWidth: 0 }, children: [
										evKind === "independent" ? (0, react_jsx_runtime.jsxs)("select", {
											value: evMode,
											style: inputStyle,
											onChange: (e) => setEventUrlMode(g.id, e.target.value),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
												(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
											]
										}) : (0, react_jsx_runtime.jsx)("span", { title: evKind === "combined" ? "该游戏活动与卡池同源产出，无独立活动源" : "该游戏暂无独立活动源，活动列使用内置数据", style: { ...inputStyle, cursor: "default", color: "var(--dsw-alias-label-tertiary)" }, children: getDefaultSourceName(g, "eventUrl") }),
										evKind === "independent" && evMode === "custom" ? (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											placeholder: "MediaWiki api.php URL",
											value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? String(eventUrls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
											onChange: (e) => setCustomEventUrl(g.id, e.target.value),
											style: { ...inputStyle, flex: "1 1 120px", minWidth: 90 }
										}) : null
									] }),
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "end" }, children: [
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
							});
						}),
						adding ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginTop: 6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u540D\u79F0 *", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 120px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u7248\u672C", value: form.version, onChange: updateForm("version"), style: { ...inputStyle, flex: "1 1 100px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u56FE\u6807 URL", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 200px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5F53\u524D\u5361\u6C60", value: form.banner, onChange: updateForm("banner"), style: { ...inputStyle, flex: "1 1 160px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5361\u6C60\u8D77\u6B62", value: form.bannerDates, onChange: updateForm("bannerDates"), style: { ...inputStyle, flex: "1 1 160px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5F53\u524D\u6D3B\u52A8", value: form.event, onChange: updateForm("event"), style: { ...inputStyle, flex: "1 1 160px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u6D3B\u52A8\u8D77\u6B62", value: form.eventDates, onChange: updateForm("eventDates"), style: { ...inputStyle, flex: "1 1 160px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5361\u6C60\u6765\u6E90 (MediaWiki api.php, \u53EF\u9009)", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 240px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u6D3B\u52A8\u6765\u6E90 (MediaWiki api.php, \u53EF\u9009)", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u6570\u636E\u6765\u6E90\uFF1A\u5B98\u65B9\u516C\u544A / \u5B98\u65B9Wiki\uFF08bwiki\u3001PRTS \u7B49\uFF09\uFF1B\u6293\u53D6\u5931\u8D25\u65F6\u56DE\u9000\u5185\u7F6E\u6570\u636E\u3002\u81EA\u5B9A\u4E49\u6761\u76EE\u53EA\u5C55\u793A\u4F60\u586B\u5199\u7684\u5185\u5BB9\uFF0C\u6709\u722C\u53D6\u5730\u5740\u65F6\u4EC5\u4F5C\u8FDE\u7F51\u68C0\u67E5\u3002" })
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
