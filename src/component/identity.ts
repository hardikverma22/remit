import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";

// Hashing helper using Web Crypto API
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Action to securely register a new agent and generate a token
export const registerAgent = action({
  args: {
    name: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    agentId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    // Generate a secure random token (32 bytes hex)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const token = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const tokenHash = await hashToken(token);

    const agentId: string = await ctx.runMutation(internal.identity.insertAgentInternal, {
      name: args.name,
      tokenHash,
      metadata: args.metadata,
    });

    return { agentId, token };
  },
});

export const insertAgentInternal = internalMutation({
  args: {
    name: v.string(),
    tokenHash: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      status: "active",
      metadata: args.metadata,
    });
    await ctx.db.insert("agentTokens", {
      agentId,
      tokenHash: args.tokenHash,
    });
    return agentId;
  },
});

// Mutation to verify a token and return the agent ID if valid/active
export const verifyToken = mutation({
  args: { token: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const tokenRecord = await ctx.db
      .query("agentTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenRecord) return null;

    const agent = await ctx.db.get("agents", tokenRecord.agentId as Id<"agents">);
    if (!agent || agent.status !== "active") return null;

    return agent._id;
  },
});

// Suspend an agent
export const suspendAgent = mutation({
  args: { agentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("agents", args.agentId);
    if (!id) throw new Error(`Invalid agent ID: ${args.agentId}`);
    const agent = await ctx.db.get("agents", id);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch("agents", id, { status: "suspended" });
    return null;
  },
});

// Reactivate an agent
export const reactivateAgent = mutation({
  args: { agentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("agents", args.agentId);
    if (!id) throw new Error(`Invalid agent ID: ${args.agentId}`);
    const agent = await ctx.db.get("agents", id);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch("agents", id, { status: "active" });
    return null;
  },
});

// Get agent by ID
export const getAgent = query({
  args: { agentId: v.string() },
  returns: v.union(v.null(), v.object({
    _id: v.string(),
    _creationTime: v.number(),
    name: v.string(),
    status: v.string(),
    metadata: v.optional(v.any()),
  })),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("agents", args.agentId);
    if (!id) return null;
    const agent = await ctx.db.get("agents", id);
    if (!agent) return null;
    return {
      _id: agent._id,
      _creationTime: agent._creationTime,
      name: agent.name,
      status: agent.status,
      metadata: agent.metadata,
    };
  },
});

// List all agents
export const listAgents = query({
  args: {},
  returns: v.array(v.object({
    _id: v.string(),
    _creationTime: v.number(),
    name: v.string(),
    status: v.string(),
    metadata: v.optional(v.any()),
  })),
  handler: async (ctx) => {
    const list = await ctx.db.query("agents").collect();
    return list.map((agent) => ({
      _id: agent._id,
      _creationTime: agent._creationTime,
      name: agent.name,
      status: agent.status,
      metadata: agent.metadata,
    }));
  },
});
