import assert from "node:assert/strict";
import { test } from "node:test";
import { Box } from "../src/components/box.ts";
import { HStack } from "../src/components/h-stack.ts";
import { MouseRegion } from "../src/components/mouse-region.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { type Component, Container, dispatchMouseEvent } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

for (const mode of ["document", "viewport"] as const) {
	for (const duplicate of [false, true]) {
		test(`allocated-width focus ${mode} duplicate=${duplicate}`, async () => {
			const events: string[] = [];
			const leaf: Component = { render: () => ["LIVE"], invalidate() {}, handleInput: (data) => events.push(data) };
			const shared = new Box(0, 0);
			shared.addChild(new VStack([{ component: leaf, visible: ({ width }) => width === 20 }]));
			const root = new HStack([
				{ component: duplicate ? shared : new Box(0, 0), basis: 10 },
				{ component: shared, basis: 20 },
			]);
			const terminal = new VirtualTerminal(30, 4);
			const tui = mode === "document" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
			if (tui instanceof TuiAltScreen) tui.setLayoutRoot(root);
			else tui.addChild(root);
			tui.setFocus(leaf);
			tui.start();
			try {
				tui.renderNow();
				await terminal.flush();
				assert.ok(
					terminal.getViewport().some((line) => line.includes("LIVE")),
					"actual second-width row is painted",
				);
				terminal.sendInput("x");
				assert.deepEqual(events, ["x"]);
				assert.equal(tui.getFocusedComponent(), leaf);
			} finally {
				tui.stop();
			}
		});
	}
}

for (const mode of ["document", "viewport"] as const) {
	test(`repeated numeric entries keep live allocation when preceding ${mode} entries are filtered`, async () => {
		let firstVisible = true;
		let expectedWidth = 20;
		let renders = 0;
		const events: string[] = [];
		const leaf: Component = {
			render: () => {
				renders++;
				return ["LIVE"];
			},
			invalidate() {},
			handleInput: (data) => events.push(data),
		};
		const shared = new Box(0, 0);
		shared.addChild(new VStack([{ component: leaf, visible: ({ width }) => width === expectedWidth }]));
		const root = new HStack([
			{ component: shared, basis: 10, visible: () => firstVisible },
			{ component: shared, basis: 20, grow: 1 },
		]);
		const terminal = new VirtualTerminal(30, 4);
		const tui = mode === "document" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		if (tui instanceof TuiAltScreen) tui.setLayoutRoot(root);
		else tui.addChild(root);
		tui.setFocus(leaf);
		tui.start();
		try {
			terminal.sendInput("a");
			assert.equal(renders, 0);
			assert.deepEqual(events, ["a"]);
			tui.renderNow();
			assert.ok((await terminal.flushAndGetViewport()).some((line) => line.includes("LIVE")));
			firstVisible = false;
			expectedWidth = 30;
			terminal.sendInput("b");
			assert.deepEqual(events, ["a", "b"]);
			tui.renderNow();
			assert.ok((await terminal.flushAndGetViewport()).some((line) => line.includes("LIVE")));
			firstVisible = true;
			terminal.sendInput("c");
			assert.deepEqual(events, ["a", "b"]);
			assert.equal(tui.getFocusedComponent(), null);
			expectedWidth = 20;
			tui.renderNow();
			terminal.sendInput("d");
			assert.deepEqual(events, ["a", "b"]);
			tui.setFocus(leaf);
			terminal.sendInput("e");
			assert.deepEqual(events, ["a", "b", "e"]);
		} finally {
			tui.stop();
		}
	});
}

for (const metadata of [false, true]) {
	for (const direct of [false, true]) {
		for (const hide of [false, true]) {
			test(`recorded Box lifetime metadata=${metadata} direct=${direct} hide=${hide}`, () => {
				const events: string[] = [];
				let shown = true;
				const leaf: Component = {
					render: () => ["LIVE"],
					invalidate() {},
					handleMouse: (event) => {
						events.push(event.type);
						return { capture: true, render: false };
					},
				};
				class LiveBox extends Box {
					isVisible() {
						return shown;
					}
					override render(width: number) {
						return shown ? super.render(width) : [];
					}
				}
				const box = new LiveBox(0, 0);
				box.addChild(leaf);
				const host: Component = {
					...(metadata ? { children: [box] } : {}),
					render: (width) => box.render(width),
					invalidate() {
						box.invalidate();
					},
					handleMouse: (event) => (direct ? box.handleMouse(event) : dispatchMouseEvent(box, event)),
				};
				const terminal = new VirtualTerminal(20, 4);
				const tui = new TuiAltScreen(terminal);
				tui.addChild(host);
				tui.start();
				try {
					tui.renderNow();
					assert.ok(tui.getScreenLines().some((line) => line.includes("LIVE")));
					terminal.sendInput("\x1b[<0;1;1M");
					assert.deepEqual(events, ["press"]);
					if (hide) shown = false;
					tui.renderNow();
					if (hide) assert.ok(tui.getScreenLines().every((line) => !line.includes("LIVE")));
					terminal.sendInput("\x1b[<32;20;4M");
					terminal.sendInput("\x1b[<0;20;4m");
					assert.deepEqual(events, hide ? ["press"] : ["press", "drag", "release"]);
				} finally {
					tui.stop();
				}
			});
		}
	}
}

for (const capture of [false, true]) {
	for (const paint of [false, true]) {
		test(`opaque direct Box ${capture ? "capture" : "press"} denies hiding before ${paint ? "repaint" : "input"} and needs a fresh gesture`, () => {
			let shown = true;
			const events: Array<{ type: string; x: number; y: number; screenX: number; screenY: number; width: number }> =
				[];
			const leaf: Component = {
				render: () => ["LIVE"],
				invalidate() {},
				handleMouse: ({ type, x, y, screenX, screenY, width }) => {
					events.push({ type, x, y, screenX, screenY, width });
					return { handled: true, capture, render: false };
				},
			};
			class LiveBox extends Box {
				isVisible() {
					return shown;
				}
				override render(width: number) {
					return shown ? super.render(width) : [];
				}
			}
			const box = new LiveBox(1, 1);
			box.addChild(leaf);
			const host: Component = {
				render: (width) => box.render(width),
				invalidate() {
					box.invalidate();
				},
				handleMouse: (event) => box.handleMouse(event),
			};
			const terminal = new VirtualTerminal(20, 6);
			const tui = new TuiAltScreen(terminal);
			tui.showOverlay(host, { row: 1, col: 2, width: 10, nonCapturing: true });
			tui.start();
			try {
				tui.renderNow();
				terminal.sendInput("\x1b[<0;4;3M");
				assert.deepEqual(events, [{ type: "press", x: 0, y: 0, screenX: 3, screenY: 2, width: 8 }]);
				shown = false;
				if (paint) {
					tui.renderNow();
					assert.ok(tui.getScreenLines().every((line) => !line.includes("LIVE")));
				}
				terminal.sendInput("\x1b[<32;20;6M");
				assert.equal(events.length, 1);
				shown = true;
				tui.renderNow();
				terminal.sendInput("\x1b[<0;20;6m");
				assert.equal(events.length, 1);
				terminal.sendInput("\x1b[<0;4;3M");
				terminal.sendInput("\x1b[<32;20;6M");
				terminal.sendInput("\x1b[<0;20;6m");
				assert.deepEqual(events.slice(1), [
					{ type: "press", x: 0, y: 0, screenX: 3, screenY: 2, width: 8 },
					{ type: "drag", x: 16, y: 3, screenX: 19, screenY: 5, width: 8 },
					{ type: "release", x: 16, y: 3, screenX: 19, screenY: 5, width: 8 },
				]);
			} finally {
				tui.stop();
			}
		});
	}
}

test("document stack focus remains usable before first scheduled paint", () => {
	const events: string[] = [];
	const child: Component = {
		render: () => ["visible"],
		invalidate() {},
		handleInput: (data) => events.push(data),
	};
	const stack = new VStack([{ component: child, visible: ({ height }) => height > 10 }]);
	const box = new Box(0, 0);
	box.addChild(stack);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiMainScreen(terminal);
	tui.addChild(box);
	tui.setFocus(child);
	tui.start();
	try {
		terminal.sendInput("x");
		tui.renderNow();
		terminal.sendInput("y");
		assert.deepEqual(events, ["x", "y"]);
	} finally {
		tui.stop();
	}
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`second narrow mount does not invalidate a displayed ${mode} document stack`, () => {
		const events: string[] = [];
		const child: Component = {
			render: () => ["visible"],
			invalidate() {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true, render: false };
			},
		};
		const stack = new VStack([{ component: child, visible: ({ width }) => width === 20 }]);
		const box = new Box(0, 0);
		box.addChild(stack);
		const terminal = new VirtualTerminal(20, 4);
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		tui.addChild(box);
		tui.start();
		try {
			tui.renderNow();
			tui.setFocus(child);
			terminal.sendInput("x");
			if (mode === "fullscreen") terminal.sendInput("\x1b[<0;1;1M");
			tui.showOverlay(box, { anchor: "bottom-right", width: 10, nonCapturing: true });
			tui.renderNow();
			if (mode === "fullscreen") {
				assert.ok((tui as TuiAltScreen).getScreenLines().some((line) => line.includes("visible")));
				terminal.sendInput("\x1b[<32;20;4M");
				terminal.sendInput("\x1b[<0;20;4m");
			}
			terminal.sendInput("y");
			assert.deepEqual(events, mode === "regular" ? ["x", "y"] : ["x", "press", "drag", "release", "y"]);
		} finally {
			tui.stop();
		}
	});
}

for (const capture of [false, true]) {
	for (const removal of ["hide", "remove"] as const) {
		test(`dead overlay ${capture ? "capture" : "press"} mount cannot borrow a visible root after ${removal}`, () => {
			const events: Array<{ type: string; x: number; y: number }> = [];
			const child: Component = {
				render: () => ["child"],
				invalidate() {},
				handleMouse: (event) => {
					events.push({ type: event.type, x: event.x, y: event.y });
					return { handled: true, capture, render: false };
				},
			};
			const box = new Box(0, 0);
			box.addChild(child);
			const terminal = new VirtualTerminal(20, 4);
			const tui = new TuiAltScreen(terminal);
			tui.addChild(box);
			const overlay = tui.showOverlay(box, { anchor: "bottom-left", width: 20, nonCapturing: true });
			tui.start();
			try {
				tui.renderNow();
				assert.ok(tui.getScreenLines()[0].includes("child"));
				assert.ok(tui.getScreenLines()[3].includes("child"));
				terminal.sendInput("\x1b[<0;1;4M");
				if (removal === "hide") overlay.setHidden(true);
				else overlay.hide();
				terminal.sendInput("\x1b[<32;20;2M");
				terminal.sendInput("\x1b[<0;20;2m");
				assert.deepEqual(events, [{ type: "press", x: 0, y: 0 }]);
				if (removal === "hide") overlay.setHidden(false);
				tui.renderNow();
				terminal.sendInput("\x1b[<32;20;2M");
				terminal.sendInput("\x1b[<0;20;2m");
				assert.deepEqual(events, [{ type: "press", x: 0, y: 0 }]);
				terminal.sendInput("\x1b[<0;1;1M");
				terminal.sendInput("\x1b[<32;20;2M");
				terminal.sendInput("\x1b[<0;20;2m");
				assert.deepEqual(events.slice(1), [
					{ type: "press", x: 0, y: 0 },
					{ type: "drag", x: 19, y: 1 },
					{ type: "release", x: 19, y: 1 },
				]);
			} finally {
				tui.stop();
			}
		});
	}
}

for (const padding of [0, 1]) {
	for (const allowed of [true, false]) {
		for (const path of ["document", "viewport", "viewport-scroll", "document-scroll", "overlay"] as const) {
			test(`prepaint ${path} padding ${padding} ${allowed ? "visible" : "hidden"} uses semantic dimensions without painting`, () => {
				const events: string[] = [];
				let renders = 0;
				const child: Component = {
					render: () => {
						renders++;
						return ["child"];
					},
					invalidate() {},
					handleInput: (data) => events.push(data),
				};
				const viewport = path === "viewport" || path === "viewport-scroll";
				const width = viewport
					? 20
					: (path === "overlay" ? 10 : path === "document-scroll" ? 19 : 20) - padding * 2;
				const stack = new VStack([
					{
						component: child,
						visible: (context) =>
							(context.width === width && context.height === (viewport ? 4 : Number.MAX_SAFE_INTEGER)) ===
							allowed,
					},
				]);
				const box = new Box(padding, 0);
				box.addChild(stack);
				const terminal = new VirtualTerminal(20, 4);
				const tui = path === "document" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
				if (path === "viewport") (tui as TuiAltScreen).setLayoutRoot(stack);
				else if (path === "viewport-scroll")
					(tui as TuiAltScreen).setLayoutRoot(new ScrollView(stack, { scrollbar: "always" }));
				else if (path === "document-scroll")
					(tui as TuiAltScreen).setLayoutRoot(new ScrollView(box, { scrollbar: "always" }));
				else if (path === "overlay") tui.showOverlay(box, { width: 10, margin: 1, nonCapturing: true });
				else tui.addChild(box);
				tui.setFocus(child);
				tui.start();
				try {
					terminal.sendInput("x");
					assert.equal(renders, 0);
					assert.deepEqual(events, allowed ? ["x"] : []);
					tui.renderNow();
					terminal.sendInput("y");
					assert.deepEqual(events, allowed ? ["x", "y"] : []);
				} finally {
					tui.stop();
				}
			});
		}
	}
}

for (const inset of [0, 10]) {
	for (const hidden of ["none", "child", "owner"] as const) {
		test(`unknown private width ${20 - inset} retains legacy prepaint keys with ${hidden} explicit hiding`, () => {
			const events: string[] = [];
			const contexts: number[][] = [];
			let renders = 0;
			const child: Component = {
				isVisible: () => hidden !== "child",
				render: () => ["child"],
				invalidate() {},
				handleInput: (data) => events.push(data),
			};
			const stack = new VStack([
				{
					component: child,
					visible: (context) => {
						contexts.push([context.width, context.height]);
						return context.width === 20;
					},
				},
			]);
			const host: Component = {
				children: [stack],
				isVisible: () => hidden !== "owner",
				render: (width) => {
					renders++;
					return stack.render(width - inset);
				},
				invalidate() {},
			};
			const terminal = new VirtualTerminal(20, 4);
			const tui = new TuiMainScreen(terminal);
			tui.addChild(host);
			tui.setFocus(child);
			tui.start();
			try {
				terminal.sendInput("x");
				assert.equal(renders, 0);
				assert.deepEqual(contexts, []);
				assert.deepEqual(events, hidden === "none" ? ["x"] : []);
				tui.renderNow();
				terminal.sendInput("y");
				assert.deepEqual(events, hidden !== "none" ? [] : inset === 0 ? ["x", "y"] : ["x"]);
			} finally {
				tui.stop();
			}
		});
	}
}

test("a hidden root occurrence cannot receive stale hit tests or borrow its visible overlay occurrence", () => {
	let rootVisible = true;
	const events: string[] = [];
	const child: Component = {
		render: () => ["child"],
		invalidate() {},
		handleInput: (data) => events.push(data),
		handleMouse: (event) => {
			events.push(event.type);
			return { capture: true, focus: true, render: false };
		},
	};
	const stack = new VStack([{ component: child, visible: ({ width }) => (width === 20 ? rootVisible : true) }]);
	const box = new Box(0, 0);
	box.addChild(stack);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.addChild(box);
	const overlay = tui.showOverlay(box, { anchor: "bottom-left", width: 10, nonCapturing: true });
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;1M");
		assert.equal(tui.getFocusedComponent(), child);
		rootVisible = false;
		terminal.sendInput("\x1b[<32;20;2M");
		terminal.sendInput("\x1b[<0;20;2m");
		terminal.sendInput("x");
		assert.deepEqual(events, ["press", "x"]);
		terminal.sendInput("\x1b[<0;1;1M");
		assert.deepEqual(events, ["press", "x"]);
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;4M");
		terminal.sendInput("\x1b[<32;20;2M");
		terminal.sendInput("\x1b[<0;20;2m");
		assert.deepEqual(events, ["press", "x", "press", "drag", "release"]);
		overlay.hide();
		terminal.sendInput("y");
		assert.equal(tui.getFocusedComponent(), null);
		rootVisible = true;
		tui.renderNow();
		terminal.sendInput("z");
		assert.deepEqual(events, ["press", "x", "press", "drag", "release"]);
		tui.setFocus(child);
		terminal.sendInput("f");
		assert.equal(events.at(-1), "f");
	} finally {
		tui.stop();
	}
});

test("fresh input on a stale viewport box obeys that occurrence's hidden ancestor", () => {
	let visible = true;
	const events: string[] = [];
	const child: Component = {
		render: () => ["child"],
		invalidate() {},
		handleMouse: (event) => {
			events.push(event.type);
			return { handled: true, render: false };
		},
	};
	const box = new Box(0, 0);
	box.addChild(child);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.setLayoutRoot(new VStack([{ component: box, visible: () => visible }]));
	tui.showOverlay(box, { anchor: "bottom-left", width: 20, nonCapturing: true });
	tui.start();
	try {
		tui.renderNow();
		visible = false;
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<0;1;1m");
		assert.deepEqual(events, []);
		terminal.sendInput("\x1b[<0;1;4M");
		assert.deepEqual(events, ["press"]);
	} finally {
		tui.stop();
	}
});

for (const allowed of [true, false]) {
	for (const mode of ["document", "viewport"] as const) {
		test(`${mode} horizontal allocation uses stock numeric bases before painting (${allowed})`, () => {
			const events: string[] = [];
			let renders = 0;
			const child: Component = {
				render: () => {
					renders++;
					return ["child"];
				},
				invalidate() {},
				handleInput: (data) => events.push(data),
			};
			const box = new Box(1, 0);
			box.addChild(
				new VStack([
					{
						component: child,
						visible: ({ width, height }) => (width === 8 && height === Number.MAX_SAFE_INTEGER) === allowed,
					},
				]),
			);
			const root = new HStack([
				{ component: box, basis: 10 },
				{ component: new Text("sibling", 0, 0), basis: 10 },
			]);
			const terminal = new VirtualTerminal(20, 4);
			const tui = mode === "document" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
			if (mode === "document") tui.addChild(root);
			else (tui as TuiAltScreen).setLayoutRoot(root);
			tui.setFocus(child);
			tui.start();
			try {
				terminal.sendInput("x");
				assert.equal(renders, 0);
				assert.deepEqual(events, allowed ? ["x"] : []);
				tui.renderNow();
				terminal.sendInput("y");
				assert.deepEqual(events, allowed ? ["x", "y"] : []);
			} finally {
				tui.stop();
			}
		});
	}
}

for (const documentVisible of [false, true]) {
	test(`same stack has independent document and viewport mounts (document visible ${documentVisible})`, () => {
		const events: string[] = [];
		const child: Component = {
			render: () => ["child"],
			invalidate() {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true, render: false };
			},
		};
		const stack = new VStack([
			{
				component: child,
				visible: ({ height }) => (documentVisible ? height === Number.MAX_SAFE_INTEGER : height === 4),
			},
		]);
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		tui.setLayoutRoot(stack);
		const overlay = tui.showOverlay(stack, { anchor: "bottom-left", width: 10, nonCapturing: true });
		tui.setFocus(child);
		tui.start();
		try {
			terminal.sendInput("x");
			tui.renderNow();
			terminal.sendInput(documentVisible ? "\x1b[<0;1;4M" : "\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;2M");
			terminal.sendInput("\x1b[<0;20;2m");
			assert.deepEqual(events, ["x", "press", "drag", "release"]);
			overlay.hide();
			terminal.sendInput("y");
			assert.deepEqual(
				events,
				documentVisible ? ["x", "press", "drag", "release"] : ["x", "press", "drag", "release", "y"],
			);
		} finally {
			tui.stop();
		}
	});
}

test("a custom stack render override keeps its private prepaint transform unknown", () => {
	class NarrowStack extends VStack {
		override render(width: number): string[] {
			return super.render(width - 10);
		}
	}
	const events: string[] = [];
	const widths: number[] = [];
	const child: Component = { render: () => ["child"], invalidate() {}, handleInput: (data) => events.push(data) };
	const stack = new NarrowStack([
		{
			component: child,
			visible: ({ width }) => {
				widths.push(width);
				return width === 20;
			},
		},
	]);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiMainScreen(terminal);
	tui.addChild(stack);
	tui.setFocus(child);
	tui.start();
	try {
		terminal.sendInput("x");
		assert.deepEqual(widths, []);
		assert.deepEqual(events, ["x"]);
		tui.renderNow();
		terminal.sendInput("y");
		assert.deepEqual(events, ["x"]);
		assert.ok(widths.every((width) => width === 10));
	} finally {
		tui.stop();
	}
});

test("live stock padding takes precedence over the previous document width", () => {
	const events: string[] = [];
	const child: Component = { render: () => ["child"], invalidate() {}, handleInput: (data) => events.push(data) };
	const box = new Box(0, 0);
	box.addChild(new VStack([{ component: child, visible: ({ width }) => width === 20 }]));
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiMainScreen(terminal);
	tui.addChild(box);
	tui.setFocus(child);
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("x");
		box.setPaddingX(1);
		terminal.sendInput("y");
		assert.deepEqual(events, ["x"]);
		assert.equal(tui.getFocusedComponent(), null);
		box.setPaddingX(0);
		terminal.sendInput("z");
		assert.deepEqual(events, ["x"]);
		tui.setFocus(child);
		terminal.sendInput("f");
		assert.deepEqual(events, ["x", "f"]);
	} finally {
		tui.stop();
	}
});

for (const hidden of ["component", "ancestor", "entry"] as const) {
	test(`known ${hidden} hiding denies initial input without invoking render`, () => {
		const events: string[] = [];
		let renders = 0;
		const child: Component = {
			isVisible: () => hidden !== "component",
			render: () => {
				renders++;
				return ["child"];
			},
			invalidate() {},
			handleInput: (data) => events.push(data),
		};
		const stack = new VStack([{ component: child, visible: () => hidden !== "entry" }]);
		const box = new Box(1, 0);
		box.addChild(stack);
		const host: Component = {
			children: [box],
			isVisible: () => hidden !== "ancestor",
			render: (width) => box.render(width),
			invalidate() {},
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiMainScreen(terminal);
		// A stock path gives a constant-false entry a known document context.
		tui.addChild(hidden === "ancestor" ? host : box);
		tui.setFocus(child);
		tui.start();
		try {
			terminal.sendInput("x");
			assert.deepEqual(events, []);
			assert.equal(renders, 0);
		} finally {
			tui.stop();
		}
	});
}

for (const change of ["remove", "clear", "replace-layout"] as const) {
	test(`removing and restoring a root mount by ${change} does not revive its gesture`, () => {
		const events: string[] = [];
		const child: Component = {
			render: () => ["child"],
			invalidate() {},
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, render: false };
			},
		};
		const box = new Box(0, 0);
		box.addChild(child);
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		if (change === "replace-layout") tui.setLayoutRoot(box);
		else tui.addChild(box);
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("\x1b[<0;1;1M");
			if (change === "replace-layout") {
				tui.setLayoutRoot(new Container());
				tui.setLayoutRoot(box);
			} else {
				if (change === "remove") tui.removeChild(box);
				else tui.clear();
				tui.addChild(box);
			}
			tui.renderNow();
			terminal.sendInput("\x1b[<32;20;2M");
			terminal.sendInput("\x1b[<0;20;2m");
			assert.deepEqual(events, ["press"]);
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;2M");
			terminal.sendInput("\x1b[<0;20;2m");
			assert.deepEqual(events, ["press", "press", "drag", "release"]);
		} finally {
			tui.stop();
		}
	});
}

test("a gesture cannot borrow a duplicate component's other layout entry", () => {
	let leftVisible = true;
	const events: string[] = [];
	const child: Component = {
		render: () => ["child"],
		invalidate() {},
		handleMouse: (event) => {
			events.push(event.type);
			return { capture: true, render: false };
		},
	};
	const box = new Box(0, 0);
	box.addChild(child);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.setLayoutRoot(
		new HStack([
			{ component: box, basis: 10, visible: () => leftVisible },
			{ component: box, basis: 10 },
		]),
	);
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;1M");
		leftVisible = false;
		terminal.sendInput("\x1b[<32;20;2M");
		terminal.sendInput("\x1b[<0;20;2m");
		assert.deepEqual(events, ["press"]);
	} finally {
		tui.stop();
	}
});

test("a custom document ScrollView override retains unknown prepaint input", () => {
	class NarrowScroll extends ScrollView {
		override render(width: number): string[] {
			return super.render(width - 10);
		}
	}
	const events: string[] = [];
	const widths: number[] = [];
	const child: Component = { render: () => ["child"], invalidate() {}, handleInput: (data) => events.push(data) };
	const stack = new VStack([
		{
			component: child,
			visible: ({ width }) => {
				widths.push(width);
				return width === 20;
			},
		},
	]);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiMainScreen(terminal);
	tui.addChild(new NarrowScroll(stack));
	tui.setFocus(child);
	tui.start();
	try {
		terminal.sendInput("x");
		assert.deepEqual(widths, []);
		assert.deepEqual(events, ["x"]);
		tui.renderNow();
		terminal.sendInput("y");
		assert.deepEqual(events, ["x"]);
		assert.ok(widths.every((width) => width === 10));
	} finally {
		tui.stop();
	}
});

test("hidden overlay root stops forwarding keyboard to a mouse-focused descendant", () => {
	let visible = true;
	const events: string[] = [];
	const child: Component = {
		render: () => ["visible"],
		invalidate: () => {},
		handleInput: (data) => events.push(data),
		handleMouse: (event) => {
			events.push(event.type);
			return { capture: true, focus: true, render: false };
		},
	};
	const host: Component = {
		children: [child],
		isVisible: () => visible,
		render: (width) => (visible ? child.render(width) : []),
		invalidate: () => {},
		handleInput: (data) => child.handleInput?.(data),
		handleMouse: (event) => dispatchMouseEvent(child, event),
	};
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.showOverlay(host, { anchor: "top-left", width: 20 });
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("x");
		assert.deepEqual(events, ["press", "x"]);
		visible = false;
		tui.renderNow();
		terminal.sendInput("\x1b[<32;20;4M");
		terminal.sendInput("\x1b[<0;20;4m");
		terminal.sendInput("y");
		assert.deepEqual(events, ["press", "x"]);
		assert.notEqual(tui.getFocusedComponent(), host);
	} finally {
		tui.stop();
	}
});

for (const hideKind of ["component", "option", "handle"] as const) {
	for (const paint of [false, true]) {
		test(`${hideKind} overlay hiding before ${paint ? "repaint" : "input"} preserves sibling fallback and fresh focus`, () => {
			let visible = true;
			const events: string[] = [];
			const baseKeys: string[] = [];
			const siblingKeys: string[] = [];
			const base: Component = {
				render: () => ["base"],
				invalidate: () => {},
				handleInput: (data) => baseKeys.push(data),
			};
			const sibling: Component = {
				render: () => ["sibling"],
				invalidate: () => {},
				handleInput: (data) => siblingKeys.push(data),
			};
			const child: Component = {
				render: () => ["child"],
				invalidate: () => {},
				handleInput: (data) => events.push(data),
				handleMouse: (event) => {
					events.push(event.type);
					return { capture: true, focus: true, render: false };
				},
			};
			const host: Component = {
				children: [child],
				...(hideKind === "component" ? { isVisible: () => visible } : {}),
				render: (width) => (visible ? child.render(width) : []),
				invalidate: () => {},
				handleInput: (data) => child.handleInput?.(data),
				handleMouse: (event) => dispatchMouseEvent(child, event),
			};
			const terminal = new VirtualTerminal(20, 4);
			const tui = new TuiAltScreen(terminal);
			tui.addChild(base);
			tui.setFocus(base);
			const lower = tui.showOverlay(sibling, { anchor: "bottom-left", width: 20 });
			const upper = tui.showOverlay(host, {
				anchor: "top-left",
				width: 20,
				...(hideKind === "option" ? { visible: () => visible } : {}),
			});
			tui.start();
			try {
				tui.renderNow();
				terminal.sendInput("\x1b[<0;1;1M");
				terminal.sendInput("x");
				assert.deepEqual(events, ["press", "x"]);
				if (hideKind === "handle") upper.setHidden(true);
				else visible = false;
				if (paint) tui.renderNow();
				terminal.sendInput("\x1b[<32;20;4M");
				terminal.sendInput("\x1b[<0;20;4m");
				terminal.sendInput("y");
				assert.deepEqual(events, ["press", "x"]);
				assert.deepEqual(siblingKeys, ["y"]);
				assert.equal(tui.getFocusedComponent(), sibling);
				if (hideKind === "handle") upper.setHidden(false);
				else visible = true;
				tui.renderNow();
				upper.focus();
				terminal.sendInput("z");
				terminal.sendInput("\x1b[<0;1;1M");
				terminal.sendInput("\x1b[<32;20;4M");
				terminal.sendInput("\x1b[<0;20;4m");
				assert.deepEqual(events, ["press", "x", "z", "press", "drag", "release"]);
				upper.hide();
				lower.hide();
				terminal.sendInput("b");
				assert.deepEqual(baseKeys, ["b"]);
			} finally {
				tui.stop();
			}
		});
	}
}

test("born component-hidden overlay preserves base focus until deliberately focused after showing", () => {
	let visible = false;
	const hiddenKeys: string[] = [];
	const baseKeys: string[] = [];
	const base: Component = {
		render: () => ["base"],
		invalidate: () => {},
		handleInput: (data) => baseKeys.push(data),
	};
	const host: Component = {
		isVisible: () => visible,
		render: () => (visible ? ["host"] : []),
		invalidate: () => {},
		handleInput: (data) => hiddenKeys.push(data),
	};
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.addChild(base);
	tui.setFocus(base);
	const overlay = tui.showOverlay(host);
	tui.start();
	try {
		terminal.sendInput("x");
		assert.deepEqual(hiddenKeys, []);
		assert.deepEqual(baseKeys, ["x"]);
		visible = true;
		tui.renderNow();
		overlay.focus();
		terminal.sendInput("y");
		assert.deepEqual(hiddenKeys, ["y"]);
	} finally {
		tui.stop();
	}
});

for (const visibilityKind of ["component", "option"] as const) {
	test(`${visibilityKind} overlay retains automatic focus restoration without reviving its old gesture`, () => {
		let visible = true;
		const events: string[] = [];
		const baseKeys: string[] = [];
		const child: Component = {
			render: () => ["child"],
			invalidate: () => {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true, render: false };
			},
		};
		const host: Component = {
			children: [child],
			...(visibilityKind === "component" ? { isVisible: () => visible } : {}),
			render: (width) => (visible ? child.render(width) : []),
			invalidate: () => {},
			handleInput: (data) => child.handleInput?.(data),
			handleMouse: (event) => dispatchMouseEvent(child, event),
		};
		const base: Component = {
			render: () => ["base"],
			invalidate: () => {},
			handleInput: (data) => baseKeys.push(data),
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		tui.addChild(base);
		tui.setFocus(base);
		tui.showOverlay(host, {
			anchor: "top-left",
			width: 20,
			...(visibilityKind === "option" ? { visible: () => visible } : {}),
		});
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("x");
			visible = false;
			terminal.sendInput("h");
			assert.equal(tui.getFocusedComponent(), base);
			assert.deepEqual(baseKeys, ["h"]);
			visible = true;
			tui.renderNow();
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			assert.deepEqual(events, ["press", "x"]);
			terminal.sendInput("y");
			assert.equal(tui.getFocusedComponent(), host);
			assert.deepEqual(events, ["press", "x", "y"]);
		} finally {
			tui.stop();
		}
	});
}

for (const mode of ["regular", "fullscreen", "overlay"] as const) {
	for (const dimension of ["height", "width"] as const) {
		test(`${mode} document stack retains input using its rendered ${dimension}`, async () => {
			const events: string[] = [];
			const child: Component = {
				render: () => ["visible"],
				invalidate: () => {},
				handleInput: (data) => events.push(data),
				handleMouse: (event) => {
					events.push(event.type);
					return { capture: true, focus: true, render: false };
				},
			};
			let visible = true;
			const contentWidth = mode === "overlay" ? 8 : 18;
			const stack = new VStack([
				{
					component: child,
					visible: (viewport) =>
						visible && (dimension === "height" ? viewport.height > 10 : viewport.width === contentWidth),
				},
			]);
			const box = new Box(1, 0);
			box.addChild(stack);
			const terminal = new VirtualTerminal(20, 4);
			const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
			const overlay =
				mode === "overlay"
					? tui.showOverlay(box, { anchor: "top-left", width: 10, margin: 1, nonCapturing: true })
					: undefined;
			if (!overlay) tui.addChild(box);
			tui.start();
			try {
				tui.renderNow();
				assert.ok((await terminal.flushAndGetViewport()).some((line) => line.includes("visible")));
				if (mode !== "regular") {
					terminal.sendInput(mode === "overlay" ? "\x1b[<0;3;2M" : "\x1b[<0;2;1M");
					terminal.sendInput("\x1b[<32;20;4M");
					terminal.sendInput("\x1b[<0;20;4m");
					assert.deepEqual(events, ["press", "drag", "release"]);
				}
				// Main-screen focus has no mouse path. Overlays may explicitly focus a descendant too.
				overlay?.unfocus({ target: child });
				tui.setFocus(child);
				terminal.sendInput("x");
				assert.equal(events.at(-1), "x");
				visible = false;
				terminal.sendInput("y");
				assert.equal(events.at(-1), "x");
				assert.equal(tui.getFocusedComponent(), null);
				tui.renderNow();
				tui.setFocus(child);
				terminal.sendInput("z");
				assert.equal(events.at(-1), "x");
			} finally {
				tui.stop();
			}
		});
	}
}

test("a viewport stack inside ScrollView retains viewport visibility after document measurement", () => {
	const inputs: string[] = [];
	let visible = true;
	const child: Component = {
		render: () => ["viewport"],
		invalidate: () => {},
		handleInput: (data) => inputs.push(data),
	};
	const stack = new VStack([{ component: child, visible: ({ height }) => visible && height === 4 }]);
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	const scroll = new ScrollView(stack);
	tui.setLayoutRoot(scroll);
	tui.setFocus(child);
	tui.start();
	try {
		tui.renderNow();
		assert.ok(tui.getScreenLines().some((line) => line.includes("viewport")));
		terminal.sendInput("x");
		visible = false;
		terminal.sendInput("y");
		assert.deepEqual(inputs, ["x"]);
		assert.equal(tui.getFocusedComponent(), null);
	} finally {
		tui.stop();
	}
});

for (const capture of [false, true]) {
	for (const change of ["none", "owner-hidden", "owner-removed", "ancestor-hidden", "overlay-hidden"] as const) {
		test(`opaque delegated ${capture ? "capture" : "press"} with ${change}`, () => {
			const events: string[] = [];
			const child: Component = {
				render: () => ["visible"],
				invalidate: () => {},
				handleInput: (data) => events.push(data),
				handleMouse: (event) => {
					events.push(event.type);
					return { handled: true, capture, focus: true, render: false };
				},
			};
			let visible = true;
			// Existing components may privately host a child and forward through the public dispatcher.
			const host: Component = {
				render: (width) => child.render(width),
				invalidate: () => child.invalidate(),
				handleMouse: (event) => dispatchMouseEvent(child, event),
				...(change === "owner-hidden" ? { isVisible: () => visible } : {}),
			};
			const root = new VStack([{ component: host, visible: () => visible }]);
			const terminal = new VirtualTerminal(20, 4);
			const tui = new TuiAltScreen(terminal);
			tui.setLayoutRoot(root);
			const overlay =
				change === "overlay-hidden"
					? tui.showOverlay(host, { anchor: "top-left", width: 20, nonCapturing: true })
					: undefined;
			tui.start();
			try {
				tui.renderNow();
				assert.ok(tui.getScreenLines().some((line) => line.includes("visible")));
				terminal.sendInput("\x1b[<0;1;1M");
				if (change === "owner-removed" || overlay) root.removeChild(host);
				if (change === "owner-hidden" || change === "ancestor-hidden") visible = false;
				overlay?.setHidden(true);
				terminal.sendInput("\x1b[<32;20;4M");
				// Repainting between retained events must not discard the observed delegation either.
				tui.renderNow();
				terminal.sendInput("\x1b[<0;20;4m");
				terminal.sendInput("x");
				assert.deepEqual(events, change === "none" ? ["press", "drag", "release", "x"] : ["press"]);
				assert.equal(tui.getFocusedComponent(), change === "none" ? child : null);
			} finally {
				tui.stop();
			}
		});
	}
}

for (const capture of [false, true]) {
	for (const change of ["remove", "stack-hidden", "overlay-hidden"] as const) {
		test(`invalidates ${capture ? "captured" : "pressed"} and focused targets after ${change}`, () => {
			const events: string[] = [];
			const child: Component = {
				render: () => ["child"],
				invalidate: () => {},
				handleMouse: (event) => {
					events.push(event.type);
					return { handled: true, capture, focus: true, render: false };
				},
				handleInput: (data) => events.push(data),
			};
			let visible = true;
			const box = new Box(0, 0);
			box.addChild(new MouseRegion(child, () => undefined));
			const root = new VStack([{ component: box, visible: () => visible }]);
			const terminal = new VirtualTerminal(20, 4);
			const tui = new TuiAltScreen(terminal);
			tui.setLayoutRoot(root);
			tui.start();
			const overlay =
				change === "overlay-hidden"
					? tui.showOverlay(box, { anchor: "top-left", width: 20, nonCapturing: true })
					: undefined;
			try {
				tui.renderNow();
				terminal.sendInput("\x1b[<0;1;1M");
				assert.deepEqual(events, ["press"]);
				// Hide/remove the only mount, without repainting before the next input.
				if (overlay) {
					root.removeChild(box);
					overlay.setHidden(true);
				} else if (change === "remove") box.clear();
				else visible = false;
				terminal.sendInput("\x1b[<32;20;4M");
				terminal.sendInput("\x1b[<0;1;1m");
				terminal.sendInput("x");
				assert.deepEqual(events, ["press"]);
			} finally {
				tui.stop();
			}
		});
	}
}

test("retains real capture outside bounds and after scrolling its target offscreen", () => {
	const events: Array<{ type: string; x: number; y: number }> = [];
	const child: Component = {
		render: () => ["target"],
		invalidate: () => {},
		handleMouse: (event) => {
			events.push({ type: event.type, x: event.x, y: event.y });
			return { handled: true, capture: true, render: false };
		},
	};
	const content = new Container();
	content.addChild(child);
	content.addChild(new Text("one\ntwo\nthree\nfour", 0, 0));
	const scroll = new ScrollView(content);
	const terminal = new VirtualTerminal(20, 2);
	const tui = new TuiAltScreen(terminal);
	tui.setLayoutRoot(scroll);
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;1M");
		scroll.scrollToEnd();
		tui.renderNow();
		terminal.sendInput("\x1b[<32;20;2M");
		terminal.sendInput("\x1b[<0;20;2m");
		assert.deepEqual(events, [
			{ type: "press", x: 0, y: 0 },
			{ type: "drag", x: 19, y: 1 },
			{ type: "release", x: 19, y: 1 },
		]);
	} finally {
		tui.stop();
	}
});

test("retains a visible sibling's capture and input while another subtree hides", () => {
	let visible = true;
	const hidden = new Container();
	hidden.addChild(new Text("first", 0, 0));
	const events: string[] = [];
	const sibling: Component = {
		render: () => ["sibling"],
		invalidate: () => {},
		handleInput: (data) => events.push(data),
		handleMouse: (event) => {
			events.push(event.type);
			return { capture: true, focus: true, render: false };
		},
	};
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.setLayoutRoot(new VStack([{ component: hidden, visible: () => visible }, sibling]));
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;2M");
		visible = false;
		tui.renderNow();
		terminal.sendInput("\x1b[<32;20;4M");
		terminal.sendInput("\x1b[<0;20;4m");
		terminal.sendInput("x");
		assert.deepEqual(events, ["press", "drag", "release", "x"]);
		assert.equal(tui.getFocusedComponent(), sibling);
	} finally {
		tui.stop();
	}
});

// SDK input-retirement regression: automatic overlay restoration must retain the
// distinction between a previously mounted target and an unknown private child.
for (const mode of ["regular", "fullscreen"] as const) {
	for (const restoration of ["hide", "set-hidden", "hide-overlay", "visibility"] as const) {
		for (const repaint of [false, true]) {
			for (const retired of [false, true]) {
				test(`${mode} ${restoration} ${repaint ? "after paint" : "before paint"} restores ${retired ? "no retired" : "live"} base focus`, () => {
					const baseKeys: string[] = [];
					const overlayKeys: string[] = [];
					let overlayVisible = true;
					const base: Component = {
						render: () => ["base"],
						invalidate() {},
						handleInput: (data) => baseKeys.push(data),
					};
					const overlay: Component = {
						render: () => ["overlay"],
						invalidate() {},
						handleInput: (data) => overlayKeys.push(data),
					};
					const terminal = new VirtualTerminal(20, 4);
					const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
					tui.addChild(base);
					tui.setFocus(base);
					tui.start();
					try {
						tui.renderNow();
						terminal.sendInput("base-before");
						const handle = tui.showOverlay(overlay, { visible: () => overlayVisible });
						tui.renderNow();
						terminal.sendInput("overlay-before");
						assert.deepEqual(baseKeys, ["base-before"]);
						assert.deepEqual(overlayKeys, ["overlay-before"]);
						if (retired) tui.removeChild(base);
						if (restoration === "hide") handle.hide();
						else if (restoration === "set-hidden") handle.setHidden(true);
						else if (restoration === "hide-overlay") tui.hideOverlay();
						else overlayVisible = false;
						if (repaint) tui.renderNow();
						terminal.sendInput("after-restoration");
						assert.deepEqual(
							baseKeys,
							retired ? ["base-before"] : ["base-before", "after-restoration"],
							"automatic restoration must not deliver a key to a removed base",
						);
						assert.equal(tui.getFocusedComponent(), retired ? null : base);
						assert.deepEqual(overlayKeys, ["overlay-before"]);
						if (retired) tui.addChild(base);
						tui.setFocus(base);
						tui.renderNow();
						terminal.sendInput("fresh-focus");
						assert.equal(baseKeys.at(-1), "fresh-focus", "fresh mounted focus remains valid");
					} finally {
						tui.stop();
					}
				});
			}
		}
	}
}

for (const repaint of [false, true]) {
	test(`opaque direct Container retires captured/focused children ${repaint ? "after paint" : "before paint"}`, () => {
		const events: string[] = [];
		const child: Component = {
			render: () => ["child"],
			invalidate() {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true, render: false };
			},
		};
		const owner = new Container();
		owner.addChild(child);
		const host: Component = {
			render: (width) => owner.render(width),
			invalidate: () => owner.invalidate(),
			handleMouse: (event) => owner.handleMouse(event),
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		tui.addChild(host);
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("intact-key");
			assert.deepEqual(events, ["press", "drag", "release", "intact-key"]);
			assert.equal(tui.getFocusedComponent(), child);
			terminal.sendInput("\x1b[<0;1;1M");
			const beforeRetirement = [...events];
			owner.clear();
			if (repaint) tui.renderNow();
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("retired-key");
			assert.deepEqual(events, beforeRetirement, "removed child must receive no retained mouse or keyboard input");
			assert.equal(tui.getFocusedComponent(), null);
			owner.addChild(child);
			tui.renderNow();
			terminal.sendInput("not-refocused");
			assert.deepEqual(events, beforeRetirement, "remount alone must not restore cancelled focus");
			tui.setFocus(child);
			terminal.sendInput("fresh-manual-key");
			assert.equal(events.at(-1), "fresh-manual-key", "fresh focus reuses the live observed owner route");
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("fresh-key");
			assert.deepEqual(events.slice(beforeRetirement.length), [
				"fresh-manual-key",
				"press",
				"drag",
				"release",
				"fresh-key",
			]);
			assert.equal(tui.getFocusedComponent(), child);
		} finally {
			tui.stop();
		}
	});
}

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode} never-observed private focus survives overlay restoration`, () => {
		const inputs: string[] = [];
		const privateChild: Component = {
			render: () => ["private"],
			invalidate() {},
			handleInput: (data) => inputs.push(data),
		};
		// Text rendering alone establishes no public input ownership for this child.
		const opaqueHost: Component = {
			render: (width) => privateChild.render(width),
			invalidate: () => privateChild.invalidate(),
		};
		const overlay: Component = { render: () => ["overlay"], invalidate() {} };
		const terminal = new VirtualTerminal(20, 4);
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		tui.addChild(opaqueHost);
		tui.setFocus(privateChild);
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("legacy-before");
			const handle = tui.showOverlay(overlay);
			tui.renderNow();
			handle.hide();
			tui.renderNow();
			terminal.sendInput("legacy-after");
			assert.deepEqual(inputs, ["legacy-before", "legacy-after"]);
			assert.equal(tui.getFocusedComponent(), privateChild);
		} finally {
			tui.stop();
		}
	});
}

for (const retired of [false, true]) {
	test(`overlay restoration retains the ${retired ? "retired" : "live"} observed private Container route`, () => {
		const events: string[] = [];
		const child: Component = {
			render: () => ["private"],
			invalidate() {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { focus: true, render: false };
			},
		};
		const owner = new Container();
		owner.addChild(child);
		const host: Component = {
			render: (width) => owner.render(width),
			invalidate: () => owner.invalidate(),
			handleMouse: (event) => owner.handleMouse(event),
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		tui.addChild(host);
		tui.start();
		try {
			tui.renderNow();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<0;1;1m");
			terminal.sendInput("before-overlay");
			assert.equal(tui.getFocusedComponent(), child);
			const beforeOverlay = [...events];
			const handle = tui.showOverlay({ render: () => ["overlay"], invalidate() {} });
			if (retired) owner.clear();
			handle.hide();
			tui.renderNow();
			terminal.sendInput("after-overlay");
			assert.deepEqual(events, retired ? beforeOverlay : [...beforeOverlay, "after-overlay"]);
			assert.equal(tui.getFocusedComponent(), retired ? null : child);
		} finally {
			tui.stop();
		}
	});
}

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode} parking focus records ownership acquired before the first validation`, () => {
		const inputs: string[] = [];
		const base: Component = {
			render: () => ["base"],
			invalidate() {},
			handleInput: (data) => inputs.push(data),
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		tui.setFocus(base);
		tui.addChild(base);
		const handle = tui.showOverlay({ render: () => ["overlay"], invalidate() {} });
		tui.removeChild(base);
		handle.hide();
		tui.start();
		try {
			terminal.sendInput("retired-before-first-paint");
			assert.deepEqual(inputs, []);
			assert.equal(tui.getFocusedComponent(), null);
		} finally {
			tui.stop();
		}
	});
}

for (const repaint of [false, true]) {
	test(`opaque direct Container denies a hidden private owner ${repaint ? "after paint" : "before paint"}`, () => {
		let shown = true;
		const events: string[] = [];
		const child: Component = {
			render: () => ["private-child-live"],
			invalidate() {},
			handleInput: (data) => events.push(data),
			handleMouse: (event) => {
				events.push(event.type);
				return { capture: true, focus: true, render: false };
			},
		};
		class VisibleContainer extends Container {
			isVisible(): boolean {
				return shown;
			}

			override render(width: number): string[] {
				return shown ? super.render(width) : [];
			}
		}
		const owner = new VisibleContainer();
		owner.addChild(child);
		const opaqueHost: Component = {
			render: (width) => owner.render(width),
			invalidate: () => owner.invalidate(),
			handleMouse: (event) => owner.handleMouse(event),
		};
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		tui.addChild(opaqueHost);
		tui.start();
		try {
			tui.renderNow();
			assert.ok(tui.getScreenLines().some((line) => line.includes("private-child-live")));
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("intact-key");
			assert.deepEqual(events, ["press", "drag", "release", "intact-key"]);
			terminal.sendInput("\x1b[<0;1;1M");
			const beforeHiding = [...events];
			shown = false;
			if (repaint) {
				tui.renderNow();
				assert.ok(tui.getScreenLines().every((line) => !line.includes("private-child-live")));
			}
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("hidden-key");
			assert.deepEqual(events, beforeHiding, "hidden private stock owner denies retained mouse and keys");
			assert.equal(tui.getFocusedComponent(), null);
			shown = true;
			tui.renderNow();
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			terminal.sendInput("not-refocused");
			assert.deepEqual(events, beforeHiding, "showing alone must not restore the cancelled gesture or focus");
			tui.setFocus(child);
			terminal.sendInput("fresh-focus");
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;20;4M");
			terminal.sendInput("\x1b[<0;20;4m");
			assert.deepEqual(events.slice(beforeHiding.length), ["fresh-focus", "press", "drag", "release"]);
			assert.equal(tui.getFocusedComponent(), child);
		} finally {
			tui.stop();
		}
	});
}
