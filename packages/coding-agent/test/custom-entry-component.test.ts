import { beforeAll, describe, expect, test } from "vitest";
import type { EntryRenderer } from "../src/core/extensions/types.ts";
import type { CustomEntry } from "../src/core/session-manager.ts";
import { CustomEntryComponent } from "../src/modes/interactive/components/custom-entry.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const entry: CustomEntry = {
	type: "custom",
	id: "entry",
	parentId: null,
	timestamp: "2026-10-16T00:00:00.000Z",
	customType: "live-presentation",
};

describe("custom entry component live content", () => {
	beforeAll(() => initTheme("dark"));

	test.each([false, true])("hides and restores the same entry, initially hidden=%s", (initiallyHidden) => {
		let hidden = initiallyHidden;
		let text = "ORIGINAL_CONTENT";
		let factories = 0;
		let renders = 0;
		let invalidations = 0;
		const renderer: EntryRenderer = () => {
			factories++;
			return {
				render: () => {
					renders++;
					return hidden ? [] : [text];
				},
				invalidate: () => {
					invalidations++;
				},
			};
		};
		const component = new CustomEntryComponent(entry, renderer);
		expect(component.hasContent()).toBe(true);
		expect(component.render(80)).toEqual(initiallyHidden ? [] : ["", "ORIGINAL_CONTENT"]);
		hidden = true;
		text = "LATEST_HIDDEN_CONTENT";
		expect(component.render(40)).toEqual([]);
		hidden = false;
		expect(component.render(40)).toEqual(["", "LATEST_HIDDEN_CONTENT"]);
		expect(renders).toBe(3);
		expect(factories).toBe(1);
		component.invalidate();
		expect(invalidations).toBe(1);
		expect(component.render(80)).toEqual(["", "LATEST_HIDDEN_CONTENT"]);
	});

	test("preserves intentional blank child content and its leading spacer", () => {
		const component = new CustomEntryComponent(entry, () => ({ render: () => [""], invalidate() {} }));
		expect(component.render(80)).toEqual(["", ""]);
	});

	test("keeps an undefined renderer result absent", () => {
		const component = new CustomEntryComponent(entry, () => undefined);
		expect(component.hasContent()).toBe(false);
		expect(component.render(80)).toEqual([]);
	});

	test("retains renderer errors and host spacing", () => {
		const component = new CustomEntryComponent(entry, () => {
			throw new Error("RENDER_FAILURE");
		});
		const lines = component.render(100);
		expect(lines[0]).toBe("");
		expect(stripAnsi(lines.join("\n"))).toContain("[live-presentation] renderer failed: RENDER_FAILURE");
	});

	test("preserves explicit expansion changes while visibility stays live", () => {
		let hidden = false;
		const component = new CustomEntryComponent(entry, (_entry, options) => ({
			render: () => (hidden ? [] : [options.expanded ? "EXPANDED" : "COLLAPSED"]),
			invalidate() {},
		}));
		component.setExpanded(true);
		expect(component.render(80)).toEqual(["", "EXPANDED"]);
		hidden = true;
		expect(component.render(80)).toEqual([]);
		hidden = false;
		expect(component.render(80)).toEqual(["", "EXPANDED"]);
	});
});
