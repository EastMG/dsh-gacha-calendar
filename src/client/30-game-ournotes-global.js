// src/client/30-game-ournotes-global.js —— BanG Dream！OurNotes·国际服（`ournotes-global`）
//   卡池 + 活动，默认源 = SPICA 的**结构化数据 JSON**（2026-11-11 接入）。
//
// ── 为什么换掉官方公告源 ─────────────────────────────────────────────────────
//   国际服由 BHK 发行，官方只有 `l11-web-api.biligames.com/game/news/page`（公告列表 → 详情正文），
//   正文里**没有**卡池名 / 角色 / 起止的结构化字段：旧实现只能靠标题分类 + 正文正则抽档期，
//   而实测 19 条全是开服期旧公告 ⇒ 当前时刻两侧如实 null（见 30-game-bandori.js 的
//   `ns_ournotes_global_*`）。BHK 那两条**保留为手动备选源**（设置页仍可切回去），本文件只换默认源。
//
// ── 抓取路径：两步，`_durl` 每次都变，必须先解 ──────────────────────────────
//   ① GET https://spica.wiki/ournotes/en/gachas        （客户端渲染 SPA；text/html / 约 44 KB）
//      页面里 `window._durl = "/ournotes/data/d-<hash>.json"` —— hash 随每次构建变化 ⇒ **不许写死**。
//   ② GET https://spica.wiki + _durl                  （application/json / 约 1.5 MB）
//        gachapages[23] = { id, name{ja,en,tw,zh,ko}, start, end, picks[], rates[] }
//        events[5]      = { id, slug, name{…}, type{…}, start, end, gachas[] }
//      卡池与活动**一次拿全** ⇒ 注册里 `url` 与 `eventUrl` 是同一条地址：刷新时卡池载荷顺手带上
//      活动字段，活动侧据此走 50-refresh.js 的 `reuseSameRequest`（省掉第二次页面 + 1.5 MB JSON）。
//      活动侧**另有**独立抓取器（`EVENT_FETCHERS["ournotes-global"].default`）—— 复用只是省请求，
//      不是"活动侧少一条腿"。
//   两个地址都在 `spica.wiki`（已在 src/index.js 的 PROXY_ALLOW_HOSTS；响应无 ACAO ⇒ 必走宿主代理）。
//
// ── 时区：数据里是 **JST 墙钟**，展示统一 **UTC+8** ──────────────────────────
//   数据 JSON 的 `start` / `end` 形如 `2026-11-08 15:00`，**不带时区标记**；它是 JST（SPICA 是日站，
//   国际服与日服同一绝对时刻：15:00 JST = 14:00 UTC+8）。所以两层分开：
//     · **解析层**恒按 `Asia/Tokyo` 把墙钟换成绝对毫秒（`NS_ON_GLOBAL_DATA_TZ`）
//     · **展示层**按条目 tz（= `Asia/Shanghai` = UTC+8）渲染 `display` / `bannerDates` / `eventDates`
//       ⇒ 钟面比源站原文少 1 小时，绝对时刻不变
//     · `raw` 保留源站原文（JST 钟面，`2026-11-08 15:00 ~ 2026-11-18 14:59`）
//   ⚠️ 别照抄 bdon.moe 那类站点：它把 JST 钟面标成「15:00 UTC+8」（错标）；本文件只认 SPICA 的墙钟，
//      时区换算只发生在上面那两处，不做任何「钟面平移」。
//
// ── 口径（沿用仓库既有规则，不另写一套）────────────────────────────────────
//   · 条目事实形状 `{ key, title, show, startTs, endTs, tz, raw, display, source, roles? }`
//     （见 30-game-komoe.js 文件头）
//   · 当期 = `coversNow`（**两端都要明确**）里 startTs 最新的那条；悬停 / 数组 = `coveredOrOpen`
//   · `end` 为空的**常驻池**（Our Notes Gacha / SSR 确定券 / 每日免费…，实测 7 条）⇒ endTs=null
//     （起点是源站明说的事实，startTs 照留）：按上面两条既有判据既不冒充当期、也不进悬停 ——
//     本文件**不额外**加一层过滤。
//   · 角色：`picks` 的引用形如 `["member", 76]` / `["snap", 79]`。
//       member → members[id].char → chars[char].name（**同一个多语种对象**，按下面的优先级取名）
//       snap   → snaps[id].chars[]（照片里出现的角色）→ 同一张角色表
//     ⚠️ **按 `id` 查，不按对象下标查**：`snaps` 是 `{"0":…,"79":…}` 的序号键、真引用号在 `id` 字段，
//        两者差 1（实测按序号查会把 Ave Mujica 池的角色查成 MyGO 的）。
//   · 名称（标题与角色名同一个纯函数 `ns_on_global_nameOf`）的语言优先级：
//     **`zh`（简中）→ `tw`（繁中）→ `en` → `ja`**（2026-11-11 用户指出源站 `name` 里有 `zh`，
//     此前取 `en` 是错的）；某一级空串 / 缺失就退下一级，四语全空才退到 `ko` 兜底，绝不拼空名。
//     ⚠️ 角色名同样带 `{ja,en,tw,zh,ko}` 五语字段（实测 26 个 chars 全有 `zh`），所以走同一函数；
//        若将来某个 picks 名字只有单语（例如只有日文 / 罗马字），函数本来就只认得出那一种，行为不变。
//
// ── 排在哪 ─────────────────────────────────────────────────────────────────
//   必须排在各 `30-game-*.js`（尤其 30-game-bandori.js）之后：`registerSource` 要**合并既有条目**，
//   而 ournotes-global 的条目本体（name / icon / tz / defaultHidden / BHK 备选源）声明在那边。
//   `GACHA_FETCHERS` / `EVENT_FETCHERS` 两张表由 21-fetcher-tables.js 先建好，这里只补键。

const NS_ON_GLOBAL_TZ = "Asia/Shanghai";          // = UTC+8（注册项与展示层用这个）
const NS_ON_GLOBAL_DATA_TZ = "Asia/Tokyo";        // 数据 JSON 的墙钟是 JST
const NS_ON_GLOBAL_ORIGIN = "https://spica.wiki";
const NS_ON_GLOBAL_URL = "https://spica.wiki/ournotes/en/gachas";
const NS_ON_GLOBAL_REFERER = "https://spica.wiki/";
const NS_ON_GLOBAL_SOURCE_LABEL = "SPICA";

// ═══════════════════════════════════════════════════════════════════════════════
// ① 页面 → _durl → 数据 JSON
// ═══════════════════════════════════════════════════════════════════════════════

/** SPA 页面 HTML → `window._durl`（形如 `/ournotes/data/d-67318986e4.json`）；没有 ⇒ 空串。 */
function ns_on_global_durlOf(html) {
	const m = /window\._durl\s*=\s*["']([^"']+)["']/.exec(String(html == null ? "" : html));
	return m ? String(m[1]).trim() : "";
}

/** `_durl` → 绝对地址（源站给站内路径；给了绝对地址就原样）。 */
function ns_on_global_dataUrlOf(durl) {
	const s = String(durl == null ? "" : durl).trim();
	if (!s) return "";
	if (/^https?:\/\//i.test(s)) return s;
	return NS_ON_GLOBAL_ORIGIN + (s.charAt(0) === "/" ? "" : "/") + s;
}

/** 页面 + 数据 JSON（两步都经宿主代理；缺 `_durl` / 非 JSON ⇒ 抛，让刷新记「抓取失败」而不是「未公布」）。 */
async function ns_on_global_fetchData(url) {
	const pageUrl = url || NS_ON_GLOBAL_URL;
	const html = await proxyFetchText(pageUrl, NS_ON_GLOBAL_REFERER);
	const durl = ns_on_global_durlOf(html);
	if (!durl) throw new Error("ournotes-global-no-durl");     // 页面结构变了（不是"未公布"）
	const text = await proxyFetchText(ns_on_global_dataUrlOf(durl), pageUrl);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("ournotes-global-bad-json");
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// ② 数据 JSON → 条目事实（卡池 / 活动各一支）
// ═══════════════════════════════════════════════════════════════════════════════

// 名称（标题 / 角色名）的语言优先级，**只在这一处定序** —— 空串或缺失就退下一级。
//   zh（简中）→ tw（繁中）→ en → ja，四语全空才退到 ko 兜底（源站万一只剩韩文，也不拼空名）。
//   角色名同样走这个函数：`chars[].name` 与 `gachapages[].name` 是同一形状的五语对象。
const NS_ON_GLOBAL_NAME_LANGS = ["zh", "tw", "en", "ja", "ko"];

/** 多语种名称对象 → 一种名字（按 `NS_ON_GLOBAL_NAME_LANGS` 逐级回退；纯字符串原样用；取不到 ⇒ 空串）。 */
function ns_on_global_nameOf(name) {
	if (typeof name === "string") return name.trim();
	if (!name || typeof name !== "object") return "";
	for (const k of NS_ON_GLOBAL_NAME_LANGS) {
		const v = name[k];
		if (typeof v === "string" && v.trim() !== "") return v.trim();
	}
	return "";
}

// 源站墙钟：`2026-11-08 15:00`（实测没有秒、也没有时区后缀）
const NS_ON_GLOBAL_WALL_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/;

/** 墙钟字符串 → `{ y, mo, d, h, mi }`；读不出 ⇒ null。 */
function ns_on_global_wallOf(s) {
	const m = NS_ON_GLOBAL_WALL_RE.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]) };
}

/** 墙钟 → 绝对毫秒。**恒按 JST**（数据 JSON 不带时区标记，见文件头的时区小节）。 */
function ns_on_global_instantOf(wall) {
	if (!wall) return null;
	return sourceInstant(wall.y, wall.mo, wall.d, wall.h, wall.mi, NS_ON_GLOBAL_DATA_TZ);
}

/** 条目的源站原文（两端用 ` ~ ` 连回原样；缺一端就只留那端）。 */
function ns_on_global_rawOf(obj) {
	const a = String((obj && obj.start) || "").trim();
	const b = String((obj && obj.end) || "").trim();
	if (!a && !b) return "";
	if (!b) return a;
	if (!a) return b;
	return a + " ~ " + b;
}

/**
 * `{ start, end }` → `{ startTs, endTs, raw, display }`。
 * 两端**各自独立**解析：`end` 为空的常驻池只留 startTs、endTs=null（起点是源站明说的事实，不丢）。
 * 两端都有但 end <= start（脏数据）⇒ 两端 null、`raw` 照实保留（不编时刻）。
 */
function ns_on_global_windowOf(obj, tz) {
	const raw = ns_on_global_rawOf(obj);
	const a = ns_on_global_wallOf(obj && obj.start);
	const b = ns_on_global_wallOf(obj && obj.end);
	const startTs = a ? ns_on_global_instantOf(a) : null;
	const endTs = b ? ns_on_global_instantOf(b) : null;
	if (startTs == null || endTs == null) return { startTs, endTs, raw, display: raw };
	if (!(endTs > startTs)) return { startTs: null, endTs: null, raw, display: raw };
	return { startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) };
}

/** `members` / `snaps`（数组或 `{ "0": … }` 序号对象）→ 按**内容 id** 索引的表。 */
function ns_on_global_indexById(v) {
	const list = Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
	const map = new Map();
	for (const x of list) {
		if (x && x.id != null) map.set(String(x.id), x);
	}
	return map;
}

/** picks → 角色名数组（member = 角色卡、snap = 照片；两者都算"这池 UP 了谁"，按名去重）。 */
function ns_on_global_rolesOf(json, gacha) {
	const members = ns_on_global_indexById(json && json.members);
	const snaps = ns_on_global_indexById(json && json.snaps);
	const chars = (json && json.chars) || {};
	const names = [];
	const pushChar = (cid) => {
		const c = chars[String(cid)];
		const n = ns_on_global_nameOf(c && c.name);
		if (n && names.indexOf(n) < 0) names.push(n);
	};
	for (const p of (gacha && gacha.picks) || []) {
		if (!Array.isArray(p) || p.length < 2) continue;
		const kind = String(p[0] == null ? "" : p[0]);
		const id = String(p[1] == null ? "" : p[1]);
		if (kind === "member") {
			const m = members.get(id);
			if (m && m.char != null) pushChar(m.char);
		} else if (kind === "snap") {
			const s = snaps.get(id);
			if (!s) continue;
			const list = Array.isArray(s.chars) && s.chars.length > 0 ? s.chars : (s.char != null ? [s.char] : []);
			for (const cid of list) pushChar(cid);
		}
		// 其它 kind（未来可能出现）如实跳过：不猜
	}
	return names;
}

/** `gachapages[]` → 卡池条目事实。 */
function ns_on_global_gachaItemsOf(json, tz = NS_ON_GLOBAL_TZ) {
	const pages = json && json.gachapages;
	if (!Array.isArray(pages)) throw new Error("ournotes-global-bad-json");
	const out = [];
	for (const g of pages) {
		if (!g || typeof g !== "object") continue;
		const title = ns_on_global_nameOf(g.name);
		if (!title) continue;
		const w = ns_on_global_windowOf(g, tz);
		out.push({
			key: "g" + String(g.id == null ? "" : g.id),
			title,
			show: title,
			roles: ns_on_global_rolesOf(json, g).join("、"),
			startTs: w.startTs,
			endTs: w.endTs,
			tz,
			raw: w.raw,
			display: w.display,
			source: "hover"
		});
	}
	if (out.length === 0) throw new Error("ournotes-global-empty-gachapages");
	return out;
}

/** `events[]` → 活动条目事实。 */
function ns_on_global_eventItemsOf(json, tz = NS_ON_GLOBAL_TZ) {
	const list = json && json.events;
	if (!Array.isArray(list)) throw new Error("ournotes-global-bad-json");
	const out = [];
	for (const e of list) {
		if (!e || typeof e !== "object") continue;
		const title = ns_on_global_nameOf(e.name);
		if (!title) continue;
		const w = ns_on_global_windowOf(e, tz);
		out.push({
			key: "e" + String(e.id == null ? "" : e.id),
			title,
			show: title,
			startTs: w.startTs,
			endTs: w.endTs,
			tz,
			raw: w.raw,
			display: w.display,
			source: "hover"
		});
	}
	if (out.length === 0) throw new Error("ournotes-global-empty-events");
	return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ 条目事实 → 载荷（当期 + 悬停 + 数据数组）
// ═══════════════════════════════════════════════════════════════════════════════

/** 卡池载荷：当期 = 覆盖 now 的最新开始；悬停 / 数组 = 全部 `coveredOrOpen`（结束升序）。 */
function ns_on_global_gachaPayloadOf(items, tz = NS_ON_GLOBAL_TZ, now = nowMs()) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = listed.slice().sort(poolHoverOrderOf).map((x) => ({
		title: x.title,
		label: x.roles ? `${x.title}：${x.roles}` : x.title,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw
	}));
	const out = {
		banner: primary.title,
		roles: primary.roles || "",
		bannerDates: primary.display,
		bannerDatesRaw: primary.raw
	};
	const hover = hoverTextFromItems(entries, "gacha", tz);
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	out.gachaHoverItems = entries;
	return out;
}

/** 活动载荷：当期 = 覆盖 now 的最新开始；悬停 / 数组 = 全部 `coveredOrOpen`。 */
function ns_on_global_eventPayloadOf(items, tz = NS_ON_GLOBAL_TZ, now = nowMs()) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
	const out = { event: primary.title, eventDates: primary.display, eventDatesRaw: primary.raw };
	const hover = hoverTextFromItems(entries, "event", tz);
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
	out.eventHoverItems = entries;
	return out;
}

/** 卡池抓取器：一次取全，卡池载荷顺手带上活动字段（两侧同 URL ⇒ 刷新走复用）。 */
async function ns_on_global_fetchGacha(url, signal, tz = NS_ON_GLOBAL_TZ) {
	const json = await ns_on_global_fetchData(url);
	const now = nowMs();
	const gp = ns_on_global_gachaPayloadOf(ns_on_global_gachaItemsOf(json, tz), tz, now);
	if (!gp) return null;                       // 一期都没在架 = 未公布（活动侧随后自己抓）
	const ep = ns_on_global_eventPayloadOf(ns_on_global_eventItemsOf(json, tz), tz, now);
	return ep ? Object.assign(gp, ep) : gp;
}

/** 活动抓取器：同一份数据 JSON 的 `events[]`（独立可用，不依赖卡池那次抓取）。 */
async function ns_on_global_fetchEvents(url, signal, tz = NS_ON_GLOBAL_TZ) {
	const json = await ns_on_global_fetchData(url);
	const now = nowMs();
	return ns_on_global_eventPayloadOf(ns_on_global_eventItemsOf(json, tz), tz, now);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ④ 登记：默认源（url / eventUrl 同一条）+ 两个抓取器
// ═══════════════════════════════════════════════════════════════════════════════

// 条目本体在 30-game-bandori.js（name / icon / tz=Asia/Shanghai / defaultHidden / BHK 两条备选源），
// `registerSource` 按 id 合并 ⇒ 这里只补"默认源是哪条"。tz 不动（UTC+8，与展示口径一致）。
registerSource({
	id: "ournotes-global",
	url: NS_ON_GLOBAL_URL,
	source: NS_ON_GLOBAL_SOURCE_LABEL,
	eventUrl: NS_ON_GLOBAL_URL,
	eventSource: NS_ON_GLOBAL_SOURCE_LABEL
});
GACHA_FETCHERS["ournotes-global"] = (url, signal, tz) => ns_on_global_fetchGacha(url, signal, tz);
EVENT_FETCHERS["ournotes-global"] = Object.assign(EVENT_FETCHERS["ournotes-global"] || {}, {
	default: (url, signal, tz) => ns_on_global_fetchEvents(url, signal, tz)
});
