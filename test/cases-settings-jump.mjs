// test/cases-settings-jump.mjs —— 「两个面板都能一步跳到本插件设置页」（2026-10-31）
//
// ── 这文件守什么 ───────────────────────────────────────────────────────────────
// 目标体验（B）= 点面板上的齿轮，**一步到位**停在 DSH 设置页的「二游日历」那一节。
// DSH 没有"打开设置到指定节"的 API（`settings.openSettingsDocument` 是给 AI 打开配置文档的，
// 不是 UI 跳转）；`Ctrl+Alt+,` 是 Electron 应用级加速键，合成键盘事件无效。实测唯一可用路径是
// 合成点击三步（2026-10-31 在活的 DSH NEXT GUI 上验证过）：
//
//   ① `[data-slot="sidebar.settings"] button[aria-label*="账号"]`  ← 账号菜单
//      （兜底：侧栏底部 `[class*="settingsArea"]` 里**唯一**带 aria-haspopup 的 button）
//   ② 等 `[role="menu"]` 出现 ⇒ 点文本以「设置」开头的项（实际文本「设置Ctrl+Alt+,」）
//   ③ 等 `[role="dialog"]` 出现 ⇒ 点 `dialog nav` 里文本全等「二游日历」的按钮
//      （兜底 aria-label 全等）
//
// 旧实现找的是"aria-haspopup=dialog 且名字像设置"的触发器 —— 那个触发器早已不存在（侧栏底部
// 只剩账号菜单），整条链失效。旧面板的设置按钮因此被 SETTINGS_BUTTON_VISIBLE=false 藏起来。
//
// 本文件守两层：
//   A. **纯判定**（80-shared-ui.js 的 settingsJumpPickOf / settingsJumpPlanOf，经 __regression 导出）：
//      给定假 DOM 快照 ⇒ 该点哪个 / 卡在哪一步。覆盖正常三步、缺账号菜单、菜单里没有设置项、
//      设置开了但没本插件节、设置根本没打开、本插件面板自己的元素必须排除、兜底歧义宁可不点。
//   B. **静态守卫**（读 src/）：按钮恢复显示、两个面板都有「设置」入口、新面板经 props 传入
//      （没传不渲染）、旧面板点击先关面板、三步选择器与失败分支都在、轮询不用固定 sleep。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, readStylesSource } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SRC = path.join(REPO, "src", "client");
const read = (f) => readFileSync(path.join(SRC, f), "utf8");

// record 工厂（与 settingsJumpRecordOf 同形；缺省 = 可见 + 不在本插件面板里）
const rec = (o) => Object.assign({ text: "", ariaLabel: "", title: "", visible: true, inOwnPanel: false, lane: "" }, o || {});

export default async function run() {
	section("设置入口（两个面板的齿轮 + 三步跳转设置页）");

	const { settingsJumpPickOf, settingsJumpPlanOf } = T;
	const shared = read("80-shared-ui.js");
	const view = read("82-schedule-view.js");
	const shell = read("83-panel-shell.js");
	const css = readStylesSource();

	// ── A. 纯判定：整条链（假 DOM 快照）──────────────────────────────────────
	{
		check("导出了两个纯判定（settingsJumpPickOf / settingsJumpPlanOf）",
			typeof settingsJumpPickOf === "function" && typeof settingsJumpPlanOf === "function");

		// 正常三步：账号菜单 → 菜单「设置Ctrl+Alt+,」→ 导航「二游日历」
		const okPlan = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单", text: "East晨曦" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," }), rec({ text: "意见反馈" }), rec({ text: "退出登录" })],
			navItems: [rec({ text: "通用设置" }), rec({ text: "二游日历" }), rec({ text: "模型" })],
			dialogCount: 1
		});
		check("正常三步 ⇒ ok", okPlan.ok === true, JSON.stringify(okPlan));
		check("正常三步 ⇒ 点的是账号菜单那一枚", okPlan.account && okPlan.account.ariaLabel === "账号菜单");
		check("正常三步 ⇒ 菜单项按「设置」前缀命中（不是「意见反馈」）",
			okPlan.menuItem && okPlan.menuItem.text === "设置Ctrl+Alt+,");
		check("正常三步 ⇒ 导航项全等「二游日历」（不是「通用设置」）",
			okPlan.navItem && okPlan.navItem.text === "二游日历");

		// ① 找不到账号菜单
		const noAccount = settingsJumpPlanOf({ accountMenus: [], menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "二游日历" })], dialogCount: 1 });
		check("缺账号菜单 ⇒ ok:false", noAccount.ok === false);
		check("缺账号菜单 ⇒ step=account-menu", noAccount.step === "account-menu", String(noAccount.step));
		check("缺账号菜单 ⇒ reason=account-menu-missing", noAccount.reason === "account-menu-missing", String(noAccount.reason));

		// ② 菜单里没有设置项
		const noMenu = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单" })],
			menuItems: [rec({ text: "意见反馈" }), rec({ text: "退出登录" })],
			navItems: [rec({ text: "二游日历" })], dialogCount: 1
		});
		check("菜单里没有设置项 ⇒ ok:false", noMenu.ok === false);
		check("菜单里没有设置项 ⇒ step=settings-item", noMenu.step === "settings-item", String(noMenu.step));
		check("菜单里没有设置项 ⇒ reason=settings-item-missing", noMenu.reason === "settings-item-missing", String(noMenu.reason));

		// ③ 设置开了，但导航里没有本插件那一节
		const noNav = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })],
			navItems: [rec({ text: "通用设置" }), rec({ text: "模型" }), rec({ text: "插件市场" })], dialogCount: 1
		});
		check("设置开了但没本插件节 ⇒ ok:false", noNav.ok === false);
		check("设置开了但没本插件节 ⇒ step=plugin-section", noNav.step === "plugin-section", String(noNav.step));
		check("设置开了但没本插件节 ⇒ reason=plugin-section-missing", noNav.reason === "plugin-section-missing", String(noNav.reason));

		// ④ 设置面板根本没打开（点完菜单项后没有 dialog）—— 与 ③ 区分开
		const noDialog = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })],
			navItems: [], dialogCount: 0
		});
		check("设置面板没打开 ⇒ ok:false", noDialog.ok === false);
		check("设置面板没打开 ⇒ reason=settings-dialog-missing（不是 plugin-section-missing）",
			noDialog.reason === "settings-dialog-missing", String(noDialog.reason));

		// ⑤ 必须排除本插件自己的面板（旧 bug：点设置把自己打开）
		const ownNav = settingsJumpPlanOf({
			accountMenus: [
				rec({ lane: "primary", ariaLabel: "二游日历", inOwnPanel: true }), // 面板触发器，不能点
				rec({ lane: "primary", ariaLabel: "账号菜单", text: "East晨曦" })
			],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })],
			navItems: [rec({ text: "二游日历", inOwnPanel: true, id: "own" }), rec({ text: "二游日历", id: "settings" })],
			dialogCount: 1
		});
		check("本插件面板里的触发器被排除（仍能点到账号菜单）", ownNav.ok === true && ownNav.account.ariaLabel === "账号菜单");
		check("本插件面板里的同名导航项被排除（点的是设置页那一枚）", ownNav.navItem && ownNav.navItem.id === "settings");
		const onlyOwn = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })],
			navItems: [rec({ text: "二游日历", inOwnPanel: true })], dialogCount: 1
		});
		check("导航里只有本插件面板里的同名项 ⇒ 仍然失败（绝不点自己）",
			onlyOwn.ok === false && onlyOwn.reason === "plugin-section-missing");

		// ⑥ 不可见的不点
		const hidden = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单", visible: false }), rec({ lane: "primary", ariaLabel: "账号菜单", id: "shown" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "二游日历" })], dialogCount: 1
		});
		check("隐藏的账号菜单跳过、用可见的那一枚", hidden.ok === true && hidden.account.id === "shown");

		// ⑦ 兜底：settingsArea 里**唯一**带 aria-haspopup 的 button；多个就不猜
		const fallback1 = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "fallback", ariaLabel: "账号菜单" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "二游日历" })], dialogCount: 1
		});
		check("账号菜单主选择器落空 ⇒ 唯一兜底候选可用", fallback1.ok === true && fallback1.account.lane === "fallback");
		const fallback2 = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "fallback", ariaLabel: "账号菜单" }), rec({ lane: "fallback", ariaLabel: "别的菜单" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "二游日历" })], dialogCount: 1
		});
		check("兜底有多个候选 ⇒ 宁可不点（account-menu-missing）",
			fallback2.ok === false && fallback2.reason === "account-menu-missing");
		const primaryFirst = settingsJumpPlanOf({
			accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单", id: "primary" }), rec({ lane: "fallback", ariaLabel: "账号菜单", id: "fallback" })],
			menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "二游日历" })], dialogCount: 1
		});
		check("主选择器优先于兜底", primaryFirst.ok === true && primaryFirst.account.id === "primary");

		// ⑧ 单步判定：前缀 / 全等 / aria-label 兜底
		check("菜单项匹配「设置」前缀（含快捷键后缀）",
			settingsJumpPickOf("settings-item", [rec({ text: "意见反馈" }), rec({ text: "设置Ctrl+Alt+," })]).hit.text === "设置Ctrl+Alt+,");
		check("导航匹配是**全等**，不是包含（「二游日历设置」不算）",
			settingsJumpPickOf("plugin-section", [rec({ text: "二游日历设置" })]).ok === false);
		check("导航文本不可用 ⇒ 退到 aria-label 全等",
			settingsJumpPickOf("plugin-section", [rec({ text: "", ariaLabel: "二游日历" })]).ok === true);
		check("导航标签可外部传入（settingsJumpPlanOf 的 snapshot.label）",
			settingsJumpPlanOf({
				label: "别的分区", accountMenus: [rec({ lane: "primary", ariaLabel: "账号菜单" })],
				menuItems: [rec({ text: "设置Ctrl+Alt+," })], navItems: [rec({ text: "别的分区" })], dialogCount: 1
			}).ok === true);
	}

	// ── B. 静态守卫：旧面板（83-panel-shell.js）──────────────────────────────
	{
		check("SETTINGS_BUTTON_VISIBLE 改回 true（旧面板设置按钮恢复）",
			/const SETTINGS_BUTTON_VISIBLE = true;/.test(shared));
		check("旧面板：设置按钮受 SETTINGS_BUTTON_VISIBLE 控制",
			/SETTINGS_BUTTON_VISIBLE && \(0, react_jsx_runtime\.jsx\)\("button", \{/.test(shell));
		// 截出设置按钮那一段（到下一处「抓取提示」注释），只在这段里断言
		const iBtn = shell.indexOf("SETTINGS_BUTTON_VISIBLE &&");
		const iEnd = shell.indexOf("// 抓取提示", iBtn);
		const oldBtn = iBtn >= 0 && iEnd > iBtn ? shell.slice(iBtn, iEnd) : "";
		check("旧面板：能定位设置按钮（守卫自身没瞎）", oldBtn.length > 0, `i=${iBtn} end=${iEnd}`);
		check("旧面板：按钮样式不变（gacha-cal-refresh 类）", /className: "gacha-cal-refresh"/.test(oldBtn));
		const iClose = oldBtn.indexOf("setOpen(false);");
		const iJump = oldBtn.indexOf("openPluginSettingsSection();");
		check("旧面板：点击**先关面板**再跳转", iClose >= 0 && iJump > iClose, `close=${iClose} jump=${iJump}`);
	}

	// ── C. 静态守卫：新面板（82-schedule-view.js）─────────────────────────────
	{
		check("新面板：ScheduleView 通过 props 接收 onOpenSettings",
			/function ScheduleView\(\{[^}]*onOpenSettings[^}]*\}\)/.test(view));

		const iFoot = view.indexOf('className: "gacha-cal-sched-foot"');
		// 底栏的结束点：下一个函数的注释。不能拿第一个 `] })` 当界 —— 搜索框自己就有一个，
		// 会把齿轮截在区域外。
		const iFootEnd = view.indexOf("// 侧栏按钮的翻页层", iFoot);
		const foot = iFoot >= 0 && iFootEnd > iFoot ? view.slice(iFoot, iFootEnd) : "";
		check("新面板：能定位底栏（守卫自身没瞎）", foot.length > 0);
		const iRefresh = foot.indexOf('className: "gacha-cal-sched-btn"');
		const iGear = foot.indexOf('className: "gacha-cal-sched-gear"');
		// 两个按钮各自的 JSX 片段（齿轮在最右 ⇒ 刷新的片段到齿轮开标签为止）。
		// 下面所有"规格"检查都在这两段上做：拿整条底栏做正则的话，两枚图标会互相冒充
		// （改坏其中一枚，另一枚照样让检查通过）。
		const refreshBtn = iRefresh >= 0 && iGear > iRefresh ? foot.slice(iRefresh, iGear) : "";
		const gearBtn = iGear >= 0 ? foot.slice(iGear) : "";
		check("新面板：齿轮在「刷新」按钮**右侧**（最外侧）", iRefresh >= 0 && iGear > iRefresh, `refresh=${iRefresh} gear=${iGear}`);
		check("新面板：能切出「刷新」/齿轮两个按钮的片段（守卫自身没瞎）",
			refreshBtn.length > 0 && gearBtn.length > 0, `refresh=${refreshBtn.length} gear=${gearBtn.length}`);
		check("新面板：没传 onOpenSettings ⇒ 不渲染（三元 + : null）",
			/onOpenSettings \? \(0, react_jsx_runtime\.jsx\)\("button", \{\s*type: "button", className: "gacha-cal-sched-gear",[\s\S]*?\}\) : null/.test(foot));
		check("新面板：齿轮 title/aria-label 都是「设置」",
			/title: "设置", "aria-label": "设置"/.test(foot));
		check("新面板：齿轮是 16px / 16 viewBox / strokeWidth 1.5（与底栏图标同一套）",
			/width: "16", height: "16", viewBox: "0 0 16 16"/.test(gearBtn) && /strokeWidth: "1\.5"/.test(gearBtn));
		check("新面板：齿轮样式类在 CSS 里有定义（20×20 图标按钮）",
			/\.gacha-cal-sched-gear\{[^}]*width:20px[^}]*height:20px/.test(css));
		check("新面板：齿轮不抢「刷新」的 margin-left:auto（不破坏底栏排布）",
			!/\.gacha-cal-sched-gear\{[^}]*margin-left:auto/.test(css));

		// ── 底栏图标统一：刷新图标必须与齿轮**同一套**（2026-10-31 用户要求）────────────
		// 用户要的是"看起来是一套"：viewBox / strokeWidth / 渲染尺寸 / 圆头圆角 只要有一项不一致，
		// 两枚图标在 20px 的一行里就会粗细或大小不一样。所以这里**逐字比对**两段 svg 的属性串，
		// 不是各查各的 —— 只改一半（比如换了 viewBox 忘改 strokeWidth）当场就红。
		const svgSpecOf = (t) => {
			const box = /width: "([^"]+)", height: "([^"]+)", viewBox: "([^"]+)", fill: "([^"]+)"/.exec(t);
			const pen = /stroke: "([^"]+)", strokeWidth: "([^"]+)", strokeLinecap: "([^"]+)", strokeLinejoin: "([^"]+)"/.exec(t);
			return box && pen
				? { width: box[1], height: box[2], viewBox: box[3], fill: box[4], stroke: pen[1], strokeWidth: pen[2], strokeLinecap: pen[3], strokeLinejoin: pen[4] }
				: null;
		};
		const rSpec = svgSpecOf(refreshBtn);
		const gSpec = svgSpecOf(gearBtn);
		check("新面板：能从两段片段里各取到 svg 规格（守卫自身没瞎）", !!rSpec && !!gSpec,
			`refresh=${JSON.stringify(rSpec)} gear=${JSON.stringify(gSpec)}`);
		check("新面板：刷新图标与齿轮**逐字相同**（viewBox / strokeWidth / 渲染尺寸 / stroke / 圆头圆角）",
			!!rSpec && !!gSpec && JSON.stringify(rSpec) === JSON.stringify(gSpec),
			`refresh=${JSON.stringify(rSpec)} gear=${JSON.stringify(gSpec)}`);
		// 只换 viewBox 不重算路径 ⇒ 24 网格的坐标塞进 16 网格，图标被裁掉一半（最容易漏的一步）。
		const rCoords = (refreshBtn.match(/(?:d|points): "([^"]+)"/g) || []).join(" ").match(/-?\d+(?:\.\d+)?/g) || [];
		check("新面板：刷新图标的坐标在**16 网格**内（没有 24 网格残留）",
			rCoords.length > 0 && rCoords.every((n) => Number(n) <= 16), rCoords.join(","));

		// ── 纯图标圆按钮（2026-10-31 二改）：去掉「刷新」二字，形态与齿轮一致 ────────────
		// 用户原话：「既有图标又有文字很丑，去掉文字改成一样的圆形图标」。所以先来一条**反向**
		// 守卫：按钮片段里只要还留着那 2 个字的 children，下面所有"形态一致"都是白搭 ——
		// 文字会把 20×20 撑回 pill，齿轮那套尺寸/圆角/居中当场失真。
		check("新面板：刷新按钮里**不再有**「刷新」文字（children 只剩 svg）",
			!/children:\s*"刷新"/.test(refreshBtn)
			&& !/"刷新中\.\.\."/.test(refreshBtn)
			&& /children: \(0, react_jsx_runtime\.jsx\)\("svg", \{/.test(refreshBtn));
		// 去掉文字 ⇒ 名字与状态全压在无障碍属性上：title + aria-label 都必须随 refreshing 切换。
		check("新面板：刷新按钮保留 title（「刷新」/ 忙碌态「刷新中」）",
			/title: refreshing \? "刷新中" : "刷新"/.test(refreshBtn));
		check("新面板：刷新按钮保留 aria-label（「刷新」/ 忙碌态「刷新中」）",
			/"aria-label": refreshing \? "刷新中" : "刷新"/.test(refreshBtn));
		check("新面板：刷新中 disabled + aria-busy=\"true\"（文字没了也要能读出忙碌）",
			/disabled: refreshing/.test(refreshBtn) && /"aria-busy": refreshing \? "true" : "false"/.test(refreshBtn));
		check("新面板：刷新中给按钮挂 is-busy（动画开关，不能只改 title）",
			/className: "gacha-cal-sched-btn" \+ \(refreshing \? " is-busy" : ""\)/.test(refreshBtn));
		check("新面板：刷新按钮 20×20 / 圆形 / 透明底 / padding:0（与齿轮同一形态，点击区不缩小）",
			/\.gacha-cal-sched-btn\{[^}]*width:20px[^}]*height:20px/.test(css)
			&& /\.gacha-cal-sched-btn\{[^}]*border-radius:999px/.test(css)
			&& /\.gacha-cal-sched-btn\{[^}]*padding:0/.test(css)
			&& /\.gacha-cal-sched-btn\{[^}]*background:transparent/.test(css));
		check("新面板：刷新按钮居中方式与齿轮一致（inline-flex + 居中 + 图标不被压扁）",
			/\.gacha-cal-sched-btn\{[^}]*display:inline-flex[^}]*align-items:center[^}]*justify-content:center/.test(css)
			&& /\.gacha-cal-sched-btn svg\{[^}]*flex:0 0 auto/.test(css));
		check("新面板：hover 仍有淡淡底色（只对可点的按钮给反馈）",
			/\.gacha-cal-sched-btn:hover:not\(:disabled\)\{[^}]*background:var\(--dsw-alias-interactive-bg-hover/.test(css));
		check("新面板：忙碌态图标旋转（规则与 keyframes 同名，两条都在）",
			/\.gacha-cal-sched-btn\.is-busy svg\{animation:gacha-cal-sched-btn-spin 1s linear infinite\}/.test(css)
			&& /@keyframes gacha-cal-sched-btn-spin\{from\{transform:rotate\(0\)\}to\{transform:rotate\(360deg\)\}\}/.test(css));
		check("新面板：reduce 下不转（disabled + aria-busy 仍表达状态）",
			/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.gacha-cal-sched-btn\.is-busy svg\{animation:none\}/.test(css));

		// 父层把动作传进来：先关面板，再走新实现
		const iProp = shell.indexOf("onOpenSettings: () => {");
		const propBlock = iProp >= 0 ? shell.slice(iProp, shell.indexOf("}", iProp) + 1) : "";
		check("新面板：父层传入了 onOpenSettings（否则齿轮不渲染）", iProp >= 0);
		const pClose = propBlock.indexOf("setOpen(false);");
		const pJump = propBlock.indexOf("openPluginSettingsSection()");
		check("新面板：点击同样**先关面板**再跳转", pClose >= 0 && pJump > pClose, `close=${pClose} jump=${pJump}`);
	}

	// ── D. 静态守卫：三步跳转实现本身（80-shared-ui.js）────────────────────────
	{
		const iFn = shared.indexOf("function openPluginSettingsSection()");
		const iFnEnd = shared.indexOf("// ── 浏览器侧", iFn);
		const fn = iFn >= 0 && iFnEnd > iFn ? shared.slice(iFn, iFnEnd) : "";
		check("跳转实现：能定位 openPluginSettingsSection（守卫自身没瞎）", fn.length > 0);

		// 三步的选择器都必须在（缺一步就会静默卡死）
		check("① 账号菜单主选择器 = sidebar.settings 里 aria-label*=\"账号\" 的 button",
			/\[data-slot="sidebar\.settings"\] button\[aria-label\*="/.test(shared));
		check("① 兜底 = settingsArea 里带 aria-haspopup 的 button",
			/\[class\*="settingsArea"\]/.test(shared) && /button\[aria-haspopup\]/.test(shared));
		check("② 只在 [role=\"menu\"] 里找菜单项（菜单是 body 级 portal）",
			/\[role="menu"\]/.test(shared));
		check("② 菜单项按「设置」前缀挑（不是全等）",
			/settingsJumpHasPrefix\(r, "\\u8BBE\\u7F6E"\)/.test(shared));
		check("③ 只在 dialog 的 nav 里找本插件那一节（不做整篇文档兜底）",
			/\[role="dialog"\]/.test(shared) && /nav button, nav a/.test(shared));
		check("① 账号菜单不再按旧的 aria-haspopup=\"dialog\" 触发器找",
			!/\[aria-haspopup="dialog"\]/.test(shared));

		// 三步都轮询等待：deadline + SETTINGS_NAV_POLL_MS，不用固定 sleep
		const iWait = shared.indexOf("function settingsJumpWaitFor(");
		const waitFn = iWait >= 0 ? shared.slice(iWait, shared.indexOf("function openPluginSettingsSection()", iWait)) : "";
		check("等待是轮询（deadline + SETTINGS_NAV_POLL_MS），不是固定 sleep",
			/SETTINGS_NAV_TIMEOUT_MS/.test(waitFn) && /Date\.now\(\) >= deadline/.test(waitFn) && /SETTINGS_NAV_POLL_MS/.test(waitFn));
		check("等待里没有写死的毫秒 sleep", !/setTimeout\([^,]+,\s*\d{2,}\)/.test(waitFn));
		check("三步各自调用一次等待（account / menu / nav）",
			(fn.match(/settingsJumpWaitFor\(SETTINGS_JUMP_STEP_/g) || []).length === 3,
			String((fn.match(/settingsJumpWaitFor\(SETTINGS_JUMP_STEP_/g) || []).length));

		// 三种失败分支各有独立的 reason；外加"dialog 没开"再分一档
		check("失败分支：缺账号菜单", /"account-menu-missing"/.test(shared));
		check("失败分支：菜单里没有设置项", /"settings-item-missing"/.test(shared));
		check("失败分支：导航里没有本插件那一节", /"plugin-section-missing"/.test(shared));
		check("失败分支：设置面板根本没打开（与上一条区分）", /"settings-dialog-missing"/.test(shared));
		check("失败不静默：console.warn 出 step + reason", /console\.warn\("\[gacha-calendar\]/.test(shared));
		check("失败不抛异常（返回 { ok:false }，面板不会因为点一下齿轮而炸掉）",
			/\.catch\(\(\) => fail\(/.test(fn));

		// 保留 inOwnPanel：本插件面板里的元素一律不认
		check("保留了 inOwnPanel 排除（面板触发器/导航项不许点）",
			/function isInOwnPanel\(el\)/.test(shared) && /gacha-cal-pop/.test(shared) && /inOwnPanel: isInOwnPanel\(el\)/.test(shared));
	}
}
