// src/client/30-game-bluepoch.js —— 深蓝互动（重返未来：1999）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

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

		const R1999_NOTICE_URL = "https://notice.sl916.com/noticecp/client/query?gameId=50001&channelId=100&subChannelId=1009&serverType=4";


		const R1999_OFFICIAL_URL = "https://re.bluepoch.com/activity/official/websites/information/query";


		// ── 条目 ──
		registerSource({
				id: "r1999",
				defaultHidden: false,
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
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["r1999"] = (url, signal, tz) => fetchR99(url, signal, tz);
					// 重返未来1999 备选：官网公告（只有维护时间与活动名，无逐期征集时间）
GACHA_FETCHERS["r1999-official"] = (url, signal, tz) => fetchR99Official(url, signal, tz);
					// 重返未来：默认与卡池同 URL（同一篇「版本活动一览」同时含征集与活动）；
			// 备选＝官网公告（只有维护时间与活动名）
EVENT_FETCHERS["r1999"] = {
				default: (url, signal, tz) => fetchR99(url, signal, tz),
				"r1999-official": (url, signal, tz) => fetchR99Official(url, signal, tz)
			};
