// test/cases-sources.mjs —— 来源策略：「默认源**不自动换站点**」（2026-11-07 用户要求）
//
// ── 为什么有这一段 ──
// 用户原话：「明日方舟卡池默认源彻底摘掉自动兜底，有问题用户自行切换才符合设计，其它所有游戏的
// 卡池和活动同理」。于是 5 个抓取器里「主源失败/无数据 ⇒ 转身去抓另一个站」的分支被摘掉：
//   ① 明日方舟 卡池：官方 CMS（web-news.hypergryph.com）→ 曾自动回退 PRTS 卡池一览
//   ② 蔚蓝档案·日服 卡池：官网新闻（api-web.bluearchive.jp）→ 曾自动回退 GameKee
//   ③ 绝区零 卡池：官方公告（api-takumi-static）→ 曾自动回退 Bwiki 往期调频
//   ④ 鸣潮 卡池：官方公告（aki-gm-resources-back）→ 曾自动回退 Bwiki 角色轮换池
//   ⑤ 重返未来：1999 卡池：官方游戏内公告（noticecp）→ 曾自动回退官网公告解析
//
// ── 这一段守什么（关键：**不是只断言结果为 null**）──
// ① **不发第二个站点的请求**：每次主源失败后都断言 `calls` 里**没有任何一条**落在「第二个站点」的
//    host 上（还会把整次抓取出现过的 host 列出来，只能有主源站点）。只断言"结果是 null/抛错"
//    是不够的 —— 旧实现里"换站成功"恰恰会返回**有数据**的对象，那种实现能骗过结果断言。
//    为了证明这条断言真的能抓住回归，第二站点的路由里放的是**能解析出当期池**的真实形状
//    （旧实现跑到那里就会拿到数据；一旦有人把兜底加回来，这里立刻红）。
// ② 两种结局分得开：主源**失败** ⇒ 抛错（该侧记失败、沿用上次成功数据）；
//    主源**结构正常但没有当期** ⇒ `null`（如实「未公布」）。绝不把失败伪装成未公布。
// ③ **手动切源（altSources）仍然通**：设置页把来源选成备选源时，对应 fetcher 照旧取到数据。
//    默认源摘兜底**不能**把备选源一起摘掉。
//
// 记账设施复用 harness 的 `setFetchImpl`（与 `cases-p4.mjs` 同一套）：impl 收到的每个 URL 都记下来，
// 代理调用（`/api/gacha-calendar-proxy?url=…`）会先**解出被代理的真实 url** 再记账 ——
// 否则"第二个站点"藏在编码后的代理参数里，断言会看漏。

import { check, section, setFetchImpl, useFixtures } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
// 固定时钟：2026-11-08 12:00 +08（= 04:00Z）。所有夹具窗口都取 ±几天的"宽窗口"，
// 这样 TZ=UTC 与 TZ=Asia/Shanghai 两道门禁下「覆盖当前」的判定一致（不靠本机时区巧合）。
const NOW = Date.parse("2026-11-08T04:00:00Z");

const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;

// ── 记账 + 路由 ──────────────────────────────────────────────────────────────
// routes：按**被代理的真实 url** 匹配；命不中一律 404（= 一次"意料之外的站点请求"，会被 calls 记到）。
// 代理通道的响应契约（见 harness 的 setFetchImpl）：外层 HTTP 200 + `{ status, body }`；
// status != 200 时抓取器抛 `proxy-bad:<status>`（模拟主源失败）。
function install(routes) {
	const calls = [];
	const res = (status, body) => ({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		text: async () => body,
		json: async () => JSON.parse(body)
	});
	const impl = async (url) => {
		const u = String(url);
		let target = u;
		let viaProxy = false;
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			viaProxy = true;
			try { target = new URL("http://x" + u).searchParams.get("url") || u; } catch { target = u; }
		}
		calls.push({ target, viaProxy });
		const hit = routes.find((r) => r.match.test(target));
		if (!hit) return res(404, "");
		const status = hit.status || 200;
		const body = typeof hit.body === "function" ? hit.body(target) : (hit.body || "");
		if (viaProxy) return res(200, JSON.stringify({ status, body }));
		return res(status, body);
	};
	setFetchImpl(impl);
	return calls;
}
const targets = (calls) => calls.map((c) => c.target);
const hostsOf = (calls) => [...new Set(calls.map((c) => {
	try { return new URL(c.target).host; } catch { return ""; }
}))].sort();

async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}

// ── 「第二个站点」的"毒饵"响应：旧实现跑到这里**会拿到数据** ─────────────────────
// 明日方舟 PRTS 卡池一览（parseArknights 认 `<tr>` + title="寻访模拟/干员轮换卡池N" + 开启时间列）
const POISON_PRTS_POOL = `<table><tr>`
	+ `<td>192</td>`
	+ `<td><a href="/w/%E5%AF%BB%E8%AE%BF%E6%A8%A1%E6%8B%9F" title="寻访模拟/干员轮换卡池192">干员轮换卡池192</a></td>`
	+ `<td>2026-11-06 00:00 ~ 2026-11-12 00:00</td>`
	+ `<td><a title="测试六星" href="/w/A">A</a></td>`
	+ `<td><a title="测试五星" href="/w/B">B</a></td>`
	+ `</tr></table>`;
const PRTS_POOL_JSON = JSON.stringify({ parse: { text: POISON_PRTS_POOL } });

// 绝区零 Bwiki 往期调频 / 鸣潮 Bwiki 角色轮换池 / 各 GameKee 条目（都是"旧实现会成功"的形状）
const POISON_ZZZ_BWIKI = `<table>`
	+ `<tr><th colspan="2">「测试频段」</th></tr>`
	+ `<tr><th>时间</th><td>2026-11-06 00:00 ~ 2026-11-12 00:00</td></tr>`
	+ `<tr><th>S级代理人</th><td>「测试代理人」</td></tr>`
	+ `<tr><th>版本</th><td>3.3</td></tr>`
	+ `</table>`;
const POISON_WUWA_BWIKI = `<div data-start="2026-11-06 00:00" data-end="2026-11-12 00:00">`
	+ `<a href="/w/共鸣者/测试角色">x</a>`
	+ `</div>`;
const GK_ENTRY_TREE = {
	data: {
		entry_list: [{
			name: "常用内容",
			child: [{
				name: "当期活动 | 当期卡池",
				child: [
					{ name: "国际服当期活动", content_id: 1 },
					{ name: "国际服当期卡池评测", content_id: 2 },
					{ name: "日服当期活动", content_id: 3 },
					{ name: "日服当期卡池评测", content_id: 4 }
				]
			}]
		}]
	}
};
const gkTitle = (s) => JSON.stringify({ data: { title: s } });
const gkPoisonRoutes = [
	{ match: /^https:\/\/www\.gamekee\.com\/v1\/wiki\/entry/, body: JSON.stringify(GK_ENTRY_TREE) },
	{ match: /^https:\/\/www\.gamekee\.com\/v1\/content\/detail\/1$/, body: gkTitle("蔚蓝档案国际服 测试活动攻略整理【11/01~11/30】") },
	{ match: /^https:\/\/www\.gamekee\.com\/v1\/content\/detail\/2$/, body: gkTitle("国际服当期卡池：不该被请求") },
	{ match: /^https:\/\/www\.gamekee\.com\/v1\/content\/detail\/3$/, body: gkTitle("日服当期活动：测试活动【11/01 ~ 11/30】") },
	{ match: /^https:\/\/www\.gamekee\.com\/v1\/content\/detail\/4$/, body: gkTitle("日服当期卡池：测试池！【11月1日 ~ 11月30日】") }
];
const R1999_PAST_NOTICE = JSON.stringify({
	data: [{
		beginTime: Date.UTC(2025, 9, 15, 4, 0),
		contentMap: {
			"zh-CN": {
				title: "1.0「旧版本」版本活动一览",
				content: JSON.stringify([
					{ content: "「旧的限定征集」" },
					{ content: "6★角色「旧角色」" },
					{ content: "【征集时间】10/08 14:00 - 10/22 13:59" }
				])
			}
		}
	}]
});

export default async function run() {
	T.setCoreEnv({ now: () => NOW });

	// ─────────────────────────① 明日方舟（官方 CMS → 曾回退 PRTS）─────────────────────────
	section("来源策略 ①：明日方舟卡池 —— 主源失败/无当期都不换站（PRTS 只在手动切源时用）");
	{
		const API = srcOf("arknights").url;
		const SECOND = /prts\.wiki/;
		const ALLOWED = /^web-news\.hypergryph\.com$/;

		// (a) 官方 CMS 500 → 抛错（不是 null），且一次抓取里没碰过 prts.wiki
		{
			const calls = install([
				{ match: /web-news\.hypergryph\.com/, status: 500, body: "" },
				{ match: SECOND, body: PRTS_POOL_JSON }
			]);
			const r = await grab(() => T.GACHA_FETCHERS["arknights"](API, undefined, TZ_CN));
			check("明日方舟：官方 CMS 500 ⇒ 抛错（失败就是失败，不装成「未公布」）", !r.ok, r.ok ? JSON.stringify(r.data) : r.err);
			check("明日方舟：主源失败 ⇒ calls 里**没有**第二个站点（prts.wiki）的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("明日方舟：整次抓取的 host 只有官方 CMS 一个",
				hostsOf(calls).every((h) => ALLOWED.test(h)), JSON.stringify(hostsOf(calls)));
		}

		// (b) 官方 CMS 正常、但没有当期寻访公告（常规轮换周）→ null，仍然不换站
		{
			const calls = install([
				{ match: /web-news\.hypergryph\.com/, body: JSON.stringify({ data: { list: [] } }) },
				{ match: SECOND, body: PRTS_POOL_JSON }
			]);
			const r = await grab(() => T.GACHA_FETCHERS["arknights"](API, undefined, TZ_CN));
			check("明日方舟：官方没有当期寻访公告 ⇒ 返回 null（如实「未公布」）", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
			check("明日方舟：无当期时也**没有**第二个站点的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
		}

		// (c) 官方接口结构变了 → 抛结构化错误（不许静默成"未公布"）
		{
			install([{ match: /web-news\.hypergryph\.com/, body: JSON.stringify({ data: {} }) }]);
			const r = await grab(() => T.GACHA_FETCHERS["arknights"](API, undefined, TZ_CN));
			check("明日方舟：官方 CMS 结构异常 ⇒ 抛 arknights-official-no-section（改版要看得见）",
				!r.ok && /arknights-official-no-section/.test(r.err), r.ok ? JSON.stringify(r.data) : r.err);
		}

		// (d) 主源正常有当期 → 仍能出数据（摘兜底没把正常路径一起摘掉）
		{
			const calls = install([
				{
					match: /web-news\.hypergryph\.com\/api\/bulletin\?/,
					body: JSON.stringify({
						data: {
							list: [
								{ cid: "1", title: "[联动]【测试限定池】限时寻访开启", brief: "活动时间：11月1日 12:00 - 11月30日 11:59 ★★★★★★：测试角色" },
								{ cid: "2", title: "例行维护公告", brief: "与寻访无关" }
							]
						}
					})
				},
				{ match: /web-news\.hypergryph\.com\/api\/bulletin\/1/, status: 500, body: "" }   // 详情失败：同源容错，保留 brief 解析的角色
			]);
			const r = await grab(() => T.GACHA_FETCHERS["arknights"](API, undefined, TZ_CN));
			check("明日方舟：官方有当期限时寻访 ⇒ 正常返回（banner 取自【】，角色取自 brief）",
				r.ok && !!r.data && r.data.banner === "测试限定池" && r.data.roles === "测试角色", JSON.stringify(r.ok ? r.data : r.err));
			check("明日方舟：正常路径同样只请求官方 CMS（详情 500 属同源容错，不换站）",
				hostsOf(calls).every((h) => ALLOWED.test(h)) && !calls.some((c) => SECOND.test(c.target)),
				JSON.stringify(hostsOf(calls)));
		}
	}

	// ─────────────────────────② 蔚蓝档案·日服（官网新闻 → 曾回退 GameKee）─────────────────────────
	section("来源策略 ②：蔚蓝档案·日服卡池 —— 主源失败/无当期都不换站（GameKee 只在手动切源时用）");
	{
		const API = srcOf("ba-jp").url;
		const SECOND = /gamekee\.com/;
		const ALLOWED = /^api-web\.bluearchive\.jp$/;

		{
			const calls = install([
				{ match: /api-web\.bluearchive\.jp/, status: 500, body: "" },
				...gkPoisonRoutes
			]);
			const r = await grab(() => T.GACHA_FETCHERS["ba-jp"](API, undefined, TZ_CN));
			check("蔚蓝档案日服：官网新闻接口 500 ⇒ 抛错", !r.ok, r.ok ? JSON.stringify(r.data) : r.err);
			check("蔚蓝档案日服：主源失败 ⇒ calls 里**没有**任何 gamekee.com 的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("蔚蓝档案日服：整次抓取的 host 只有官网新闻接口", hostsOf(calls).every((h) => ALLOWED.test(h)), JSON.stringify(hostsOf(calls)));
		}
		{
			const calls = install([
				{ match: /api-web\.bluearchive\.jp/, body: JSON.stringify({ data: { rows: [] } }) },
				...gkPoisonRoutes
			]);
			const r = await grab(() => T.GACHA_FETCHERS["ba-jp"](API, undefined, TZ_CN));
			check("蔚蓝档案日服：官网结构正常但没有当期募集 ⇒ 返回 null", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
			check("蔚蓝档案日服：无当期时也**没有** GameKee 的请求", !calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
		}
		{
			install([{ match: /api-web\.bluearchive\.jp/, body: JSON.stringify({ data: {} }) }]);
			const r = await grab(() => T.GACHA_FETCHERS["ba-jp"](API, undefined, TZ_CN));
			check("蔚蓝档案日服：官网没有 data.rows（改版）⇒ 抛 ba-jp-news-no-section", !r.ok && /ba-jp-news-no-section/.test(r.err), r.ok ? JSON.stringify(r.data) : r.err);
		}
	}

	// ─────────────────────────③ 绝区零（官方公告 → 曾回退 Bwiki）─────────────────────────
	section("来源策略 ③：绝区零卡池 —— 主源失败/无当期都不换站（Bwiki 只在手动切源时用）");
	{
		const API = srcOf("zzz").url;
		const SECOND = /wiki\.biligame\.com/;
		const ALLOWED = /^api-takumi-static\.mihoyo\.com$/;
		const bwikiPoison = { match: SECOND, body: JSON.stringify({ parse: { text: POISON_ZZZ_BWIKI } }) };

		{
			const calls = install([{ match: /api-takumi-static\.mihoyo\.com/, status: 500, body: "" }, bwikiPoison]);
			const r = await grab(() => T.GACHA_FETCHERS["zzz"](API, undefined, TZ_CN));
			check("绝区零：官方公告接口 500 ⇒ 抛错", !r.ok, r.ok ? JSON.stringify(r.data) : r.err);
			check("绝区零：主源失败 ⇒ calls 里**没有** wiki.biligame.com 的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("绝区零：整次抓取的 host 只有 api-takumi-static", hostsOf(calls).every((h) => ALLOWED.test(h)), JSON.stringify(hostsOf(calls)));
		}
		{
			const calls = install([{ match: /api-takumi-static\.mihoyo\.com/, body: JSON.stringify({ data: { list: [] } }) }, bwikiPoison]);
			const r = await grab(() => T.GACHA_FETCHERS["zzz"](API, undefined, TZ_CN));
			check("绝区零：官方结构正常但没有当期频段 ⇒ 返回 null", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
			check("绝区零：无当期时也**没有** Bwiki 的请求", !calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
		}
		{
			install([{ match: /api-takumi-static\.mihoyo\.com/, body: JSON.stringify({ data: {} }) }]);
			const r = await grab(() => T.GACHA_FETCHERS["zzz"](API, undefined, TZ_CN));
			check("绝区零：官方 payload 没有 data.list（改版）⇒ 抛 zzz-official-no-section", !r.ok && /zzz-official-no-section/.test(r.err), r.ok ? JSON.stringify(r.data) : r.err);
		}
	}

	// ─────────────────────────④ 鸣潮（官方公告 → 曾回退 Bwiki）─────────────────────────
	section("来源策略 ④：鸣潮卡池 —— 主源失败/无当期都不换站（同源 zh-Hans→notice 容错保留）");
	{
		const API = srcOf("wuwa").url;
		const SECOND = /wiki\.biligame\.com/;
		const ALLOWED = /(^|\.)aki-game\.com$/;
		const bwikiPoison = { match: SECOND, body: JSON.stringify({ parse: { text: POISON_WUWA_BWIKI } }) };
		const entryOk = JSON.stringify({ contentUrl: ["https://aki-gm-resources-back.aki-game.com/gamenotice/G152/x/y/zh-Hans.json"] });

		{
			const calls = install([{ match: /aki-game\.com/, status: 500, body: "" }, bwikiPoison]);
			const r = await grab(() => T.GACHA_FETCHERS["wuwa"](API, undefined, TZ_CN));
			check("鸣潮：entrypoint 500 ⇒ 抛错", !r.ok, r.ok ? JSON.stringify(r.data) : r.err);
			check("鸣潮：主源失败 ⇒ calls 里**没有** wiki.biligame.com 的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("鸣潮：整次抓取的 host 只有 aki-game.com（官方资源站）", hostsOf(calls).every((h) => ALLOWED.test(h)), JSON.stringify(hostsOf(calls)));
		}
		{
			const calls = install([
				{ match: /entrypoint\.json$/, body: entryOk },
				{ match: /zh-Hans\.json$/, body: JSON.stringify({}) },
				bwikiPoison
			]);
			const r = await grab(() => T.GACHA_FETCHERS["wuwa"](API, undefined, TZ_CN));
			check("鸣潮：官方公告正常但没有当期唤取 ⇒ 返回 null", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
			check("鸣潮：无当期时也**没有** Bwiki 的请求", !calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
		}
		{
			// 同源容错：zh-Hans.json 读不到 → 同目录 notice.json（同一个站点，**不是**换站）
			const calls = install([
				{ match: /entrypoint\.json$/, body: entryOk },
				{ match: /zh-Hans\.json$/, status: 500, body: "" },
				{
					match: /notice\.json$/,
					body: JSON.stringify({
						recommend: [{ tag: 7, tabTitle: "[测试池]\n角色活动唤取", content: "活动期间，5星角色「测试角色」唤取概率限时提升！", startTimeMs: NOW - 86400e3, endTimeMs: NOW + 86400e3 }]
					})
				}
			]);
			const r = await grab(() => T.GACHA_FETCHERS["wuwa"](API, undefined, TZ_CN));
			check("鸣潮：zh-Hans.json 失败 ⇒ 同站点 notice.json 顶上（同源容错保留）",
				r.ok && !!r.data && r.data.banner === "角色活动唤取" && r.data.roles === "测试角色", JSON.stringify(r.ok ? r.data : r.err));
			check("鸣潮：同源容错只落在 aki-game.com 上（没顺手换站）",
				hostsOf(calls).every((h) => ALLOWED.test(h)) && !calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("鸣潮：同源容错真的请求了 notice.json（不是因为 zh-Hans 成功而误判）",
				calls.some((c) => /notice\.json$/.test(c.target)), JSON.stringify(targets(calls)));
		}
	}

	// ─────────────────────────⑤ 重返未来：1999（游戏内公告 → 曾回退官网公告）─────────────────────────
	section("来源策略 ⑤：重返未来 1999 卡池 —— 主源失败不换站（官网/小米只在手动切源时用）");
	{
		const API = srcOf("r1999").url;
		const SECOND = /re\.bluepoch\.com|game\.xiaomi\.com/;
		const ALLOWED = /(^|\.)sl916\.com$/;
		const secondPoison = [
			{ match: /re\.bluepoch\.com/, body: JSON.stringify({ data: { pageData: [] } }) },
			{ match: /game\.xiaomi\.com/, body: "<html>官方资讯流（毒饵）</html>" }
		];

		{
			const calls = install([{ match: /sl916\.com/, status: 500, body: "" }, ...secondPoison]);
			const r = await grab(() => T.GACHA_FETCHERS["r1999"](API, undefined, TZ_CN));
			check("重返未来 1999：游戏内公告接口 500 ⇒ 抛错（不再静默退回官网）", !r.ok, r.ok ? JSON.stringify(r.data) : r.err);
			check("重返未来 1999：主源失败 ⇒ calls 里**没有** re.bluepoch.com / game.xiaomi.com 的请求",
				!calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
			check("重返未来 1999：整次抓取的 host 只有 notice.sl916.com", hostsOf(calls).every((h) => ALLOWED.test(h)), JSON.stringify(hostsOf(calls)));
		}
		{
			const calls = install([{ match: /sl916\.com/, body: R1999_PAST_NOTICE }, ...secondPoison]);
			const r = await grab(() => T.GACHA_FETCHERS["r1999"](API, undefined, TZ_CN));
			check("重返未来 1999：结构正常但没有覆盖当前的征集 ⇒ 返回 null", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
			check("重返未来 1999：无当期时也**没有**官网/小米的请求", !calls.some((c) => SECOND.test(c.target)), JSON.stringify(targets(calls)));
		}
	}

	// ─────────────────────────⑥ 手动切源：altSources 路径照旧能取到数据 ─────────────────────────
	section("来源策略 ⑥：手动切源（altSources）仍能取到数据 —— 摘兜底没有把备选源一起摘掉");
	{
		// 注册表侧：5 个默认源的备选源都还在（label + url + fetcher），且 fetcher 已登记
		const want = {
			arknights: "arknights-prts",
			"ba-jp": "ba-jp-gamekee",
			zzz: "zzz-bwiki",
			wuwa: "wuwa-bwiki",
			r1999: "r1999-official"
		};
		for (const [id, fetcherKey] of Object.entries(want)) {
			const src = srcOf(id);
			const alt = ((src && src.altSources) || [])[0] || null;
			// 备选源的标识有两种形态：`url`（切源时连地址一起换）或 `id`（抓取器自带地址，如 ba-jp:gamekee）
			check(`${id}：备选源仍在（设置页可切）且 fetcher=${fetcherKey}`,
				!!alt && alt.fetcher === fetcherKey && String(alt.url || alt.id || "") !== "" && !!alt.label,
				JSON.stringify(alt));
			check(`${id}：备选抓取器已登记（typeof function）`, typeof T.GACHA_FETCHERS[fetcherKey] === "function", fetcherKey);
		}

		// ① 明日方舟：切到 PRTS 卡池一览 → 能解析出当期池
		{
			const src = srcOf("arknights");
			const alt = src.altSources.find((a) => a.fetcher === "arknights-prts");
			install([{ match: /prts\.wiki/, body: PRTS_POOL_JSON }]);
			const r = await grab(() => T.GACHA_FETCHERS["arknights-prts"](alt.url, undefined, TZ_CN));
			check("手动切源·明日方舟 PRTS：取到当期轮换池（banner / 角色 / 档期都在）",
				r.ok && !!r.data && r.data.banner === "干员轮换卡池192" && r.data.roles === "测试六星、测试五星",
				JSON.stringify(r.ok ? r.data : r.err));
		}
		// ② 蔚蓝档案日服：切到 GameKee 当期卡池 → 能解析出池名+档期（无角色名）
		{
			const src = srcOf("ba-jp");
			const alt = src.altSources.find((a) => a.fetcher === "ba-jp-gamekee");
			install(gkPoisonRoutes);
			const r = await grab(() => T.GACHA_FETCHERS["ba-jp-gamekee"](alt.url, undefined, TZ_CN));
			check("手动切源·蔚蓝档案日服 GameKee：取到池名 + 档期（roles 为空是本源既有口径）",
				r.ok && !!r.data && r.data.banner === "测试池！" && !!r.data.bannerDates,
				JSON.stringify(r.ok ? r.data : r.err));
		}
		// ③ 绝区零：切到 Bwiki 往期调频 → 能解析出当期频段
		{
			const src = srcOf("zzz");
			const alt = src.altSources.find((a) => a.fetcher === "zzz-bwiki");
			install([{ match: /wiki\.biligame\.com/, body: JSON.stringify({ parse: { text: POISON_ZZZ_BWIKI } }) }]);
			const r = await grab(() => T.GACHA_FETCHERS["zzz-bwiki"](alt.url, undefined, TZ_CN));
			check("手动切源·绝区零 Bwiki：取到当期频段（banner 含「」，档期非空）",
				r.ok && !!r.data && /测试频段/.test(r.data.banner) && !!r.data.bannerDates,
				JSON.stringify(r.ok ? r.data : r.err));
		}
		// ④ 鸣潮：切到 Bwiki 角色轮换池 → 能解析出角色名
		{
			const src = srcOf("wuwa");
			const alt = src.altSources.find((a) => a.fetcher === "wuwa-bwiki");
			install([{ match: /wiki\.biligame\.com/, body: JSON.stringify({ parse: { text: POISON_WUWA_BWIKI } }) }]);
			const r = await grab(() => T.GACHA_FETCHERS["wuwa-bwiki"](alt.url, undefined, TZ_CN));
			check("手动切源·鸣潮 Bwiki：取到角色轮换池（角色名解析出来）",
				r.ok && !!r.data && r.data.roles === "测试角色", JSON.stringify(r.ok ? r.data : r.err));
		}
		// ⑤ 重返未来 1999：切到「官网公告+小米」→ 官网口径能出数据（这是**用户点名**的复合备选源）
		{
			const src = srcOf("r1999");
			const alt = src.altSources.find((a) => a.fetcher === "r1999-official");
			install([
				{
					match: /re\.bluepoch\.com/,
					body: JSON.stringify({
						data: {
							pageData: [{
								title: "2.0「测试版本」版本更新维护公告",
								content: "<p>【维护时间】2026/11/01 05:00 - 2026/11/01 10:00</p><p>新增角色：6星角色「测试角色」</p><p>活动正篇，「测试活动」</p>"
							}]
						}
					})
				},
				{ match: /game\.xiaomi\.com/, status: 500, body: "" }   // 小米是本源内的"增强"，失败不影响官网结果
			]);
			const r = await grab(() => T.GACHA_FETCHERS["r1999-official"](alt.url, undefined, TZ_CN));
			check("手动切源·1999 官网公告：取到当期版本的首位 6 星角色 + 活动名（官网无逐期征集时间，bannerDates 为固定文案）",
				r.ok && !!r.data && r.data.banner === "测试角色" && r.data.bannerDates === "暂无时间信息" && r.data.event === "测试活动",
				JSON.stringify(r.ok ? r.data : r.err));
		}
	}

	// 收尾：把夹具 transport 与时钟交回默认（后续若再加段，不会被这里的路由粘住）
	useFixtures();
	T.setCoreEnv({ now: () => Date.now() });
}
