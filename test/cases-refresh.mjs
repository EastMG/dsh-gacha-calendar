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
// 2026-10-31：**出厂默认改成 0（启动时）**（schema 同步改 `default(0)`）。同一天按用户要求补了
// **一次性迁移**（标记 `refreshMigrated`），并在当天晚些时候按用户第二次要求改成**无条件**：
// **不看旧值**，已有的配置（1440 / 用户自己选过的 2 天 / 0）一律写成 `{ refreshMinutes: 0,
// refreshMigrated: true }` —— 迁移的写法与失败重试见 ⑭，那是本文件唯一需要"真调宿主代码"的一段。
// ⑭⑧ 另守「⏳ 待废弃的一次性迁移」标记块 / 调用处短注释 / README_Dev 那一节（目标移除 2026-11-30）。
// 选项表里「1 天 = 1440」这一档必须保留 —— 用户仍可手选回 1 天，所以 ⑥ 会同时断言
// "默认是 0"与"选项里还有 1440 这档"。
// 版本哨兵（首次安装 force）不能被 0 档掩盖 —— 见 ⑬ 的出厂组合用例。
//
// 纯函数部分吃固定时刻，不依赖跑测的日期；静态部分读 `src/` 与构建产物（跑前先 `node build.mjs`）。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, section } from "./harness.mjs";
import { T, REPO, FIXTURES_DIR } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

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

export default async function runRefresh() {
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
		// （2026-10-31 起老用户那份 1440 会被一次性迁到 0，见 ⑭；这一档仍然保留给"手选 1 天"的人。）
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

	// ── ⑭ 一次性迁移：**无条件**一律改成 0（启动时）────────────────────────────────
	// 为什么必须补：出厂默认改成 0 对**已经存过配置的老用户**完全无效 —— 配置里有的是显式的 1440，
	// 有的甚至被用户自己选成了 2 天（2880）。用户 2026-10-31 定的口径是**无条件**（照
	// migrateNewPanelOnce 的写法）：不看旧值、不做分支，一律写 { refreshMinutes: 0, refreshMigrated: true }。
	// 这条迁移坏掉的两个方向都不报错，只让用户觉得"设置自己变了 / 功能没生效"：
	//   · 漏迁 ⇒ 老用户永远停在 1 天 / 2 天（以为「启动时」没做出来）；
	//   · 反复迁 ⇒ 用户改回去，下次启动又被改（开关像坏了）。
	// 做法 = 与 cases-health ⑨ 同一套**真机式桩跑**：把 src/index.js 原文搬进临时目录，只把两处
	// 外部依赖 import 指向本地桩（桩只负责"让宿主代码能被 import 起来"，迁移逻辑一行不抄），
	// 再用假 ctx 真调 apply() 与真实导出的 migrateRefreshOnce()。
	// ⚠️ 迁移函数没有导出（宿主内部实现，不该为测试改导出面）⇒ 只在这份**临时副本**末尾补一行
	//    export；src/index.js 一个字都不动。
	// ⚠️ LOCALAPPDATA 指向临时目录：迁移日志 / identity.json 不写进真实用户目录。
	// ⚠️ 假 ctx.effect 只记账不执行 ⇒ registerRemindTimer 的 setInterval 不会起来，门禁不挂住。
	// ⚠️ 每条配置都带 `newPanelMigrated: true`：那是**另一条**迁移（cases-health ⑨ 守），让它直接
	//    return，updates 里才只剩刷新频率迁移这一笔（两笔混在一起就分不清是谁写的）。
	{
		const prevLocalAppData = process.env.LOCALAPPDATA;
		const box = mkdtempSync(path.join(os.tmpdir(), "dsh-migrate-refresh-" + process.pid + "-"));
		try {
			const modDir = path.join(box, "mod");
			const runDir = path.join(box, "run");       // = 假的 %LOCALAPPDATA%
			const stateDir = path.join(runDir, "dsh-gacha-calendar");
			mkdirSync(modDir, { recursive: true });
			mkdirSync(stateDir, { recursive: true });
			process.env.LOCALAPPDATA = runDir;
			const logFile = path.join(stateDir, "remind.log");
			// identity.json 先放一份：apply 的启动预热看到"有缓存"就走毫秒路径、**不排后台探测**
			// （桩里的 notifyIdentityCacheOf 恒回 useCached ⇒ 不会起 PowerShell、不碰真实开始菜单）。
			writeFileSync(path.join(stateDir, "identity.json"), "{}\n", "utf8");

			// 桩 1：schemastery —— 只用链式 DSL 构造 schema，所以"每个方法都返回自己"就够。
			writeFileSync(path.join(modDir, "z-stub.mjs"), `function chain() {
	const o = {
		default: () => o, min: () => o, max: () => o, volatile: () => o,
		object: () => o, array: () => o, string: () => o, boolean: () => o, number: () => o
	};
	return o;
}
const z = { object: () => chain(), boolean: () => chain(), number: () => chain(), string: () => chain(), array: () => chain() };
export default z;
`, "utf8");
			// 桩 2：remind-core —— 迁移完全不碰提醒；具名导出的名字必须齐（缺一个 ESM 导入直接报错）。
			// 桩的 hostStateDirOf 只是"能被 import 起来"：固定回假 LOCALAPPDATA 下的 dsh-gacha-calendar，
			// 这样迁移日志仍然落在临时目录里（真实的三平台解析规则由 cases-remind.mjs 自己钉）。
			writeFileSync(path.join(modDir, "remind-core-stub.mjs"), `export const NOTIFY_IDENTITY_MAX_AGE_MS = 86400000;
export const HOST_STATE_DIR_NAME = "dsh-gacha-calendar";
export const NOTIFY_CHANNEL_WINRT = "winrt-toast";
export const NOTIFY_CHANNEL_OSASCRIPT = "osascript";
export const NOTIFY_CHANNEL_NONE = "none";
export function hostStateDirOf(env) {
	const base = env && typeof env.LOCALAPPDATA === "string" ? env.LOCALAPPDATA.trim() : "";
	return base === "" ? "" : base + "/" + HOST_STATE_DIR_NAME;
}
export function notifyChannelOf() { return NOTIFY_CHANNEL_WINRT; }
export function remindAppleScriptOf() { return ""; }
export function notifyIdentityCacheOf() {
	return { useCached: true, shouldRefresh: false, state: { enabled: false, name: "stub", aumid: "stub", shortcutPath: "" } };
}
const empty = () => ({});
export const notifyIdentityFallbackOf = empty;
export const notifyNameOf = () => "stub";
export const notifyShortcutPickOf = empty;
export const remindConfigOf = empty;
export const remindIdentityOf = empty;
export const remindItemsOf = () => [];
export const remindOnOf = () => false;
export const remindStateOf = empty;
export const remindTestToastOf = empty;
export const remindTickOf = () => ({ toNotify: [], stateNext: {} });
export const remindToastOf = () => ({ title: "stub", lines: [] });
export const remindAllowedTickOf = () => ({ toNotify: [], stateNext: {}, allowed: 0, skipped: 0 });
export const REMIND_TZ_BY_ID = { genshin: "Asia/Shanghai", hsr: "Asia/Shanghai" };
export const remindEntryShownOf = () => true;
export const remindOffGamesOf = (value, fallback) => (Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []));
`, "utf8");

			const srcText = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
			check("⑭ 桩跑前置：src/index.js 里仍有可替换的 schemastery 导入行（漂移了就重写这条用例）",
				srcText.includes('import z from "@deepseek-ai/schemastery";'));
			const stubbed = srcText
				.replace('import z from "@deepseek-ai/schemastery";', 'import z from "./z-stub.mjs";')
				.replace('} from "./remind-core.mjs";', '} from "./remind-core-stub.mjs";');
			check("⑭ 桩跑前置：两处 import 都替换成功（否则测的不是真实代码路径）",
				stubbed.includes('"./z-stub.mjs"') && stubbed.includes('"./remind-core-stub.mjs"')
				&& !stubbed.includes("@deepseek-ai/schemastery") && !stubbed.includes('"./remind-core.mjs"'));
			const moduleFile = path.join(modDir, "index.mjs");
			writeFileSync(moduleFile, stubbed + "\nexport { migrateRefreshOnce };\n", "utf8");
			const mod = await import(pathToFileURL(moduleFile).href);
			check("⑭ 桩跑能加载真实宿主代码：导出 apply / migrateRefreshOnce",
				typeof mod.apply === "function" && typeof mod.migrateRefreshOnce === "function");

			const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
			const volatileOf = (value) => ({ get: () => value, [VOLATILE_WRITE]: () => {} });
			// 假 settings：update 的**每一笔**都记账（迁移只许写一笔、且键集合固定）。
			const settingsOf = (mode) => {
				const updates = [];
				return {
					updates,
					configure() { /* apply 会调，无副作用 */ },
					async update(ns, patch) {
						updates.push({ ns, patch, keys: Object.keys(patch).sort().join(",") });
						if (mode === "throw") throw new Error("boom-from-settings");
					}
				};
			};
			// 假 ctx：inject("settings") 同步回调（真机是异步，但迁移做的事与时序无关）；
			// effect 只记账不执行 —— 定时器一旦真起来会挂住门禁。
			const ctxOf = (config, settings) => {
				const trace = [];
				const fiber = { config };
				const effect = () => { trace.push("effect"); return () => {}; };
				const ctx = {
					fiber,
					root: { loader: {
						await: async () => { trace.push("loader.await"); },
						locate: (f) => { trace.push(f === fiber ? "locate(fiber)" : "locate(other)"); return "gacha-calendar"; }
					} },
					effect,
					inject(deps, cb) {
						trace.push("inject:" + deps.join("+"));
						if (deps.includes("settings")) cb({ effect, settings });
					}
				};
				return { ctx, trace };
			};
			const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
			const logText = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
			const migLogged = () => (logText().match(/刷新频率迁移/g) || []).length;

			// ① 旧默认 1440 且标记缺失 ⇒ 一笔写入、patch 恰好两个键（值 + 标记同笔，不留半状态）
			{
				const config = { refreshMinutes: 1440, newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				const { ctx, trace } = ctxOf(config, settings);
				let threw = null;
				try { mod.apply(ctx, config); await settle(); } catch (err) { threw = err; }
				check("⑭① apply() 不被迁移拖住、两处注入都正常走完（settings + webServer）",
					threw === null && trace.includes("inject:settings") && trace.includes("inject:webServer"),
					threw ? String(threw.message) : trace.join("|"));
				check("⑭① 值=1440 且未迁 ⇒ settings.update 恰好被调 1 次",
					settings.updates.length === 1, String(settings.updates.length));
				const u = settings.updates[0] || { ns: "", patch: {}, keys: "" };
				check("⑭① 写入的条目 id = loader.locate(ctx.fiber) 的结果（不写死 id：用户改名也迁得动）",
					u.ns === "gacha-calendar" && trace.includes("locate(fiber)"), u.ns + " / " + trace.join("|"));
				check("⑭① patch 恰好是 { refreshMinutes: 0, refreshMigrated: true }（值与键集合精确）",
					!!u.patch && u.patch.refreshMinutes === 0 && u.patch.refreshMigrated === true
					&& u.keys === "refreshMigrated,refreshMinutes", JSON.stringify(u.patch));
				check("⑭① patch 只有那 2 个键（多一个键都不行）",
					!!u.patch && Object.keys(u.patch).length === 2, String(u.patch && Object.keys(u.patch).length));
				check("⑭① 先等 loader.await() 再 locate/写（加载中途写会撞 entry is no longer available）",
					trace.indexOf("loader.await") >= 0 && trace.indexOf("loader.await") < trace.indexOf("locate(fiber)"),
					trace.join("|"));
				check("⑭① 迁移成功留了日志（含条目 id + 「无条件」口径）",
					logText().includes("刷新频率迁移：条目 gacha-calendar 的 refreshMinutes 已一次性无条件迁到 0")
					&& logText().includes("不看旧值"));
			}

			// ② 用户自己选过 2 天（2880）⇒ **也照样改成 0**（无条件、不看旧值；2026-10-31 用户要求）
			{
				const config = { refreshMinutes: 2880, newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭② 值=2880（用户选过 2 天）⇒ 仍只调 1 次 update", settings.updates.length === 1, String(settings.updates.length));
				const u = settings.updates[0] || { patch: {}, keys: "" };
				check("⑭② 2880 也被无条件写成 0：patch 恰好 { refreshMinutes: 0, refreshMigrated: true }",
					!!u.patch && u.patch.refreshMinutes === 0 && u.patch.refreshMigrated === true
					&& u.keys === "refreshMigrated,refreshMinutes", JSON.stringify(u.patch));
				check("⑭② …… 不再是「只补标记」：refreshMinutes 真被写成 0、且键集合仍只有 2 个",
					!!u.patch && u.patch.refreshMinutes === 0 && Object.keys(u.patch).length === 2, JSON.stringify(u.patch));
			}

			// ②b 键缺失（= 从没存过，新用户 / 已清空的配置）⇒ 同样一笔写 0 + 标记（代码里没有"键在不在"分支）
			{
				const config = { newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭②b refreshMinutes 键缺失 ⇒ 也是一笔 { refreshMinutes: 0, refreshMigrated: true }",
					settings.updates.length === 1
					&& settings.updates[0].keys === "refreshMigrated,refreshMinutes"
					&& settings.updates[0].patch.refreshMinutes === 0, JSON.stringify(settings.updates));
			}

			// ②c 已经是「启动时」（0）⇒ 仍然整笔写一遍（0 是幂等的；代码里没有分支，不特殊照顾）
			{
				const config = { refreshMinutes: 0, newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭②c 值已经是 0 ⇒ 照样写 { refreshMinutes: 0, refreshMigrated: true }（无分支、幂等）",
					settings.updates.length === 1
					&& settings.updates[0].keys === "refreshMigrated,refreshMinutes"
					&& settings.updates[0].patch.refreshMinutes === 0, JSON.stringify(settings.updates));
			}

			// ③ 已迁移（标记 true）：零动作 —— 用户改回去不许被反复覆写
			{
				const config = { refreshMinutes: 1440, refreshMigrated: true, newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				const before = migLogged();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭③ 标记已是 true ⇒ settings.update 零次调用（哪怕值是 1440）",
					settings.updates.length === 0, String(settings.updates.length));
				check("⑭③ 已迁移时连日志都不写（不是「迁了但没变」）",
					migLogged() === before, String(migLogged() - before));
			}

			// ③b volatile 引用形态（DSH 真实交给 apply 的就是这种，不是裸值）
			{
				const config = { refreshMinutes: volatileOf(1440), refreshMigrated: volatileOf(false), newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭③b volatile 引用形态下也认得出 1440（解包没漏 ⇒ 不是「永远读到 undefined」）",
					settings.updates.length === 1 && settings.updates[0].keys === "refreshMigrated,refreshMinutes",
					JSON.stringify(settings.updates));
			}

			// ④ 失败不崩：update 抛错 ⇒ 函数不抛、只记日志；apply() 本身仍完成
			{
				const config = { refreshMinutes: 1440, newPanelMigrated: true, remindMigrated: true };
				const settings = settingsOf("throw");
				let threw = null;
				try { await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings); } catch (err) { threw = err; }
				check("⑭④ update 抛错时 migrateRefreshOnce 不抛（整段 try/catch）",
					threw === null, String(threw && threw.message));
				check("⑭④ 抛错时也只尝试 1 笔（没有重试循环，不会每启动刷日志）",
					settings.updates.length === 1, String(settings.updates.length));

				const settings2 = settingsOf("throw");
				const { ctx: ctx2, trace } = ctxOf({ refreshMinutes: 1440, newPanelMigrated: true }, settings2);
				let threw2 = null;
				try { mod.apply(ctx2, { refreshMinutes: 1440, newPanelMigrated: true }); await settle(); } catch (err) { threw2 = err; }
				check("⑭④ apply() 本身仍然完成（不因迁移失败而抛/中断）",
					threw2 === null && trace.includes("inject:settings") && trace.includes("inject:webServer"),
					String(threw2 && threw2.message));
				check("⑭④ 失败被记进日志（异常原文 + 下次启动重试），不是静默吞掉",
					logText().includes("刷新频率迁移失败（不影响插件加载，下次启动重试）")
					&& logText().includes("boom-from-settings"));
			}

			// ⑤ 下次重试：上一轮写入失败 ⇒ 标记没落盘 ⇒ 下一次（真机 = 下次启动）会再试并成功
			{
				const config = { refreshMinutes: 1440, newPanelMigrated: true, remindMigrated: true };
				const failing = settingsOf("throw");
				await mod.migrateRefreshOnce(ctxOf(config, failing).ctx, config, failing);
				check("⑭⑤ 失败那轮只尝试 1 笔", failing.updates.length === 1, String(failing.updates.length));
				const ok = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, ok).ctx, config, ok);
				check("⑭⑤ …… 紧接着重试（标记仍未写）⇒ 这次真写下 { refreshMinutes: 0, refreshMigrated: true }",
					ok.updates.length === 1 && ok.updates[0].keys === "refreshMigrated,refreshMinutes"
					&& ok.updates[0].patch.refreshMinutes === 0, JSON.stringify(ok.updates));
			}

			// ⑥ 静态度量：void 触发（不 await）、整段 try/catch、**只有一笔无条件写入**、不看旧值
			{
				const applyText = srcText.slice(srcText.indexOf("export function apply("));
				check("⑭⑥ apply() 里是 void 触发（不 await：一次配置写入不许拖慢插件加载）",
					/void migrateRefreshOnce\(ctx, config, settingsCtx\.settings\);/.test(applyText)
					&& !/await migrateRefreshOnce\(/.test(srcText));
				const fnAt = srcText.indexOf("async function migrateRefreshOnce(");
				const fnEnd = fnAt >= 0 ? srcText.indexOf("\n}\n", fnAt) : -1;
				const fnText = fnAt >= 0 && fnEnd > fnAt ? srcText.slice(fnAt, fnEnd) : "";
				check("⑭⑥ 迁移函数切片已定位（静态断言没瞎）", fnText.length > 600, String(fnText.length));
				check("⑭⑥ 整段包在 try/catch 里（失败只记日志，绝不让插件加载失败）",
					/try \{/.test(fnText) && /\} catch \(err\) \{/.test(fnText));
				check("⑭⑥ **只有一笔**写入（无条件写入，没有第二个分支 / 第三笔；2.0.23-next 起经 settingsUpdateFirstOf 选条目）",
					(fnText.match(/settingsUpdateFirstOf\(/g) || []).length === 1
					&& !/settings\.update\(/.test(fnText),
					String((fnText.match(/settingsUpdateFirstOf\(/g) || []).length));
				check("⑭⑥ 那一笔就是 { refreshMinutes: 0, refreshMigrated: true }（值与标记同笔，不留半状态）",
					/await settingsUpdateFirstOf\(settings, ids, \{ refreshMinutes: 0, refreshMigrated: true \}\);/.test(fnText));
				check("⑭⑥ 不看旧值：函数体里没有 `configValueOf(cfg, \"refreshMinutes\")`，也没有 `=== 1440` 分支",
					!/configValueOf\(cfg, "refreshMinutes"\)/.test(fnText)
					&& !/===\s*1440/.test(fnText));
				check("⑭⑥ 标记判定读**裸值**且严格 === true（volatile 引用不解包会永远读到 undefined）",
					/if \(configValueOf\(cfg, "refreshMigrated"\) === true\) return;/.test(fnText));
			}

			// ⑦ 三处齐 + 产物同源
			{
				check("⑭⑦ DEFAULT_SETTINGS.refreshMigrated = false（出厂 = 未迁移）",
					DEFAULT_SETTINGS.refreshMigrated === false, String(DEFAULT_SETTINGS.refreshMigrated));
				check("⑭⑦ schema：refreshMigrated 是 boolean / 默认 false / .volatile()（否则写入被拒）",
					/refreshMigrated: z\.boolean\(\)\.default\(false\)\.volatile\(\)/.test(srcText));
				const ehText = readFileSync(path.join(REPO, "src", "client", "engine-head.js"), "utf8");
				const ckAt = ehText.indexOf("const CONFIG_KEYS = [");
				const ckBlock = ckAt >= 0 ? ehText.slice(ckAt, ehText.indexOf("];", ckAt)) : "";
				check("⑭⑦ engine-head.js 的 CONFIG_KEYS 里有 refreshMigrated（三处齐）",
					/"refreshMigrated"/.test(ckBlock), ckBlock.length ? "已定位" : "没定位到 CONFIG_KEYS");
				const hostLib = readFileSync(path.join(REPO, "lib", "index.js"), "utf8");
				const clientLib = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
				check("⑭⑦ 构建产物同源：lib/index.js 有 migrateRefreshOnce、lib/client.js 有 refreshMigrated",
					hostLib.includes("async function migrateRefreshOnce(")
					&& hostLib.includes("void migrateRefreshOnce(ctx, config, settingsCtx.settings);")
					&& clientLib.includes("refreshMigrated"));
			}

			// ⑧ 待废弃标记守卫（2026-10-31 用户要求：这类迁移到期要**彻底删除**）
			// 为什么守：标记被删掉 / 日期被改成"3 个月后"这种相对表述，将来就再没人找得到这段代码该删；
			// 反之只删标记不删逻辑 = 一份没人认领的兼容层。所以标记块、调用处短注释、README_Dev 那一节
			// 三处必须同时存在，且日期是**字面日期 2026-11-30**。
			{
				const markerOf = (name) => {
					const at = srcText.indexOf("async function " + name + "(");
					if (at < 0) return "";
					const blockAt = srcText.lastIndexOf("/**", at);
					return blockAt >= 0 ? srcText.slice(blockAt, at) : "";
				};
				const applyText = srcText.slice(srcText.indexOf("export function apply("));
				for (const [label, name, keys] of [
					["新面板迁移", "migrateNewPanelOnce", "newPanelMigrated / newPanel 的旧默认 false"],
					["刷新频率迁移", "migrateRefreshOnce", "refreshMigrated / refreshMinutes 的旧默认 1440"]
				]) {
					const block = markerOf(name);
					check(`⑭⑧ ${label}（${name}）上方有统一的「⏳ 待废弃的一次性迁移」标记块，标题含字面日期 2026-11-30`,
						block.includes("⏳ 待废弃的一次性迁移") && block.includes("目标移除：2026-11-30 之后"),
						block.slice(0, 80));
					check(`⑭⑧ ${label} 标记块写明删除方法 / 涉及键（${keys}）/ 用户指令`,
						block.includes("删除方法：") && block.includes(keys) && block.includes("用户指令：2026-10-31"),
						block.slice(0, 200));
					check(`⑭⑧ ${label} 的 void 调用处有指向标记块的短注释（⏳ 待废弃 + 2026-11-30）`,
						applyText.includes("⏳ 待废弃（目标移除：2026-11-30 之后）—— 说明见 " + name + " 上方的注释块"));
				}
				check("⑭⑧ 日期用**字面值**：src/index.js 里没有「3 个月后」这类相对表述",
					!/\d\s*个月后/.test(srcText));
				const devText = readFileSync(path.join(REPO, "README_Dev.md"), "utf8");
				check("⑭⑧ README_Dev.md 有「待废弃的一次性迁移」一节（目标移除：2026-11-30 之后）",
					devText.includes("## 待废弃的一次性迁移（目标移除：2026-11-30 之后）"));
				const NEEDLES = [
					"| 迁移 | 涉及配置键 | 代码位置（函数） | 目标移除时间 | 删除步骤 |",
					"migrateNewPanelOnce", "migrateRefreshOnce",
					"newPanelMigrated", "refreshMigrated", "2026-11-30"
				];
				const missing = NEEDLES.filter((s) => !devText.includes(s));
				check("⑭⑧ README_Dev.md 那一节是「迁移 / 键 / 函数 / 目标移除时间 / 删除步骤」表格，两个迁移都列了",
					missing.length === 0, "缺：" + missing.join(" / "));
				// ⑧ 反向守卫（2026-10-31 用户把目标移除日从 2027-01-31 提前到 2026-11-30）：
				// 旧日期不许再有任何残留 —— 否则"改了一半"，将来照旧日期删不掉 / 或按两套日期各删一次。
				// 只守**迁移标记这一层**（src/index.js 与 README_Dev.md）：`2027-01-31` 在
				// test/fixtures（日服 3470/3477 的 to_date）与 src/client/30-game-cygames.js 的说明里
				// 是**真实档期数据**，跟迁移无关，永远不跟着改。
				check("⑭⑧ 反向：迁移标记不再残留旧日期（src/index.js 里 2027-01-31 出现 0 处）",
					!srcText.includes("2027-01-31"),
					"仍含 2027-01-31：" + String((srcText.match(/2027-01-31/g) || []).length) + " 处");
				check("⑭⑧ 反向：README_Dev.md 不再残留旧日期（2027-01-31 出现 0 处）",
					!devText.includes("2027-01-31"),
					"仍含 2027-01-31：" + String((devText.match(/2027-01-31/g) || []).length) + " 处");
			}
		} catch (err) {
			check("⑭ 迁移用例整套能跑完（抛异常即视为失败，见 detail）", false, String((err && err.stack) || err));
		} finally {
			if (prevLocalAppData === void 0) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = prevLocalAppData;
			try { rmSync(box, { recursive: true, force: true }); } catch { /* 清不掉不影响门禁 */ }
		}
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// ⑮（2026-11-17 新增，2026-11-18 扩展）**刷新调度层**：
	//   全局并发上限 / 同主机并发上限 / 每条目超时 / 分级重试 / 整轮硬上限
	//
	// 为什么是行为测试而不是静态断言：真机两天的刷新轮暴露了旧调度（整轮共用 20s deadline + 61 条
	// 全并发 + 无重试）的具体后果 —— `fgo-jp` 被整轮 deadline 掐成「超时」（实测源站
	// 200 / 1.4s / 1.77MB），`nikki4`（闪耀暖暖）在全并发下连续两轮 `HTTP 403`（该源一轮 17 次
	// 请求，单独复跑两轮 32 次请求全 200）。2026-11-18 真机第二轮：imas 五款（共用
	// `melonpapapapa-n.com`，各 ~650KB）同一轮同时 502 / 超时 —— 复测 5 页并发全 200、214~960ms，
	// 属上游瞬时抖动 ⇒ 补「同主机并发上限 + 分级重试」。所以这一段**真跑调度层**
	// （createEngine + 假 transport 记账），短预算全部经 `refreshAll` 的第三参注入 ——
	// 生产默认值（8 / 3 / 25s / 120s / 800·1600·1200ms）一个字不改。
	section("刷新调度：全局并发 ≤ 8 / 同主机 ≤ 3 / 每条目超时 / 分级重试 / 整轮硬上限");
	{
		const refreshSrc = readFileSync(path.join(REPO, "src", "client", "50-refresh.js"), "utf8");
		const engineApiSrc = readFileSync(path.join(REPO, "src", "client", "engine-api.js"), "utf8");
		check("⑮ 常量：REFRESH_MAX_PARALLEL = 8 / REFRESH_HOST_MAX_PARALLEL = 3 / REFRESH_ENTRY_TIMEOUT_MS = 25000 / REFRESH_HARD_CAP_MS = 120000",
			/const REFRESH_MAX_PARALLEL = 8;/.test(refreshSrc)
			&& /const REFRESH_HOST_MAX_PARALLEL = 3;/.test(refreshSrc)
			&& /const REFRESH_ENTRY_TIMEOUT_MS = 25000;/.test(refreshSrc)
			&& /const REFRESH_HARD_CAP_MS = 120000;/.test(refreshSrc));
		check("⑮ 重试退避改成分级：瞬时类 800/1600（2 次）、限流类 1200（1 次）；旧的「一次 400ms」常量已取消",
			/const REFRESH_RETRY_TRANSIENT_DELAYS_MS = \[800, 1600\];/.test(refreshSrc)
			&& /const REFRESH_RETRY_LIMITED_DELAYS_MS = \[1200\];/.test(refreshSrc)
			&& !/const REFRESH_RETRY_DELAY_MS/.test(refreshSrc)
			&& /\bretryClassOf\b/.test(refreshSrc) && /"limited"/.test(refreshSrc) && /"transient"/.test(refreshSrc));
		check("⑮ 旧的「整轮共用 20s」常量已取消（代码里不再声明/引用 REFRESH_TIMEOUT_MS，注释里的历史说明不算）",
			!/const REFRESH_TIMEOUT_MS/.test(refreshSrc) && !/\|\| REFRESH_TIMEOUT_MS/.test(refreshSrc)
			&& !/REFRESH_TIMEOUT_MS/.test(engineApiSrc));
		check("⑮ selfCheck 的 timeoutMs 改成**每条目**预算：默认值用 REFRESH_ENTRY_TIMEOUT_MS、按对象传给调度层",
			/\(options && options\.timeoutMs\) \|\| REFRESH_ENTRY_TIMEOUT_MS/.test(engineApiSrc)
			&& /runEntriesWithDeadline\(targets, \{ entryTimeoutMs: timeoutMs \}\)/.test(engineApiSrc));
		check("⑮ 注释写清新模型与真机证据（fgo-jp 被整轮 deadline 掐 / nikki4 全并发下 HTTP 403）",
			/fgo-jp/.test(refreshSrc) && /nikki4/.test(refreshSrc)
			&& /REFRESH_MAX_PARALLEL/.test(refreshSrc) && /REFRESH_HARD_CAP_MS/.test(refreshSrc));

		// —— 夹具 / transport 小工具（全离线：假 transport 按 URL 回夹具正文或状态码）——
		const FIX_BIWIKI = readFileSync(path.join(FIXTURES_DIR, "p3e-custom-bwiki-html", "response.txt"), "utf8");
		const FIX_NOMATCH = readFileSync(path.join(FIXTURES_DIR, "p3e-custom-nomatch", "response.txt"), "utf8");
		// 夹具抓取时刻（与 cases-p3 的 P3E_NOW_BWIKI 同一份，通用解析才选得出当期）
		const FX_NOW = Date.parse("2026-11-07T00:28:21.868Z");
		const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
		const respOf = (status, body) => ({
			ok: status >= 200 && status < 300, status, headers: { get: () => null },
			text: async () => body, json: async () => JSON.parse(body)
		});
		// 假 transport：既记"每个 URL 被请求几次"，也记"同时在飞"的峰值（全局 + 每主机）。
		const hostOfUrl = (u) => { try { return new URL(String(u)).hostname; } catch { return ""; } };
		const makeTransport = (handler) => {
			const calls = [];
			let inFlight = 0, peak = 0;
			const perHost = new Map();   // host → { inFlight, peak }
			const transport = {
				async fetchRaw(url) {
					const u = String(url);
					calls.push(u);
					const h = hostOfUrl(u);
					let hs = perHost.get(h);
					if (!hs) { hs = { inFlight: 0, peak: 0 }; perHost.set(h, hs); }
					inFlight++; peak = Math.max(peak, inFlight);
					hs.inFlight++; hs.peak = Math.max(hs.peak, hs.inFlight);
					try { return await handler(u); } finally { inFlight--; hs.inFlight--; }
				},
				async fetchViaProxy() { throw new Error("本段用例只走直连"); }
			};
			return { transport, calls, peakOf: () => peak, hostPeakOf: (h) => (perHost.get(h) || { peak: 0 }).peak };
		};
		const engineOf = (transport) => createEngine({
			transport, storage: makeStore(), now: () => FX_NOW, timer: { setTimeout, clearTimeout }
		});
		// 自定义条目：id 不在抓取器表里 ⇒ 走通用解析兜底（allowGenericGacha = custom:true）
		const entryOf = (i, patch) => Object.assign({
			id: "sim-" + i, name: "模拟条目 " + i, custom: true,
			url: "https://example.invalid/sim/" + i
		}, patch || {});

		// ① 全局并发上限：24 条、每条 1 个请求、假 transport 内挂 20ms ⇒ 在飞峰值恰为 8（不超、也不串行）。
		//    ⚠️ 每条用**不同主机**：同主机另有 ≤3 的上限（见下面 ①b），这里只量全局池。
		{
			const fx = makeTransport(async () => { await new Promise((r) => setTimeout(r, 20)); return respOf(200, FIX_NOMATCH); });
			const engine = engineOf(fx.transport);
			const entries = Array.from({ length: 24 }, (_, i) =>
				entryOf(i, { url: "https://g" + i + ".example.invalid/sim/" + i }));
			const round = await engine.__test.refreshAll(entries, {}, { entryTimeoutMs: 5000, hardCapMs: 30000, retryDelayMs: 5 });
			check("⑮① 同时在飞的条目峰值 ≤ 8（REFRESH_MAX_PARALLEL 池化生效）",
				fx.peakOf() <= 8, String(fx.peakOf()));
			check("⑮① 峰值恰为 8（不是退化成串行 / 1 条在飞）", fx.peakOf() === 8, String(fx.peakOf()));
			check("⑮① 24 条全部定稿且没有 down；refreshAll 返回结构不变（okCount / total / status / results）",
				round.results.length === 24
				&& round.results.every((r) => r && r.ok === true && !(r.gachaFail && r.gachaFail.kind === "down"))
				&& round.okCount === 24 && round.total === 24 && round.status === "ok",
				JSON.stringify({ peak: fx.peakOf(), okCount: round.okCount, total: round.total, status: round.status }));
		}

		// ② 每条目超时：一条的卡池侧永远不返回（transport 也不理会 signal）⇒ 只有那一条那一侧记超时、
		//    其余条目全部正常；整轮在注入的**每条目**预算（120ms）附近结束，而不是等生产默认 25s。
		{
			const HANG = "https://example.invalid/sim/hang";
			const fx = makeTransport(async (u) => (u.startsWith(HANG) ? new Promise(() => {}) : respOf(200, FIX_BIWIKI)));
			const engine = engineOf(fx.transport);
			const entries = [entryOf(0), entryOf(1), entryOf(2, { url: HANG }), entryOf(3)];
			const t0 = Date.now();
			const round = await engine.__test.refreshAll(entries, {}, { entryTimeoutMs: 120, hardCapMs: 5000, retryDelayMs: 5 });
			const elapsed = Date.now() - t0;
			const hung = round.results[2];
			check("⑮② 卡住的条目只把它自己的卡池侧记 {kind:\"down\", reason:\"超时\"}（文案/形状不变）",
				hung && hung.ok === false && hung.reason === "超时"
				&& hung.gachaFail && hung.gachaFail.kind === "down" && hung.gachaFail.reason === "超时",
				JSON.stringify(hung));
			check("⑮② 该条目未配置的活动侧仍是 eventNone（不冒充超时）",
				hung && hung.eventFail === null && hung.eventNone === true, JSON.stringify(hung));
			check("⑮② 其余 3 条全部正常（ok、无 down、通用解析真的出了卡池内容）",
				[0, 1, 3].every((i) => {
					const r = round.results[i];
					return r && r.ok === true && !(r.gachaFail && r.gachaFail.kind === "down")
						&& !!(r.data && r.data.banner);
				}),
				JSON.stringify([0, 1, 3].map((i) => round.results[i] && { ok: round.results[i].ok, banner: round.results[i].data && round.results[i].data.banner })));
			check("⑮② 整轮在注入的**每条目**预算附近结束（≥100ms 且远小于 25s：没退化成整轮 deadline）",
				elapsed >= 100 && elapsed < 2000, elapsed + "ms");
		}

		// ②b 同一轮里"已经回来的侧保留结果"：卡池侧 200、活动侧永远不返回 ⇒ 只有活动侧记超时
		{
			const HANG_EVENT = "https://example.invalid/sim/hang-event";
			const fx = makeTransport(async (u) => (u.startsWith(HANG_EVENT) ? new Promise(() => {}) : respOf(200, FIX_BIWIKI)));
			const engine = engineOf(fx.transport);
			const twoSide = [{ id: "sim-two", name: "两侧条目", custom: true, url: "https://example.invalid/sim/two-gacha", eventUrl: HANG_EVENT }];
			const round = await engine.__test.refreshAll(twoSide, {}, { entryTimeoutMs: 120, hardCapMs: 5000, retryDelayMs: 5 });
			const r = round.results[0];
			check("⑮②b 条目到点时：已回来的卡池侧保留结果、只有没回来的活动侧记超时",
				r && r.ok === false && r.reason === "超时" && r.gachaFail === null
				&& !!(r.data && r.data.banner)
				&& r.eventFail && r.eventFail.kind === "down" && r.eventFail.reason === "超时",
				JSON.stringify(r && { ok: r.ok, banner: r.data && r.data.banner, gachaFail: r.gachaFail, eventFail: r.eventFail }));
		}

		// ③ 瞬时失败重试一次：① 403 → 200 成功且请求恰为 2；② 两次 403 仍失败且请求恰为 2；
		//    ③ nomatch（200 但读不出内容）不重试、请求恰为 1。
		{
			const hits = { a: 0, b: 0, c: 0 };
			const fx = makeTransport(async (u) => {
				if (u.includes("retry-ok")) { hits.a++; return hits.a === 1 ? respOf(403, "forbidden") : respOf(200, FIX_BIWIKI); }
				if (u.includes("retry-down")) { hits.b++; return respOf(403, "forbidden"); }
				if (u.includes("retry-nomatch")) { hits.c++; return respOf(200, FIX_NOMATCH); }
				return respOf(404, "");
			});
			const engine = engineOf(fx.transport);
			const entries = [
				{ id: "sim-retry-ok", name: "重试成功", custom: true, url: "https://example.invalid/sim/retry-ok" },
				{ id: "sim-retry-down", name: "重试仍失败", custom: true, url: "https://example.invalid/sim/retry-down" },
				{ id: "sim-retry-nomatch", name: "未命中不重试", custom: true, url: "https://example.invalid/sim/retry-nomatch" }
			];
			const round = await engine.__test.refreshAll(entries, {}, { entryTimeoutMs: 3000, hardCapMs: 10000, retryDelayMs: 20 });
			check("⑮③ 第一次 HTTP 403、第二次 200 ⇒ 用重试结果（成功、解析出卡池内容）",
				round.results[0] && round.results[0].ok === true && !!(round.results[0].data && round.results[0].data.banner)
				&& !(round.results[0].gachaFail && round.results[0].gachaFail.kind === "down"),
				JSON.stringify(round.results[0] && { ok: round.results[0].ok, fail: round.results[0].gachaFail }));
			check("⑮③ 上述条目请求数恰为 2（退避后只重试一次）", hits.a === 2, String(hits.a));
			check("⑮③ 两次都 403 ⇒ 仍是 {kind:\"down\"}（reason 含 403）且请求数恰为 2（只重试一次）",
				hits.b === 2 && round.results[1] && round.results[1].ok === false
				&& round.results[1].gachaFail && round.results[1].gachaFail.kind === "down"
				&& /403/.test(round.results[1].gachaFail.reason || ""),
				JSON.stringify({ hits: hits.b, fail: round.results[1] && round.results[1].gachaFail }));
			check("⑮③ nomatch 不重试：请求数恰为 1、结果 ok（kind:nomatch）",
				hits.c === 1 && round.results[2] && round.results[2].ok === true
				&& round.results[2].gachaFail && round.results[2].gachaFail.kind === "nomatch",
				JSON.stringify({ hits: hits.c, fail: round.results[2] && round.results[2].gachaFail }));
		}

		// ④ 整轮硬上限：所有条目都挂住 ⇒ 整轮在注入的短硬上限（250ms）附近结束、全部按超时口径收尾
		//    （每条目预算故意设成 5000ms，证明"是硬上限在兜底"而不是每条目超时）。
		//    2026-11-18 起这 20 条同主机 ⇒ 同时最多 3 条在飞、其余 17 条在等主机槽位 ——
		//    硬上限到点必须把**等待者**也一起收尾（不能留下永远挂在 hostAcquire 上的 worker）。
		{
			const fx = makeTransport(async () => new Promise(() => {}));
			const engine = engineOf(fx.transport);
			const t0 = Date.now();
			const round = await engine.__test.refreshAll(Array.from({ length: 20 }, (_, i) => entryOf(i)), {},
				{ entryTimeoutMs: 5000, hardCapMs: 250, retryDelayMs: 5 });
			const elapsed = Date.now() - t0;
			check("⑮④ 整轮硬上限到点即结束（注入 250ms；没有等 20 条 × 5s 的每条目预算）",
				elapsed >= 200 && elapsed < 3000, elapsed + "ms");
			check("⑮④ 未完成的 20 条全部按超时口径收尾（{kind:\"down\", reason:\"超时\"}）",
				round.results.length === 20 && round.results.every((r) => r && r.ok === false && r.reason === "超时"
					&& r.gachaFail && r.gachaFail.kind === "down" && r.gachaFail.reason === "超时"),
				JSON.stringify(round.results.map((r) => r && r.reason)));
		}

		// ⑯（2026-11-18 新增）同主机并发 ≤ 3 + 分级重试的**次数**边界。
		//   真机依据：imas 五款（gakumas / shinycolors / millisita / deresute / shanison）共用
		//   `https://melonpapapapa-n.com/imas_*_202611/`（各 ~650KB），同一轮同时 502 / 超时；
		//   复测 5 页并发全 200、214~960ms ⇒ 上游瞬时抖动 ⇒ 用同主机 3 并发 + 分级重试兜住。
		{
			// ①a 同主机 10 条（与另外 10 个不同主机交错）⇒ 该主机在飞峰值 ≤ 3（且真的用到 3 不串行），
			//     全局峰值仍 ≤ 8（同主机上限不是把整轮压成 3）。
			const SHARED = "example.invalid";
			const fx = makeTransport(async () => { await new Promise((r) => setTimeout(r, 20)); return respOf(200, FIX_NOMATCH); });
			const engine = engineOf(fx.transport);
			const entries = [];
			for (let i = 0; i < 20; i++) {
				entries.push(i % 2 === 0
					? entryOf(i, { url: "https://" + SHARED + "/sim/shared-" + i })
					: entryOf(i, { url: "https://o" + i + ".example.invalid/sim/solo-" + i }));
			}
			const round = await engine.__test.refreshAll(entries, {}, { entryTimeoutMs: 5000, hardCapMs: 30000, retryDelayMs: 5 });
			check("⑯①a 同主机 10 条并发 ⇒ 该主机在飞峰值 ≤ 3（REFRESH_HOST_MAX_PARALLEL 生效）",
				fx.hostPeakOf(SHARED) <= 3, String(fx.hostPeakOf(SHARED)));
			check("⑯①a ……且峰值恰为 3（不是退化成同主机串行）", fx.hostPeakOf(SHARED) === 3, String(fx.hostPeakOf(SHARED)));
			check("⑯①a 全局在飞峰值仍 ≤ 8（同主机上限没有压死全局并发）", fx.peakOf() <= 8, String(fx.peakOf()));
			check("⑯①a 20 条全部定稿且 ok（同主机排队不影响结果）",
				round.results.length === 20 && round.results.every((r) => r && r.ok === true) && round.okCount === 20,
				JSON.stringify({ ok: round.okCount, total: round.total }));

			// ② 瞬时类（http-5xx）：连续两次 502、第三次 200 ⇒ 用重试结果（成功），请求数恰为 3（2 次重试）。
			{
				let hits = 0;
				const fx5 = makeTransport(async (u) => {
					if (u.includes("retry-5xx")) { hits++; return hits <= 2 ? respOf(502, "bad gateway") : respOf(200, FIX_BIWIKI); }
					return respOf(404, "");
				});
				const e5 = engineOf(fx5.transport);
				const round5 = await e5.__test.refreshAll(
					[{ id: "sim-retry-5xx", name: "5xx 重试", custom: true, url: "https://retry5xx.example.invalid/sim/retry-5xx" }],
					{}, { entryTimeoutMs: 5000, hardCapMs: 10000, retryDelayMs: 5 });
				check("⑯② http-5xx 连续失败两次、第三次成功 ⇒ 成功（瞬时类允许 2 次重试）",
					round5.results[0] && round5.results[0].ok === true && !!(round5.results[0].data && round5.results[0].data.banner),
					JSON.stringify(round5.results[0] && { ok: round5.results[0].ok, fail: round5.results[0].gachaFail }));
				check("⑯② 上述条目请求数恰为 3（2 次重试；不是 1 次、也不是无限重试）", hits === 3, String(hits));
			}

			// ③ 限流类（http-403）：两次都 403 ⇒ down，请求数恰为 2（只允许重试 1 次，别硬顶）。
			{
				let hits = 0;
				const fx4 = makeTransport(async (u) => {
					if (u.includes("retry-403")) { hits++; return respOf(403, "forbidden"); }
					return respOf(404, "");
				});
				const e4 = engineOf(fx4.transport);
				const round4 = await e4.__test.refreshAll(
					[{ id: "sim-retry-403", name: "403 重试", custom: true, url: "https://retry403.example.invalid/sim/retry-403" }],
					{}, { entryTimeoutMs: 5000, hardCapMs: 10000, retryDelayMs: 5 });
				check("⑯③ 两次都 403 ⇒ 仍是 down（reason 含 403）且请求数恰为 2（限流类只重试 1 次）",
					hits === 2 && round4.results[0] && round4.results[0].ok === false
					&& round4.results[0].gachaFail && round4.results[0].gachaFail.kind === "down"
					&& /403/.test(round4.results[0].gachaFail.reason || ""),
					JSON.stringify({ hits, fail: round4.results[0] && round4.results[0].gachaFail }));
			}

			// ④ nomatch（200 但读不出当期内容）属非瞬时类 ⇒ 不重试，请求数恰为 1。
			{
				let hits = 0;
				const fxN = makeTransport(async (u) => {
					if (u.includes("retry-nomatch")) { hits++; return respOf(200, FIX_NOMATCH); }
					return respOf(404, "");
				});
				const eN = engineOf(fxN.transport);
				const roundN = await eN.__test.refreshAll(
					[{ id: "sim-retry-nomatch", name: "未命中", custom: true, url: "https://retrynm.example.invalid/sim/retry-nomatch" }],
					{}, { entryTimeoutMs: 5000, hardCapMs: 10000, retryDelayMs: 5 });
				check("⑯④ nomatch 不重试：请求数恰为 1、结果 ok（kind:nomatch）",
					hits === 1 && roundN.results[0] && roundN.results[0].ok === true
					&& roundN.results[0].gachaFail && roundN.results[0].gachaFail.kind === "nomatch",
					JSON.stringify({ hits, fail: roundN.results[0] && roundN.results[0].gachaFail }));
			}
		}
	}
}
