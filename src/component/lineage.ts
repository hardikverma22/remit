import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";


// Open a new trace
export const openTrace = mutation({
  args: {
    traceId: v.string(),
    agentId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert("executionEvents", {
      traceId: args.traceId,
      spanId: args.traceId, // root spanId is same as traceId
      agentId: args.agentId,
      type: "trace_open",
      timestamp: Date.now(),
      data: {},
    });
    return eventId;
  },
});

// Start a span
export const startSpan = mutation({
  args: {
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    capabilityId: v.string(),
    agentId: v.string(),
    tool: v.string(),
    parameters: v.any(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert("executionEvents", {
      traceId: args.traceId,
      spanId: args.spanId,
      parentSpanId: args.parentSpanId,
      agentId: args.agentId,
      type: "span_start",
      timestamp: Date.now(),
      data: {
        capabilityId: args.capabilityId,
        tool: args.tool,
        parameters: args.parameters,
        status: "running",
      },
    });
    return eventId;
  },
});

// Complete a span successfully
export const completeSpan = mutation({
  args: {
    spanId: v.string(),
    outputSummary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the span start event
    const startEvent = await ctx.db
      .query("executionEvents")
      .withIndex("by_spanId", (q) => q.eq("spanId", args.spanId))
      .first();

    if (!startEvent) throw new Error(`Span not found: ${args.spanId}`);

    const latencyMs = Date.now() - startEvent.timestamp;

    await ctx.db.insert("executionEvents", {
      traceId: startEvent.traceId,
      spanId: args.spanId,
      agentId: startEvent.agentId,
      type: "span_complete",
      timestamp: Date.now(),
      data: {
        outputSummary: args.outputSummary ?? "",
        latencyMs,
        status: "completed",
      },
    });

    return null;
  },
});

// Fail a span with an error
export const failSpan = mutation({
  args: {
    spanId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the span start event
    const startEvent = await ctx.db
      .query("executionEvents")
      .withIndex("by_spanId", (q) => q.eq("spanId", args.spanId))
      .first();

    if (!startEvent) throw new Error(`Span not found: ${args.spanId}`);

    const latencyMs = Date.now() - startEvent.timestamp;

    await ctx.db.insert("executionEvents", {
      traceId: startEvent.traceId,
      spanId: args.spanId,
      agentId: startEvent.agentId,
      type: "span_fail",
      timestamp: Date.now(),
      data: {
        errorMessage: args.error,
        latencyMs,
        status: "failed",
      },
    });

    return null;
  },
});

// Record human approval decision
export const recordApproval = mutation({
  args: {
    spanId: v.string(),
    approvedBy: v.string(),
    decision: v.string(), // "approved" | "denied"
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const startEvent = await ctx.db
      .query("executionEvents")
      .withIndex("by_spanId", (q) => q.eq("spanId", args.spanId))
      .first();

    if (!startEvent) throw new Error(`Span not found: ${args.spanId}`);

    await ctx.db.insert("executionEvents", {
      traceId: startEvent.traceId,
      spanId: args.spanId,
      agentId: startEvent.agentId,
      type: "approval_recorded",
      timestamp: Date.now(),
      data: {
        approvedBy: args.approvedBy,
        decision: args.decision,
        reason: args.reason ?? "",
      },
    });

    return null;
  },
});

// Query trace tree events
export const getTraceTree = query({
  args: { traceId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      traceId: v.string(),
      spanId: v.string(),
      parentSpanId: v.optional(v.string()),
      agentId: v.string(),
      type: v.string(),
      timestamp: v.number(),
      data: v.any(),
    })
  ),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("executionEvents")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .order("asc")
      .collect();

    return events.map((e) => ({
      _id: e._id,
      _creationTime: e._creationTime,
      traceId: e.traceId,
      spanId: e.spanId,
      parentSpanId: e.parentSpanId,
      agentId: e.agentId,
      type: e.type,
      timestamp: e.timestamp,
      data: e.data,
    }));
  },
});

// Query live execution feed
export const liveExecutionFeed = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      traceId: v.string(),
      spanId: v.string(),
      parentSpanId: v.optional(v.string()),
      agentId: v.string(),
      type: v.string(),
      timestamp: v.number(),
      data: v.any(),
    })
  ),
  handler: async (ctx) => {
    const events = await ctx.db
      .query("executionEvents")
      .order("desc")
      .take(100);

    return events.map((e) => ({
      _id: e._id,
      _creationTime: e._creationTime,
      traceId: e.traceId,
      spanId: e.spanId,
      parentSpanId: e.parentSpanId,
      agentId: e.agentId,
      type: e.type,
      timestamp: e.timestamp,
      data: e.data,
    }));
  },
});
