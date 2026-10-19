import assert from "node:assert/strict";
import { test } from "node:test";
import type { Component } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

test("cancelled capture permits hover across focus-out while denying held-button drag", () => {
	const capturedEvents: string[] = [];
	const baseEvents: string[] = [];
	const base: Component = {
		render: () => ["base"],
		invalidate() {},
		handleMouse: (event) => {
			baseEvents.push(event.type);
			return { handled: true, render: false };
		},
	};
	const captured: Component = {
		render: () => ["captured"],
		invalidate() {},
		handleMouse: (event) => {
			capturedEvents.push(event.type);
			return { capture: true, render: false };
		},
	};
	const terminal = new VirtualTerminal(20, 4);
	const tui = new TuiAltScreen(terminal);
	tui.addChild(base);
	const overlay = tui.showOverlay(captured, { anchor: "top-left", width: 10, nonCapturing: true });
	tui.start();
	try {
		tui.renderNow();
		terminal.sendInput("\x1b[<0;1;1M");
		assert.deepEqual(capturedEvents, ["press"]);
		overlay.setHidden(true);
		tui.renderNow();
		terminal.sendInput("\x1b[<32;1;1M");
		assert.deepEqual(capturedEvents, ["press"], "cancelled capture receives no held-button drag");
		assert.deepEqual(baseEvents, [], "cancelled held-button drag must not retarget to the base");
		terminal.sendInput("\x1b[<63;1;1M");
		assert.deepEqual(baseEvents, ["move"], "pure hover must pass without reviving the cancelled gesture");
		terminal.sendInput("\x1b[<32;1;1M");
		assert.deepEqual(baseEvents, ["move"], "hover must not clear held-button suppression");
		terminal.sendInput("\x1b[O");
		terminal.sendInput("\x1b[I");
		terminal.sendInput("\x1b[<63;1;1M");
		assert.deepEqual(baseEvents, ["move", "move"], "pure hover must also pass after terminal focus-out");
		terminal.sendInput("\x1b[<32;1;1M");
		assert.deepEqual(baseEvents, ["move", "move"], "focus-out must not admit a stale held-button drag");
		assert.deepEqual(capturedEvents, ["press"]);
		overlay.setHidden(false);
		tui.renderNow();
		terminal.sendInput("\x1b[<32;1;1M");
		assert.deepEqual(capturedEvents, ["press"], "showing the target must not revive the cancelled gesture");
		assert.deepEqual(baseEvents, ["move", "move"]);
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<0;1;1m");
		assert.deepEqual(baseEvents, ["move", "move"]);
		assert.deepEqual(capturedEvents, ["press", "press", "release", "click"]);
	} finally {
		tui.stop();
	}
});
