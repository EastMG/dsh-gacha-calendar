// test/cases-refresh.mjs —— 刷新频率「启动时」档（`refreshMinutes = 0`）
//
// ── 为什么需要它 ──
// 2026-10-30 用户加了一档「启动时」：只在面板挂载（DSH 启动 / 页面加载）时刷一次，运行期**不排定时器**。
// 这一档同时改了三处口径，任何一处漏掉都会静默出错：
//   ① `autoRefreshPlan`（60-helpers.js）：0 必须 due 但**不 force**；更危险的是"0 曾经等于关闭"，
//      改成"每次挂载都 due"之后，**脏配置**（负数 / NaN / 空串）绝不能被当成 0 —— 否则清空过的
//      配置会每开一次页面就偷偷刷一轮。
//   ② 运行期定时器（83-panel-shell.js）：0 必须**直接 return**，否则 intervalMs = 0 ⇒ 每 1 秒一轮
//      （比 42 天溢出更糟）。
//   ③ 设置页的「自定义」兜底（84-settings-page.js）：0 现在是正常选项，不能被误判成"自定义（0 分钟）"。
// 另外守一条容易回归的地方：版本哨兵**优先于**「启动时」（插件更新时仍走 force），以及 0 档在同一次
// 挂载里只刷一次（否则升级那一轮会先 force、再命中「启动时刷新」→ 连刷两轮）。
//
// 2026-10-31：**出厂默认改成 0（启动时）**（schema 同步改 `default(0)`）。只改出厂默认，
// **不做老用户迁移**（已存 1440 的保持 1 天）。选项表里「1 天 = 1440」这一档必须保留 ——
// 用户仍可手选回 1 天，所以 ⑥ 会同时断言"默认是 0"与"选项里还有 1440 这档"。
// 版本哨兵（首次安装 force）不能被 0 档掩盖 —— 见 ⑬ 的出厂组合用例。
//
// 纯函数部分吃固定时刻，不依赖跑测的日期；静态部分读 `src/` 与构建产物（跑前先 `node build.mjs`）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

const { autoRefreshPlan, DEFAULT_SETTINGS } = T;

const VERSION = "0.12.10";
const NOW = 1760000000000;
const DAY = 24 * 60 * 60 * 1000;

// 固定版本哨兵"对得上"的基线输入，各用例只覆盖自己关心的字段
const base = (patch) => ({
	autoRefresh: true,
	refreshMinutes: 0,
	lastRefresh: NOW - DAY,
	lastVersion: VERSION,
	pluginVersion: VERSION,
	now: NOW,
	...patch
});

export default function runRefresh() {
	section("刷新频率「启动时」档（refreshMinutes = 0）");

	// ── ① 「启动时」+ 自动刷新开 ⇒ due / 不 force / reason 逐字 ──
	{
		const p = autoRefreshPlan(base({}));
		check("启动时 + 自动刷新开 ⇒ due", p.due === true, JSON.stringify(p));
		check("启动时 ⇒ force 为 false（不是插件更新那种强制）", p.force === false, JSON.stringify(p));
		check("启动时 ⇒ reason 逐字「启动时刷新」", p.reason === "启动时刷新", JSON.stringify(p.reason));
		// "启动时"的语义 = 每次挂载都刷一次，与上次刷新多久以前**无关**
		const justNow = autoRefreshPlan(base({ lastRefresh: NOW }));
		check("启动时 ⇒ 刚刷过（lastRefresh = now）也照样 due", justNow.due === true, JSON.stringify(justNow));
		const never = autoRefreshPlan(base({ lastRefresh: 0 }));
		check("启动时 ⇒ lastRefresh = 0（从没刷过）也 due", never.due === true, JSON.stringify(never));
	}

	// ── ② 自动刷新关 ⇒ 沿用手动（0 不能绕过关）──
	{
		const p = autoRefreshPlan(base({ autoRefresh: false }));
		check("启动时 + 自动刷新关 ⇒ due 为 false（沿用手动刷新）", p.due === false, JSON.stringify(p));
		check("启动时 + 自动刷新关 ⇒ force 也为 false（没版本变化）", p.force === false, JSON.stringify(p));
	}

	// ── ③ 0 与脏值的区别：-5 / NaN / 空串 / undefined 一律"永不 due" ──
	{
		const minus = autoRefreshPlan(base({ refreshMinutes: -5 }));
		check("refreshMinutes = -5（脏配置）⇒ 永不 due", minus.due === false, JSON.stringify(minus));
		const nan = autoRefreshPlan(base({ refreshMinutes: NaN }));
		check("refreshMinutes = NaN（脏配置）⇒ 永不 due", nan.due === false, JSON.stringify(nan));
		const inf = autoRefreshPlan(base({ refreshMinutes: Infinity }));
		check("refreshMinutes = Infinity（非有限值）⇒ 永不 due", inf.due === false, JSON.stringify(inf));
		const empty = autoRefreshPlan(base({ refreshMinutes: "" }));
		check("refreshMinutes = 空串（Number(\"\") 会变 0）⇒ 仍按脏配置处理、不算启动时", empty.due === false, JSON.stringify(empty));
		const missing = autoRefreshPlan({ autoRefresh: true, lastVersion: VERSION, pluginVersion: VERSION, now: NOW });
		check("refreshMinutes 缺失 ⇒ 永不 due（默认值由调用方补，纯函数不猜）", missing.due === false, JSON.stringify(missing));
		// 反证：0 本身必须是 due（否则上面"脏值不 due"可能因为整个函数坏了而假通过）
		check("对照：refreshMinutes = 0 ⇒ due（脏值那几条不是假通过）", autoRefreshPlan(base({})).due === true);
	}

	// ── ④ 版本哨兵优先于「启动时」：插件更新 / 首次安装仍走 force ──
	{
		const updated = autoRefreshPlan(base({ lastVersion: "0.12.9" }));
		check("版本不符（插件已更新）⇒ force = true，优先于 0 档", updated.force === true && updated.due === true, JSON.stringify(updated));
		check("…… reason 逐字「插件已更新」", updated.reason === "插件已更新", JSON.stringify(updated.reason));
		const first = autoRefreshPlan(base({ lastVersion: "" }));
		check("首次安装（lastVersion 空）⇒ force = true", first.force === true && first.due === true, JSON.stringify(first));
		check("…… reason 逐字「首次启动」", first.reason === "首次启动", JSON.stringify(first.reason));
		const off = autoRefreshPlan(base({ lastVersion: "0.12.9", autoRefresh: false }));
		check("版本不符 + 自动刷新关 ⇒ 仍 force（哨兵不看开关）", off.force === true && off.due === true, JSON.stringify(off));
	}

	// ── ⑤ 间隔档行为没变（0 不是把旧逻辑整段替换掉）──
	{
		const due = autoRefreshPlan(base({ refreshMinutes: 7 * 24 * 60, lastRefresh: NOW - 7 * DAY - 1 }));
		check("7 天档到点 ⇒ due、不 force、reason「已到刷新间隔」",
			due.due === true && due.force === false && due.reason === "已到刷新间隔", JSON.stringify(due));
		const notYet = autoRefreshPlan(base({ refreshMinutes: 7 * 24 * 60, lastRefresh: NOW - 6 * DAY }));
		check("7 天档没到点 ⇒ 不 due", notYet.due === false, JSON.stringify(notYet));
		const dirtyAt = autoRefreshPlan(base({ refreshMinutes: 7 * 24 * 60, lastRefresh: 0 }));
		check("间隔档但 lastRefresh = 0 ⇒ 不 due（交给版本哨兵/首次启动判）", dirtyAt.due === false, JSON.stringify(dirtyAt));
	}

	// ── ⑥ 静态：REFRESH_OPTIONS 第一项就是「启动时」= 0（逐字），且出厂默认也是 0 ──
	const cfgSrc = readFileSync(path.join(REPO, "src", "client", "10-config.js"), "utf8");
	{
		const m = /const REFRESH_OPTIONS = \[\s*\{\s*label:\s*"([^"]+)",\s*minutes:\s*([^}]+?)\s*\}/.exec(cfgSrc);
		check("能解析出 REFRESH_OPTIONS 的第一项（守卫自身没瞎）", !!m, String(m));
		check("REFRESH_OPTIONS 第一项 label 逐字「启动时」", !!m && m[1] === "启动时", m ? m[1] : "");
		const firstMinutes = m ? new Function(`return (${m[2]});`)() : null;
		check("REFRESH_OPTIONS 第一项 minutes = 0", firstMinutes === 0, String(firstMinutes));
		// 位置 = 最前：整段里在它之前不能再有别的 { label, minutes }
		const block = /const REFRESH_OPTIONS = \[([\s\S]*?)\];/.exec(cfgSrc);
		const labels = block ? [...block[1].matchAll(/label:\s*"([^"]+)"/g)].map((x) => x[1]) : [];
		check("「启动时」排在选项表最前（最省流量的一档）", labels[0] === "启动时", labels.join(","));
		check("选项表没有重复的 0 档（只有一个「启动时」）",
			block ? ([...block[1].matchAll(/minutes:\s*0\s*[,}]/g)].length === 1) : false);
		check("DEFAULT_SETTINGS.refreshMinutes = 0（出厂默认「启动时」，2026-10-31 改）",
			DEFAULT_SETTINGS.refreshMinutes === 0, String(DEFAULT_SETTINGS.refreshMinutes));
		// 选项表**不能**跟着删：用户仍可手选回 1 天（1 档 = 1440 分钟），老用户也存着 1440。
		const optionMinutes = block ? [...block[1].matchAll(/minutes:\s*([^,}]+?)\s*[,}]/g)].map((x) => new Function(`return (${x[1]});`)()) : [];
		check("选项表里仍保留「1 天」这一档（label 逐字）", labels.includes("1 天"), labels.join(","));
		check("…… 且它的分钟数仍是 1440（1 * 24 * 60）", optionMinutes.includes(1440), optionMinutes.join(","));
	}

	// ── ⑦ 静态：宿主 schema 允许 0，且默认已改成 0 ──
	{
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("src/index.js schema：refreshMinutes 允许 0（.min(0).max(60480)）",
			/refreshMinutes:\s*z\.number\(\)\.min\(0\)\.max\(60480\)\.default\(0\)\.volatile\(\)/.test(hostSrc));
		check("…… 默认值是 0（与 DEFAULT_SETTINGS 同口径，两处都是出厂值）",
			!/refreshMinutes:[^\n]*\.default\(1440\)/.test(hostSrc));
		check("…… 没有残留 .min(1)（否则设置页写入 0 会被 schema 拒）",
			!/refreshMinutes:\s*z\.number\(\)\.min\(1\)/.test(hostSrc));
		check("…… 默认值 0 与 DEFAULT_SETTINGS.refreshMinutes 一致",
			/default\(0\)\.volatile\(\)/.test(hostSrc) && DEFAULT_SETTINGS.refreshMinutes === 0);
	}

	// ── ⑧ 静态：设置页「自定义」兜底不会把 0 当自定义 ──
	{
		const pageSrc = readFileSync(path.join(REPO, "src", "client", "84-settings-page.js"), "utf8");
		check("设置页 inOptions 按 REFRESH_OPTIONS 的 minutes 判定（0 会命中选项表）",
			/const inOptions = REFRESH_OPTIONS\.some\(\(o\) => o\.minutes === currentMinutes\);/.test(pageSrc));
		check("「自定义（N 分钟）」只在 !inOptions 时渲染（0 命中后不会出现）",
			/!inOptions \?/.test(pageSrc) && pageSrc.indexOf('"自定义（"') > 0);
		// 模拟：currentMinutes = 0 时 inOptions 必须为 true（选项表里确实有 0）
		const block = /const REFRESH_OPTIONS = \[([\s\S]*?)\];/.exec(cfgSrc);
		const minutesList = block ? [...block[1].matchAll(/minutes:\s*([^,}]+?)\s*[,}]/g)].map((x) => new Function(`return (${x[1]});`)()) : [];
		check("按选项表模拟：currentMinutes = 0 ⇒ inOptions = true（「启动时」是正常选项）",
			minutesList.some((n) => n === 0), minutesList.join(","));
	}

	// ── ⑨ 静态：运行期定时器在 0 档直接 return（不排下一拍）──
	{
		const shellSrc = readFileSync(path.join(REPO, "src", "client", "83-panel-shell.js"), "utf8");
		const start = shellSrc.indexOf("// 定时自动刷新");
		const end = shellSrc.indexOf("// 启动时判定一次", start);
		const body = start >= 0 && end > start ? shellSrc.slice(start, end) : "";
		check("能定位到运行期定时器那段（守卫自身没瞎）", body.length > 0, `start=${start} end=${end}`);
		check("定时器：minutes === 0 ⇒ 直接 return（不排下一拍）", /if \(minutes === 0\) return;/.test(body));
		check("…… 这段 return 在第一次 setTimeout 之前（不会先排再跳）",
			body.indexOf("minutes === 0") >= 0 && body.indexOf("minutes === 0") < body.indexOf("window.setTimeout"));
		check("定时器：负数/非有限值也仍然不排（脏配置不猜）", /!Number\.isFinite\(minutes\) \|\| minutes < 0/.test(body));
	}

	// ── ⑩ 静态：0 档「同一次挂载只刷一次」的启动闸（防升级时连刷两轮）──
	{
		const shellSrc = readFileSync(path.join(REPO, "src", "client", "83-panel-shell.js"), "utf8");
		check("启动判定：0 档单独算 zeroInterval", /const zeroInterval = Number\(s\.refreshMinutes\) === 0;/.test(shellSrc));
		check("0 档的启动闸 key 与原因无关（同一次挂载只刷一次）",
			/zeroInterval \? `\$\{PLUGIN_VERSION\}\|启动时` : `\$\{PLUGIN_VERSION\}\|\$\{plan\.reason\}`/.test(shellSrc));
		check("启动判定仍先看 autoRefreshPlan 的 due/force/reason",
			/const plan = autoRefreshPlan\(\{/.test(shellSrc) && /if \(!plan\.due\) return;/.test(shellSrc));
	}

	// ── ⑪ 产物：构建后的 client / core 里都带这档（设置页渲染的是产物）──
	{
		const client = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
		const core = readFileSync(path.join(REPO, "packages", "core", "core.mjs"), "utf8");
		check("lib/client.js 产物里有「启动时」这一档", client.includes('label: "启动时"'));
		check("packages/core/core.mjs 产物里也有（core 共用同一份配置）", core.includes('label: "启动时"'));
		check("产物里 0 档排在选项表最前",
			client.indexOf('label: "启动时"') > 0
			&& client.indexOf('label: "启动时"') < client.indexOf('label: "1 天"')
			&& core.indexOf('label: "启动时"') < core.indexOf('label: "1 天"'));
	}

	// ── ⑫ 顺手核对：面板上「上次更新」文案不假设固定周期（中性说法）──
	{
		const sched = readFileSync(path.join(REPO, "src", "client", "82-schedule-view.js"), "utf8");
		check("面板底部是「上次更新 X 前」（不写「每 N 天刷新」这类依赖档位的文案）",
			/"上次更新 " \+ scheduleAgo\(s\.lastRefresh, now\)/.test(sched));
		// 「启动时」档下这一行照常显示：lastRefresh = 0 走「尚未更新」分支（不假设有固定周期）。
		const model = readFileSync(path.join(REPO, "src", "client", "81-schedule-model.js"), "utf8");
		check("…… scheduleAgo 对 lastRefresh = 0 有中性分支（「尚未更新」，不写出固定周期）",
			/function scheduleAgo\(ts, now\)[\s\S]{0,300}if \(t <= 0\) return "尚未更新";/.test(model));
	}

	// ── ⑬ 出厂组合：autoRefresh 默认开 + refreshMinutes 默认 0 的首轮行为 ──
	// 这条守的是"0 档不能把首次安装的 force 掩盖掉"：0 档每次挂载都 due，但**不 force**；
	// 首次安装（lastVersion 空）/ 插件更新仍然必须先走版本哨兵的 force 分支。
	{
		check("出厂组合：DEFAULT_SETTINGS.autoRefresh = true（开）", DEFAULT_SETTINGS.autoRefresh === true, String(DEFAULT_SETTINGS.autoRefresh));
		check("出厂组合：DEFAULT_SETTINGS.refreshMinutes = 0（启动时）", DEFAULT_SETTINGS.refreshMinutes === 0, String(DEFAULT_SETTINGS.refreshMinutes));
		// 用默认值**原样**喂给纯判定，不手写 0/true（改默认值时这条会跟着动）
		const factory = {
			autoRefresh: DEFAULT_SETTINGS.autoRefresh,
			refreshMinutes: DEFAULT_SETTINGS.refreshMinutes,
			now: NOW
		};
		// ① lastVersion 为空 = 首次安装 ⇒ force（必须刷新，不能被 0 档"只是启动时"糊过去）
		const first = autoRefreshPlan({ ...factory, lastVersion: "", lastRefresh: 0, pluginVersion: VERSION });
		check("出厂组合 + 首次安装（lastVersion 空）⇒ force = true、reason「首次启动」",
			first.due === true && first.force === true && first.reason === "首次启动", JSON.stringify(first));
		// ② lastVersion 非空且版本一致 ⇒ 走「启动时刷新」，**不** force
		const started = autoRefreshPlan({ ...factory, lastVersion: VERSION, lastRefresh: NOW, pluginVersion: VERSION });
		check("出厂组合 + 版本一致 ⇒ 走「启动时刷新」、不 force",
			started.due === true && started.force === false && started.reason === "启动时刷新", JSON.stringify(started));
		// ③ 首次安装时连自动刷新关都不影响 force（哨兵优先）——出厂默认虽然是开，但语义必须独立
		const firstOff = autoRefreshPlan({ ...factory, autoRefresh: false, lastVersion: "", lastRefresh: 0, pluginVersion: VERSION });
		check("出厂组合 + 首次安装 + 自动刷新关 ⇒ 仍 force（哨兵不看开关）",
			firstOff.due === true && firstOff.force === true, JSON.stringify(firstOff));
	}
}
