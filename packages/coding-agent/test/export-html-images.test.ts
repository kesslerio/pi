import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { Text } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test } from "vitest";
import { exportSessionToHtml } from "../src/core/export-html/index.ts";
import { createToolHtmlRenderer } from "../src/core/export-html/tool-renderer.ts";
import type { ToolRenderers } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=";
const temporaryDirectories: string[] = [];

// This transport records HTML produced by the complete exported application.
// It does not implement rendering, image decoding or browser interaction.
class HtmlTransportNode {
	readonly tag: string;
	textContent = "";
	value = "";
	className = "";
	dataset: Record<string, string> = {};
	style: Record<string, unknown> = { setProperty() {} };
	classList = { add() {}, remove() {}, toggle() {} };
	children: HtmlTransportNode[] = [];
	content: { firstElementChild: HtmlTransportNode | null } = { firstElementChild: null };
	private html = "";

	constructor(tag = "div") {
		this.tag = tag;
	}

	get innerHTML(): string {
		return this.html;
	}

	set innerHTML(value: string) {
		this.html = value;
		this.children = [];
		if (this.tag === "template") {
			const node = new HtmlTransportNode();
			node.innerHTML = value;
			this.content.firstElementChild = value ? node : null;
		}
	}

	appendChild(node: HtmlTransportNode): void {
		this.children.push(node);
	}

	cloneNode(): HtmlTransportNode {
		const copy = new HtmlTransportNode(this.tag);
		copy.innerHTML = this.innerHTML;
		copy.children = this.children.map((child) => child.cloneNode());
		return copy;
	}

	addEventListener(): void {}
	querySelector(): null {
		return null;
	}
	querySelectorAll(): HtmlTransportNode[] {
		return [];
	}

	output(): string {
		return this.innerHTML + this.children.map((child) => child.output()).join("");
	}
}

function runExportedApplication(html: string): string {
	const elements = new Map<string, HtmlTransportNode>();
	const element = (id: string) => {
		let node = elements.get(id);
		if (!node) {
			node = new HtmlTransportNode();
			elements.set(id, node);
		}
		return node;
	};
	const document = {
		body: new HtmlTransportNode(),
		documentElement: new HtmlTransportNode(),
		getElementById: element,
		querySelector: () => null,
		querySelectorAll: () => [],
		createElement: (tag: string) => new HtmlTransportNode(tag),
		createDocumentFragment: () => new HtmlTransportNode(),
		addEventListener() {},
	};
	const window = {
		document,
		location: { href: "file:///session.html", search: "" },
		innerWidth: 1280,
		addEventListener() {},
		removeEventListener() {},
		matchMedia: () => ({ matches: false }),
	};
	const context = createContext({
		document,
		window,
		console,
		TextDecoder,
		Uint8Array,
		URL,
		URLSearchParams,
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		localStorage: { getItem: () => null, setItem() {} },
		setTimeout: () => 0,
		clearTimeout() {},
	});
	// Script boundaries are public HTML containers, not extracted private functions.
	for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
		if (script[1].includes('id="session-data"')) {
			element("session-data").textContent = script[2];
		} else {
			runInContext(script[2], context, { timeout: 1000, filename: "exported-session.html" });
		}
	}
	return element("messages").output();
}

type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

async function renderSession(name: string, content: Content, renderers?: ToolRenderers): Promise<string> {
	initTheme("dark");
	const dir = mkdtempSync(join(tmpdir(), "pi-export-images-"));
	temporaryDirectories.push(dir);
	const manager = SessionManager.create(dir, join(dir, "sessions"));
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "toolCall", id: "image-call", name, arguments: { path: "fixture.png" } }],
		api: "anthropic-messages",
		provider: "synthetic",
		model: "fixture",
		usage,
		stopReason: "toolUse",
		timestamp: 1,
	});
	manager.appendMessage({
		role: "toolResult",
		toolCallId: "image-call",
		toolName: name,
		content,
		isError: false,
		timestamp: 2,
	});
	const file = await exportSessionToHtml(manager, undefined, {
		outputPath: join(dir, "session.html"),
		toolRenderer: createToolHtmlRenderer({ getToolRenderers: () => renderers, theme, cwd: dir }),
	});
	return runExportedApplication(readFileSync(file, "utf8"));
}

const callRenderer: ToolRenderers = { renderCall: () => new Text("custom call", 0, 0) };
const resultRenderer: ToolRenderers = {
	renderResult: (_result, options) => new Text(options.expanded ? "custom expanded result" : "custom preview", 0, 0),
};

describe("export HTML tool result images", () => {
	afterEach(() => {
		for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	test.each([
		{ name: "registered", renderers: {} },
		{ name: "legacy", renderers: {} },
		{ name: "resumed", renderers: undefined },
		{ name: "custom-call", renderers: callRenderer },
		{ name: "custom-result", renderers: resultRenderer },
		{ name: "custom-both", renderers: { ...callRenderer, ...resultRenderer } },
	])("renders one saved image for $name", async ({ name, renderers }) => {
		const html = await renderSession(
			name,
			[
				{ type: "text", text: "retained text" },
				{ type: "image", mimeType: "image/png", data: png },
			],
			renderers,
		);
		expect(html).toContain('id="tool-call-image-call"');
		expect(html.match(/class="tool-image"/g)).toHaveLength(1);
		expect(html).toContain(`src="data:image/png;base64,${png}"`);
		expect(html).toContain(
			name.startsWith("custom-result") || name === "custom-both" ? "custom expanded result" : "retained text",
		);
	});

	test.each([undefined, resultRenderer])("renders image-only results once per block", async (renderers) => {
		const html = await renderSession(
			"image-only",
			[
				{ type: "image", mimeType: "image/png", data: png },
				{ type: "image", mimeType: "image/jpeg", data: "second-image" },
			],
			renderers,
		);
		expect(html.match(/class="tool-image"/g)).toHaveLength(2);
		expect(html.indexOf(`data:image/png;base64,${png}`)).toBeLessThan(
			html.indexOf("data:image/jpeg;base64,second-image"),
		);
	});

	test("keeps the stock read image single", async () => {
		const html = await renderSession("read", [{ type: "image", mimeType: "image/png", data: png }]);
		expect(html.match(/class="tool-image"/g)).toHaveLength(1);
	});

	test.each([{ content: [] }, { content: [{ type: "text", text: "text only" }] }] satisfies Array<{
		content: Content;
	}>)("adds no image container for results without images", async ({ content }) => {
		const html = await renderSession("no-image", content, resultRenderer);
		expect(html).not.toContain('class="tool-image"');
		expect(html).not.toContain('class="tool-images"');
	});

	test("escapes MIME and data attributes on the generic tool path", async () => {
		const html = await renderSession("escaped-image", [
			{ type: "image", mimeType: 'image/png" onerror="bad<&\'', data: "\"'><bad&" },
		]);
		expect(html).toContain(
			'src="data:image/png&quot; onerror=&quot;bad&lt;&amp;&#39;;base64,&quot;&#39;&gt;&lt;bad&amp;"',
		);
		expect(html).not.toContain(' onerror="');
		expect(html.match(/class="tool-image"/g)).toHaveLength(1);
	});
});
