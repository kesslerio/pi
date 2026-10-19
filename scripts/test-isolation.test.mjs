import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../test.sh", import.meta.url));
const sentinelNames = [
	"NPM_TOKEN",
	"NODE_AUTH_TOKEN",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"AWS_ACCESS_KEY_ID",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_KEY_0",
	"GIT_CONFIG_VALUE_0",
	"GIT_SSH_COMMAND",
	"OLLAMA_HOST",
	"PI_CODING_AGENT_DIR",
];

// Run the whole public script with a declarative test command and genuine npm.
const consumer = `import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const config = (name) => execFileSync("npm", ["config", "get", name], {
	encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
}).trim();
const root = dirname(process.env.HOME);
const result = {
	offline: config("offline") === "true",
	ignoreScripts: config("ignore-scripts") === "true",
	global: config("global") === "true",
	updateNotifier: config("update-notifier") === "true",
	isolatedUserconfig: config("userconfig") === join(root, "npm-userconfig"),
	isolatedGlobalconfig: config("globalconfig") === join(root, "npm-globalconfig"),
	emptyUserconfig: readFileSync(join(root, "npm-userconfig"), "utf8") === "",
	emptyGlobalconfig: readFileSync(join(root, "npm-globalconfig"), "utf8") === "",
	callerRegistryPresent: config("registry") === "https://nonsecret-fixture.invalid/",
	gitGlobalDisabled: process.env.GIT_CONFIG_GLOBAL === "/dev/null",
	gitSystemDisabled: process.env.GIT_CONFIG_NOSYSTEM === "1",
	noLocalLlm: process.env.PI_NO_LOCAL_LLM === "1",
};
for (const name of ${JSON.stringify(sentinelNames)}) result[name] = Object.hasOwn(process.env, name);
writeFileSync("observed.json", JSON.stringify(result));
console.log(JSON.stringify(result));
`;

function runFixture(t, settings) {
	const root = mkdtempSync(join(tmpdir(), "pi-test-isolation-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const name of ["home", "tmp"]) mkdirSync(join(root, name));
	writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node inspect.mjs" } }));
	writeFileSync(join(root, "inspect.mjs"), consumer);
	for (const name of ["caller-userconfig", "caller-globalconfig"]) {
		writeFileSync(join(root, name), "offline=true\nignore-scripts=true\nregistry=https://nonsecret-fixture.invalid/\n");
	}
	const env = {
		PATH: process.env.PATH,
		PWD: root,
		HOME: join(root, "home"),
		TMPDIR: join(root, "tmp"),
		NPM_CONFIG_USERCONFIG: join(root, "caller-userconfig"),
		NPM_CONFIG_GLOBALCONFIG: join(root, "caller-globalconfig"),
		NPM_CONFIG_REGISTRY: "https://nonsecret-fixture.invalid/",
		NPM_CONFIG_UPDATE_NOTIFIER: "true",
		...Object.fromEntries(sentinelNames.map((name) => [name, "nonsecret-fixture"])),
		...settings,
	};
	for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	const result = spawnSync("bash", [script], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
	assert.ifError(result.error);
	assert.equal(result.signal, null);
	assert.deepEqual(readdirSync(join(root, "tmp")), [], "the script must clean up its isolated root");
	return { root, result };
}

for (const [label, settings, offline, ignoreScripts] of [
	["explicit safety flags", { NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_GLOBAL: "false" }, true, true],
	["omitted flags", {}, false, false],
	["explicit false", { NPM_CONFIG_OFFLINE: "false", NPM_CONFIG_IGNORE_SCRIPTS: "false", NPM_CONFIG_GLOBAL: "false" }, false, false],
	["independent flags", { NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "false" }, true, false],
]) {
	test(`test.sh preserves ${label} while isolating caller configuration`, (t) => {
		const { root, result } = runFixture(t, settings);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const observed = JSON.parse(readFileSync(join(root, "observed.json"), "utf8"));
		console.log(JSON.stringify({ case: label, ...observed }));
		assert.deepEqual(observed, {
			offline,
			ignoreScripts,
			global: false,
			updateNotifier: false,
			isolatedUserconfig: true,
			isolatedGlobalconfig: true,
			emptyUserconfig: true,
			emptyGlobalconfig: true,
			callerRegistryPresent: false,
			gitGlobalDisabled: true,
			gitSystemDisabled: true,
			noLocalLlm: true,
			...Object.fromEntries(sentinelNames.map((name) => [name, false])),
		});
	});
}

for (const name of ["NPM_CONFIG_OFFLINE", "NPM_CONFIG_IGNORE_SCRIPTS", "NPM_CONFIG_GLOBAL"]) {
	for (const value of ["invalid-nonsecret-fixture", ""]) {
		test(`test.sh rejects invalid ${name} ${value === "" ? "empty" : "nonboolean"} before npm`, (t) => {
			const { root, result } = runFixture(t, { [name]: value });
			assert.equal(result.status, 1);
			assert.equal(result.stdout, "");
			assert.match(result.stderr, new RegExp(name));
			assert.ok(!result.stderr.includes("invalid-nonsecret-fixture"));
			assert.ok(!readdirSync(root).includes("observed.json"));
		});
	}
}

test("test.sh rejects global installs before npm", (t) => {
	const { root, result } = runFixture(t, { NPM_CONFIG_GLOBAL: "true" });
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /Tests require NPM_CONFIG_GLOBAL=false/);
	assert.ok(!readdirSync(root).includes("observed.json"));
});
