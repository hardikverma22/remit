import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  agents: defineTable({
    name: v.string(),
    status: v.string(), // "active" | "suspended"
    metadata: v.optional(v.any()),
  }),

  agentTokens: defineTable({
    agentId: v.string(), // ID of agents table
    tokenHash: v.string(),
  }).index("by_tokenHash", ["tokenHash"]),

  capabilities: defineTable({
    agentId: v.string(),
    toolName: v.string(),
    constraints: v.optional(v.any()),
    expirationTime: v.number(),
    delegationDepth: v.number(),
    status: v.string(), // "active" | "expired" | "revoked"
    parentCapabilityId: v.optional(v.string()),
    scheduledExpiryJobId: v.optional(v.string()),
  })
    .index("by_agentId_and_status", ["agentId", "status"])
    .index("by_status", ["status"]),

  delegationRequests: defineTable({
    requesterId: v.string(),
    targetAgentId: v.string(),
    requestedTool: v.string(),
    constraints: v.optional(v.any()),
    status: v.string(), // "pending" | "approved" | "denied"
    policyDecision: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_requesterId", ["requesterId"]),

  executionEvents: defineTable({
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    agentId: v.string(),
    type: v.string(), // "trace_open" | "span_start" | "span_complete" | "span_fail" | "approval_recorded"
    timestamp: v.number(),
    data: v.any(),
  })
    .index("by_traceId", ["traceId"])
    .index("by_spanId", ["spanId"])
    .index("by_agentId", ["agentId"]),

  policies: defineTable({
    toolPattern: v.string(),
    agentPattern: v.string(),
    effect: v.string(), // "allow" | "deny" | "require_approval"
    priority: v.number(),
    version: v.number(),
  }).index("by_priority", ["priority"]),
});
