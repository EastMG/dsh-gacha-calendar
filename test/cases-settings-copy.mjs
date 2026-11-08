// test/cases-settings-copy.mjs —— 设置页 8 处 `title` 文案定稿守卫（2026-11-01 用户逐条指令）
//
// ── 这文件守什么 ──
// 用户当轮逐条点名改了 `src/client/84-settings-page.js` 里的 8 个 `title`（**只这 8 处**）：
//
//   ① 通知身份「启用/移除」按钮   ：…会在开始菜单建一条无害的快捷方式（可随时移除）
//                                  → …**需要在开始菜单新建快捷方式**
//   ② 「发送测试通知」按钮        ：**整条 title 删掉**（按钮文案已自解释）
//   ③ 「名称」输入框的 label      ：…应用名（最多 40 字；文件名非法字符会被去掉）→ **应用名称**
//   ④ 「当前：…」状态 span        ：…当前显示的应用名 → …当前应用名称
//   ⑤ 「按钮轮播」那一行 div      ：有卡池或活动在 **N 小时内结束或开始时** → **即将结束时**
//   ⑥ 「搜游戏名」输入框          ：**整条 title 删掉**（`aria-label="按游戏名搜索"` 保留）
//   ⑦ 版本号 span                 ：**整条 title 删掉**（`.gacha-cal-version` 只显示 vX.Y.Z）
//   ⑧ 「上次自检 X 前」span       ：三元两个分支都去掉括号里那句「（与面板刷新的时间无关）」
//
// 2026-11-01 第二轮（同一份合同，用户逐条再删 3 处）：
//   ⑨ 提醒列空态提示 span         ：**整条 title 删掉**（可见文字「未勾选任何游戏 ⇒ 不提醒」保留）
//   ⑩ 「只看已启用」label         ：**整条 title 删掉**（label 文字「只看已启用」保留）
//   ⑪ 健康行 title                ：**删掉第二行**（`\n第四列「上次成功 X 前」= …`），只留 `h.name + " · " + h.text`
//
// 2026-11-08 第三轮（用户逐条再删 5 处文案 / 改 1 处；⑨ 从"只删 title"升级为"整块删"）：
//   ⑫ 提醒开关右侧说明 span       ：整条删（「到期前弹系统通知（仅 DSH 运行期间）」）
//   ⑬ 「提醒」那一行 div 的 title ：整条删（「到点时用系统通知提醒：…」）
//   ⑭ 「结束提醒」档位行 tooltip  ：整条删（`remindChipRow` 的 titleText 参数一并去掉）
//   ⑮ 「开始提醒」档位行（注释）  ：整行注释删掉（停用说明保留）
//   ⑯ 提醒列空态条件渲染整块      ：删（连 `SHOW_REMIND_COLUMN && remindIds.length === 0` 一起）
//   ⑰ `shortcut-name-taken` 文案  ：→「与开始菜单已有快捷方式冲突」
//   ⑱ 测试通知正文第三行          ：→「看到这条通知 说明系统通知可用」（中间半角空格）
//
// 为什么单独成段：这些文案散在「通知身份 / 轮播 / 搜索 / 版本号 / 健康 / 提醒」六个特性里，
// 但它们是**同一份产品文案合同**；改回去、或者删 title 时手一抖留下 `title: ""`，都该在这里红。
//
// 三条铁律：
//   ① **反向守卫**：上面各轮列出的旧字符串在**生产代码**（`src/` 全部 .js）与**产物**（`lib/client.js`）里都不许再出现；
//   ② **正向守卫**：新字符串**逐字**存在，而且确实挂在**对应的那个控件**上（只查"文件里有这句话"太弱）；
//   ③ **删除型守卫**：②⑥⑦⑨⑩ 的 title 是从**该控件附近的源码切片**里消失的 —— 不是从别处挪走的。
//
// ⚠️ 段数守卫：本文件是 `test/all.mjs` 的第 26 段（README_Dev.md / test/README.md 的「N 段」跟着它走）。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { REPO, readComponentsSource } from "./load.mjs";

const LIB_CLIENT = path.join(REPO, "lib", "client.js");

/** 递归收集 src/ 下的全部 .js（生产代码 = 源的唯一真源；样式/夹具不在其中）。 */
function collectSourceFiles(dir, acc) {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
		else if (name.endsWith(".js")) acc.push([path.relative(REPO, full), readFileSync(full, "utf8")]);
	}
	return acc;
}

// ── 8 条**旧**文案（改前逐字；反向守卫用）────────────────────────────────────
const OLD_COPY = [
	["① 通知身份按钮", "更改系统通知的发送者：会在开始菜单建一条无害的快捷方式（可随时移除）"],
	["② 发送测试通知按钮", "立刻弹一条系统通知，确认通知链路通不通"],
	["③ 名称输入框", "通知横幅顶部的应用名（最多 40 字；文件名非法字符会被去掉）"],
	["④ 当前状态 span", "系统通知横幅顶部当前显示的应用名"],
	["⑤ 按钮轮播行", "有卡池或活动在 N 小时内结束或开始时，侧栏按钮轮播显示"],
	["⑥ 搜游戏名输入框", "按游戏名过滤（大小写 / 全半角不敏感；空格分隔 = 每个词都要命中）"],
	["⑦ 版本号 span", "插件版本（与 package.json 的 version 一致）"],
	["⑧ 上次自检 span", "上次「立即检查」的时间（与面板刷新的时间无关）"]
];

// ── 5 条**新**文案（改后逐字；②⑥⑦ 是"整条删掉"，没有新文案）────────────────
const NEW_COPY = [
	["① 通知身份按钮", "更改系统通知的发送者：需要在开始菜单新建快捷方式"],
	["③ 名称输入框", "通知横幅顶部的应用名称"],
	["④ 当前状态 span", "系统通知横幅顶部当前应用名称"],
	["⑤ 按钮轮播行", "有卡池或活动在即将结束时，侧栏按钮轮播显示"],
	["⑧ 上次自检 span", "上次「立即检查」的时间"]
];

/** `title:` 属性（含 JSX 里写成 `title: "…"` 的形态）。 */
const TITLE_PROP = /\btitle\s*:/;

export default function runSettingsCopy() {
	section("设置页 title 文案（11 处定稿：5 条改写 + 6 条删除）");

	const comp = readComponentsSource();
	const lib = readFileSync(LIB_CLIENT, "utf8");
	const sources = collectSourceFiles(path.join(REPO, "src"), []);

	// ── 0) 切片锚点先定位，否则后面的"附近没有 title"会假绿 ──────────────────────
	// 三个**删除型**控件（②⑥⑦）各截一段对象字面量的源码切片；一处找不到就说明控件被重写了。
	const SLICES = {
		testBtn: /\(0, react_jsx_runtime\.jsx\)\("button", \{[\s\S]{0,600}?onClick: sendTestNotify,[\s\S]{0,200}?children: notifyTestBusy \? "发送中…" : "发送测试通知"/.exec(comp),
		searchInput: /className: "gacha-cal-set-find-in",[\s\S]{0,600}?onKeyDown: \(e\) => \{ if \(e\.key === "Escape"\)/.exec(comp),
		versionSpan: /\(0, react_jsx_runtime\.jsx\)\("span", \{ className: "gacha-cal-version",[^}]*\}/.exec(comp)
	};
	const missingAnchor = Object.keys(SLICES).filter((k) => !SLICES[k]);
	check("三个删除型控件都能定位到源码切片（守卫自身没瞎）", missingAnchor.length === 0,
		"没定位到：" + missingAnchor.join(", "));

	// ── 1) 反向：8 条旧字符串在 src/ 与 lib/client.js 里都不许再出现 ─────────────
	// 为什么连 src/ 全量扫：文案可能被顺手"抄"到别的段（比如宿主侧说明），只查设置页会漏。
	for (const [label, old] of OLD_COPY) {
		const inSrc = sources.filter(([, text]) => text.includes(old)).map(([f]) => f);
		const inLib = lib.includes(old);
		check(`${label}：旧文案不在生产代码里（src/ 与 lib/client.js）`,
			inSrc.length === 0 && !inLib,
			JSON.stringify({ src: inSrc, lib: inLib }));
	}

	// ── 2) 正向：5 条新字符串逐字存在（src + 产物都要，否则就是忘了 build）────────
	for (const [label, next] of NEW_COPY) {
		check(`${label}：新文案逐字存在（生产代码 + 产物）`,
			comp.includes(next) && lib.includes(next));
	}
	// ⑧ 是三元：两个分支都要在（前一支去掉括号里那句、后一支原样保留）
	check("⑧ 三元两个分支都在：`上次「立即检查」的时间` / `还没有跑过「立即检查」`",
		/title: healthCheckedAt > 0 \? "上次「立即检查」的时间" : "还没有跑过「立即检查」"/.test(comp)
		&& /title: healthCheckedAt > 0 \? "上次「立即检查」的时间" : "还没有跑过「立即检查」"/.test(lib));

	// ── 3) 正向（上下文）：新文案确实挂在**那个控件**上，不是随便哪儿的一句 ────────
	// 判据：以该文案为中心取一段源码，那段里必须同时出现该控件的**专属**标识。
	const AROUND = (needle, before, after) => {
		const at = comp.indexOf(needle);
		return at < 0 ? "" : comp.slice(Math.max(0, at - before), at + needle.length + after);
	};
	{
		const s = AROUND("title: \"更改系统通知的发送者：需要在开始菜单新建快捷方式\"", 400, 400);
		check("① 新 title 挂在通知身份「启用/移除」按钮上（同一段里有 toggleNotifyIdentity + 启用/移除文案）",
			s.includes("toggleNotifyIdentity") && s.includes('? "移除" : "启用"'));
	}
	{
		const s = AROUND("title: \"通知横幅顶部的应用名称\"", 200, 700);
		check("③ 新 title 挂在「名称」那个 label 上（同一段里有「名称」+ aria-label=通知身份名称）",
			s.includes('children: "名称"') && s.includes('"aria-label": "通知身份名称"'));
	}
	{
		const s = AROUND("title: \"系统通知横幅顶部当前应用名称\"", 300, 700);
		check("④ 新 title 挂在「当前：…」状态 span 上（同一段里有「当前：」+ PowerShell（默认）兜底）",
			s.includes('children: "当前："') && s.includes("PowerShell（默认）"));
	}
	{
		const s = AROUND("title: \"有卡池或活动在即将结束时，侧栏按钮轮播显示\"", 500, 900);
		check("⑤ 新 title 挂在「按钮轮播」那一行（同一段里有 tickerOn + 轮播范围 + tickerHours）",
			s.includes("tickerOn") && s.includes("轮播范围") && s.includes('commit("tickerHours"'));
	}
	{
		const s = AROUND("title: healthCheckedAt > 0 ? \"上次「立即检查」的时间\"", 400, 400);
		check("⑧ 新 title 挂在 .gacha-cal-health-checked 那个 span 上（同一段里有 healthCheckedText）",
			s.includes('className: "gacha-cal-health-checked"') && s.includes("children: healthCheckedText"));
	}

	// ── 4) 删除型：②⑥⑦ 那三个控件的切片里**没有 title**，且各自的要件还在 ────────
	{
		const slice = SLICES.testBtn ? SLICES.testBtn[0] : "";
		check("②「发送测试通知」按钮的 title 整条删掉（按钮对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("②「发送测试通知」按钮本身没被改坏（仍是 sendTestNotify + 「发送测试通知」文案）",
			slice.includes("disabled: notifyTestBusy") && slice.includes('"发送测试通知"'));
	}
	{
		const slice = SLICES.searchInput ? SLICES.searchInput[0] : "";
		check("⑥「搜游戏名」输入框的 title 整条删掉（input 对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("⑥ aria-label=\"按游戏名搜索\" 保留、placeholder/筛选行为不变",
			slice.includes('"aria-label": "按游戏名搜索"') && slice.includes('placeholder: "搜游戏名"')
			&& slice.includes("setGameQuery(e.target.value)"));
	}
	{
		const slice = SLICES.versionSpan ? SLICES.versionSpan[0] : "";
		check("⑦ 版本号 span 的 title 整条删掉（span 对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("⑦ 版本号仍然由 PLUGIN_VERSION 拼（`children: \"v\" + PLUGIN_VERSION`）",
			slice.includes('className: "gacha-cal-version"') && slice.includes('children: "v" + PLUGIN_VERSION'));
	}

	// ── 4b) 第二轮（2026-11-01）：⑨ 提醒列空态 / ⑩ 只看已启用 / ⑪ 健康行 title ──────
	// 三处都是**删**：⑨⑩ 整条 title 删掉，⑪ 只删 title 的拼接尾巴（第二行）。
	const ROUND2 = [
		["⑨ 提醒列空态提示 span", "「提醒」列一个都没勾 ⇒ 到期提醒不会弹任何通知；在每行的「提醒」列勾上才提醒"],
		["⑩ 只看已启用 label", "只列当前展示中的条目（不写设置）"],
		["⑪ 健康行 title 第二行", "第四列「上次成功 X 前」= 自检时观察到的该源最近一次成功解析（由「立即检查」观察，不是面板刷新时间）"]
	];
	for (const [label, old] of ROUND2) {
		const inSrc = sources.filter(([, text]) => text.includes(old)).map(([f]) => f);
		const inLib = lib.includes(old);
		check(`${label}：旧文案不在生产代码里（src/ 与 lib/client.js）`,
			inSrc.length === 0 && !inLib,
			JSON.stringify({ src: inSrc, lib: inLib }));
	}
	{
		// ⑯ 2026-11-08 用户要求把「白名单为空」那句**整块**删掉（先前只删 title、保留可见文字）。
		const GONE3 = [
			["⑫ 提醒开关右侧说明", "到期前弹系统通知（仅 DSH 运行期间）"],
			["⑬「提醒」行 tooltip", "到点时用系统通知提醒：结束前若干小时，同一件事只发最紧急的一档"],
			["⑭「结束提醒」档位行 tooltip", "结束前多久提醒（可多选；全不选 = 结束不提醒）"],
			["⑮「开始提醒」档位行（注释）", "开始前多久提醒（可多选；全不选 = 开始不提醒）"],
			["⑯ 提醒列空态提示", "未勾选任何游戏 ⇒ 不提醒"]
		];
		for (const [label, gone] of GONE3) {
			const inSrc = sources.filter(([, text]) => text.includes(gone)).map(([f]) => f);
			const inLib = lib.includes(gone);
			check(`${label}：文案在生产代码（src/ 与 lib/client.js）里都不再出现`,
				inSrc.length === 0 && !inLib, JSON.stringify({ src: inSrc, lib: inLib }));
		}
		check("⑯ 空态条件渲染整块删掉（源码里没有 `SHOW_REMIND_COLUMN && remindIds.length === 0`）",
			!comp.includes("SHOW_REMIND_COLUMN && remindIds.length === 0"));
		check("⑯ 删块没带走相邻控件：「游戏列表」标题之后仍是搜索框",
			/children: "游戏列表" \}\),\s*\n\s*\/\/ 搜游戏名/.test(comp));
	}
	{
		// ⑩ 切片 = 「只看已启用」那个 label 对象字面量（从 ("label", { 到 label 里的 span 文字）。
		const m = /\(0, react_jsx_runtime\.jsxs\)\("label", \{[\s\S]{0,700}?children: "只看已启用"/.exec(comp);
		const slice = m ? m[0] : "";
		check("⑩「只看已启用」label 能定位到源码切片（守卫自身没瞎）", slice.length > 0);
		check("⑩ label 的 title 整条删掉（切片里没有 title:）", slice.length > 0 && !TITLE_PROP.test(slice));
		check("⑩ label 文字与行为保留：children「只看已启用」+ 受控 onlyShown",
			slice.includes('children: "只看已启用"') && slice.includes("checked: onlyShown")
			&& slice.includes("setOnlyShown(e.target.checked)"));
	}
	{
		// ⑪ 健康行 title：只剩 `h.name + " · " + h.text`，第二行（\n第四列…）不许再出现。
		const TITLE_EXPR = 'title: h.name + " · " + h.text,';
		check("⑪ 健康行 title 逐字是 `title: h.name + \" · \" + h.text,`（src + 产物）",
			comp.includes(TITLE_EXPR) && lib.includes(TITLE_EXPR));
		check("⑪ title 里不再有 `\\n第四列` 那段拼接（src 与 lib/client.js 都没有）",
			comp.indexOf('"\\n第四列') < 0 && lib.indexOf('"\\n第四列') < 0
			&& comp.indexOf('h.text + "') < 0);
	}

	// ── 4c) 2026-11-08 第三轮：两条**新**文案逐字存在（src + 产物）───────────────────
	// ⑰ 是宿主错误码的兜底文案（84-settings-page.js）；⑱ 是测试通知正文第三行（65-remind.js，
	// 中间是**半角空格**，别被编辑器改成全角）。65 不在 COMPONENT_FILES 里，单独取它的源码。
	const remindSrc65 = (sources.find(([f]) => f === path.join("src", "client", "65-remind.js")) || ["", ""])[1];
	check("⑰「与开始菜单已有快捷方式冲突」逐字存在（src + 产物）",
		comp.includes("与开始菜单已有快捷方式冲突") && lib.includes("与开始菜单已有快捷方式冲突"));
	check("⑱「看到这条通知 说明系统通知可用」逐字存在（src + 产物；中间是半角空格）",
		remindSrc65.includes("看到这条通知 说明系统通知可用") && lib.includes("看到这条通知 说明系统通知可用"));
	check("⑱ 测试通知旧第三行「看到这条说明系统通知链路是通的」在 src/ 与 lib/client.js 里都不再出现",
		sources.every(([, text]) => !text.includes("看到这条说明系统通知链路是通的"))
		&& !lib.includes("看到这条说明系统通知链路是通的"));

	// ── 5) 格式守卫：删属性不许留下空壳 / 连续逗号，产物必须还能解析 ──────────────
	check("删 title 后没有残留空属性（`title: \"\"` / `title: ,` / `title: }`）",
		!/\btitle\s*:\s*(?:""|'')?\s*[,}]/.test(comp));
	check("删 title 后没有残留连续逗号（`, ,` / `,\\n\\s*,`）",
		!/,\s*,/.test(comp));
	{
		let ok = true;
		try { new Function(lib); } catch (e) { ok = false; }
		check("产物 lib/client.js 仍是可解析的合法 JS（删 JSX 属性没把对象字面量搞坏）", ok);
	}
}
