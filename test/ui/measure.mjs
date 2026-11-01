// test/ui/measure.mjs —— 在页面里量几何（page.evaluate 的函数体）
//
// ⚠️ 这个函数会被 Playwright **序列化**送进浏览器：它必须自包含 ——
//    不许引用模块级变量/import 的符号（只许用参数与浏览器全局）。
//
// 量的都是 **getBoundingClientRect / getComputedStyle / getBBox**（真实 CSS 布局结果），
// 不是"从 CSS 文本里 grep 一个数字"—— 这正是这套 harness 存在的理由。

export function measurePage() {
	const rect = (el) => {
		if (!el) return null;
		const b = el.getBoundingClientRect();
		return { x: b.x, y: b.y, w: b.width, h: b.height, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
	};
	const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
	const num = (v) => {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : 0;
	};
	// 文字**真正的起点**：input 的内容盒左缘 = 边框盒左缘 + 左边框 + 左内边距。
	// 这正是 2026-11-01 那次 bug 的裂缝：类规则被行内 padding 盖掉后，这个值会左移。
	const textStartX = (el) => rect(el).left + num(cs(el, "borderLeftWidth")) + num(cs(el, "paddingLeft"));
	// 内容盒右缘（不含 padding/border）
	const contentRight = (el) => rect(el).right - num(cs(el, "borderRightWidth")) - num(cs(el, "paddingRight"));
	const contentBottom = (el) => rect(el).bottom - num(cs(el, "borderBottomWidth")) - num(cs(el, "paddingBottom"));

	const byId = (id) => document.getElementById(id);
	const scroller = (el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
		scrollHeight: el.scrollHeight,
		clientHeight: el.clientHeight
	});

	// ── 选择器路径（失败信息里用来定位；最多 3 层）────────────────────────────
	const desc = (el) =>
		el.tagName.toLowerCase() +
		(el.id ? "#" + el.id : "") +
		(el.classList && el.classList.length ? "." + [...el.classList].join(".") : "");
	const pathOf = (el) => {
		const parts = [];
		let n = el;
		let depth = 0;
		while (n && n.nodeType === 1 && depth < 3) {
			parts.unshift(desc(n));
			n = n.parentElement;
			depth++;
		}
		return parts.join(" > ");
	};

	// ── F 组：溢出扫描（子元素是否越出容器边界，容差 1px）────────────────────
	const scan = (root) => {
		if (!root) return { missing: true, offenders: [] };
		const cr = root.getBoundingClientRect();
		const offenders = [];
		for (const el of root.querySelectorAll("*")) {
			const b = el.getBoundingClientRect();
			if (!b.width && !b.height) continue; // 不参与布局的节点（如 <path> 的 0×0）跳过
			const over = {
				left: cr.left - b.left,
				right: b.right - cr.right,
				top: cr.top - b.top,
				bottom: b.bottom - cr.bottom
			};
			const worst = Math.max(over.left, over.right, over.top, over.bottom);
			if (worst > 1) offenders.push({ sel: pathOf(el), over, rect: rect(el) });
		}
		return { rect: rect(root), offenders };
	};

	// ── A/B：侧栏底栏槽位 ────────────────────────────────────────────────────
	const slot = (id) => {
		const el = byId(id);
		if (!el) return { missing: true };
		const parent = byId(id + "-parent");
		return {
			display: cs(el, "display"),
			dir: cs(el, "flexDirection"),
			rect: rect(el),
			scroll: scroller(el),
			parentScroll: parent ? scroller(parent) : null,
			children: [...el.children].map((c) => ({ cls: String(c.className || ""), rect: rect(c) }))
		};
	};

	// ── C：设置页搜索框 ──────────────────────────────────────────────────────
	const setShell = byId("fx-set-find");
	const setInput = byId("fx-set-input");
	const setIcon = setShell ? setShell.querySelector(".gacha-cal-set-find-ic") : null;
	const settings = !setShell ? { missing: true } : {
		shell: rect(setShell),
		shellScroll: scroller(setShell),
		shellContentRight: contentRight(setShell),
		shellContentBottom: contentBottom(setShell),
		icon: rect(setIcon),
		input: rect(setInput),
		textStartX: textStartX(setInput),
		inputScroll: scroller(setInput),
		inputStyle: {
			paddingLeft: cs(setInput, "paddingLeft"),
			paddingRight: cs(setInput, "paddingRight"),
			borderLeftWidth: cs(setInput, "borderLeftWidth"),
			fontSize: cs(setInput, "fontSize"),
			lineHeight: cs(setInput, "lineHeight")
		}
	};

	// ── C/D：新面板底栏（搜索框 + 刷新 + 齿轮）────────────────────────────────
	const svgInfo = (el) => {
		if (!el) return null;
		const r = rect(el);
		const vb = el.viewBox && el.viewBox.baseVal ? el.viewBox.baseVal : null;
		let bbox = null;
		try {
			const b = el.getBBox();
			// getBBox 的单位是 viewBox 用户单位 ⇒ 换算成**渲染像素**才能与尺寸比较
			bbox = vb && vb.width
				? { x: b.x, y: b.y, w: b.width, h: b.height, pxW: (b.width * r.w) / vb.width, pxH: (b.height * r.h) / vb.height }
				: { x: b.x, y: b.y, w: b.width, h: b.height, pxW: b.width, pxH: b.height };
		} catch (e) {
			bbox = null;
		}
		return {
			rect: r,
			attrWidth: el.getAttribute("width"),
			attrHeight: el.getAttribute("height"),
			viewBox: el.getAttribute("viewBox"),
			strokeWidth: el.getAttribute("stroke-width"),
			fill: el.getAttribute("fill"),
			bbox
		};
	};

	const foot = byId("fx-panel-foot");
	const find = byId("fx-find");
	const findInput = byId("fx-find-input");
	const findIcon = find ? find.querySelector(".gacha-cal-sched-find-ic") : null;
	const panel = !foot ? { missing: true } : {
		foot: rect(foot),
		footScroll: scroller(foot),
		find: rect(find),
		findContentRight: contentRight(find),
		findScroll: scroller(find),
		input: rect(findInput),
		inputScroll: scroller(findInput),
		textStartX: textStartX(findInput),
		inputStyle: {
			paddingLeft: cs(findInput, "paddingLeft"),
			paddingRight: cs(findInput, "paddingRight"),
			borderLeftWidth: cs(findInput, "borderLeftWidth"),
			fontSize: cs(findInput, "fontSize")
		},
		icon: rect(findIcon),
		refresh: svgInfo(byId("fx-refresh") ? byId("fx-refresh").querySelector("svg") : null),
		gear: svgInfo(byId("fx-gear") ? byId("fx-gear").querySelector("svg") : null)
	};

	// 两处放大镜（设置页 vs 面板底栏）—— D 组比"同规格"
	const magnifiers = { settings: svgInfo(setIcon), panel: svgInfo(findIcon) };

	// ── E：近期行 ────────────────────────────────────────────────────────────
	const nearpg = byId("fx-nearpg");
	const recent = !nearpg ? { missing: true } : {
		page: rect(nearpg),
		scroll: scroller(nearpg),
		rows: [...nearpg.children].map((row) => ({
			id: row.id,
			rect: rect(row),
			scroll: scroller(row),
			padTop: num(cs(row, "paddingTop")),
			padBottom: num(cs(row, "paddingBottom")),
			icon: rect(row.querySelector(".gacha-cal-sched-uic")),
			kids: [...row.children].map((k) => ({
				cls: String(k.className || ""),
				rect: rect(k),
				scroll: scroller(k),
				whiteSpace: cs(k, "whiteSpace"),
				fontSize: cs(k, "fontSize"),
				lineHeight: cs(k, "lineHeight")
			}))
		}))
	};

	// ── F：对四个被测容器各扫一次 ─────────────────────────────────────────────
	const overflow = {
		sidebarSlot2: scan(byId("fx-slot-2")),
		sidebarSlot3: scan(byId("fx-slot-3")),
		settingsRow: scan(byId("fx-set-find")),
		panelFoot: scan(byId("fx-panel-foot")),
		recentList: scan(nearpg)
	};

	// 页面上是否真的挂上了压力样式（诊断用：证明压力规则**已注入**，而不是被漏掉）
	const pressureStyle = document.getElementById("fx-host-pressure");
	return {
		viewport: { w: innerWidth, h: innerHeight },
		hasPressureStyle: !!pressureStyle,
		slots: { one: slot("fx-slot-1"), two: slot("fx-slot-2"), three: slot("fx-slot-3") },
		settings,
		panel,
		magnifiers,
		recent,
		overflow
	};
}
