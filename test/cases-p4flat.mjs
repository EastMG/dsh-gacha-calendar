// test/cases-p4flat.mjs —— P4「展平」：数组 ts 换绝对时刻 / 「近期」收全部条目 / 计数与提醒·ics·轮播按条
//
// ── 这一批在守什么（P4 的验收方式与前三步不同）──────────────────────────────────────
// P1~P3 都要求"可见输出逐字不变"，所以那几批的断言是 golden / 等价性。P4 **允许改变可见输出**：
// 同一游戏的多个在期条目以前在「近期」里只剩**外显那一条**（`82-schedule-view.js` 的
// `all.push(view.primary)`），现在要各占一行。于是这一批的断言全换成"**数字**"与"**口径**"：
//   ① 数据层：数组条目的 `startTs`/`endTs` 是**绝对时刻**（按条目自己的 tz 解析源站墙钟），
//      同一份夹具在 TZ=UTC 与 TZ=Asia/Shanghai 下逐字节相同；源站写「X.Y 版本更新后」的
//      **单边窗口**也能给出终点（起点留 null，不编造）；
//   ② 展平：每侧 `primary + rest` **全部**进「近期」候选（`scheduleFlattenOf` 的 `all`）——
//      逐款钉住行数（明日方舟 3 条活动 / 星铁 5 条卡池 / pjsk 17 条卡池 / bandori 16 条活动）；
//   ③ 计数按条：24 小时 / 7 天两段数字与**条数**一致（不是格数）——用"2 格却 13 条"这种
//      极端时刻钉住（若退回按格，数字会立刻掉到 2）；
//   ④ 提醒 / 导出 .ics / 侧栏轮播都遍历 N 条（含兑换截止）；
//   ⑤ 跨时区：同一份数据在 UTC 与 +08 下**渲染文本逐字相同**（新口径的核心断言 ——
//      渲染走 `scheduleMeta(x, now, x.tz)`，文本只由 (ts, 源站 tz) 决定）。
//
// ⚠️ 反向证明（报告里贴红字）：把 `scheduleFlattenOf` 改回"每侧只收 primary"⇒ 本文件 ② + ③ 的
//    行数/计数断言必须变红；本文件最后还有一条静态守卫，防止渲染层偷偷绕开展平函数。
//
// 时刻来源：各夹具的抓取时刻（固定，不随跑测日期漂移；与 cases-core / cases-p3 同一口径）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section, useFixtures, fixtureBody } from "./harness.mjs";
import { T, REPO } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

const TZ_CN = "Asia/Shanghai";
const DUE_MS = 864e5;
const NEAR_MS = 7 * 864e5;
const H = 3600000;

// 与 82-schedule-view.js 的 `scheduleNear` 同一判据（7 天内有事发生；长期/已结束不进「近期」）
const nearOf = (all, nowMs) => all.filter((x) => (x.state === "wait"
	? x.startTs != null && x.startTs - nowMs <= NEAR_MS
	: x.state === "live" && x.remain <= NEAR_MS));
// 与 82 的 `soonCount` 同一判据（未来 24 小时内开始或结束）
const soonOf = (all, nowMs) => all.filter((x) => (
	(x.startTs > nowMs && x.startTs <= nowMs + DUE_MS) ||
	(x.endTs > nowMs && x.endTs <= nowMs + DUE_MS)
));
const rowsOfSide = (flat, id, side) => {
	const v = flat.cellViews.get(id + ":" + side);
	return v ? 1 + v.rest.length : 0;
};
const metaOf = (x, now) => T.scheduleMeta(x, now, x.tz);
// 跑测机的**本机时区**（在改 `process.env.TZ` 之前先记下来：Windows/Node 上 `delete process.env.TZ`
// 并不保证回落到系统时区 —— 实测会把上一次设的值留着 ⇒ 必须显式恢复成这个 IANA 名）。
const ORIGINAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default async function runP4Flat() {
	const fixture = useFixtures();
	const transport = {
		async fetchRaw(url, opts) {
			const r = await fixture(url, opts);
			return { ok: r.ok, status: r.status, text: () => r.text(), json: () => r.json() };
		},
		async fetchViaProxy(url, opts) {
			const o = opts || {};
			let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
			api += "&referer=" + encodeURIComponent(o.referer || "");
			if (o.headers) api += "&headers=" + encodeURIComponent(JSON.stringify(o.headers));
			const r = await fixture(api);
			if (!r.ok) throw new Error("proxy-http-" + r.status);
			const wrapped = JSON.parse(await r.text());
			if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
			return wrapped.body;
		}
	};
	const makeStore = (seed) => {
		const m = new Map(Object.entries(seed || {}));
		return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
	};
	const ids = createEngine({ transport, storage: makeStore(), now: () => 0 }).__test.SOURCES.map((s) => s.id);
	const only = (id) => ({ hidden: ids.filter((x) => x !== id) });
	// 真跑一轮 refresh（夹具 + 固定时钟），返回该游戏的记录
	const runGame = async (id, nowMs) => {
		const engine = createEngine({ transport, storage: makeStore(only(id)), now: () => nowMs, timer: { setTimeout, clearTimeout } });
		const r = await engine.refresh();
		return r.games[id] || {};
	};
	const gameOf = (id, rec) => Object.assign({ id, name: id, tz: TZ_CN }, rec);
	const flatOf = (id, rec, nowMs) => {
		const now = new Date(nowMs);
		const flat = T.scheduleFlattenOf([gameOf(id, rec)], now);
		return { now, flat, recent: nearOf(flat.all, nowMs), soon: soonOf(flat.all, nowMs) };
	};

	const NOW_ARK = Date.parse("2026-11-07T00:00:00.000Z");     // 明日方舟：视相已进兑换期
	const NOW_ARK_ACT = Date.parse("2026-10-24T09:00:00.000Z"); // 明日方舟：活动期（两个 deadline 都在未来）
	const NOW_BD = Date.parse("2026-10-01T17:26:29.000Z");      // bandori 夹具抓取时刻
	const NOW_BD_LATE = Date.parse("2026-10-25T12:00:00.000Z"); // bandori：一堆活动同一天到期（24 小时按条）
	const NOW_HSR = Date.parse("2026-11-07T00:00:00.000Z");
	const NOW_PJSK = Date.parse("2026-10-01T17:26:14.336Z");
	const NOW_PJSK_LATE = Date.parse("2026-10-11T00:00:00.000Z");

	// ── 夹具数据（真机快照；hsr / pjsk 走 payload 级，与 cases-core ④-9 / cases-p3 P3B 同一份）──
	const ark = await runGame("arknights", NOW_ARK);
	const arkAct = await runGame("arknights", NOW_ARK_ACT);
	const bandori = await runGame("bandori", NOW_BD);
	const bandoriLate = await runGame("bandori", NOW_BD_LATE);

	// pjsk：默认源是 gh-proxy 加速地址（夹具只有直连地址）⇒ 直接调 pjsk 抓取器 + mergeEntryRecord
	const pjskRecAt = async (nowMs) => {
		const fx = useFixtures({ "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json": "b1-sekai-gachas/response.txt" });
		const t2 = {
			async fetchRaw(url, opts) { const r = await fx(url, opts); return { ok: r.ok, status: r.status, text: () => r.text(), json: () => r.json() }; },
			async fetchViaProxy() { return fixtureBody("https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json"); }
		};
		const engine = createEngine({ transport: t2, storage: makeStore(), now: () => nowMs, timer: { setTimeout, clearTimeout } });
		const payload = await engine.__test.GACHA_FETCHERS["pjsk"]("https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json", undefined, TZ_CN);
		return engine.__test.mergeEntryRecord({ data: payload || {} }, null, nowMs, { id: "pjsk", tz: TZ_CN });
	};
	const pjsk = await pjskRecAt(NOW_PJSK);
	const pjskLate = await pjskRecAt(NOW_PJSK_LATE);
	useFixtures();   // 复位夹具（后面还有 arknights / hsr 的 payload 级用例）

	// hsr：bwiki「历史跃迁」+「活动一览」（与 cases-core ④-9 同一份真机夹具）
	const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });
	const hsr = await (async () => {
		const warp = FIX("p4-hsr-bwiki-warp-1107"), events = FIX("p4-hsr-bwiki-events-1107");
		let body = "";
		const t3 = {
			async fetchRaw() { return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) }; },
			async fetchViaProxy() { return body; }
		};
		const engine = createEngine({ transport: t3, storage: makeStore(), now: () => NOW_HSR, timer: { setTimeout, clearTimeout } });
		const meta = { id: "hsr", tz: TZ_CN };
		body = warp;
		const gp = await engine.__test.GACHA_FETCHERS["hsr"]("https://wiki.biligame.com/sr/api.php?action=parse&page=warp", undefined, TZ_CN);
		const recG = engine.__test.mergeEntryRecord({ data: gp || {} }, null, NOW_HSR, meta);
		body = events;
		const ep = await engine.__test.EVENT_FETCHERS["hsr"].default("https://wiki.biligame.com/sr/api.php?action=parse&page=events", undefined, TZ_CN);
		const recE = engine.__test.mergeEntryRecord({ data: ep || {} }, null, NOW_HSR, meta);
		return Object.assign({}, recG, recE, { gacha: recG.gacha, events: recE.events });
	})();

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ① 数据层：数组 ts = 绝对时刻（按条目 tz 解析源站墙钟）");
	{
		// 同一份夹具、两种运行环境时区：数组**必须逐字节相同**（P1~P3 的"本机墙钟"口径会差 8 小时）
		const snapshotOf = (rec) => JSON.stringify({ gacha: rec.gacha || [], events: rec.events || [] });
		const withTz = async (tz, fn) => {
			const saved = process.env.TZ;
			process.env.TZ = tz;
			try { return await fn(); } finally { process.env.TZ = saved === void 0 ? ORIGINAL_TZ : saved; }
		};
		const snapUtc = await withTz("UTC", async () => snapshotOf(await runGame("bandori", NOW_BD)));
		const snapSh = await withTz("Asia/Shanghai", async () => snapshotOf(await runGame("bandori", NOW_BD)));
		check("同一份数据在 TZ=UTC 与 TZ=Asia/Shanghai 下 `gacha`/`events` 逐字节相同（数组 ts 已经是绝对时刻）",
			snapUtc === snapSh, `utc=${snapUtc.length} sh=${snapSh.length}${snapUtc === snapSh ? "" : " 不相等"}`);

		// 单边窗口：星铁 3 口池写「4.6/4.7版本更新后 ~ …」⇒ 起点 null、终点是绝对时刻
		const g = hsr.gacha || [];
		const single = g.filter((x) => x.startTs == null && typeof x.endTs === "number");
		check("单边窗口：星铁 `gacha` 里有 3 条「版本更新后 ~ …」⇒ startTs=null、endTs 是 number（不编造起点）",
			g.length === 5 && single.length === 3, JSON.stringify([g.length, single.length]));
		check("单边窗口：这 3 条的 endTs 与源站墙钟对得上（11-10 15:00 +08 = 1794294000000 等）",
			single.some((x) => x.endTs === Date.parse("2026-11-10T15:00:00+08:00"))
			&& single.some((x) => x.endTs === Date.parse("2026-12-02T11:59:00+08:00"))
			&& single.some((x) => x.endTs === Date.parse("2026-12-22T15:00:00+08:00")),
			JSON.stringify(single.map((x) => [x.raw, x.endTs])));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ② 展平：「近期」收每侧全部条目（逐款钉住行数）");
	{
		const cases = [
			["arknights", ark, NOW_ARK, 0, 3],      // 3 条活动（兑换期那条在 phase 里，不另算一条）
			["bandori", bandori, NOW_BD, 1, 16],    // 1 条卡池 + 16 条活动
			["pjsk", pjsk, NOW_PJSK, 17, 0],        // 17 条卡池（当期全部池）
			["hsr", hsr, NOW_HSR, 5, 3]             // 5 条卡池（含 3 条单边窗口）+ 3 条活动
		];
		for (const [id, rec, nowMs, expectG, expectE] of cases) {
			const { flat } = flatOf(id, rec, nowMs);
			check(`展平（${id}）：卡池侧 ${expectG} 行 / 活动侧 ${expectE} 行（primary + rest 全部）`,
				rowsOfSide(flat, id, "gacha") === expectG && rowsOfSide(flat, id, "event") === expectE,
				JSON.stringify([rowsOfSide(flat, id, "gacha"), rowsOfSide(flat, id, "event")]));
			check(`展平（${id}）：\`all\` 的条数 = 两侧行数之和（不再「每侧只收外显那一条」）`,
				flat.all.length === expectG + expectE,
				`all=${flat.all.length} 期望=${expectG + expectE}`);
		}
		// 逐款把 `all` 的绝对条数也钉死（上面那条只在"已结束"为 0 时等价；这里 4 款都全在期）
		check("展平：四款的 `all` 条数 = 3 / 17 / 17 / 8（与上面逐侧行数一致）",
			flatOf("arknights", ark, NOW_ARK).flat.all.length === 3
			&& flatOf("bandori", bandori, NOW_BD).flat.all.length === 17
			&& flatOf("pjsk", pjsk, NOW_PJSK).flat.all.length === 17
			&& flatOf("hsr", hsr, NOW_HSR).flat.all.length === 8,
			JSON.stringify([
				flatOf("arknights", ark, NOW_ARK).flat.all.length,
				flatOf("bandori", bandori, NOW_BD).flat.all.length,
				flatOf("pjsk", pjsk, NOW_PJSK).flat.all.length,
				flatOf("hsr", hsr, NOW_HSR).flat.all.length
			]));
		// 同一款游戏的多条必须在「近期」候选里**各占一条**，而不是被折成一条
		const hs = flatOf("hsr", hsr, NOW_HSR);
		check("「近期」候选（7 天内）：星铁 5 条（4 条卡池 + 1 条活动；两条长档期在 7 天窗口外）",
			hs.recent.length === 5, JSON.stringify(hs.recent.map((x) => x.show || x.title)));
		check("「近期」候选：明日方舟 1 条 / bandori 0 条 / pjsk 6 条（7 天窗口本身没变，变的是「按条」）",
			flatOf("arknights", ark, NOW_ARK).recent.length === 1
			&& flatOf("bandori", bandori, NOW_BD).recent.length === 0
			&& flatOf("pjsk", pjsk, NOW_PJSK).recent.length === 6,
			JSON.stringify([
				flatOf("arknights", ark, NOW_ARK).recent.length,
				flatOf("bandori", bandori, NOW_BD).recent.length,
				flatOf("pjsk", pjsk, NOW_PJSK).recent.length
			]));
		// 行文本仍由现有行组件（游戏名 / 卡池或活动 / 事项名 / 剩余时间）表达：这里只钉"事项名非空"
		check("展平后的每一行都有事项名（`show || title`），不会出现空行",
			hs.flat.all.every((x) => String(x.show || x.title || "").trim() !== ""),
			JSON.stringify(hs.flat.all.map((x) => [x.show, x.title])));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ③ 计数按条：24 小时 / 7 天数字与条数一致（不是格数）");
	{
		// bandori 10-25：15 条在期活动里有 13 条在 24 小时内到期，而面板只有 **2 格**（卡池+活动）
		// —— 只有"按条"才会数出 13；按格最多是 2。
		const late = flatOf("bandori", bandoriLate, NOW_BD_LATE);
		const cells = Array.from(late.flat.cellViews.values());
		check("计数·24 小时：bandori 在 10-25 那一刻有 13 条落在 24 小时内（面板只有 2 格 ⇒ 按条才对）",
			late.soon.length === 13 && cells.length === 2,
			JSON.stringify([late.soon.length, cells.length]));
		check("计数·7 天：同一刻 13 条（7 天窗口 ⊇ 24 小时窗口），且 = 「近期」列表条数",
			late.recent.length === 13 && late.recent.length === late.soon.length,
			JSON.stringify([late.recent.length, late.soon.length]));
		// pjsk 10-11：9 条 24 小时内到期 / 10 条 7 天内到期（面板 1 格）
		const pl = flatOf("pjsk", pjskLate, NOW_PJSK_LATE);
		check("计数·24 小时：pjsk 在 10-11 那一刻有 9 条（面板只有 1 格）",
			pl.soon.length === 9, JSON.stringify(pl.soon.length));
		check("计数·7 天：pjsk 同一刻 10 条（「近期」列表条数 = 这个数字）",
			pl.recent.length === 10, JSON.stringify(pl.recent.length));
		// 夹具抓取时刻那几款：24 小时窗口外 = 0（数字是"真的按条统计"，不是恒等于条数）
		check("计数·24 小时：抓取时刻那几款确实为 0（bandori 17 条 / pjsk 17 条 / 星铁 8 条都不在 24 小时窗口）",
			flatOf("bandori", bandori, NOW_BD).soon.length === 0
			&& flatOf("pjsk", pjsk, NOW_PJSK).soon.length === 0
			&& flatOf("hsr", hsr, NOW_HSR).soon.length === 0,
			JSON.stringify([
				flatOf("bandori", bandori, NOW_BD).soon.length,
				flatOf("pjsk", pjsk, NOW_PJSK).soon.length,
				flatOf("hsr", hsr, NOW_HSR).soon.length
			]));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ④ 提醒遍历 N 条（含兑换截止）");
	{
		// ① 明日方舟两阶段：活动期同一份数据里两条 deadline（活动结束 / 兑换截止）各发一次
		const items = T.remindItemsOf({ arknights: Object.assign({ name: "明日方舟" }, arkAct) }, NOW_ARK_ACT, null);
		const actEnd = Date.parse("2026-11-07T03:59:00+08:00");
		const claimEnd = Date.parse("2026-11-10T03:59:00+08:00");
		const kEvent = "arknights|event|end|" + actEnd;
		const kClaim = "arknights|event-claim|end|" + claimEnd;
		check("提醒（明日方舟·活动期）：同一份数据派生两条 end（活动结束 + 兑换截止），key 不同",
			items.filter((x) => x.kind === "end").length === 2
			&& items.some((x) => x.key === kEvent) && items.some((x) => x.key === kClaim && x.claim === true),
			JSON.stringify(items.map((x) => x.key)));
		const first = T.remindTickOf(actEnd - 72 * H, T.remindItemsOf({ arknights: Object.assign({ name: "明日方舟" }, arkAct) }, actEnd - 72 * H, null), {}, {});
		const second = T.remindTickOf(claimEnd - 72 * H, T.remindItemsOf({ arknights: Object.assign({ name: "明日方舟" }, arkAct) }, claimEnd - 72 * H, null), {}, first.stateNext);
		check("提醒（明日方舟）：活动结束前 72h 发一条（key = 活动）、兑换截止前 72h 再发一条（key = 奖励领取）",
			first.toNotify.length === 1 && first.toNotify[0].key === kEvent && first.toNotify[0].node === 72
			&& second.toNotify.length === 1 && second.toNotify[0].key === kClaim && second.toNotify[0].node === 72,
			JSON.stringify([first.toNotify.map((n) => [n.key, n.node]), second.toNotify.map((n) => [n.key, n.node])]));

		// ② 多条目各发：pjsk 17 条卡池 ⇒ 8 条不同 deadline（同 T 的合并成一条 = 既有"同一时刻不弹两条"）
		const pjskItems = T.remindItemsOf({ pjsk: Object.assign({ name: "pjsk" }, pjsk) }, NOW_PJSK, null);
		const pjskEnds = pjskItems.filter((x) => x.kind === "end" && x.T > NOW_PJSK);
		check("提醒（pjsk）：17 条卡池 → 8 条 end（按条派生；同一结束时刻的多条合成一条）",
			pjskEnds.length === 8 && new Set(pjskEnds.map((x) => x.key)).size === 8,
			JSON.stringify(pjskEnds.map((x) => x.key)));
		// 反向对照：同一份记录把数组清空 ⇒ 退回"每侧一条"（这正是 P1 之前的限制）
		const pjskOld = T.remindItemsOf({ pjsk: Object.assign({ name: "pjsk" }, pjsk, { gacha: [], events: [] }) }, NOW_PJSK, null);
		check("提醒（pjsk）：把数组清空（老 lastData）⇒ 只剩 1 条（说明多出来的 7 条确实是展平带来的）",
			pjskOld.length === 1, JSON.stringify(pjskOld.map((x) => x.key)));
		// ③ bandori 多条目：5 条 end（1 卡池 + 4 个不同活动截止），清空数组后只剩 2 条
		const bdItems = T.remindItemsOf({ bandori: Object.assign({ name: "bandori" }, bandori) }, NOW_BD, null).filter((x) => x.kind === "end");
		const bdOld = T.remindItemsOf({ bandori: Object.assign({ name: "bandori" }, bandori, { gacha: [], events: [] }) }, NOW_BD, null).filter((x) => x.kind === "end");
		check("提醒（bandori）：5 条 end（卡池 1 + 活动 4）/ 清空数组后 2 条（每侧一条）",
			bdItems.length === 5 && bdOld.length === 2,
			JSON.stringify([bdItems.map((x) => x.key), bdOld.map((x) => x.key)]));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ⑤ 导出 .ics 遍历 N 条（每条目一个事件，含兑换截止）");
	{
		const bd = T.icsEventsOf([{ id: "bandori", name: "bandori", tz: TZ_CN }], { bandori }, NOW_BD);
		check("ics（bandori）：导出事件数 = 数组条目数 17（1 卡池 + 16 活动；以前最多 2 条）",
			bd.events.length === 17 && bd.skipped.length === 0,
			JSON.stringify([bd.events.length, bd.skipped.length]));
		check("ics（bandori）：UID 全部唯一（同一份数据重复导入不会重复建事件）",
			new Set(bd.events.map((e) => e.uid)).size === bd.events.length);
		const pj = T.icsEventsOf([{ id: "pjsk", name: "pjsk", tz: TZ_CN }], { pjsk }, NOW_PJSK);
		check("ics（pjsk）：导出事件数 = 数组条目数 17", pj.events.length === 17, JSON.stringify(pj.events.length));
		// 明日方舟活动期：活动本身 + 兑换截止（phase）= 2 个事件
		const arkIcs = T.icsEventsOf([{ id: "arknights", name: "arknights", tz: TZ_CN }], { arknights: arkAct }, NOW_ARK_ACT);
		check("ics（明日方舟·活动期）：2 个事件 —— 活动本身 + 兑换截止（phase 的窗口独立导出）",
			arkIcs.events.length === 2
			&& arkIcs.events[1].summary === "arknights · 视相博物馆：演化 兑换截止"
			&& arkIcs.events[1].startTs === Date.parse("2026-11-07T03:59:00+08:00"),
			JSON.stringify(arkIcs.events.map((e) => [e.summary, e.startTs, e.endTs])));
		// 星铁：5 条卡池里 3 条单边窗口（起点未知）不导出（日历必须两端都有），4 个事件 = 2 卡池 + 2 活动
		const hs = T.icsEventsOf([{ id: "hsr", name: "hsr", tz: TZ_CN }], { hsr }, NOW_HSR);
		check("ics（星铁）：4 个事件（5 条卡池里有 3 条起点未知 ⇒ 不导出，skipped 记 bad-window）",
			hs.events.length === 4 && hs.skipped.length === 4 && hs.skipped.every((s) => s.reason === "bad-window"),
			JSON.stringify([hs.events.length, hs.skipped.map((s) => [s.side, s.reason])]));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ⑥ 侧栏轮播遍历 N 条");
	{
		// 范围给足 100 天，把所有在期条目都纳入（只验"条数随数组展开"，不验 12/24/48/72 档位）
		const bd = T.tickerItemsOf([gameOf("bandori", bandori)], new Date(NOW_BD), 24 * 100);
		check("轮播（bandori）：17 条 = 数组条目数（1 卡池 + 16 活动；以前最多 2 条）",
			bd.length === 17, JSON.stringify(bd.map((x) => x.key)));
		const pj = T.tickerItemsOf([gameOf("pjsk", pjsk)], new Date(NOW_PJSK), 24 * 100);
		check("轮播（pjsk）：17 条 = 数组条目数", pj.length === 17, JSON.stringify(pj.length));
		const ak = T.tickerItemsOf([gameOf("arknights", ark)], new Date(NOW_ARK), 24 * 100);
		check("轮播（明日方舟）：3 条活动（事项名用条目的 `show` —— 兑换期那条带「兑换截止」）",
			ak.length === 3 && ak.some((x) => x.title === "视相博物馆：演化 兑换截止"),
			JSON.stringify(ak.map((x) => x.title)));
		// 起点未知的条目不进轮播（dueKindOf 要求两端都 number）：这是**如实留空**，不是漏
		const hs = T.tickerItemsOf([gameOf("hsr", hsr)], new Date(NOW_HSR), 24 * 100);
		check("轮播（星铁）：4 条 —— 5 条卡池里 3 条起点未知被跳过（起点未知的条目不编造开始时刻）",
			hs.length === 4, JSON.stringify(hs.map((x) => [x.key, x.startTs])));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ⑦ 跨时区：同一份数据在 UTC 与 +08 下渲染文本逐字相同");
	{
		// 这一步是"新口径的核心断言"：渲染文本只由 (绝对 ts, 条目自己的源站 tz) 决定 ——
		// 把**进程时区**切到 UTC / +08 各渲染一遍，逐行文本必须完全相同。
		// （Node 24 支持运行期改 process.env.TZ；这里 try/finally 复位，绝不把全局状态留给后面的批次。）
		const rowsOf = (games, nowMs) => {
			const now = new Date(nowMs);
			const out = [];
			for (const g of games) {
				const flat = T.scheduleFlattenOf([g], now);
				for (const x of flat.all) out.push((x.show || x.title || "") + " ⏎ " + metaOf(x, now));
			}
			return out;
		};
		const sets = [
			["hsr", hsr, NOW_HSR],
			["pjsk", pjsk, NOW_PJSK],
			["arknights", ark, NOW_ARK],
			["bandori", bandori, NOW_BD]
		];
		const withTz = (tz, fn) => {
			const saved = process.env.TZ;
			process.env.TZ = tz;
			try { return fn(); } finally { process.env.TZ = saved === void 0 ? ORIGINAL_TZ : saved; }
		};
		const rowsUnder = (tz) => withTz(tz, () => sets.map(([id, rec, nowMs]) => rowsOf([gameOf(id, rec)], nowMs)).flat());
		const rowsUtc = rowsUnder("UTC");
		const rowsSh = rowsUnder("Asia/Shanghai");
		const rowsJst = rowsUnder("Asia/Tokyo");
		check("跨时区：UTC / +08 / +09 三个进程时区下，45 行渲染文本逐字相同",
			rowsUtc.length === 45 && JSON.stringify(rowsUtc) === JSON.stringify(rowsSh) && JSON.stringify(rowsSh) === JSON.stringify(rowsJst),
			JSON.stringify([rowsUtc.length, rowsSh.length, rowsJst.length,
				rowsUtc.find((r, i) => r !== rowsSh[i]), rowsSh.find((r, i) => r !== rowsJst[i])]));
		// 文本 = **源站墙钟**：拿星铁那两条做字面量钉死（在两种时区下都必须长这样）
		const hsNow = new Date(NOW_HSR);
		const hsFlat = T.scheduleFlattenOf([gameOf("hsr", hsr)], hsNow).all;
		const row = hsFlat.map((x) => metaOf(x, hsNow));
		check("跨时区·字面量：星铁卡池行 =「10-21 12:00 → 11-10 15:00 · 还剩 3天7时」（源站 +08 墙钟）",
			row[0] === "10-21 12:00 → 11-10 15:00 · 还剩 3天7时", JSON.stringify(row[0]));
		check("跨时区·字面量：起点未知的行 =「至 12-02 11:59 · 还剩 25天3时」（只写终点，不编起点）",
			row[3] === "至 12-02 11:59 · 还剩 25天3时", JSON.stringify(row[3]));
		// 同一行的渲染文本必须等于条目自己的 `raw`（源站原文）—— 这是"渲染不漂移"的另一面
		const roundtrip = hsFlat.every((x) => {
			const head = metaOf(x, hsNow).split(" · ")[0].replace(/^至 /, "");
			const parts = head.split(" → ");
			const ends = parts[parts.length - 1];
			const starts = parts.length > 1 ? parts[0] : null;
			const src = String(x.rawSrc || x.raw || "");   // `rawSrc` = 源站原文（主条的 `raw` 是"本机换算后"的显示串）
			return src.indexOf(ends) >= 0 && (starts == null || src.indexOf(starts) >= 0);
		});
		check("跨时区·回读：每一行的起点文本都能在条目 `raw`（源站原文）里找到（渲染没有自己算一个钟点）",
			roundtrip, JSON.stringify(hsFlat.map((x) => [x.raw, metaOf(x, hsNow)])));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	section("P4 ⑧ 静态守卫：渲染层必须走展平函数（不许绕回「每侧只收外显那一条」）");
	{
		const viewSrc = readFileSync(path.join(REPO, "src", "client", "82-schedule-view.js"), "utf8");
		check("82 的「近期」/ 24 小时计数读 `scheduleFlattenOf`（81 的纯函数，展平只在一处实现）",
			/scheduleFlattenOf\(shownGames, now\)/.test(viewSrc));
		check("82 里不再有「只收外显那一条」的写法（`all.push(view.primary)` / `all.push(it)`）",
			!/all\.push\(view\.primary\)/.test(viewSrc) && !/all\.push\(it\)/.test(viewSrc));
		check("81 的 `scheduleFlattenOf` 展开的是 `[primary].concat(rest)`（primary + rest 全部）",
			/for \(const x of \[view\.primary\]\.concat\(view\.rest\)\)/.test(readFileSync(path.join(REPO, "src", "client", "81-schedule-model.js"), "utf8")));
	}
}
