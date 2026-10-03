// src/client/30-game-hoyoverse.js —— 米哈游（原神 / 星穹铁道 / 绝区零）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

		// 「版本更新后」这类**只有日期没有时分**的写法，默认按当日该时刻折算。
		// 为什么需要一个默认值：源站常见 `2026/09/28 4.6版本更新后`（日期 + 版本标签的混合体），
		// 日期是明确的，缺的只是时分；不补的话 startTs 会是 null，外显只能回落源站原文
		// （星铁活动列一度显示成 `2026/09/28 4.6版本更新后 ~ 11-10 15:00`，与其它游戏的
		// `09-28 04:00 ~ 11-10 15:00` 口径不一致）。
		// 取 04:00 是因为国内二游版本更新普遍落在凌晨维护窗口（该表内 04:00 出现最多），
		// 拿它当锚点比"不补"更接近真实，也不会让"活动是否已开始"的判定偏移一天。
		const VERSION_UPDATE_ANCHOR = { h: 4, mi: 0 };


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

		const ZZZ_NEWS_LIST_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/706fd13a87294881/getContentList?iChanId=279&iPageSize=50&iPage=1&sLangKey=zh-cn";


		const ZZZ_BWIKI_URL = "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2";


		// ══ 以下为原 42-parsers-miyoushe.js 的内容（原样保留）══
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
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null
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
const ns_miyoushe_sleep = (ms) => new Promise((r) => coreEnv.timer.setTimeout(r, ms));

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
async function ns_miyoushe_gachaMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = nowMs()) {
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
async function ns_miyoushe_eventsMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = nowMs()) {
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

		// ── 条目 ──
		registerSource({
				id: "genshin",
				defaultHidden: false,
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
		});

		registerSource({
				id: "hsr",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 1,
				name: "崩坏：星穹铁道",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/64",
				source: "Bwiki \u5386\u53F2\u8DC3\u8FC1",
				url: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2",
				// 独立活动源：星铁活动一览（api.php 带 origin=* 可浏览器直连；「活动时间」表含当期活动）
				eventUrl: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
		});

		registerSource({
				id: "zzz",
				defaultHidden: false,
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
		});

		registerSource({
			id: "bh3",
				defaultHidden: true,
			tz: "Asia/Shanghai",
			name: "崩坏3",
			icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f4/BH3_icon.png!/fw/64",
			// 出厂默认不勾选展示（用户要求）：默认未配置时面板恒空，不该占版面
			// 默认**未配置**：不给 url / eventUrl
			source: "",
			eventSource: "",
			altSources: [{ label: "米游社公告", url: "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20", fetcher: "bh3-miyoushe" }],
			eventAltSources: [{ label: "米游社公告", url: "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20", fetcher: "bh3-miyoushe" }]
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["genshin"] = mkMediaWiki(bwikiGachaPayload);
		GACHA_FETCHERS["hsr"] = mkMediaWiki(bwikiGachaPayload);
		GACHA_FETCHERS["zzz"] = (url, signal, tz) => fetchZzzGacha(url, signal, tz);
		GACHA_FETCHERS["zzz-bwiki"] = mkMediaWiki(pickCurrent(parseAllBwiki));
					// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
EVENT_FETCHERS["genshin"] = {
				default: (url, signal, tz) => fetchYsActivity(signal, tz)
			};
					// 星铁：活动一览（静态「活动时间」表，api.php 可直连）→ 外显当期 + 悬停列出全部并行活动
EVENT_FETCHERS["hsr"] = {
				default: mkMediaWiki(genericEventPayload)
			};
					// 绝区零：默认=官方公告（api-takumi-static，与卡池侧同一接口；活动时间写在公告正文里，
			// 含"X.Y版本更新后/版本结束"的换算；结束时间未知的活动保留并沉底）→ 备选=Bwiki 活动一览
EVENT_FETCHERS["zzz"] = {
				default: (url, signal, tz) => fetchZzzEventsOfficial(url, signal, tz),
				"zzz-event-bwiki": mkMediaWiki(genericEventPayload)
			};

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
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
