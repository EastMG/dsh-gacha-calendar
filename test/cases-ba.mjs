// test/cases-ba.mjs —— 蔚蓝档案（2026-10-21 两项改动）
//
// 覆盖两块**新的解析面**，都用真实抓包的夹具（`test/fixtures/ba-*`）离线复跑：
//
// ① 国际服 GameKee「当期卡池」表 → 角色名（任务 A）
//    页面 https://www.gamekee.com/ba/609133.html 的 HTML 是纯 SPA 壳（3.4KB，无数据），
//    正文在 `content_cdn` 的 JSON 里（编辑器 block 数组）。夹具 `ba-gamekee-pool-blocks`
//    就是那份 content 的「当期卡池」段**真实字节摘录**（paragraph + 两张 table）。
//
// ② 国服公告正文「■ 标签 + 起止时间」通用块解析（任务 B）
//    三种公告形态各一份夹具：
//      · `ba-cn-list-1015`   10月15日维护更新说明（正文**没有**「更新限时…招募【】」句式 → ① 解析必失败）
//      · `ba-cn-preview-1008` 只有【预告】、**列表里没有任何维护更新说明**（证明 ② 不依赖 ①）
//      · `ba-cn-list-0924`   09月24日维护更新说明（**旧逻辑必须逐字不变**，回归基线）
//
// 断言的"档期文本"一律是 `MM-DD HH:MM ~ MM-DD HH:MM`（与全仓 fmtWindow 口径一致）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section, setFetchImpl } from "./harness.mjs";
import { T, FIXTURES_DIR } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIST_URL = "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=";
const TZ_CN = "Asia/Shanghai";

const fx = (name) => readFileSync(path.join(FIXTURES_DIR, name), "utf8");
const blocksFixture = () => JSON.parse(fx("ba-gamekee-pool-blocks/response.txt"));

// 夹具版 fetch：旧式 impl（url → Response 形态），代理路径按 harness 约定包一层 {status, body}。
// 返回 `calls` 数组 —— 用来断言"零额外请求"。
function useListFixture(name) {
	const body = fx(name + "/response.txt");
	const calls = [];
	const impl = async (url) => {
		const u = String(url);
		calls.push(u);
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			const payload = JSON.stringify({ status: 200, body });
			return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => payload, json: async () => JSON.parse(payload) };
		}
		return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => body, json: async () => JSON.parse(body) };
	};
	setFetchImpl(impl);
	return calls;
}

// 在固定 now 下跑国服抓取器
async function fetchBaCnAt(fixture, iso) {
	const ts = Date.parse(iso);
	T.setCoreEnv({ now: () => ts });
	const calls = useListFixture(fixture);
	let data = null, err = null;
	try { data = await T.GACHA_FETCHERS["ba-cn"](LIST_URL, undefined, TZ_CN); }
	catch (e) { err = e && e.message; }
	return { data, err, calls };
}

const localTs = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

export default async function run() {
	section("蔚蓝档案（国际服 GameKee 当期卡池表 / 国服公告时间块）");

	// ── ① GameKee 609133「当期卡池」表 → 当期池（角色名 + 起止）──────────────────
	{
		const blocks = blocksFixture();
		const now = Date.parse("2026-10-21T03:00:00+08:00");
		const cur = T.gkBaCurrentPool(blocks, now, 2026, null);
		check("ba-global：609133 当期卡池表 → 角色名（旬/妃姬，含简繁与括号归一）",
			!!cur && cur.roles === "旬(泳装)、妃姬(泳装)", JSON.stringify(cur && cur.roles));
		// 显示口径（endDayTs）与判断口径（endTs 含当日全天）分开：显示必须是 10-27 00:00（上一轮读数），
		// 但判断不能提前一天过期（到期当天 00:00 起仍算当期）
		check("ba-global：档期显示 10-13 00:00 ~ 10-27 00:00 / 判断用 endTs 覆盖到 10-27 23:59",
			!!cur && T.fmtWindow(cur.win.startTs, cur.win.endDayTs) === "10-13 00:00 ~ 10-27 00:00"
			&& T.fmtMdHm(cur.win.endTs) === "10-27 23:59",
			cur && [T.fmtWindow(cur.win.startTs, cur.win.endDayTs), T.fmtMdHm(cur.win.endTs)].join(" | "));
		// titleWindow 不再是卡池标题（线上已不请求它）—— 传了也只作"没有组覆盖 now"时的兜底
		const outside = Date.parse("2026-12-01T00:00:00+08:00");
		const title = { startTs: localTs(2026, 10, 13), endTs: localTs(2026, 10, 27) };
		check("ba-global：now 在表档期之外 + 标题档期同月同日 → 兜底采信（宁缺勿错的下限）",
			T.gkBaCurrentPool(blocks, outside, 2026, title)?.roles === "旬(泳装)、妃姬(泳装)");
		check("ba-global：now 在表档期之外且没有标题档期 → null（不残留上一期）",
			T.gkBaCurrentPool(blocks, outside, 2026, null) === null);

		// 把「一个角色都没解析出来」与「表结构不认识」分开：前者 null（未公布），后者抛（内容接口失败）
		const noRoles = blocks.map((b) => JSON.parse(JSON.stringify(b).replace(/旬\( 泳装\)|妃姬\(泳装\)/g, "")));
		check("ba-global：表里没有任何角色名 → null（不产出空壳）",
			T.gkBaCurrentPool(noRoles, now, 2026, null) === null);
		const noHead = blocks.filter((b) => !(b.type === "paragraph" && JSON.stringify(b).includes("当期卡池")));
		let shapeErr = null;
		try { T.gkBaCurrentPool(noHead, now, 2026, null); } catch (e) { shapeErr = String(e && e.message); }
		check("ba-global：找不到「当期卡池」段 → 抛「GameKee 内容接口失败」（结构变化不许静默成未公布）",
			!!shapeErr && /^GameKee 内容接口失败（当期卡池表/.test(shapeErr), shapeErr);

		// ⚠️ 回归守卫：①（标题档期同月同日）**不允许**覆盖 ②（恰好一组覆盖 now）。
		//    原因：titleWindow 现在只能来自**活动标题**，可能滞后一期；若它优先，会把上一期的角色当当期。
		const row = (cells) => ({
			type: "table-row", children: cells.map((c) => ({ type: "table-cell", children: [{ type: "paragraph", children: [{ text: c }] }] }))
		});
		const twoGroups = [
			{ type: "paragraph", children: [{ text: "当期卡池" }] },
			{ type: "table", children: [row(["卡池图标", "PU学生", "卡池时间"]), row(["", "白子(泳装)", "9月29日～10月13日"])] },
			{ type: "table", children: [row(["", "旬(泳装)", "10月13日～10月27日"])] },
			{ type: "paragraph", children: [{ text: "历史卡池" }] }
		];
		const staleTitle = { startTs: localTs(2026, 9, 29), endTs: localTs(2026, 10, 13) };
		const pickStale = T.gkBaCurrentPool(twoGroups, now, 2026, staleTitle);
		check("ba-global：活动标题滞后一期时，仍以「恰好一组覆盖 now」为准（不配上一期角色）",
			!!pickStale && pickStale.roles === "旬(泳装)", JSON.stringify(pickStale && pickStale.roles));

		// 多组同时覆盖 now → 宁缺勿错（null），不猜
		const overlap = [
			{ type: "paragraph", children: [{ text: "当期卡池" }] },
			{ type: "table", children: [row(["卡池图标", "PU学生", "卡池时间"]), row(["", "阿露(礼服)", "10月13日～10月27日"])] },
			{ type: "table", children: [row(["", "日奈(礼服)", "10月20日～11月03日"])] }
		];
		check("ba-global：多组同时覆盖 now → null（不猜）", T.gkBaCurrentPool(overlap, now, 2026, null) === null);

		// 列序变化 + 合并单元格继承 + 角色名清洗（全角括号、括号内空格、★3「」前缀）
		const synthetic = [
			{ type: "paragraph", children: [{ text: "当期卡池" }] },
			{
				type: "table", children: [
					row(["卡池时间", "PU学生"]),
					row(["11月20日～11月30日", "★3「未花」"]),
					row(["11月01日～11月15日", "日奈（礼服）"]),
					row(["", "阿露( 礼服)"])
				]
			},
			{ type: "paragraph", children: [{ text: "历史卡池" }] }
		];
		const syn = T.gkBaCurrentPool(synthetic, localTs(2026, 11, 5, 12), 2026, null);
		check("ba-global：列序调换 + 合并单元格继承 + 角色名清洗（全角括号/★3「」/括号内空格）",
			!!syn && syn.roles === "日奈(礼服)、阿露(礼服)", JSON.stringify(syn && syn.roles));
	}

	// ── ba-global 抓取链路：卡池侧**只**走 609133（2 请求），活动侧维持目录树 ─────────
	// 这条是**真实踩过的坑**的回归守卫：api-cdn.gamekee.com 的 WAF 对"带路径的 Referer"
	// 直接 567（实测 origin→200、/ba/huodong/15→567、/ba/609133.html→567、无 Referer→567）。
	// 传页面地址时整条链会静默失效，不报错、不留痕 —— 只能靠断言钉住。
	{
		const nowTs = Date.parse("2026-10-21T03:00:00+08:00");
		T.setCoreEnv({ now: () => nowTs });
		const blocks = blocksFixture();
		const detail609133 = fx("ba-gamekee-pool-detail/response.txt");
		const tree = {
			data: {
				entry_list: [
					{
						name: "常用内容", child: [{
							name: "当期活动 | 当期卡池", child: [
								{ name: "国际服当期活动", content_id: 1 },
								{ name: "国际服当期卡池评测", content_id: 2 },   // 已废弃：**不许**再被请求
								{ name: "日服当期活动", content_id: 3 },
								{ name: "日服当期卡池评测", content_id: 4 }
							]
						}]
					}
				]
			}
		};
		const title = (s) => JSON.stringify({ data: { title: s } });
		let failCdn = false;
		const route = (url) => {
			if (url.includes("/v1/wiki/entry")) return JSON.stringify(tree);
			if (url.includes("/v1/content/detail/1")) return title("蔚蓝档案国际服 岚过天晴 活动攻略整理【10/13~10/27】");
			if (url.includes("/v1/content/detail/2")) throw new Error("卡池标题不应再被请求（回退守卫）");
			if (url.includes("/v1/content/detail/3")) return title("日服当期活动：我们是神秘学研究会！【10/07~10/21】");
			if (url.includes("/v1/content/detail/4")) return title("日服当期卡池：我们是神秘学研究会！【10月7日 ~ 10月21日】");
			if (url.includes("/v1/content/detail/609133")) return detail609133;
			if (url.startsWith("https://api-cdn.gamekee.com/")) {
				if (failCdn) throw new Error("proxy-http-404");
				return JSON.stringify({ content: JSON.stringify(blocks) });
			}
			throw new Error("unexpected-url:" + url);
		};
		const seen = [];
		T.setCoreEnv({
			transport: {
				async fetchRaw(u) { throw new Error("unexpected-direct:" + u); },
				async fetchViaProxy(u, opts) { seen.push({ u: String(u), referer: opts && opts.referer }); return route(String(u)); }
			}
		});
		const g = await T.GACHA_FETCHERS["ba-global"]();
		check("ba-global：卡池三字段全部来自 609133 单源（banner=招募类型 / roles / bannerDates）",
			!!g && g.banner === "特选招募" && g.roles === "旬(泳装)、妃姬(泳装)" && g.bannerDates === "10-13 00:00 ~ 10-27 00:00",
			JSON.stringify(g));
		check("ba-global：活动侧未改动（仍来自「国际服当期活动」标题）",
			!!g && g.event === "岚过天晴" && g.eventDates === "10-13 00:00 ~ 10-27 00:00", JSON.stringify(g && [g.event, g.eventDates]));
		check("ba-global：整条抓取器 4 次请求（目录树 + 活动标题 + detail + CDN）",
			seen.length === 4, "requests=" + seen.length);
		check("ba-global：卡池侧恰好 2 次请求（detail 609133 + CDN），不再请求目录页叠加标题",
			seen.filter((x) => x.u.includes("/v1/content/detail/609133") || x.u.startsWith("https://api-cdn.gamekee.com/")).length === 2
			&& !seen.some((x) => x.u.includes("/v1/content/detail/2")),
			JSON.stringify(seen.map((x) => x.u)));
		const cdnReq = seen.find((x) => x.u.startsWith("https://api-cdn.gamekee.com/"));
		check("ba-global：CDN 那一跳的 Referer 是纯 origin（带路径/无 Referer → WAF 567）",
			!!cdnReq && cdnReq.referer === "https://www.gamekee.com/", JSON.stringify(cdnReq && cdnReq.referer));

		// 失败路径：CDN 打错（404）→ **必须失败**（抛错），不是"只有池名/未公布"的半成品
		seen.length = 0;
		failCdn = true;
		let err = null;
		try { await T.GACHA_FETCHERS["ba-global"](); } catch (e) { err = String((e && e.message) || e); }
		check("ba-global：CDN 失败 → 该侧抛错（不产出半成品）",
			!!err && /^GameKee 内容接口失败（content CDN：proxy-http-404）$/.test(err), err);
		check("ba-global：失败文案能看出是 GameKee 内容接口失败（normErr 原样透出，不再压成「抓取异常」）",
			T.normErr(new Error(err || "")) === err, T.normErr(new Error(err || "")));
		failCdn = false;

		// 日服兜底不加这两次请求（roles 保持空 = 改造前行为；仍是 3 次：目录树 + 卡池标题 + 活动标题）
		seen.length = 0;
		const jp = await T.GACHA_FETCHERS["ba-jp-gamekee"]();
		check("ba-jp（GameKee 兜底）不受影响：仍 3 次请求、roles 为空",
			seen.length === 3 && jp && jp.roles === "" && jp.banner.includes("神秘学研究会"), "requests=" + seen.length + " roles=" + JSON.stringify(jp && jp.roles));
	}

	// ── ② 国服公告时间块：三种公告形态 ───────────────────────────────────────
	{
		// 形态 A：09-24 维护更新说明 —— ① 老逻辑，必须逐字不变（回归基线）
		const a = await fetchBaCnAt("ba-cn-list-0924", "2026-09-26T12:00:00+08:00");
		check("ba-cn/0924：① 老逻辑不变（限时限定招募 + 莲见/圣娅 + 09-24~10-08）",
			!!a.data && a.data.banner === "限时限定招募" && a.data.roles === "莲见(泳装)、圣娅(泳装)"
			&& a.data.bannerDates === "09-24 14:00 ~ 10-08 13:59", JSON.stringify(a.data));
		check("ba-cn/0924：活动仍走 ① 的「活动名 + 维护起算」",
			!!a.data && a.data.event === "夏日天空的约定" && a.data.eventDates === "09-24 14:00 ~ 10-22 13:59", JSON.stringify(a.data && a.data.event));

		// 形态 B：10-15 维护更新说明（正文没有招募句式 ⇒ ① 返回 null）→ ② 时间块接住
		//   同时证明"零额外请求"：列表 content 就是全文，② 不再为任何一条拉详情。
		const b = await fetchBaCnAt("ba-cn-list-1015", "2026-10-16T20:00:00+08:00");
		check("ba-cn/1015：① 解析不出时由 ② 预告时间块接住（乐队 3 池合并）",
			!!b.data && b.data.banner === "限时招募" && b.data.roles === "夏(乐队)、和纱(乐队)、好美(乐队)"
			&& b.data.bannerDates === "10-08 14:00 ~ 10-22 13:59", JSON.stringify(b.data));
		check("ba-cn/1015：活动名取最新一篇覆盖当前的活动预告（-ive aLIVE!）",
			!!b.data && b.data.event === "-ive aLIVE!" && b.data.eventDates === "10-08 14:00 ~ 10-22 13:59", JSON.stringify(b.data && b.data.event));
		check("ba-cn/1015：零额外请求（只打列表接口 1 次，不为条目拉详情）", b.calls.length === 1, "requests=" + b.calls.length);

		// 形态 C：只有【预告】（列表里根本没有维护更新说明）→ 证明 ② 不依赖 ①
		const c = await fetchBaCnAt("ba-cn-preview-1008", "2026-10-21T03:00:00+08:00");
		check("ba-cn/preview：列表里没有维护公告时，② 预告时间块独立可用",
			!!c.data && c.data.roles === "夏(乐队)、和纱(乐队)、好美(乐队)"
			&& c.data.bannerDates === "10-08 14:00 ~ 10-22 13:59" && c.data.event === "-ive aLIVE!", JSON.stringify(c.data));

		// 未开始/已结束：乐队池 10-22 13:59 结束；过了这个点、又没有别的覆盖当前的预告
		//   → 必须 nomatch（不能把已结束的档期继续显示）
		const d = await fetchBaCnAt("ba-cn-preview-1008", "2026-10-25T12:00:00+08:00");
		check("ba-cn/preview：档期已结束后 → nomatch（不显示过期档期）", d.data === null, JSON.stringify(d.data));
		// 未开始：乐队池 10-08 14:00 开始；之前同样 nomatch
		const e = await fetchBaCnAt("ba-cn-preview-1008", "2026-10-08T10:00:00+08:00");
		check("ba-cn/preview：档期尚未开始 → nomatch", e.data === null, JSON.stringify(e.data));

		// 优先级：① 能给出结果时，② 不参与（同一份 0924 列表在 10-21 已无 ① 覆盖 → ②/③ 也无覆盖）
		const f = await fetchBaCnAt("ba-cn-list-0924", "2026-10-21T03:00:00+08:00");
		check("ba-cn/0924：过了 ① 的窗口且无覆盖当前的活跃块 → nomatch（不残留上一期）", f.data === null, JSON.stringify(f.data));
	}

	// ── ③ 通用块解析器：写法归一化 / 严格性（合成文本，逐条钉住）─────────────
	{
		const nowYear = 2026;
		const w = (s) => T.baCnWindowIn(s, nowYear, TZ_CN);
		const norm = w("· 活动持续时间：10月08日 14:00 ~ 10月22日 13:59");
		check("块解析：标准写法 `10月08日 14:00 ~ 10月22日 13:59`",
			!!norm && T.fmtMdHm(norm.startTs, TZ_CN) === "10-08 14:00" && T.fmtMdHm(norm.endTs, TZ_CN) === "10-22 13:59",
			norm && T.fmtWindow(norm.startTs, norm.endTs, TZ_CN));
		const variant = w("10月 8日 14：00 ～ 10月 22日 13：59");
		check("块解析：全角冒号 + `～` + `月 日` 空格 与标准写法一致",
			!!variant && !!norm && variant.startTs === norm.startTs && variant.endTs === norm.endTs);
		const singleHour = w("10月08日 9:00 ~ 10月22日 3:59");
		check("块解析：`H:MM`（单数字小时）可解析",
			!!singleHour && T.fmtMdHm(singleHour.startTs, TZ_CN) === "10-08 09:00" && T.fmtMdHm(singleHour.endTs, TZ_CN) === "10-22 03:59");
		const clockOnly = w("10月15日 14:00 ~ 18:00（预计）");
		check("块解析：右侧只写钟点（同左侧日期）",
			!!clockOnly && T.fmtMdHm(clockOnly.endTs, TZ_CN) === "10-15 18:00");
		const cross = w("12月30日 10:00 ~ 01月05日 10:00");
		check("块解析：跨年（右侧月份小于左侧 → 次年）",
			!!cross && new Date(cross.endTs).getFullYear() === nowYear + 1, cross && new Date(cross.endTs).toISOString());
		const withYear = w("2026年10月08日 14:00 ~ 2026年10月22日 13:59");
		check("块解析：带年份写法与无年份写法同一时刻",
			!!withYear && !!norm && withYear.startTs === norm.startTs && withYear.endTs === norm.endTs);
		check("块解析：左端是「维护结束后」（无钟点）→ 一律不解析（宁缺勿错）",
			w("09月24日 维护结束后 ~ 10月01日 13:59") === null);
		check("块解析：右端缺失/不成区间 → 不解析", w("10月22日 13:59前") === null);
		// 标签分类：只有 招募/活动 的时间块参与档期判定
		const text = [
			"■ 维护时间", "10月15日 14:00 ~ 18:00", "■ 招募时间", "10月08日 14:00 ~ 10月22日 13:59",
			"■ 活动时间", "· 活动持续时间：10月08日 14:00 ~ 10月22日 13:59", "· 商店兑换时间：10月08日 14:00 ~ 10月29日 13:59"
		].join("\n");
		const blocks = T.baCnTimeBlocks(text, nowYear, TZ_CN);
		check("块解析：标签分类——维护时间不参与、招募/活动各有条目",
			blocks.length === 2 && blocks.filter((x) => x.tag === "招募").length === 1 && blocks.filter((x) => x.tag === "活动").length === 1,
			JSON.stringify(blocks.map((x) => x.tag + ":" + T.fmtMdHm(x.startTs, TZ_CN))));
		// 辅助窗口必须被排除：商店兑换时间比活动晚一周结束，若混进来会显示"错的档期"
		const act = blocks.filter((x) => x.tag === "活动")[0];
		check("块解析：排除「商店兑换时间」等等辅助窗口，活动档期取「活动持续时间」",
			!!act && T.fmtMdHm(act.endTs, TZ_CN) === "10-22 13:59", act && T.fmtWindow(act.startTs, act.endTs, TZ_CN));
	}

	// ── ④ 活动名不许按标点截断（2026-10-21 用户报「ba-cn 活动名称不完整」）────────────
	// 现场：`baCnEventInfoFromNotice` 原来用 `title.match(/[:：]\s*(.+)$/)` —— 把**第一个冒号之前**
	// 整段丢掉。冒号前是纯类别词（限时活动/限时招募）时正好；是**玩法名**时就是残缺：
	//   【预告】综合战术测试：护卫 • 特殊装甲 → 旧「护卫 • 特殊装甲」
	//   【预告】总力战：猫鬼黑影 • 街区战     → 旧「猫鬼黑影 • 街区战」
	//   【预告】大决战：比纳 • 街区战         → 旧「比纳 • 街区战」
	//   【预告】无限制决战：提翡瑞 • 重装甲   → 旧「提翡瑞 • 重装甲」
	// 标题**没有冒号**时 `fromTitle` 取不到 → 空串（面板落成 "—"）：
	//   【预告】掉落量3倍活动即将开启！/【预告】家具互动即将更新/【预告】区域29更新/【预告】限时签到活动
	// 夹具 `ba-cn-live-1021` = 2026-10-21 03:45 真实抓的 30 条，上面四种形态全在里面。
	{
		const live = JSON.parse(fx("ba-cn-live-1021/response.txt")).data.rows;
		const titleOf = (id) => (live.find((r) => r.id === id) || {}).title;
		const nameOf = (id) => T.baCnEventName(titleOf(id));

		// ① 当期这条：冒号前是纯类别词「限时活动」→ 与仓库既有口径一致，只留活动名（**这次不改坏**）
		check("活动名：当期 1974 仍是「-ive aLIVE!」（类别词前缀按既有口径去掉）",
			titleOf(1974) === "【预告】限时活动：-ive aLIVE!" && nameOf(1974) === "-ive aLIVE!",
			JSON.stringify([titleOf(1974), nameOf(1974)]));
		check("活动名：同类 1983 / 1968 / 1962 也只留名字（Say-Bing! / 沙勒总决算 / 夏日天空的约定）",
			nameOf(1983) === "Say-Bing!" && nameOf(1968) === "沙勒总决算" && nameOf(1962) === "夏日天空的约定",
			JSON.stringify([nameOf(1983), nameOf(1968), nameOf(1962)]));

		// ② 玩法前缀：必须**保留**（这是"不完整"的实际现场）
		const modeCases = [
			[1977, "综合战术测试：护卫 • 特殊装甲"],
			[1970, "总力战：猫鬼黑影 • 街区战"],
			[1969, "大决战：比纳 • 街区战"],
			[1967, "无限制决战：提翡瑞 • 重装甲"]
		];
		for (const [id, want] of modeCases) {
			check(`活动名：${id} 保留玩法前缀 → ${want}`, nameOf(id) === want, JSON.stringify(nameOf(id)));
		}

		// ③ 标题没有冒号 → 不许是空名（旧实现 fromTitle 为空串）
		const bareCases = [
			[1975, "掉落量3倍活动即将开启！"],
			[1964, "掉落量3倍活动即将开启！"],
			[1966, "家具互动即将更新"],
			[1965, "区域29更新"],
			[1955, "限时签到活动"],
			[1956, "100次免费招募"]
		];
		for (const [id, want] of bareCases) {
			check(`活动名：${id} 无冒号标题 → 完整标题（非空）`, nameOf(id) === want, JSON.stringify(nameOf(id)));
		}

		// ④ 正文优先：只在**明确是活动名**的位置取（`活动名：X` / `…活动【X】`），不抓整段
		check("活动名：正文 `活动名：沙勒总决算` → 取正文名（优先于标题）",
			T.baCnEventNameFromNotice("【预告】限时活动：某某", "欢迎连接【什亭之箱】，老师。\n活动名：沙勒总决算\n■ 活动时间") === "沙勒总决算",
			JSON.stringify(T.baCnEventNameFromNotice("【预告】限时活动：某某", "老师。\n活动名：沙勒总决算\n■ 活动时间")));
		check("活动名：正文 `更新限时活动【沙勒总决算】` → 取括号里的名字",
			T.baCnEventNameFromNotice("【预告】限时活动：某某", "以下是更新内容：\n1、更新限时活动【沙勒总决算】\n■ 活动时间") === "沙勒总决算",
			JSON.stringify(T.baCnEventNameFromNotice("【预告】限时活动：某某", "以下是更新内容：\n1、更新限时活动【沙勒总决算】\n■ 活动时间")));
		check("活动名：正文深处（>6 行）的「活动【…】」不当作名字（不抓成整段）",
			T.baCnEventNameFromNotice("【预告】限时活动：某活动", ["a", "b", "c", "d", "e", "f", "g", "h【活动时间】", "活动【不是名字】"].join("\n")) === "某活动",
			JSON.stringify(T.baCnEventNameFromNotice("【预告】限时活动：某活动", ["a", "b", "c", "d", "e", "f", "g", "h", "活动【不是名字】"].join("\n"))));

		// ⑤ 端到端：只喂 1977 那一篇真实行（10-22 14:00 ~ 10-29 03:59），活动名必须是完整的
		const only = live.filter((r) => r.id === 1977);
		const e2e = T.baCnFromNoticeBlocks(only, { now: Date.parse("2026-10-25T12:00:00+08:00"), nowYear: 2026, tz: TZ_CN, previewOnly: true });
		check("活动名：端到端（1977 单篇，10-25）= 综合战术测试：护卫 • 特殊装甲",
			!!e2e && e2e.event === "综合战术测试：护卫 • 特殊装甲" && e2e.eventDates === "10-22 14:00 ~ 10-29 03:59",
			JSON.stringify(e2e));
		// ⑥ 端到端：完整 30 条 @ 2026-10-21 03:40（= 报 bug 的时刻），当期活动名与档期都要对
		const now0 = await fetchBaCnAt("ba-cn-live-1021", "2026-10-21T03:40:00+08:00");
		check("活动名：完整 30 条 @10-21 → 当期 = -ive aLIVE!（10-08 14:00 ~ 10-22 13:59）",
			!!now0.data && now0.data.event === "-ive aLIVE!" && now0.data.eventDates === "10-08 14:00 ~ 10-22 13:59",
			JSON.stringify(now0.data));
		check("活动名：完整 30 条 @10-21 → 只打列表 1 次（不因改名多请求）", now0.calls.length === 1, "requests=" + now0.calls.length);
	}
}
