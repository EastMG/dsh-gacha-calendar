// Host-side entry for dsh-gacha-calendar.
// Registers the settings namespace so the Settings > Plugins page enumerates
// the plugin's configurable card (the browser half renders the card UI).
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

/** Settings namespace persisted through DSH Settings. */
const GACHA_NAMESPACE = "gacha-calendar";

/** Cordis configuration schema for this plugin's persisted settings. */
const Config = z.object({
	autoRefresh: z.boolean().default(true),
	refreshMinutes: z.number().min(1).max(1440).default(30),
	order: z.array(z.string()).default([]),
	lastRefresh: z.number().default(0),
	lastSource: z.string().default("builtin")
});

/** Required services (host side). */
const inject = [];

export function apply(ctx, config = {}) {
	let current = () => config;
	installSettingsSection(ctx, settingsNamespace(GACHA_NAMESPACE), Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
}

export { inject };
