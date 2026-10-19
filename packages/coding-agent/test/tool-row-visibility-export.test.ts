import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetCapabilitiesCache, setCapabilities, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterEach, describe, expect, test } from "vitest";
import { getKittyImagePlacement } from "../../tui/src/terminal-image.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { exportSessionToHtml } from "../src/core/export-html/index.ts";
import { createToolHtmlRenderer } from "../src/core/export-html/tool-renderer.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ToolRenderers } from "../src/core/extensions/types.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { readRenderers } from "../src/core/tools/renderers/index.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

describe("resolved tool row visibility", () => {
	afterEach(() => resetCapabilitiesCache());
	for (const width of [24, 40, 100, 160]) {
		for (const outputPad of [0, 1]) {
			for (const bornHidden of [false, true]) {
				test(`preserves resolved fallback identity at width ${width}, pad ${outputPad}, born hidden ${bornHidden}`, async () => {
					initTheme("dark");
					setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
					let enabled = false;
					let visible = !bornHidden;
					let invalidate = () => {};
					const runtime = createExtensionRuntime();
					const cwd = process.cwd();
					const sessionManager = SessionManager.inMemory(cwd);
					const extension = await loadExtensionFromFactory(
						(pi) => {
							pi.registerTool({
								name: "registered",
								label: "registered",
								description: "registered fallback",
								parameters: Type.Any(),
								execute: async () => ({ content: [], details: undefined }),
							});
							pi.registerToolRenderer((_name, next) => {
								const base = next();
								return enabled
									? {
											...base,
											isVisible: (context) => {
												invalidate = context.invalidate;
												return visible;
											},
										}
									: base;
							});
							// A second visibility adapter must preserve the same absent-base identity.
							pi.registerToolRenderer((_name, next) => {
								const base = next();
								return enabled ? { ...base, isVisible: () => visible } : base;
							});
						},
						cwd,
						createEventBus(),
						runtime,
					);
					const runner = new ExtensionRunner(
						[extension],
						runtime,
						cwd,
						sessionManager,
						undefined as unknown as ModelRegistry,
					);
					try {
						for (const name of ["unregistered", "legacy", "registered"]) {
							const base: ToolRenderers | undefined = name === "legacy" ? {} : runner.getToolDefinition(name);
							const resolve = () => runner.resolveToolRenderers(name, () => base);
							enabled = false;
							expect(resolve()).toBe(base);
							const make = () =>
								new ToolExecutionComponent(
									name,
									"id",
									{ path: "notes.txt" },
									{ outputPad },
									resolve(),
									{ requestRender() {} } as unknown as TUI,
									cwd,
								);
							const stock = make();
							enabled = true;
							visible = !bornHidden;
							const row = make();
							expect(row.render(width)).toEqual(bornHidden ? [] : stock.render(width));
							const compare = () => {
								const actual = row.render(width),
									expected = stock.render(width);
								expect(actual.filter((line) => !getKittyImagePlacement(line))).toEqual(
									expected.filter((line) => !getKittyImagePlacement(line)),
								);
								expect(actual.filter((line) => getKittyImagePlacement(line))).toHaveLength(
									expected.filter((line) => getKittyImagePlacement(line)).length,
								);
							};
							for (const result of [
								{ content: [], isError: false },
								{ content: [{ type: "text", text: "partial" }], isError: false },
								{
									content: [
										{ type: "text", text: Array.from({ length: 15 }, (_, i) => `line-${i + 1}`).join("\n") },
									],
									isError: false,
								},
								{ content: [{ type: "text", text: "latest failure" }], isError: true },
								{
									content: [
										{
											type: "image",
											data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=",
											mimeType: "image/png",
										},
									],
									isError: false,
								},
							]) {
								const first = result.content[0];
								const text = first && "text" in first ? first.text : undefined;
								visible = false;
								for (const component of [row, stock]) {
									component.updateArgs({ path: "latest.txt" });
									component.markExecutionStarted();
									component.setArgsComplete();
									component.updateResult({ ...result, durationMs: 4200 }, text === "partial");
									component.setOutputPad(1 - outputPad);
									component.setImageWidthCells(10);
									component.setExpanded(false);
								}
								// The same row survives hidden updates and a late context invalidation.
								expect(row.render(width)).toEqual([]);
								visible = true;
								invalidate();
								compare();
								if (result.content[0]?.type === "image")
									expect(row.render(width).filter((line) => getKittyImagePlacement(line))).toHaveLength(1);
								if (text?.includes("line-15")) {
									expect(stock.render(width).join("\n").includes("line-15")).toBe(name === "unregistered");
								}
								for (const expanded of [true, false]) {
									for (const component of [row, stock]) component.setExpanded(expanded);
									compare();
								}
								for (const show of [false, true]) {
									visible = false;
									for (const component of [row, stock]) component.setShowImages(show);
									expect(row.render(width)).toEqual([]);
									visible = true;
									compare();
								}
							}
						}
					} finally {
						runtime.invalidate();
					}
				});
			}
		}
	}
	test("composes next() on one stock row and leaves the complete HTML export unchanged", async () => {
		initTheme("dark");
		const dir = mkdtempSync(join(tmpdir(), "pi-tool-visibility-"));
		const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
		let visibilityEnabled = false;
		let visible = false;
		let visibilityFailure = false;
		let predicateCalls = 0;
		let exportWidth = 100;
		let renderShell: "default" | "self" = "default";
		let invalidate = () => {};
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			(pi) => {
				pi.registerToolRenderer((_name, next) => {
					const base = next();
					return visibilityEnabled
						? {
								...base,
								isVisible: (context) => {
									predicateCalls++;
									invalidate = context.invalidate;
									if (visibilityFailure) throw new Error("visibility failed");
									return visible;
								},
							}
						: base;
				});
				pi.registerToolRenderer((name, next) =>
					name.startsWith("custom")
						? {
								renderShell,
								renderCall: () => new Text("exported call", 0, 0),
								renderResult: (result, options) =>
									new Text(
										`${options.expanded ? "expanded" : "collapsed"}:${JSON.stringify(result.content)}`,
										0,
										0,
									),
							}
						: next(),
				);
			},
			dir,
			createEventBus(),
			runtime,
		);
		// Renderer resolution does not execute tools or use a model registry.
		const runner = new ExtensionRunner(
			[extension],
			runtime,
			dir,
			sessionManager,
			undefined as unknown as ModelRegistry,
		);
		const resolve = (name: string) =>
			runner.resolveToolRenderers(name, () => (name === "read" ? readRenderers : undefined));
		const exportHtml = async (name: string) =>
			readFileSync(
				await exportSessionToHtml(sessionManager, undefined, {
					outputPath: join(dir, name),
					toolRenderer: createToolHtmlRenderer({ getToolRenderers: resolve, theme, cwd: dir, width: exportWidth }),
				}),
				"utf8",
			);
		try {
			const usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			sessionManager.appendMessage({ role: "user", content: "show results", timestamp: 1 });
			for (const [i, name] of ["custom", "read", "unregistered", "custom-empty", "custom-error"].entries()) {
				const id = `call-${i}`;
				sessionManager.appendMessage({
					role: "assistant",
					content: [{ type: "toolCall", id, name, arguments: { path: "notes.txt" } }],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "test",
					usage,
					stopReason: "toolUse",
					timestamp: 2 + i,
				});
				sessionManager.appendMessage({
					role: "toolResult",
					toolCallId: id,
					toolName: name,
					content:
						name === "custom-empty"
							? []
							: [
									{ type: "text", text: "retained text" },
									{
										type: "image",
										data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=",
										mimeType: "image/png",
									},
								],
					isError: i === 1 || name === "custom-error",
					timestamp: 5 + i,
				});
			}
			const stockHtml = await exportHtml("stock.html");
			visibilityEnabled = true;
			const stockDefinition = readRenderers;
			const definition = resolve("read");
			expect(definition?.renderCall).toBe(stockDefinition?.renderCall);
			expect(definition?.renderResult).toBe(stockDefinition?.renderResult);
			const row = new ToolExecutionComponent(
				"read",
				"id",
				{ path: "notes.txt" },
				{},
				definition,
				{ requestRender: () => {} } as unknown as TUI,
				dir,
			);
			expect(row.render(100)).toEqual([]);
			row.updateResult({ content: [{ type: "text", text: "latest output" }], isError: false });
			row.setExpanded(true);
			visible = true;
			invalidate();
			expect(row.render(100).join("\n")).toContain("latest output");
			visible = false;
			expect(await exportHtml("hidden.html")).toBe(stockHtml);
			for (const width of [24, 40, 100, 160]) {
				for (const shell of ["default", "self"] as const) {
					exportWidth = width;
					renderShell = shell;
					visibilityEnabled = false;
					const expected = await exportHtml("reference.html");
					visibilityEnabled = true;
					for (const mode of ["hidden", "shown", "throw", "recovered"] as const) {
						visible = mode !== "hidden";
						visibilityFailure = mode === "throw";
						predicateCalls = 0;
						expect(await exportHtml("actual.html")).toBe(expected);
						expect(predicateCalls).toBe(0);
					}
				}
			}
		} finally {
			runtime.invalidate();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
