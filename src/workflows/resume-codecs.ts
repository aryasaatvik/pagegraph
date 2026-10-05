import * as Schema from "effect/Schema";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { WorkflowFailureV2, WorkflowProgressV2, WorkflowRunV2 } from "./model";
import { DecisionRecord } from "../decide/record";

const array = <S extends Schema.Constraint>(schema: S) => Schema.mutable(Schema.Array(schema));
const strings = array(Schema.String);
const optionalString = Schema.optional(Schema.String);
const model = Schema.Struct({ provider: Schema.String, id: Schema.String });
const usage = Schema.Struct({
  input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number,
  cacheWrite1h: Schema.optional(Schema.Number), reasoning: Schema.optional(Schema.Number), totalTokens: Schema.Number,
  cost: Schema.Struct({ input: Schema.Number, output: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number, total: Schema.Number }),
});
const text = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String, textSignature: optionalString });
const image = Schema.Struct({ type: Schema.Literal("image"), data: Schema.String, mimeType: Schema.String });
const thinking = Schema.Struct({ type: Schema.Literal("thinking"), thinking: Schema.String, thinkingSignature: optionalString, redacted: Schema.optional(Schema.Boolean) });
const toolCall = Schema.Struct({ type: Schema.Literal("toolCall"), id: Schema.String, name: Schema.String, arguments: Schema.JsonObject,
  thoughtSignature: optionalString, namespace: optionalString });
const diagnostic = Schema.Struct({ type: Schema.String, timestamp: Schema.Number, details: Schema.optional(Schema.JsonObject),
  error: Schema.optional(Schema.Struct({ name: optionalString, message: Schema.String, stack: optionalString, code: Schema.optional(Schema.Union([Schema.String, Schema.Number])) })) });
const deferred = Schema.Struct({ provider: Schema.String, modelId: Schema.String, api: Schema.String, id: Schema.String,
  expiresAt: Schema.optional(Schema.Number), pollAfterMs: Schema.optional(Schema.Number), data: Schema.optional(Schema.Json) });
// These codecs follow the pinned Pi 1.0.0 session contracts; custom message roles require a future decoder.
const tool = Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.JsonObject,
  constrainedSampling: Schema.optional(Schema.Union([Schema.Literal(false),
    Schema.Struct({ type: Schema.Literal("json_schema"), strict: Schema.Literals(["prefer", "require"]) }),
    Schema.Struct({ type: Schema.Literal("grammar"), variants: Schema.Struct({ openai_lark: optionalString, openai_regex: optionalString }) })])) });
const message: Schema.Codec<AgentMessage> = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.Union([Schema.String, array(text)]), timestamp: Schema.Number,
    sections: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null]))),
    toolsAdded: Schema.optional(array(tool)), toolsRemoved: Schema.optional(array(Schema.Struct({ name: Schema.String }))) }),
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Union([Schema.String, array(Schema.Union([text, image]))]), timestamp: Schema.Number }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: array(Schema.Union([text, thinking, toolCall])), api: Schema.String,
    provider: Schema.String, model: Schema.String, responseModel: optionalString, responseId: optionalString, providerThinkingLevel: optionalString,
    thinkingLevel: Schema.optional(Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])),
    diagnostics: Schema.optional(array(diagnostic)), usage, stopReason: Schema.Literals(["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"]),
    deferred: Schema.optional(deferred), errorMessage: optionalString, rawStopReason: optionalString, endTurn: Schema.optional(Schema.Boolean), timestamp: Schema.Number }),
  Schema.Struct({ role: Schema.Literal("toolResult"), toolCallId: Schema.String, toolName: Schema.String, content: array(Schema.Union([text, image])),
    details: Schema.optional(Schema.Json), usage: Schema.optional(usage), isError: Schema.Boolean, timestamp: Schema.Number,
    nestedCalls: Schema.optional(Schema.Struct({ complete: Schema.Boolean, calls: array(Schema.Struct({ id: Schema.String, name: Schema.String,
      arguments: Schema.optional(Schema.JsonObject), argumentsBytes: Schema.optional(Schema.Number), status: Schema.Literals(["ok", "error", "unfinished"]),
      durationMs: Schema.optional(Schema.Number), error: optionalString })) })) }),
]);
const agent = Schema.Struct({ runtime: Schema.Literal("pi"), model, messages: array(message), usage });
const rejectedItems = Schema.optional(array(Schema.Struct({ index: Schema.Int, reason: Schema.String })));
const executorRecord = Schema.Struct({ tool: Schema.String, input: Schema.Unknown, output: Schema.Unknown });
const executor = Schema.Struct({ searches: array(executorRecord), calls: array(executorRecord) });
const edge = Schema.Struct({ from: Schema.String, to: Schema.String, type: Schema.Literals(["crumb-parent", "related", "redirect", "collection-member"]) });
const node = Schema.Struct({ path: Schema.String, kind: Schema.String, source: Schema.String,
  policy: Schema.Struct({ kind: Schema.String, crumb: optionalString, robots: optionalString, related: Schema.optional(strings), redirectTo: optionalString,
    link: Schema.optional(Schema.Struct({ title: Schema.String, description: Schema.String })),
    sitemap: Schema.optional(Schema.Union([Schema.Literal(false), Schema.Struct({ priority: Schema.Number, changeFrequency: Schema.Literals(["weekly", "monthly"]) })])) }),
  instance: Schema.optional(Schema.Struct({ title: Schema.String, description: optionalString, publishedAt: optionalString, modifiedAt: optionalString })) });
const neighbor = Schema.Struct({ edge, node });
const suggestions = Schema.Struct({ kind: Schema.Literal("links-candidates"), schemaVersion: Schema.Literal(2), origin: Schema.String,
  limit: Schema.Number, pageLimit: Schema.Number, maxBodyBytes: Schema.Number, total: Schema.Number, truncated: Schema.Boolean,
  skipped: array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  candidates: array(Schema.Struct({ source: Schema.String, destination: Schema.String, cluster: Schema.String, reason: Schema.String, sentence: Schema.String,
    anchor: Schema.String, targetSentence: Schema.String, score: Schema.Number,
    scores: Schema.Struct({ topical: Schema.Number, rarity: Schema.Number, inboundNeed: Schema.Number, graph: Schema.Number }) })) });
const evidence = Schema.Struct({ graph: Schema.Struct({ nodes: array(node), edges: array(edge) }),
  neighborhood: Schema.Struct({ inbound: array(neighbor), outbound: array(neighbor) }),
  sources: array(Schema.Struct({ path: Schema.String, content: Schema.String })), suggestions: Schema.optional(suggestions), executor });
const options = Schema.Struct({ pages: strings, queries: strings, kinds: strings, competitors: strings, domains: strings, limit: Schema.Int,
  market: optionalString, language: optionalString, device: Schema.optional(Schema.Literals(["desktop", "mobile"])), refresh: Schema.Boolean,
  dryRun: Schema.Boolean, allowDirty: Schema.Boolean, allowPrivate: Schema.optional(Schema.Boolean), suggestions: optionalString });
const project = Schema.Struct({ root: Schema.String, head: optionalString, dirtyAtStart: Schema.Boolean, filesAtStart: strings });
const git = Schema.Struct({ head: optionalString, dirty: Schema.Boolean, files: strings, fingerprints: Schema.Record(Schema.String, Schema.String) });
const workflow = Schema.Literals(["research.keywords", "research.competitors", "research.authority", "analyze.serp", "analyze.content", "analyze.ai-search",
  "plan.architecture", "improve.content", "improve.metadata", "improve.schema", "improve.links"]);
const common = { schemaVersion: Schema.Literal(2), id: Schema.String, workflow };
const decisions = Schema.Struct({ kind: Schema.Literal("decide"), schemaVersion: Schema.Literal(1), family: Schema.String, model: Schema.String,
  threshold: Schema.Number, counts: Schema.Struct({ inputs: Schema.Number, resolved: Schema.Number, review: Schema.Number }),
  verdicts: Schema.Record(Schema.String, Schema.Number), resolved: array(DecisionRecord), review: array(DecisionRecord) });
const research = Schema.Struct({ ...common, kind: Schema.Literal("pagegraph-workflow-research-checkpoint"), startedAt: Schema.String,
  checkpointedAt: Schema.String, project, options, evidence, state: Schema.Unknown, decisionInputs: array(Schema.Unknown), agent, rejectedItems });
const result = Schema.Struct({ state: Schema.Unknown, messages: array(message), usage, executor, rejectedItems });
const progress: Schema.Codec<WorkflowProgressV2> = Schema.Struct({ ...common, kind: Schema.Literal("pagegraph-workflow-progress"), startedAt: Schema.String,
  project, options, evidence, repositoryRoot: Schema.String, git, research: Schema.optional(research), decisions: Schema.optional(decisions), actionStarted: Schema.optional(Schema.Boolean),
  action: Schema.optional(result), actionGit: Schema.optional(git),
  actionSources: Schema.optional(array(Schema.Struct({ path: Schema.String, content: Schema.String }))) });
const failure: Schema.Codec<WorkflowFailureV2> = Schema.Struct({ ...common, kind: Schema.Literal("pagegraph-workflow-failure"),
  stage: Schema.String, agent: Schema.optional(agent), executor: Schema.optional(executor), cause: Schema.Unknown });
const run: Schema.Codec<WorkflowRunV2> = Schema.Struct({ ...common, kind: Schema.Literal("pagegraph-workflow-run"), startedAt: Schema.String, finishedAt: Schema.String,
  project: Schema.Struct({ root: Schema.String, head: optionalString, dirtyAtStart: Schema.Boolean }), options, model,
  targets: Schema.Struct({ pages: strings, queries: strings, kinds: strings }), evidence,
  decisions: array(Schema.Struct({ family: Schema.String, questions: array(Schema.Struct({ inputRef: Schema.String, decisions: Schema.Record(Schema.String, Schema.Unknown) })), report: decisions })),
  changes: Schema.Struct({ files: strings, providerCalls: strings }), result: Schema.Unknown, agent, rejectedItems });

export const decodeWorkflowProgress = Schema.decodeUnknownSync(progress);
export const decodeWorkflowFailure = Schema.decodeUnknownSync(failure);
export const decodeWorkflowRun = Schema.decodeUnknownSync(run);
