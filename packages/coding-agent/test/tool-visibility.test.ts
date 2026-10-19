import {
	type Component,
	resetCapabilitiesCache,
	setCapabilities,
	Text,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { getKittyImagePlacement } from "../../tui/src/terminal-image.ts";
import { dispatchMouseEvent } from "../../tui/src/tui.ts";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { ToolRenderContext, ToolRenderers } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { readRenderers } from "../src/core/tools/renderers/index.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=";
const host = { requestRender: () => {} } as unknown as TUI;

function mouse(x: number, y: number, width: number, height: number): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
}

describe("tool row visibility", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => resetCapabilitiesCache());

	for (const width of [24, 40, 100, 160]) {
		for (const outputPad of [0, 1]) {
			for (const bornHidden of [false, true]) {
				test(`retains the latest stock row at width ${width}, pad ${outputPad}, born hidden ${bornHidden}`, () => {
					let visible = !bornHidden;
					const stock = new ToolExecutionComponent(
						"read",
						"id",
						{ path: "old.txt" },
						{ outputPad },
						readRenderers,
						host,
						process.cwd(),
					);
					const row = new ToolExecutionComponent(
						"read",
						"id",
						{ path: "old.txt" },
						{ outputPad },
						{ ...readRenderers, isVisible: () => visible },
						host,
						process.cwd(),
					);
					expect(row.render(width)).toEqual(bornHidden ? [] : stock.render(width));
					visible = false;
					for (const component of [row, stock]) {
						component.updateArgs({ path: "latest.txt" });
						component.markExecutionStarted();
						component.setArgsComplete();
						component.updateResult({ content: [], isError: false }, true);
						component.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);
						component.updateResult({
							content: [{ type: "text", text: "latest failure" }],
							isError: true,
							durationMs: 20,
						});
						component.setExpanded(true);
						component.setOutputPad(1 - outputPad);
						component.setShowImages(false);
						component.setImageWidthCells(12);
						component.invalidate();
					}
					expect(row.render(width)).toEqual([]);
					expect(dispatchMouseEvent(row, mouse(2, 2, width, 20))).toBeUndefined();
					visible = true;
					expect(row.render(width)).toEqual(stock.render(width));
					expect(stripAnsi(row.render(width).join("\n"))).toContain("latest failure");
				});
			}
		}
	}

	test("uses current context, shares renderer state, and recovers from a throwing predicate", () => {
		let mode: "hidden" | "throw" | "shown" = "hidden";
		let invalidate = () => {};
		const contexts: ToolRenderContext[] = [];
		const definition: ToolRenderers = {
			isVisible: (context) => {
				contexts.push(context);
				if (mode === "throw") throw new Error("visibility failed");
				return mode === "shown";
			},
			renderCall: (_args, _theme, context) => {
				context.state.token ??= "retained";
				invalidate = context.invalidate;
				return context.lastComponent ?? new Text("call", 0, 0);
			},
			renderResult: (_result, _options, _theme, context) =>
				new Text(`${context.state.token}:${context.expanded}:${context.isError}`, 0, 0),
		};
		const row = new ToolExecutionComponent("tool", "id", {}, {}, definition, host, process.cwd());
		expect(row.render(40)).toEqual([]);
		row.updateArgs({ value: "latest" });
		row.updateResult({ content: [], isError: true }, false);
		row.setExpanded(true);
		mode = "throw";
		expect(stripAnsi(row.render(40).join("\n"))).toContain("retained:true:true");
		mode = "hidden";
		invalidate();
		expect(row.render(40)).toEqual([]);
		mode = "shown";
		invalidate();
		expect(stripAnsi(row.render(40).join("\n"))).toContain("retained:true:true");
		expect(contexts.at(-1)).toMatchObject({
			args: { value: "latest" },
			toolCallId: "id",
			expanded: true,
			isError: true,
			isPartial: false,
		});
	});

	test("hides and restores exactly one real Kitty image placement", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		let visible = true;
		const row = new ToolExecutionComponent("tool", "id", {}, {}, { isVisible: () => visible }, host, process.cwd());
		row.updateResult({ content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: false });
		const count = () => row.render(100).filter((line) => getKittyImagePlacement(line)).length;
		expect(count()).toBe(1);
		visible = false;
		row.setShowImages(false);
		row.setShowImages(true);
		row.setImageWidthCells(10);
		expect(row.render(100)).toEqual([]);
		visible = true;
		expect(count()).toBe(1);
	});

	for (const width of [24, 40, 100, 160]) {
		for (const outputPad of [0, 1]) {
			test(`preserves stock mouse responses on every boundary at width ${width}, pad ${outputPad}`, () => {
				const make = (definition: ToolRenderers) => {
					const row = new ToolExecutionComponent(
						"read",
						"id",
						{ path: "notes.txt" },
						{ outputPad },
						definition,
						host,
						process.cwd(),
					);
					row.updateResult({ content: [{ type: "text", text: "result" }], isError: false });
					return row;
				};
				const stock = make(readRenderers);
				const row = make({ ...readRenderers, isVisible: () => true });
				const lines = stock.render(width);
				expect(row.render(width)).toEqual(lines);
				const points = new Set<string>();
				for (let x = 0; x < width; x++) for (const y of [0, 1, lines.length - 1]) points.add(`${x},${y}`);
				for (let y = 0; y < lines.length; y++) for (const x of [0, width - 1]) points.add(`${x},${y}`);
				for (const point of points) {
					const [x, y] = point.split(",").map(Number);
					for (const component of [stock, row]) {
						component.setExpanded(false);
						component.render(width);
					}
					const expected = dispatchMouseEvent(stock, mouse(x!, y!, width, lines.length));
					const actual = dispatchMouseEvent(row, mouse(x!, y!, width, lines.length));
					const flags = (result: typeof actual) =>
						result && {
							handled: result.handled,
							render: result.render,
							focus: result.focus,
							capture: result.capture,
							originX: result.target.originX,
							originY: result.target.originY,
							width: result.target.width,
							height: result.target.height,
						};
					expect(flags(actual)).toEqual(flags(expected));
					expect(row.render(width)).toEqual(stock.render(width));
					if (outputPad === 1) expect(actual).toBeUndefined();
				}
				for (const component of [stock, row]) {
					component.setExpanded(false);
					component.render(width);
					expect(component.handleMouse(mouse(2, 2, width, lines.length))?.handled).toBe(true);
					expect(stripAnsi(component.render(width).join("\n"))).toContain("result");
					component.invalidate();
					expect(component.handleMouse(mouse(2, 2, width, component.render(width).length))?.handled).toBe(true);
					expect(stripAnsi(component.render(width).join("\n"))).not.toContain("result");
				}
			});

			test(`preserves public SGR triple-click selection at width ${width}, pad ${outputPad}`, async () => {
				const run = async (hook: boolean) => {
					const copied: string[] = [];
					const terminal = new VirtualTerminal(width, 12);
					const tui = new TuiAltScreen(terminal, undefined, undefined, {
						copyOnSelect: false,
						copySelection: async (text) => {
							copied.push(text);
							return true;
						},
					});
					const row = new ToolExecutionComponent(
						"read",
						"id",
						{ path: "notes.txt" },
						{ outputPad },
						hook ? { ...readRenderers, isVisible: () => true } : readRenderers,
						tui,
						process.cwd(),
					);
					row.updateResult({ content: [{ type: "text", text: "result" }], isError: false });
					tui.addChild(row);
					tui.start();
					try {
						tui.renderNow();
						for (let i = 0; i < 3; i++) {
							terminal.sendInput("\x1b[<0;1;3M");
							terminal.sendInput("\x1b[<0;1;3m");
							tui.renderNow();
						}
						const selected = tui.hasActiveSelection();
						const copiedSelection = await tui.copyActiveSelectionToClipboard();
						return {
							selected,
							copiedSelection,
							copied,
							lines: row.render(width),
							focus: tui.getFocusedComponent() !== null,
						};
					} finally {
						tui.stop();
					}
				};
				const stock = await run(false);
				expect(await run(true)).toEqual(stock);
				if (outputPad === 1) {
					expect(stock.selected).toBe(true);
					expect(stock.copied.join("\n")).toContain("notes.txt");
				}
			});
		}
	}

	for (const renderShell of ["default", "self"] as const) {
		test(`restores hidden partial, empty, success, and image state in the ${renderShell} shell`, () => {
			setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
			let visible = false;
			const definition: ToolRenderers = {
				renderShell,
				renderCall: () => new Text("call", 0, 0),
				renderResult: (result, options, _theme, context) =>
					new Text(`${JSON.stringify(result.content)}:${options.isPartial}:${context.showImages}`, 0, 0),
			};
			const row = new ToolExecutionComponent(
				"tool",
				"id",
				{},
				{},
				{ ...definition, isVisible: () => visible },
				host,
				process.cwd(),
			);
			const stock = new ToolExecutionComponent("tool", "id", {}, {}, definition, host, process.cwd());
			for (const result of [
				{ content: [], isError: false },
				{ content: [{ type: "text", text: "partial" }], isError: false },
				{ content: [{ type: "text", text: "success" }], isError: false },
				{ content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: false },
			]) {
				visible = false;
				for (const component of [row, stock]) {
					const first = result.content[0];
					component.updateResult(result, first !== undefined && "text" in first && first.text === "partial");
				}
				expect(row.render(100)).toEqual([]);
				visible = true;
				const actual = row.render(100);
				const expected = stock.render(100);
				// Image IDs belong to their one owning Image; compare placement counts and the text separately.
				expect(actual.filter((line) => getKittyImagePlacement(line)).length).toBe(
					expected.filter((line) => getKittyImagePlacement(line)).length,
				);
				expect(actual.filter((line) => !getKittyImagePlacement(line))).toEqual(
					expected.filter((line) => !getKittyImagePlacement(line)),
				);
			}
		});
	}

	test("cancels focus and capture on an empty self-rendered row, and never resumes the old gesture", () => {
		let visible = true;
		const events: string[] = [];
		const child: Component = {
			render: () => (visible ? ["child"] : []),
			invalidate: () => {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true };
			},
		};
		const terminal = new VirtualTerminal(40, 6);
		const tui = new TuiAltScreen(terminal);
		const row = new ToolExecutionComponent(
			"tool",
			"id",
			{},
			{},
			{ renderShell: "self", renderCall: () => child },
			tui,
			process.cwd(),
		);
		tui.addChild(row);
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("\x1b[<0;1;2M");
			expect(tui.getFocusedComponent()).toBe(child);
			visible = false;
			tui.renderNow();
			expect(row.render(40)).toEqual([]);
			expect(tui.getFocusedComponent()).toBeNull();
			visible = true;
			tui.renderNow();
			terminal.sendInput("\x1b[<32;1;2M");
			terminal.sendInput("\x1b[<0;1;2m");
			terminal.sendInput("x");
			expect(events).toEqual(["press"]);
			terminal.sendInput("\x1b[<0;1;2M");
			terminal.sendInput("\x1b[<0;1;2m");
			expect(events).toEqual(["press", "press", "release", "click"]);
		} finally {
			tui.stop();
		}
	});

	for (const mode of ["regular", "fullscreen"] as const) {
		test(`keeps configured keyboard expansion working while a ${mode} row is hidden`, () => {
			const terminal = new VirtualTerminal(100, 24);
			const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
			let visible = false;
			let expanded = false;
			const row = new ToolExecutionComponent(
				"read",
				"id",
				{ path: "notes.txt" },
				{},
				{ ...readRenderers, isVisible: () => visible },
				tui,
				process.cwd(),
			);
			row.updateResult({ content: [{ type: "text", text: "latest output" }], isError: false });
			const editor = new CustomEditor(
				tui,
				defaultEditorTheme,
				new KeybindingsManager({ "app.tools.expand": "ctrl+y" }),
			);
			editor.onAction("app.tools.expand", () => {
				expanded = !expanded;
				row.setExpanded(expanded);
			});
			tui.addChild(row);
			tui.addChild(editor);
			tui.setFocus(editor);
			tui.start();
			try {
				tui.renderNow();
				terminal.sendInput("\x19");
				expect(expanded).toBe(true);
				expect(row.render(100)).toEqual([]);
				visible = true;
				tui.renderNow();
				expect(stripAnsi(row.render(100).join("\n"))).toContain("latest output");
				terminal.sendInput("\x19");
				expect(expanded).toBe(false);
				expect(stripAnsi(row.render(100).join("\n"))).not.toContain("latest output");
				expect(tui.getFocusedComponent()).toBe(editor);
			} finally {
				tui.stop();
			}
		});
	}

	for (const response of [
		undefined,
		{ handled: false, render: true },
		{ handled: true, render: false },
		{ capture: true, focus: true, render: true },
	]) {
		test(`preserves downstream target identity, coordinates, response ${JSON.stringify(response)}, and late invalidation`, () => {
			let label = "old";
			let invalidate = () => {};
			const received: TuiMouseEvent[] = [];
			const child: Component = {
				render: () => [label],
				invalidate: () => {},
				handleMouse: (event) => {
					received.push(event);
					return response;
				},
			};
			const definition: ToolRenderers = {
				renderCall: (_args, _theme, context) => {
					invalidate = context.invalidate;
					return context.lastComponent ?? child;
				},
			};
			let visible = true;
			const stock = new ToolExecutionComponent("tool", "id", {}, {}, definition, host, process.cwd());
			const row = new ToolExecutionComponent(
				"tool",
				"id",
				{},
				{},
				{ ...definition, isVisible: () => visible },
				host,
				process.cwd(),
			);
			row.render(40);
			stock.render(40);
			const event = mouse(3, 2, 40, 4);
			const expected = dispatchMouseEvent(stock, event);
			const actual = dispatchMouseEvent(row, event);
			expect(actual).toEqual(expected);
			if (actual) expect(actual.target.component).toBe(child);
			expect(received[0]).toEqual(received[1]);
			visible = false;
			label = "latest";
			invalidate();
			expect(row.render(40)).toEqual([]);
			expect(row.handleMouse(event)).toBeUndefined();
			expect(received).toHaveLength(2);
			visible = true;
			row.invalidate();
			expect(stripAnsi(row.render(40).join("\n"))).toContain("latest");
		});
	}

	test("denies keyboard focus assigned to a descendant of a row born hidden", () => {
		const inputs: string[] = [];
		const child: Component = {
			render: () => ["child"],
			invalidate: () => {},
			handleInput: (data) => inputs.push(data),
		};
		const terminal = new VirtualTerminal(40, 6);
		const tui = new TuiAltScreen(terminal);
		const row = new ToolExecutionComponent(
			"tool",
			"id",
			{},
			{},
			{ isVisible: () => false, renderCall: () => child },
			tui,
			process.cwd(),
		);
		tui.addChild(row);
		tui.setFocus(child);
		tui.start();
		try {
			terminal.sendInput("x");
			expect(inputs).toEqual([]);
			expect(tui.getFocusedComponent()).toBeNull();
		} finally {
			tui.stop();
		}
	});

	for (const claim of ["handled", "capture", "focus"] as const) {
		for (const change of ["hide", "detach"] as const) {
			test(`invalidates a ${claim} descendant on ${change} before further public input`, () => {
				let visible = true;
				const events: string[] = [];
				const child: Component = {
					render: () => ["target"],
					invalidate: () => {},
					handleMouse: (event) => {
						events.push(event.type);
						return { [claim]: true, focus: true, render: false };
					},
					handleInput: (data) => events.push(data),
				};
				const terminal = new VirtualTerminal(40, 10);
				const tui = new TuiAltScreen(terminal);
				const row = new ToolExecutionComponent(
					"tool",
					"id",
					{},
					{},
					{ isVisible: () => visible, renderCall: () => child },
					tui,
					process.cwd(),
				);
				tui.addChild(row);
				tui.start();
				try {
					tui.renderNow();
					terminal.sendInput("\x1b[<0;3;3M");
					expect(events).toEqual(["press"]);
					expect(tui.getFocusedComponent()).toBe(child);
					terminal.sendInput("x");
					expect(events).toEqual(["press", "x"]);
					if (change === "hide") visible = false;
					else tui.removeChild(row);
					// Input arrives before a requested repaint has run.
					terminal.sendInput("\x1b[<32;30;9M");
					terminal.sendInput("\x1b[<0;3;3m");
					terminal.sendInput("y");
					expect(events).toEqual(["press", "x"]);
					expect(tui.getFocusedComponent()).toBeNull();
					visible = true;
					if (change === "detach") tui.addChild(row);
					tui.renderNow();
					terminal.sendInput("z");
					expect(events).toEqual(["press", "x"]);
					terminal.sendInput("\x1b[<0;3;3M");
					terminal.sendInput("\x1b[<0;3;3m");
					expect(events.slice(-3)).toEqual(["press", "release", "click"]);
				} finally {
					tui.stop();
				}
			});
		}
	}

	for (const slot of ["call", "result"] as const) {
		for (const { capture, renderShell } of [
			{ capture: true, renderShell: "default" },
			{ capture: false, renderShell: "default" },
			{ capture: true, renderShell: "self" },
			{ capture: false, renderShell: "self" },
		] as const) {
			test(`preserves a retained ${slot} child gesture in ${renderShell} across invalidation and streaming with capture ${capture}`, () => {
				const events: TuiMouseEvent[] = [];
				const inputs: string[] = [];
				let invalidate = () => {};
				let visible = true;
				let replace = false;
				let retainedContexts = 0;
				const child: Component = {
					render: () => ["retained-gesture-child"],
					invalidate: () => {},
					handleInput: (data) => inputs.push(data),
					handleMouse: (event) => {
						events.push(event);
						if (event.type === "press" || event.type === "drag") invalidate();
						return { handled: true, capture, focus: true, render: false };
					},
				};
				const replacement = new Text("replacement-child", 0, 0);
				const retain = (context: ToolRenderContext): Component => {
					invalidate = context.invalidate;
					const selected = replace ? replacement : child;
					if (context.lastComponent === selected) {
						retainedContexts++;
						return context.lastComponent;
					}
					return selected;
				};
				const definition: ToolRenderers = { renderShell, isVisible: () => visible };
				if (slot === "call") definition.renderCall = (_args, _theme, context) => retain(context);
				else {
					definition.renderCall = () => new Text("call", 0, 0);
					definition.renderResult = (_result, _options, _theme, context) => retain(context);
				}
				const terminal = new VirtualTerminal(40, 12);
				const tui = new TuiAltScreen(terminal);
				const row = new ToolExecutionComponent("tool", "id", {}, {}, definition, tui, process.cwd());
				row.updateResult({ content: [], isError: false });
				tui.addChild(row);
				tui.start();
				try {
					tui.renderNow();
					const targetRow = () => {
						const index = tui
							.getScreenLines()
							.findIndex((line) => stripAnsi(line).includes("retained-gesture-child"));
						expect(index).toBeGreaterThanOrEqual(0);
						return index;
					};
					const press = () => terminal.sendInput(`\x1b[<0;3;${targetRow() + 1}M`);
					const drag = () => terminal.sendInput("\x1b[<32;30;10M");
					const release = () => terminal.sendInput("\x1b[<0;30;10m");
					const originalRow = targetRow();
					press();
					expect(events.map((event) => event.type)).toEqual(["press"]);
					expect(retainedContexts).toBeGreaterThan(0);
					tui.renderNow();
					expect(targetRow()).toBe(originalRow);
					expect(tui.getFocusedComponent()).toBe(child);
					const beforeFirstStream = retainedContexts;
					row.updateResult({ content: [{ type: "text", text: "stream-one" }], isError: false }, true);
					expect(retainedContexts).toBeGreaterThan(beforeFirstStream);
					tui.renderNow();
					expect(targetRow()).toBe(originalRow);
					terminal.sendInput("x");
					const beforeDragInvalidation = retainedContexts;
					drag();
					expect(retainedContexts).toBeGreaterThan(beforeDragInvalidation);
					const beforeSecondStream = retainedContexts;
					row.updateResult({ content: [{ type: "text", text: "stream-one\nstream-two" }], isError: false }, true);
					expect(retainedContexts).toBeGreaterThan(beforeSecondStream);
					tui.renderNow();
					expect(targetRow()).toBe(originalRow);
					release();
					expect(events.map((event) => event.type)).toEqual(["press", "drag", "release"]);
					expect(inputs).toEqual(["x"]);
					expect(events.at(-1)).toMatchObject({
						x: renderShell === "default" ? 28 : 29,
						y: 9 - originalRow,
						screenX: 29,
						screenY: 9,
					});

					// Preserving internal framing must not extend a hidden or replaced child's input lifetime.
					for (const change of ["hide", "replace"] as const) {
						const count = events.length;
						const keyCount = inputs.length;
						press();
						if (change === "hide") visible = false;
						else replace = true;
						invalidate();
						// Validate ownership before the scheduled repaint.
						drag();
						terminal.sendInput("y");
						expect(events).toHaveLength(count + 1);
						expect(inputs).toHaveLength(keyCount);
						expect(tui.getFocusedComponent()).toBeNull();
						visible = true;
						replace = false;
						invalidate();
						tui.renderNow();
						release();
						terminal.sendInput("y");
						expect(events).toHaveLength(count + 1);
						expect(inputs).toHaveLength(keyCount);
						press();
						tui.renderNow();
						drag();
						release();
						terminal.sendInput("z");
						expect(events.slice(-3).map((event) => event.type)).toEqual(["press", "drag", "release"]);
						expect(inputs.at(-1)).toBe("z");
					}
				} finally {
					tui.stop();
				}
			});
		}

		test(`does not transfer a retired ${slot} gesture to the same child in the other renderer slot`, () => {
			const events: string[] = [];
			const inputs: string[] = [];
			const child: Component = {
				render: () => ["shared-renderer-child"],
				invalidate: () => {},
				handleMouse: (event) => {
					events.push(event.type);
					return { handled: true, capture: true, focus: true, render: false };
				},
				handleInput: (data) => inputs.push(data),
			};
			const replacement = new Text("replacement", 0, 0);
			let replace = false;
			const terminal = new VirtualTerminal(40, 12);
			const tui = new TuiAltScreen(terminal);
			const row = new ToolExecutionComponent(
				"tool",
				"id",
				{},
				{},
				{
					renderCall: () => (replace && slot === "call" ? replacement : child),
					renderResult: () => (replace && slot === "result" ? replacement : child),
				},
				tui,
				process.cwd(),
			);
			row.updateResult({ content: [], isError: false });
			tui.addChild(row);
			tui.start();
			try {
				tui.renderNow();
				const targetRow = () => {
					const rows = tui
						.getScreenLines()
						.flatMap((line, index) => (stripAnsi(line).includes("shared-renderer-child") ? [index] : []));
					expect(rows).toHaveLength(2);
					return rows[slot === "call" ? 0 : 1]!;
				};
				const press = () => terminal.sendInput(`\x1b[<0;3;${targetRow() + 1}M`);
				press();
				expect(events).toEqual(["press"]);
				replace = true;
				row.invalidate();
				tui.renderNow();
				terminal.sendInput("\x1b[<32;30;10M");
				expect(events).toEqual(["press"]);
				// The remaining visible occurrence may still own keyboard focus.
				terminal.sendInput("x");
				expect(inputs).toEqual(["x"]);
				replace = false;
				row.invalidate();
				tui.renderNow();
				terminal.sendInput("\x1b[<0;30;10m");
				expect(events).toEqual(["press"]);
				press();
				terminal.sendInput("\x1b[<32;30;10M");
				terminal.sendInput("\x1b[<0;30;10m");
				expect(events).toEqual(["press", "press", "drag", "release"]);
			} finally {
				tui.stop();
			}
		});
	}

	for (const capture of [true, false]) {
		test(`does not revive a result gesture after omission and recovery before repaint with capture ${capture}`, () => {
			const events: string[] = [];
			let fail = false;
			const child: Component = {
				render: () => ["recovering-result-child"],
				invalidate: () => {},
				handleMouse: (event) => {
					events.push(event.type);
					return { handled: true, capture, render: false };
				},
			};
			const terminal = new VirtualTerminal(40, 12);
			const tui = new TuiAltScreen(terminal);
			const row = new ToolExecutionComponent(
				"tool",
				"id",
				{},
				{},
				{
					renderCall: () => new Text("call", 0, 0),
					renderResult: (_result, _options, _theme, context) => {
						if (fail) throw new Error("result renderer failed");
						return context.lastComponent ?? child;
					},
				},
				tui,
				process.cwd(),
			);
			row.updateResult({ content: [], isError: false });
			tui.addChild(row);
			tui.start();
			try {
				tui.renderNow();
				const targetRow = tui
					.getScreenLines()
					.findIndex((line) => stripAnsi(line).includes("recovering-result-child"));
				expect(targetRow).toBeGreaterThanOrEqual(0);
				const press = () => terminal.sendInput(`\x1b[<0;3;${targetRow + 1}M`);
				press();
				expect(events).toEqual(["press"]);
				// No terminal input or repaint observes the absent role between these real updates.
				fail = true;
				row.invalidate();
				fail = false;
				row.invalidate();
				tui.renderNow();
				terminal.sendInput("\x1b[<32;30;10M");
				terminal.sendInput("\x1b[<0;30;10m");
				expect(events).toEqual(["press"]);
				press();
				terminal.sendInput("\x1b[<32;30;10M");
				terminal.sendInput("\x1b[<0;30;10m");
				expect(events).toEqual(["press", "press", "drag", "release"]);
			} finally {
				tui.stop();
			}
		});
	}
});
