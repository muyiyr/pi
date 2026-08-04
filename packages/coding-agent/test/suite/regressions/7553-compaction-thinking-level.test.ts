import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionBeforeCompactEvent } from "../../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "../harness.ts";

type CompactionMode = "manual" | "auto";

type SessionWithAutoCompaction = {
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

interface SummaryRequest {
	provider: string;
	modelId: string;
	baseUrl: string;
	reasoning: SimpleStreamOptions["reasoning"] | undefined;
}

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function seedCompactableSession(harness: Harness): void {
	const model = harness.getModel();
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	const assistant: AssistantMessage = {
		...fauxAssistantMessage("assistant response to compact", {
			timestamp: now - 500,
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(100),
	};
	harness.sessionManager.appendMessage(assistant);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function captureSummaryRequests(harness: Harness): SummaryRequest[] {
	const requests: SummaryRequest[] = [];
	harness.session.agent.streamFunction = (model, _context, options) => {
		requests.push({
			provider: model.provider,
			modelId: model.id,
			baseUrl: model.baseUrl,
			reasoning: options?.reasoning,
		});
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage("compaction summary"),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return requests;
}

function registerSummaryProvider(harness: Harness, modelId = "summary-1"): Model<Api> {
	const model: Model<Api> = {
		...harness.getModel(),
		id: modelId,
		name: "Summary Model",
		provider: "summary-provider",
		baseUrl: "https://catalog.example.test",
		reasoning: true,
	};
	harness.session.modelRuntime.registerNativeProvider({
		id: model.provider,
		name: "Summary Provider",
		auth: {
			apiKey: {
				name: "Summary API key",
				resolve: async () => ({
					auth: {
						apiKey: "summary-key",
						baseUrl: "https://request.example.test",
					},
					source: "test summary key",
				}),
			},
		},
		getModels: () => [model],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => createAssistantMessageEventStream(),
	});
	return model;
}

async function runCompaction(harness: Harness, mode: CompactionMode): Promise<void> {
	if (mode === "manual") {
		await harness.session.compact();
		return;
	}

	const session = harness.session as unknown as SessionWithAutoCompaction;
	await session._runAutoCompaction("threshold", false);
}

describe("issue #7553 compaction model and thinking level", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it.each(["manual", "auto"] as const)(
		"uses the configured model and thinking level for %s compaction",
		async (mode) => {
			const harness = await createHarness({
				models: [
					{ id: "faux-1", reasoning: true },
					{ id: "faux-2", reasoning: true },
				],
				settings: {
					compaction: {
						keepRecentTokens: 1,
						model: "faux/faux-2",
						thinkingLevel: "high",
					},
				},
			});
			harnesses.push(harness);
			harness.session.agent.state.thinkingLevel = "low";
			seedCompactableSession(harness);
			const requests = captureSummaryRequests(harness);

			await runCompaction(harness, mode);

			expect(requests).toEqual([
				expect.objectContaining({
					provider: "faux",
					modelId: "faux-2",
					reasoning: "high",
				}),
			]);
			expect(harness.session.model?.id).toBe("faux-1");
		},
	);

	it("inherits the live session level for the configured model", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", reasoning: true },
				{ id: "faux-2", reasoning: true },
			],
			settings: { compaction: { keepRecentTokens: 1, model: "faux/faux-2" } },
		});
		harnesses.push(harness);
		harness.session.agent.state.thinkingLevel = "medium";
		seedCompactableSession(harness);
		const requests = captureSummaryRequests(harness);

		await harness.session.compact();

		expect(requests).toEqual([
			expect.objectContaining({
				provider: "faux",
				modelId: "faux-2",
				reasoning: "medium",
			}),
		]);
	});

	it("allows explicit off to override the session level", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", reasoning: true },
				{ id: "faux-2", reasoning: true },
			],
			settings: {
				compaction: {
					keepRecentTokens: 1,
					model: "faux/faux-2",
					thinkingLevel: "off",
				},
			},
		});
		harnesses.push(harness);
		harness.session.agent.state.thinkingLevel = "high";
		seedCompactableSession(harness);
		const requests = captureSummaryRequests(harness);

		await harness.session.compact();

		expect(requests).toEqual([
			expect.objectContaining({
				provider: "faux",
				modelId: "faux-2",
				reasoning: undefined,
			}),
		]);
	});

	it("clamps the override to the configured model capabilities", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", reasoning: true },
				{ id: "faux-2", reasoning: false },
			],
			settings: {
				compaction: {
					keepRecentTokens: 1,
					model: "faux/faux-2",
					thinkingLevel: "high",
				},
			},
		});
		harnesses.push(harness);
		seedCompactableSession(harness);
		const requests = captureSummaryRequests(harness);

		await harness.session.compact();

		expect(requests).toEqual([
			expect.objectContaining({
				provider: "faux",
				modelId: "faux-2",
				reasoning: undefined,
			}),
		]);
	});

	it("allows manual compaction without a session model when a compaction model is configured", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", reasoning: true },
				{ id: "faux-2", reasoning: true },
			],
			settings: {
				compaction: {
					keepRecentTokens: 1,
					model: "faux/faux-2",
					thinkingLevel: "high",
				},
			},
		});
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<Api>;
		seedCompactableSession(harness);
		const requests = captureSummaryRequests(harness);

		await harness.session.compact();

		expect(requests).toEqual([
			expect.objectContaining({
				provider: "faux",
				modelId: "faux-2",
				reasoning: "high",
			}),
		]);
	});

	it("rejects an unknown configured model", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1, model: "faux/missing" } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);

		await expect(harness.session.compact()).rejects.toThrow(
			'Compaction model "faux/missing" not found. Use an exact model id or provider/model reference.',
		);
	});

	it("rejects an ambiguous bare model id", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1, model: "faux-1" } },
		});
		harnesses.push(harness);
		registerSummaryProvider(harness, "faux-1");
		seedCompactableSession(harness);

		await expect(harness.session.compact()).rejects.toThrow(
			'Compaction model "faux-1" not found. Use an exact model id or provider/model reference.',
		);
	});

	it("exposes raw settings and the effective request model to extensions", async () => {
		let capturedEvent: SessionBeforeCompactEvent | undefined;
		const harness = await createHarness({
			settings: {
				compaction: {
					keepRecentTokens: 1,
					model: "summary-provider/summary-1",
					thinkingLevel: "high",
				},
			},
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						capturedEvent = event;
					});
				},
			],
		});
		harnesses.push(harness);
		registerSummaryProvider(harness);
		harness.session.agent.state.thinkingLevel = "low";
		seedCompactableSession(harness);
		const requests = captureSummaryRequests(harness);

		await harness.session.compact();

		expect(requests).toEqual([
			{
				provider: "summary-provider",
				modelId: "summary-1",
				baseUrl: "https://request.example.test",
				reasoning: "high",
			},
		]);
		expect(capturedEvent).toMatchObject({
			model: {
				provider: "summary-provider",
				id: "summary-1",
				baseUrl: "https://request.example.test",
			},
			thinkingLevel: "high",
			preparation: {
				settings: {
					model: "summary-provider/summary-1",
					thinkingLevel: "high",
				},
			},
		});
	});
});
