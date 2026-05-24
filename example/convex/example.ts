import { action, mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { GovernanceRuntime } from "@agent-governance/convex";
import { v } from "convex/values";

const gov = new GovernanceRuntime(components.remit);

// Register an agent and get a token
export const registerAgent = action({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await gov.registerAgent(ctx, { name: args.name });
  },
});

// Issue a capability to an agent
export const issueCapability = action({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    expirationTime: v.number(),
    delegationDepth: v.number(),
    purpose: v.string(),
  },
  handler: async (ctx, args) => {
    return await gov.issueCapability(ctx, args);
  },
});

// Verify a capability is allowed to execute a tool
export const verifyCapability = mutation({
  args: {
    capabilityId: v.string(),
    toolName: v.string(),
    parameters: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.remit.capabilities.verify, args);
  },
});

// List all registered agents
export const listAgents = query({
  args: {},
  handler: async (ctx) => {
    return await gov.listAgents(ctx);
  },
});

// Retrieve live lineage events feed
export const liveExecutionFeed = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.remit.lineage.liveExecutionFeed, {});
  },
});

// Create a governance policy rule
export const createPolicy = mutation({
  args: {
    toolPattern: v.string(),
    agentPattern: v.string(),
    effect: v.string(), // "allow" | "deny" | "require_approval"
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    return await gov.createPolicy(ctx, args);
  },
});

// Suspend an agent
export const suspendAgent = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    return await gov.suspendAgent(ctx, args);
  },
});

// Reactivate an agent
export const reactivateAgent = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    return await gov.reactivateAgent(ctx, args);
  },
});

// Simulate agent tool execution lineage flow
export const simulateToolExecution = action({
  args: {
    capabilityId: v.string(),
    agentId: v.string(),
    toolName: v.string(),
    parameters: v.any(),
    traceId: v.string(),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // Start span
    await ctx.runMutation(components.remit.lineage.startSpan, {
      traceId: args.traceId,
      spanId,
      parentSpanId: args.traceId,
      capabilityId: args.capabilityId,
      agentId: args.agentId,
      tool: args.toolName,
      parameters: args.parameters,
    });

    // Simulate small latency
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (args.success) {
      await ctx.runMutation(components.remit.lineage.completeSpan, {
        spanId,
        outputSummary: `Simulated output summary for ${args.toolName}: Completed successfully.`,
      });
    } else {
      await ctx.runMutation(components.remit.lineage.failSpan, {
        spanId,
        error: `Simulated error in ${args.toolName}: Execution aborted due to constraint.`,
      });
    }

    return spanId;
  },
});
