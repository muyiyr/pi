import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelsDevV2Model } from "../catalog/sources/models-dev.ts";
import { streamSimple } from "../src/api/openai-completions.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import type { Api, Model, SimpleStreamOptions } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { writeUpstreamMock } from "./catalog-generation-utils.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function sourceModel(
	id: string,
	api: ModelsDevV2Model["api"],
	reasoning?: ModelsDevV2Model["capabilities"]["reasoning"],
): ModelsDevV2Model {
	return {
		id,
		type: "chat",
		name: id,
		modalities: { input: ["text"], output: ["text"] },
		capabilities: { tools: { supported: true }, reasoning: reasoning ?? { supported: false } },
		api,
	};
}

function generateOpencodeModels(
	models: ModelsDevV2Model[],
	strict = false,
	provider: "opencode" | "opencode-go" = "opencode",
) {
	const root = mkdtempSync(join(tmpdir(), "pi-opencode-generation-"));
	temporaryRoots.push(root);
	const preloadPath = join(root, "mock-catalog.mjs");
	const outputPath = join(root, "catalog");
	writeUpstreamMock(preloadPath, {
		[provider]: { models: Object.fromEntries(models.map((model) => [model.id, model])) },
	});
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			pathToFileURL(preloadPath).href,
			"catalog/generate.ts",
			...(strict ? ["--strict"] : []),
			"--json-only",
			"--json-output",
			outputPath,
		],
		{ cwd: packageRoot, encoding: "utf8", timeout: 10_000 },
	);
	return {
		result,
		models: () =>
			JSON.parse(readFileSync(join(outputPath, `providers/${provider}.json`), "utf8")) as Record<string, Model<Api>>,
	};
}

async function captureRequest(model: Model<"openai-completions">, reasoning?: SimpleStreamOptions["reasoning"]) {
	let payload: unknown;
	await streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "Hello", timestamp: 0 }] }), {
		apiKey: "test",
		reasoning,
		fetch: async () => {
			throw new Error("Unexpected network request");
		},
		onPayload: (request) => {
			payload = request;
			throw new Error("Payload captured");
		},
	}).result();
	expect(payload).toBeDefined();
	return payload;
}

describe("OpenCode model generation", () => {
	// Regression for #10237: K2.7 Code accepts thinking objects, not reasoning_effort or disabled thinking.
	it.each(["opencode", "opencode-go"] as const)("keeps Kimi K2.7 Code thinking enabled on %s", async (provider) => {
		const modelIds = ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"];
		const { result, models } = generateOpencodeModels(
			modelIds.map((id) =>
				sourceModel(
					id,
					{ "chat-completions": { base_url: "https://example.test/v1" } },
					{ supported: true, effort: ["none", "medium", "high"] },
				),
			),
			false,
			provider,
		);
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		const generated = models();
		for (const id of modelIds) {
			// The upstream fixture serves each model only on Chat Completions.
			const model = generated[id] as Model<"openai-completions">;
			expect(getSupportedThinkingLevels(model)).not.toContain("off");
			for (const reasoning of ["medium", "high", undefined] satisfies SimpleStreamOptions["reasoning"][]) {
				const payload = await captureRequest(model, reasoning);
				expect(payload).not.toHaveProperty("reasoning_effort");
				if (reasoning === undefined) {
					expect(payload).not.toHaveProperty("thinking");
				} else {
					expect(payload).toHaveProperty("thinking", { type: "enabled" });
				}
			}
		}
	});

	// Regression for #10237: extending K2.7 compat must preserve the other Kimi request formats.
	it.each(["opencode", "opencode-go"] as const)("preserves K2.6 toggles and K3 effort on %s", async (provider) => {
		const { result, models } = generateOpencodeModels(
			["kimi-k2.6", "kimi-k3"].map((id) =>
				sourceModel(
					id,
					{ "chat-completions": { base_url: "https://example.test/v1" } },
					{ supported: true, effort: ["none", "medium", "high"] },
				),
			),
			false,
			provider,
		);
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		// The fixture serves both models only on Chat Completions.
		const generated = models() as Record<string, Model<"openai-completions">>;
		for (const [reasoning, thinking, effort] of [
			["high", "enabled", "high"],
			[undefined, "disabled", "none"],
		] as const) {
			const k26 = await captureRequest(generated["kimi-k2.6"], reasoning);
			expect(k26).toHaveProperty("thinking", { type: thinking });
			expect(k26).not.toHaveProperty("reasoning_effort");
			const k3 = await captureRequest(generated["kimi-k3"], reasoning);
			expect(k3).toHaveProperty("reasoning_effort", effort);
			expect(k3).not.toHaveProperty("thinking");
		}
	});

	it("uses the protocol and base URL models.dev lists for each model", () => {
		const base = "https://example.test/zen";
		const { result, models } = generateOpencodeModels([
			sourceModel("chat", { "chat-completions": { base_url: `${base}/openai/v1` } }),
			sourceModel("responses", { responses: { base_url: `${base}/openai/v1` } }),
			sourceModel("messages", { messages: { base_url: `${base}/anthropic/v1` } }),
			sourceModel("gemini", { "generate-content": { base_url: `${base}/google/v1beta` } }),
			// Native protocols win over Chat Completions regardless of listing order.
			sourceModel("both", {
				"chat-completions": { base_url: `${base}/openai/v1` },
				messages: { base_url: `${base}/anthropic/v1` },
			}),
			sourceModel("live", { "bidi-generate-content": { base_url: `${base}/google/v1beta` } }),
		]);
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		expect(result.stderr).toContain("models.dev lists no supported API for opencode/live (bidi-generate-content)");

		const generated = models();
		const endpoints = Object.fromEntries(
			Object.values(generated).map((model) => [model.id, { api: model.api, baseUrl: model.baseUrl }]),
		);
		expect(endpoints).toEqual({
			chat: { api: "openai-completions", baseUrl: `${base}/openai/v1` },
			responses: { api: "openai-responses", baseUrl: `${base}/openai/v1` },
			// The Anthropic SDK appends /v1/messages itself.
			messages: { api: "anthropic-messages", baseUrl: `${base}/anthropic` },
			gemini: { api: "google-generative-ai", baseUrl: `${base}/google/v1beta` },
			both: { api: "anthropic-messages", baseUrl: `${base}/anthropic` },
		});
	});

	it("fails strict generation for a model without a supported protocol", () => {
		const { result } = generateOpencodeModels(
			[sourceModel("live", { "bidi-generate-content": { base_url: "https://example.test/google/v1beta" } })],
			true,
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("models.dev lists no supported API for opencode/live (bidi-generate-content)");
	});
});
