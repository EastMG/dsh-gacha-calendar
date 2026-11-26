// src/client/30-game-sega.js —— 世嘉（初音未来：缤纷舞台）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-sekai.js 的内容（原样保留；压平后见 30-game-sega.js）══
// 原 src/client/35-parsers-sekai.js（压平后见 30-game-sega.js）
//
// 由 next-sources/parsers/sekai.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_sekai__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-sekai.js（压平后见 30-game-sega.js） —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
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


const ns_sekai_DEFAULT_GACHA = "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-cn-diff/main/gachas.json";
const ns_sekai_DEFAULT_EVENT = "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-cn-diff/main/events.json";

// ── 探头/并列条短名（2026-11-26 names-B1，**只给数组条目的 `show`，title 与悬停不动**）──
// 源站 `gachas.json` 只有 `name`（没有角色/池型字段），但三服池名有**稳定词法结构**：
//   `[标签] 核心名 + [体裁词]`
//   · 体裁词 = 末尾的 `招募` / `Step-up招募` / `Step-up 뽑기` / `티켓 뽑기` / `뽑기`（= 抽卡/票券抽取），
//     与日服的 `ガシャ` 是同一类体裁词（中/繁/韩三服各自的写法）—— **一定剥**；
//   · 行首 `[...]` 标签分两种，**只剥类别标签**（栏目/批次标记：`[复刻]` / `[新手应援]` /
//     `[邀請朋友]` / `[4.5주년 기념]` …，同一标签会在多口池上重复出现）；
//     **内容标签保留**（角色名 / 曲名 / 主题：`[桐谷遥]` / `[Little Maverick]` / `[侦探]` /
//     `[感谢有你的「世界」]`）—— 它们就是这口池的身份，剥掉会让多口池变成同一行。
//     类别词表**只收真机 + 夹具里出现过的**（`TAG_CATEGORY_RE`，见下），没见过的标签默认**保留**
//     （宁可少缩短，也不猜着删名字）。
// 实测（2026-11-26 活网）：pjsk 并列条 18 条最长 24 字 / pjsk-tc 23 条最长 26 / pjsk-kr 28 条最长 33。
// **不做字数截断**：剥完不足 3 码点就放弃该步（都放弃 ⇒ 返回 ""，调用方退回 title 原文）。
// 长尾优先（`Step-up招募` 先于 `招募`），否则会剥出悬挂的 `Step-up`。
const ns_sekai_POOL_TAG_RE = /^\s*[\[［【]\s*([^\]］】]{1,40}?)\s*[\]］】]\s*/u;
const ns_sekai_POOL_TAG_LONE_RE = /^[\[［【]\s*([^\]］】]{1,40}?)\s*[\]］】]$/u;
// 类别标签词表（证据：2026-11-26 活网 + 2026-10-02 夹具里**实际出现**的标签，逐个归类）。
// 周年类是开区间（`1.5周年纪念` / `4.5주년 기념`），用两个数值模式覆盖，不枚举年份。
const ns_sekai_POOL_TAG_CATEGORY_RE =
	/^(?:复刻|復刻|재등장|新手应援|新手應援|초보자 응원|초보자 한정|邀请朋友|邀請朋友|친구 초대|欢迎回来|歡迎回來|복귀를 환영합니다|新手限定|세카이|\d+(?:\.\d+)?周年纪念|\d+(?:\.\d+)?주년 기념)$/u;
const ns_sekai_POOL_TAIL_WORDS = [
	"Step-up招募", "Step-up 招募", "Step-up뽑기", "Step-up 뽑기",
	"티켓 뽑기", "招募", "뽑기"
].sort((a, b) => b.length - a.length);
function ns_sekai_poolShortOf(name) {
	const orig = typeof name === "string" ? name.trim() : "";
	if (!orig) return "";
	let s = orig;
	// ① 体裁词（可反复：`[Little Maverick]Step-up招募` ⇒ `[Little Maverick]`）
	for (;;) {
		const hit = ns_sekai_POOL_TAIL_WORDS.find((t) => s.length > t.length && s.endsWith(t));
		if (!hit) break;
		const next = s.slice(0, s.length - hit.length).replace(/[\s\u3000]+$/u, "");
		if ([...next].length < 3) break;
		s = next;
	}
	// ② 行首标签：**类别**且剥完仍 ≥3 码点 ⇒ 剥；整串只剩一个标签 ⇒ 取标签内文（`[]` 是记号，
	//    里面的才是名字）；**内容**标签（角色名/曲名/主题）原样保留、不取内文（去掉方括号会丢辨识度）。
	for (;;) {
		const m = ns_sekai_POOL_TAG_RE.exec(s);
		if (!m) break;
		const content = m[1].trim();
		const next = s.slice(m[0].length).trim();
		if (ns_sekai_POOL_TAG_CATEGORY_RE.test(content) && [...next].length >= 3) { s = next; continue; }
		// 整串只剩**一个**标签（`[Little Maverick]` / `[4.5주년 기념]`）⇒ 取标签内文：
		// `[]` 只是记号，里面的才是名字（与「从『』取真正的名字」同一口径）。
		const lone = ns_sekai_POOL_TAG_LONE_RE.exec(s);
		if (lone) {
			const inner = lone[1].trim();
			if ([...inner].length >= 3) s = inner;
		}
		break;
	}
	return s !== orig ? s : "";
}

// ⚠️ 2026-10-03 收敛：本文件原有 `toTs`（**严格版**：只接受 number，数字字符串返回 null）
//    与 `byNewestStart`（与 bestdori 那份逐字相同）。均已统一到 `27-parser-text.js` 的
//    `numOrNull` / `byNewestStart`。取宽容版对本源无影响（`gachas.json`/`events.json` 里都是数字），
//    但若源站哪天改成字符串就能直接吃下，不必再改代码。

// ── 卡池侧 ──
// 覆盖当前时刻的池里取 startTs 最新的一期当"当期招募"。
// 2026-11-11 用户拍板：**不再判断"长期池"**（旧的 120 天阈值已删）—— 窗口多长只看是否覆盖 now。
function ns_sekai_parseSekaiGachas(json, now = nowMs(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = numOrNull(g.startAt), e = numOrNull(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => coversNow(x, now));
	const cur = active.slice().sort(byNewestStart)[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 悬停 = 全部当期池。每池一行池名 + 档期，窗口完全相同则
	// 档期只在末尾写一遍 —— 排版交给**条目反生成**（与本体 buildPoolHover 逐字一致）。
	// 源站没有角色名 → name 就用池名本身（对应本体的「池名：角色」里的池名位置）。
	// 池名里的「（ceil）」等后缀来自 `gachaType` 枚举，**不是源站原文** → 不进悬停；
	// 同名同窗的阶梯/高级礼物招募多条各自成行（源站如此，不再合并成 ×n）——
	// 数组侧由 `dataArrayExtrasFromEntriesOf` 的「归一后同名只留第一条」收口（与悬停逆解析同一判据）。
	// ── P3b：条目事实 → 悬停 + `gacha` 数组 ──────────────────────────────────
	// `show` = 这一口池的**短名**（`ns_sekai_poolShortOf`：剥类别标签 + 体裁词）；取不到就不写
	// ⇒ 显示退回原文。`title` / 悬停排版只读 title，逐字不变。
	const hoverItems = active
		.filter((p) => p.name)
		.sort(poolHoverOrderOf)
		.map((p) => {
			const it = { title: p.name, startTs: p.startTs, endTs: p.endTs, raw: "" };
			const show = ns_sekai_poolShortOf(p.name);
			if (show) it.show = show;
			return it;
		});
	const hover = hoverTextFromItems(hoverItems, "gacha", tz);
	// 只有 1 个当期池 → hover 为 ""，**不设 bannerHover**，由 UI 走默认两行式「banner ⏎ bannerDates」
	const out = {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
	// `extrasShowFromEntry`：并列条（探头里其余池）显示**各自**的短名；`title` 仍是源站原文
	// （与 FGO 日服 / 终末地同一套 opt-in，见 50-refresh.js 的说明）。
	out.gacha = dataArrayProducedGachaOf(out, hoverItems, { tz, extrasShowFromEntry: true }, now);
	out.gachaHoverItems = hoverItems;
	return out;
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
function ns_sekai_parseSekaiEvents(json, now = nowMs(), tz = "Asia/Shanghai") {
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
	// ── P3b：条目事实 → 悬停 + `events` 数组（顺序 = 上面的结束时间升序）──
	const eventItems = ordered.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: "" }));
	const hover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: cur.name,
		eventDates: dates,
		eventDatesRaw: raw,
		...(hover ? { eventHover: hover } : {})
	};
	// category / tags 批 1（2026-11-08）：`eventType` 早就读进 `rows` 的 `type`（`:131`），
	// 此前只用于排查、没进数组 ⇒ 按标题贴进 `events[]` 的 `category`。
	// ⚠️ 值是源站的**英文枚举原样**（`marathon` / `cheerful_carnival` / `world_bloom`），
	//    不翻译、不映射（映射是批 2 的事，见 README_Dev「category / tags 来源与现状」）。
	const facts = {};
	for (const x of ordered) if (x.type) facts[x.name] = { category: x.type };
	if (Object.keys(facts).length) out.itemFacts = facts;
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
async function ns_sekai_gachaSekai(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_GACHA, { signal, mode: "direct" });
	return ns_sekai_parseSekaiGachas(data, now, tz);
}
async function ns_sekai_eventsSekai(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_EVENT, { signal, mode: "direct" });
	return ns_sekai_parseSekaiEvents(data, now, tz);
}

		// ── 条目 ──
		registerSource({
				id: "pjsk",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "初音未来：缤纷舞台·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/00/5c/7c/005c7c99-d162-1dc9-2c38-f5e5a50619e1/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-cn-diff/main/gachas.json",
				// 站点名 + 资源名（对齐本体惯例：`Bwiki 往期祈愿` / `Bwiki 活动一览`）
				// 旧值写的是「第三方数据」——那是**类别**不是站点名，用户 2026-10-03 要求改成网站名称。
				source: "Sekai World 卡池表（代理）",
				eventUrl: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-cn-diff/main/events.json",
				eventSource: "Sekai World 活动表（代理）",
				// 2026-10-21 用户要求：默认走 **gh-proxy 加速**（电信成功率 74% → 99%+，itdog 320 节点实测），
				// 原先直连 GitHub Pages 的来源降级为备选（label 保留原名字）。
				// ⚠️ 加速器包的是 raw.githubusercontent 地址（包 Pages 地址会 404）；ACAO=* 故仍走 mode="direct"。
				altSources: [
					{
						label: "Sekai World 卡池表",
						url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
						fetcher: "pjsk"
					}
				],
				eventAltSources: [
					{
						label: "Sekai World 活动表",
						url: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
						fetcher: "default"
					}
				],
		});

		// ── 2026-11-14 新增：**繁中服 / 韩服**（与国服同源同形）──
		// 数据来自 Sekai-World 的 `sekai-master-db-tc-diff` / `-kr-diff`（与国服 `-cn-diff` 同一套
		// sekai-master-db 派生仓）：`gachas.json` 的 {id, gachaType, name, startAt, endAt} 与
		// `events.json` 的 {id, eventType, name, startAt, aggregateAt} **字段与形态逐字同构**，
		// 池名 / 活动名直接就是本地语言原文（繁中 / 韩文），不含简体或日文串。
		// ⇒ 解析器**复用**上面那套 `ns_sekai_*`（只换 URL 与 tz），`roles` 仍为空（与国服一致，不新造）。
		//
		// 时区依据（夹具自洽，2026-11-14 复核；epoch 毫秒 = 绝对时刻，tz 只影响墙钟渲染）：
		//   ① 生日池 856「[東雲彰人]HAPPY BIRTHDAY 2026招募」startAt=1794038400000
		//      → Asia/Taipei 渲染 **2026-11-08 00:00**（生日当天零点）；韩服同一个池 1794034800000
		//      → Asia/Seoul 同样渲染 **2026-11-08 00:00** —— 两个服的差 1 小时正是 UTC+8 / UTC+9 之差；
		//   ② 常规池轮换 859/860 落在**当地 12:00**（繁中 04:00Z / 韩 03:00Z）；
		//   ③ 活动 185 起于**当地 15:00**（繁中 07:00Z / 韩 06:00Z）—— 与国服同一条排期口径。
		//
		// 入口实测（2026-11-14，HEAD；三个候选全部 **200 + `Access-Control-Allow-Origin: *`**）：
		//   · `https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main/gachas.json`  200
		//   · `https://gh-proxy.com/<同上 raw 地址>`                                                     200
		//   · `https://sekai-world.github.io/sekai-master-db-tc-diff/gachas.json`                       200（Pages 版**存在**）
		//   韩服三条同结论（gachas 4,245,811 / events 1,435,245 字节；繁中 gachas 4,443,816 / events 1,480,360）。
		// 主源仍按**国服惯例**走 `gh-proxy` 包 raw（电信成功率更高），Pages 版降为 alt；
		// 4MB+ 的文件**只挂一个主源**（不对同一个大文件发两遍请求，也不把 raw 单独列成第二个主源）。
		// ⚠️ 这两个域名（gh-proxy.com / sekai-world.github.io）本来就在 tools/check-host-allow.mjs 的
		//    DIRECT_HOSTS 里（直连 + ACAO 证据），本次**没有新增任何直连域名**。
		registerSource({
				id: "pjsk-tc",
				defaultHidden: false,
				tz: "Asia/Taipei",
				name: "初音未来：缤纷舞台·繁中服",
				// 图标与国服同款：同一作品的品牌图标（区服差异不体现在图标上）
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/00/5c/7c/005c7c99-d162-1dc9-2c38-f5e5a50619e1/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main/gachas.json",
				source: "Sekai World 卡池表（代理）",
				eventUrl: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main/events.json",
				eventSource: "Sekai World 活动表（代理）",
				altSources: [
					{
						label: "Sekai World 卡池表",
						url: "https://sekai-world.github.io/sekai-master-db-tc-diff/gachas.json",
						fetcher: "pjsk-tc"
					}
				],
				eventAltSources: [
					{
						label: "Sekai World 活动表",
						url: "https://sekai-world.github.io/sekai-master-db-tc-diff/events.json",
						fetcher: "default"
					}
				],
		});
		registerSource({
				id: "pjsk-kr",
				defaultHidden: false,
				tz: "Asia/Seoul",
				name: "初音未来：缤纷舞台·韩服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/00/5c/7c/005c7c99-d162-1dc9-2c38-f5e5a50619e1/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-kr-diff/main/gachas.json",
				source: "Sekai World 卡池表（韩文 · 代理）",
				eventUrl: "https://gh-proxy.com/https://raw.githubusercontent.com/Sekai-World/sekai-master-db-kr-diff/main/events.json",
				eventSource: "Sekai World 活动表（韩文 · 代理）",
				altSources: [
					{
						label: "Sekai World 卡池表（韩文）",
						url: "https://sekai-world.github.io/sekai-master-db-kr-diff/gachas.json",
						fetcher: "pjsk-kr"
					}
				],
				eventAltSources: [
					{
						label: "Sekai World 活动表（韩文）",
						url: "https://sekai-world.github.io/sekai-master-db-kr-diff/events.json",
						fetcher: "default"
					}
				],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["pjsk"] = (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz);
		EVENT_FETCHERS["pjsk"] = Object.assign(EVENT_FETCHERS["pjsk"] || {}, { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) });
		// 繁中服 / 韩服：抓取器与国服**同一个函数**（只靠 url + tz 区分），roles 仍为空。
		GACHA_FETCHERS["pjsk-tc"] = (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz);
		EVENT_FETCHERS["pjsk-tc"] = Object.assign(EVENT_FETCHERS["pjsk-tc"] || {}, { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) });
		GACHA_FETCHERS["pjsk-kr"] = (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz);
		EVENT_FETCHERS["pjsk-kr"] = Object.assign(EVENT_FETCHERS["pjsk-kr"] || {}, { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) });
