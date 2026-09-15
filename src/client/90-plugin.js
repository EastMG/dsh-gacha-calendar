		//#region plugin
		const inject = ["slots", "settingsScope", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-gacha-calendar";
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-gacha-calendar: styles");

			// DSH 设置页左侧导航的 section 图标由 navIcon 硬编码（未知 id 一律默认齿轮），
			// 插件无法通过 settings.section 配置图标；这里在设置面板打开后，把
			// "二游排期" 导航项的齿轮图标替换为日历图标（Lucide 风格 16px，幂等）。
			// 性能：MutationObserver 回调只置脏标记，用 requestAnimationFrame 合并执行；
			// patch 先查 dialog 是否存在，不存在立即返回（Web 端高频 DOM 变化时开销极小）。
			ctx.effect(() => {
				const LABEL = "\u4E8C\u6E38\u6392\u671F";
				const CAL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
				let raf = 0;
				const patch = () => {
					raf = 0;
					const dialog = document.querySelector('[role="dialog"]');
					if (!dialog) return;
					const buttons = dialog.querySelectorAll("nav button");
					for (const btn of buttons) {
						const labelEl = btn.querySelector("span");
						if (!labelEl || labelEl.textContent.trim() !== LABEL) continue;
						if (btn.dataset.gachaCalIcon === "1") continue;
						const icon = btn.querySelector("svg");
						if (icon) {
							icon.style.display = "none"; // 隐藏 DSH 默认齿轮
							const wrap = document.createElement("span");
							wrap.setAttribute("aria-hidden", "true");
							wrap.innerHTML = CAL_ICON_SVG;
							// 插到按钮第一个子元素位置（与 DSH 图标同级，flex 子项对齐一致）
							btn.insertBefore(wrap.firstChild, btn.firstChild);
							btn.dataset.gachaCalIcon = "1";
						}
					}
				};
				const schedule = () => {
					if (raf) return;
					raf = requestAnimationFrame(patch);
				};
				schedule();
				const mo = new MutationObserver(schedule);
				mo.observe(document.body, { childList: true, subtree: true });
				return () => {
					mo.disconnect();
					if (raf) cancelAnimationFrame(raf);
				};
			}, "dsh-gacha-calendar: settings nav icon");

			// 全局截断文字悬停 marquee（面板 + 设置页共用）：内容超出容器时加
			// gacha-cal-marq 并计算滚动距离，让内层 span 来回滚动显示全文（未超宽不加）。
			ctx.effect(() => {
				const onOver = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (!cell) return;
					const inner = cell.querySelector(".gacha-cal-inner");
					if (!inner) return;
					const dist = inner.scrollWidth - cell.clientWidth;
					if (dist > 0) {
						cell.style.setProperty("--gacha-marq-d", `-${dist + 8}px`);
						cell.classList.add("gacha-cal-marq");
					}
				};
				const onOut = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (cell) cell.classList.remove("gacha-cal-marq");
				};
				document.addEventListener("mouseover", onOver);
				document.addEventListener("mouseout", onOut);
				return () => {
					document.removeEventListener("mouseover", onOver);
					document.removeEventListener("mouseout", onOut);
				};
			}, "dsh-gacha-calendar: marquee");

			const scope = ctx.settingsScope.bind({ namespace: NS });
			// core 引擎：抓取/解析/缓存合并都在 engine 里（面板只读它返回的 Result JSON）。
			// 存储适配（settings scope）与传输适配（直连 + 宿主代理）见 92-dsh-env.js。
			const engine = createDshEngine(scope);

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-gacha-calendar",
				priority: -10,
				locale: NS,
				inject: () => ({ scope, engine })
			}, CalendarPanel));

			// 设置页单开一个 section（左侧导航独立页面，参照 dsh-cost-meter 的 settings.section 用法）
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "gacha-calendar",
				order: 25,
				label: "\u4E8C\u6E38\u6392\u671F",
				locale: NS,
				inject: () => ({ scope })
			}, CalendarSettingsPage));
		}
		//#endregion
