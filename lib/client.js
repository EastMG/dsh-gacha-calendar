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
				eventUrl: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2"
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
				source: "wiki.gg",
				url: "https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
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
				source: "",
				url: "",
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
				source: "",
				url: "",
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
				source: "",
				url: "",
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

		// 各游戏解析器（无 url 的游戏无解析器 → 保持内置数据）
		const PARSERS = {
			genshin: (html) => selectCurrent(parseAllBwiki(html), Date.now()),
			hsr: (html) => selectCurrent(parseAllBwiki(html), Date.now()),
			zzz: (html) => selectCurrent(parseAllBwiki(html), Date.now()),
			arknights: (html) => selectCurrent(parseArknights(html), Date.now()),
			wuwa: (html) => parseWuwaPool(html),
			endfield: (html) => parseEndfieldCurrent(html)
		};
		// 活动源解析器：eventUrl 抓取的页面用（如鸣潮活动日历 → event/eventDates）
		const EVENT_PARSERS = {
			wuwa: parseWuwaCalendar
		};
		//#endregion

		//#region refresh
		async function fetchGame(source, signal) {
			const parser = PARSERS[source.id];
			const eventParser = EVENT_PARSERS[source.id];
			// 卡池源抓取（解析内容）
			if (source.url) {
				try {
					// MediaWiki 标准 CORS：加 origin=* 后服务器返回 Access-Control-Allow-Origin: *，
					// 否则浏览器跨域 fetch 会被拦截（此前联网刷新全部失败、回退内置数据）。
					const apiUrl = source.url + (source.url.includes("?") ? "&" : "?") + "origin=*";
					const res = await fetch(apiUrl, { signal, headers: { "Accept": "application/json" } });
					if (!res.ok) return { ok: false, reason: "http-" + res.status };
					// 无内置解析器的条目（自定义条目等）：自定义地址仅做健康检查，
					// HTTP 200 即算联网成功（内容仍用内置/用户填写数据），不硬性要求 MediaWiki JSON。
					if (typeof parser !== "function") {
						return { ok: true, reason: "reachable" };
					}
					const json = await res.json();
					const text = json?.parse?.text;
					if (typeof text !== "string") return { ok: false, reason: "bad-json" };
					const data = parser(text);
					if (!data || !data.banner || !data.bannerDates) return { ok: false, reason: "no-match" };
					// 活动源：若有活动源解析器且配置了 eventUrl，抓取并合并 event/eventDates
					if (typeof eventParser === "function" && source.eventUrl) {
						try {
							const eApi = source.eventUrl + (source.eventUrl.includes("?") ? "&" : "?") + "origin=*";
							const eRes = await fetch(eApi, { signal, headers: { "Accept": "application/json" } });
							if (eRes.ok) {
								const eJson = await eRes.json();
								const eText = eJson?.parse?.text;
								if (typeof eText === "string") {
									const eData = eventParser(eText);
									if (eData && eData.banner) {
										data.event = eData.banner;
										data.eventDates = eData.bannerDates || "";
									} else {
										data.eventFail = "no-match";
									}
								} else {
									data.eventFail = "bad-json";
								}
							} else {
								data.eventFail = "http-" + eRes.status;
							}
						} catch (err) {
							// 活动源失败不影响卡池结果，但记录原因供面板提示
							data.eventFail = err?.name === "AbortError" ? "aborted" : String(err?.message ?? err).slice(0, 60);
						}
					}
					return { ok: true, reason: "ok", data };
				} catch (err) {
					if (err?.name !== "AbortError") return { ok: false, reason: String(err?.message ?? err) };
					return { ok: false, reason: "aborted" };
				}
			}
			// 卡池源为空时：活动源健康检查（仅验证可达，不解析内容）
			if (source.eventUrl) {
				try {
					const apiUrl = source.eventUrl + (source.eventUrl.includes("?") ? "&" : "?") + "origin=*";
					const res = await fetch(apiUrl, { signal, headers: { "Accept": "application/json" } });
					return res.ok ? { ok: true, reason: "event-ok" } : { ok: false, reason: "event-http-" + res.status };
				} catch (err) {
					return { ok: false, reason: err?.name === "AbortError" ? "aborted" : String(err?.message ?? err) };
				}
			}
			return { ok: false, reason: "no-source" };
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
			const results = await Promise.all(targets.map((t) => fetchGame(t, controller.signal)));
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

		// 默认爬取源显示名：内置条目用 source 字段；无 source 的显示"内置数据"；自定义条目显示其 url 域名
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		function getDefaultSourceName(g, urlField) {
			const isEvent = urlField === "eventUrl";
			const u = isEvent ? g.eventUrl : g.url;
			// 活动源默认名只看 eventUrl 本身（source 是卡池源名，不能借用到活动列）
			if (isEvent) {
				if (u && u.trim() !== "") {
					try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
				}
				return "\u5185\u7F6E\u6570\u636E";
			}
			if (g.source && g.source.trim() !== "") return g.source.trim();
			if (u && u.trim() !== "") {
				try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
			}
			return "\u5185\u7F6E\u6570\u636E";
		}

		// 可见条目 = 全部条目 - 隐藏条目
		function getVisibleEntries(s) {
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			return getAllEntries(s).filter((x) => !hidden.includes(x.id));
		}

		// 某条目的实际爬取地址：自定义覆盖默认；urlField 区分卡池源(customUrls)/活动源(customEventUrls)
		function getEntryUrl(s, id, fallbackUrl, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			return typeof u === "string" && u.trim() !== "" ? u.trim() : fallbackUrl;
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
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池列，活动列保持内置
			const visible = getVisibleEntries(s);
			const games = applyOrder(visible, s.order).map((g) => {
				const sc = scrapedById[g.id];
				if (!sc) return g;
				return {
					...g,
					version: sc.version || g.version,
					banner: sc.banner ? sc.banner + (sc.roles ? "\u00B7" + sc.roles : "") : g.banner,
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
					// 抓取详情（成功数 + 失败游戏 + 活动源失败提示），供面板顶部展示
					const okNames = entries.filter((x, i) => result.results[i]?.ok).map((x) => x.name);
					const eventFails = result.results
						.map((r, i) => r.ok && r.data?.eventFail ? `${entries[i].name}(\u6D3B\u52A8:${r.data.eventFail})` : "")
						.filter(Boolean);
					let info = result.failed.length === 0
						? `\u6293\u53D6\u6210\u529F ${okNames.length}/${result.total}：${okNames.join("、")}`
						: `\u6293\u53D6\u6210\u529F ${okNames.length}/${result.total}；\u5931\u8D25：${result.failed.join("、")}`;
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
							games.map((g) => (0, react_jsx_runtime.jsxs)("div", {
								className: "gacha-cal-row",
								key: g.id,
								children: [
									(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: g.name, children: g.name }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.banner, children: g.banner }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.bannerDates, children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates, now) }) }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.event, children: g.event }),
									(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: g.eventDates, children: displayTimeCell(g.eventDates, now) })
								]
							}))
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
				const idx = order.indexOf(id);
				const target = idx + delta;
				if (idx < 0 || target < 0 || target >= order.length) return;
				const next = order.slice();
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
			// 爬取地址：默认/自定义。模式由 customUrls 中是否存在该 id 的 key 决定
			// （值可能为空串：用户选了自定义但还没填 → 刷新时回退默认地址），
			// 不能用值非空判断，否则"自定义"会因空值跳回"默认"。
			const entryUrlMode = (id) => {
				const urls = parseJsonStr(s.customUrls, {});
				return urls && typeof urls === "object" && Object.prototype.hasOwnProperty.call(urls, id) ? "custom" : "default";
			};
			const setUrlMode = async (id, mode) => {
				const next = { ...(urls || {}) };
				if (mode === "custom") next[id] = customInputs[id] ?? "";
				else delete next[id];
				await commit("customUrls", JSON.stringify(next));
			};
			const setCustomUrl = async (id, value) => {
				setCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(urls || {}) };
				next[id] = value;
				await commit("customUrls", JSON.stringify(next));
			};
			// 活动来源地址：默认/自定义（存 customEventUrls），判定同上
			const eventUrls = parseJsonStr(s.customEventUrls, {});
			const eventUrlMode = (id) => {
				const eu = parseJsonStr(s.customEventUrls, {});
				return eu && typeof eu === "object" && Object.prototype.hasOwnProperty.call(eu, id) ? "custom" : "default";
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = eventCustomInputs[id] ?? "";
				else delete next[id];
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = value;
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
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "\u201C\u5C55\u793A\u201D\u63A7\u5236\u9762\u677F\u662F\u5426\u663E\u793A\uFF1B\u201C\u2191\u2193\u201D\u8C03\u6574\u987A\u5E8F\uFF1B\u201C\u81EA\u5B9A\u4E49\u201D\u53EF\u8986\u76D6\u5361\u6C60/\u6D3B\u52A8\u6765\u6E90\u5730\u5740\uFF1B\u5220\u9664\u540E\u53EF\u6062\u590D\u9ED8\u8BA4\u3002" }),
						// 表头行（与数据行同 grid 列）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "end" }, children: "\u64CD\u4F5C" })
						] }),
						sorted.map((g, i) => {
							const mode = entryUrlMode(g.id);
							const evMode = eventUrlMode(g.id);
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
											onChange: (e) => setUrlMode(g.id, e.target.value),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
												(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
											]
										}),
										mode === "custom" ? (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											placeholder: "MediaWiki api.php URL",
											value: customInputs[g.id] ?? (urls && typeof urls === "object" ? urls[g.id] : "") ?? "",
											onChange: (e) => setCustomUrl(g.id, e.target.value),
											style: { ...inputStyle, flex: "1 1 120px", minWidth: 90 }
										}) : null
									] }),
									// 活动来源列
									(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, justifySelf: "center", minWidth: 0 }, children: [
										(0, react_jsx_runtime.jsxs)("select", {
											value: evMode,
											style: inputStyle,
											onChange: (e) => setEventUrlMode(g.id, e.target.value),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
												(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
											]
										}),
										evMode === "custom" ? (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											placeholder: "MediaWiki api.php URL",
											value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? eventUrls[g.id] : "") ?? "",
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
