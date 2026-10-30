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
// 2026-10-31：**出厂默认改成 0（启动时）**（schema 同步改 `default(0)`）。同时在同一天按用户要求
// 补了**老用户一次性迁移**（已存 1440 = 旧默认的迁到 0，标记 `refreshMigrated`；用户自己选过别的档
// 一律不动）—— 迁移的三种分支与失败重试见 ⑭，那是本文件唯一需要"真调宿主代码"的一段。
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

	// ── ⑭ 老用户一次性迁移：1440（旧默认 = 1 天）→ 0（启动时）────────────────────────
	// 为什么必须补：出厂默认改成 0 对**已经存过 1440 的老用户**完全无效 —— 配置里是显式的 1440。
	// 这条迁移坏掉的三个方向都不报错，只让用户觉得"设置自己变了 / 功能没生效"：
	//   · 漏迁 ⇒ 老用户永远停在 1 天（以为「启动时」没做出来）；
	//   · 误迁 ⇒ 用户自己选的 2 天被悄悄改成 0（设置页看起来"自己变了"）；
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
export const remindGamesOf = (value, fallback) => (Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []));
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
				const config = { refreshMinutes: 1440, newPanelMigrated: true };
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
				check("⑭① 迁移成功留了日志（含条目 id）",
					logText().includes("刷新频率迁移：条目 gacha-calendar 的 refreshMinutes 仍是旧默认 1440（1 天），已一次性迁到 0（启动时）"));
			}

			// ② 用户自己选过 2 天（2880）⇒ **只写标记**，不碰用户的选择
			{
				const config = { refreshMinutes: 2880, newPanelMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭② 值=2880（用户选过 2 天）⇒ 仍只调 1 次 update", settings.updates.length === 1, String(settings.updates.length));
				const u = settings.updates[0] || { patch: {}, keys: "" };
				check("⑭② patch 只有 refreshMigrated: true（既没有 refreshMinutes，也没多写别的键）",
					!!u.patch && u.patch.refreshMigrated === true && u.keys === "refreshMigrated", JSON.stringify(u.patch));
				check("⑭② …… refreshMinutes 一个字节都没动（用户的选择不被覆盖）",
					!!u.patch && !Object.prototype.hasOwnProperty.call(u.patch, "refreshMinutes"), JSON.stringify(u.patch));
			}

			// ②b 键缺失（= 从没存过，新用户 / 已清空的配置）⇒ 也只补标记（现在就是 0，无需写值）
			{
				const config = { newPanelMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭②b refreshMinutes 键缺失 ⇒ 只写 refreshMigrated: true（不凭空写值）",
					settings.updates.length === 1 && settings.updates[0].keys === "refreshMigrated", JSON.stringify(settings.updates));
			}

			// ②c 已经是「启动时」（0）⇒ 同样只补标记
			{
				const config = { refreshMinutes: 0, newPanelMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭②c 值已经是 0（启动时）⇒ 只写标记，不重复写 0",
					settings.updates.length === 1 && settings.updates[0].keys === "refreshMigrated", JSON.stringify(settings.updates));
			}

			// ③ 已迁移（标记 true）：零动作 —— 用户改回去不许被反复覆写
			{
				const config = { refreshMinutes: 1440, refreshMigrated: true, newPanelMigrated: true };
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
				const config = { refreshMinutes: volatileOf(1440), refreshMigrated: volatileOf(false), newPanelMigrated: true };
				const settings = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, settings).ctx, config, settings);
				check("⑭③b volatile 引用形态下也认得出 1440（解包没漏 ⇒ 不是「永远读到 undefined」）",
					settings.updates.length === 1 && settings.updates[0].keys === "refreshMigrated,refreshMinutes",
					JSON.stringify(settings.updates));
			}

			// ④ 失败不崩：update 抛错 ⇒ 函数不抛、只记日志；apply() 本身仍完成
			{
				const config = { refreshMinutes: 1440, newPanelMigrated: true };
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
				const config = { refreshMinutes: 1440, newPanelMigrated: true };
				const failing = settingsOf("throw");
				await mod.migrateRefreshOnce(ctxOf(config, failing).ctx, config, failing);
				check("⑭⑤ 失败那轮只尝试 1 笔", failing.updates.length === 1, String(failing.updates.length));
				const ok = settingsOf();
				await mod.migrateRefreshOnce(ctxOf(config, ok).ctx, config, ok);
				check("⑭⑤ …… 紧接着重试（标记仍未写）⇒ 这次真写下 { refreshMinutes: 0, refreshMigrated: true }",
					ok.updates.length === 1 && ok.updates[0].keys === "refreshMigrated,refreshMinutes"
					&& ok.updates[0].patch.refreshMinutes === 0, JSON.stringify(ok.updates));
			}

			// ⑥ 静态度量：void 触发（不 await）、整段 try/catch、两笔各自一次 update、都读裸值
			{
				const applyText = srcText.slice(srcText.indexOf("export function apply("));
				check("⑭⑥ apply() 里是 void 触发（不 await：一次配置写入不许拖慢插件加载）",
					/void migrateRefreshOnce\(ctx, config, settingsCtx\.settings\);/.test(applyText)
					&& !/await migrateRefreshOnce\(/.test(srcText));
				const fnAt = srcText.indexOf("async function migrateRefreshOnce(");
				const fnEnd = fnAt >= 0 ? srcText.indexOf("\n}\n", fnAt) : -1;
				const fnText = fnAt >= 0 && fnEnd > fnAt ? srcText.slice(fnAt, fnEnd) : "";
				check("⑭⑥ 迁移函数切片已定位（静态断言没瞎）", fnText.length > 800, String(fnText.length));
				check("⑭⑥ 整段包在 try/catch 里（失败只记日志，绝不让插件加载失败）",
					/try \{/.test(fnText) && /\} catch \(err\) \{/.test(fnText));
				check("⑭⑥ 两条分支各一次 settings.update（共 2 处，没有第三笔 = 不留半状态）",
					(fnText.match(/settings\.update\(/g) || []).length === 2,
					String((fnText.match(/settings\.update\(/g) || []).length));
				check("⑭⑥ 1440 分支：值与标记在**同一次** update 里（不是两次写）",
					/await settings\.update\(ns, \{ refreshMinutes: 0, refreshMigrated: true \}\);/.test(fnText));
				check("⑭⑥ 其它值分支：只写标记 { refreshMigrated: true }",
					/await settings\.update\(ns, \{ refreshMigrated: true \}\);/.test(fnText));
				check("⑭⑥ 标记判定读**裸值**且严格 === true（volatile 引用不解包会永远读到 undefined）",
					/if \(configValueOf\(cfg, "refreshMigrated"\) === true\) return;/.test(fnText));
				check("⑭⑥ 只看当前值：解包后 `=== 1440` 才走迁移值那条分支",
					/const current = configValueOf\(cfg, "refreshMinutes"\);/.test(fnText)
					&& /if \(current === 1440\) \{/.test(fnText));
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
		} catch (err) {
			check("⑭ 迁移用例整套能跑完（抛异常即视为失败，见 detail）", false, String((err && err.stack) || err));
		} finally {
			if (prevLocalAppData === void 0) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = prevLocalAppData;
			try { rmSync(box, { recursive: true, force: true }); } catch { /* 清不掉不影响门禁 */ }
		}
	}
}
