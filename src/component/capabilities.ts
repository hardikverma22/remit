import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { hashToken } from "./identity.js";

// Action to issue a new root capability
export const issueCapability = action({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    constraints: v.optional(v.any()),
    expirationTime: v.number(),
    delegationDepth: v.number(),
    parentCapabilityId: v.optional(v.string()),
    purpose: v.string(),
  },
  returns: v.object({
    capabilityId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    // Generate secure token (32 bytes hex)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const token = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const tokenHash = await hashToken(token);

    const capabilityId: string = await ctx.runMutation(internal.capabilities.insertCapabilityInternal, {
      agentId: args.agentId,
      toolName: args.toolName,
      constraints: args.constraints,
      expirationTime: args.expirationTime,
      delegationDepth: args.delegationDepth,
      status: "active",
      parentCapabilityId: args.parentCapabilityId,
      tokenHash,
    });

    return { capabilityId, token };
  },
});

export const insertCapabilityInternal = internalMutation({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    constraints: v.optional(v.any()),
    expirationTime: v.number(),
    delegationDepth: v.number(),
    status: v.string(),
    parentCapabilityId: v.optional(v.string()),
    tokenHash: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const capabilityId = await ctx.db.insert("capabilities", {
      agentId: args.agentId,
      toolName: args.toolName,
      constraints: args.constraints,
      expirationTime: args.expirationTime,
      delegationDepth: args.delegationDepth,
      status: args.status,
      parentCapabilityId: args.parentCapabilityId,
    });

    // Save token mapping
    await ctx.db.insert("agentTokens", {
      agentId: args.agentId,
      tokenHash: args.tokenHash,
    });

    // Schedule expiry
    const jobId = await ctx.scheduler.runAt(
      args.expirationTime,
      internal.capabilities.expire,
      { capabilityId }
    );

    // Update capability with scheduled job ID
    await ctx.db.patch("capabilities", capabilityId, { scheduledExpiryJobId: jobId });

    return capabilityId;
  },
});

// Scheduled expiry mutation
export const expire = internalMutation({
  args: { capabilityId: v.id("capabilities") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const capability = await ctx.db.get("capabilities", args.capabilityId);
    if (capability && capability.status === "active") {
      await ctx.db.patch("capabilities", args.capabilityId, { status: "expired" });
    }
    return null;
  },
});

// Revoke a capability manually
export const revoke = mutation({
  args: { capabilityId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("capabilities", args.capabilityId);
    if (!id) throw new Error("Invalid capability ID");
    const capability = await ctx.db.get("capabilities", id);
    if (!capability) throw new Error("Capability not found");

    if (capability.status === "active") {
      await ctx.db.patch("capabilities", id, { status: "revoked" });
      if (capability.scheduledExpiryJobId) {
        await ctx.scheduler.cancel(capability.scheduledExpiryJobId as any);
      }
    }
    return null;
  },
});

// Activate capability from token
export const activateFromToken = mutation({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({
    _id: v.string(),
    agentId: v.string(),
    toolName: v.string(),
    status: v.string(),
  })),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const tokenRecord = await ctx.db
      .query("agentTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenRecord) return null;

    // Find active capability for this agent
    const capability = await ctx.db
      .query("capabilities")
      .withIndex("by_agentId_and_status", (q) =>
        q.eq("agentId", tokenRecord.agentId).eq("status", "active")
      )
      .first();

    if (!capability) return null;
    return {
      _id: capability._id,
      agentId: capability.agentId,
      toolName: capability.toolName,
      status: capability.status,
    };
  },
});

// Verify a capability is allowed to execute a tool with input
export const verify = mutation({
  args: {
    capabilityId: v.string(),
    toolName: v.string(),
    parameters: v.any(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("capabilities", args.capabilityId);
    if (!id) return { allowed: false, reason: "Invalid capability ID" };

    const capability = await ctx.db.get("capabilities", id);
    if (!capability) return { allowed: false, reason: "Capability not found" };

    if (capability.status !== "active") {
      return { allowed: false, reason: `Capability is in status: ${capability.status}` };
    }

    if (Date.now() > capability.expirationTime) {
      // Lazy transition to expired
      await ctx.db.patch("capabilities", id, { status: "expired" });
      return { allowed: false, reason: "Capability has expired" };
    }

    // Check tool name match
    if (capability.toolName !== "*" && capability.toolName !== args.toolName) {
      return { allowed: false, reason: `Tool '${args.toolName}' is not allowed by this capability` };
    }

    // Check simple parameter constraints (if defined)
    if (capability.constraints && capability.constraints[args.toolName]) {
      const toolConstraints = capability.constraints[args.toolName];
      for (const [key, value] of Object.entries(toolConstraints)) {
        if (args.parameters[key] !== value) {
          return {
            allowed: false,
            reason: `Constraint violation for parameter '${key}'. Expected '${value}' but got '${args.parameters[key]}'`,
          };
        }
      }
    }

    return { allowed: true };
  },
});

// Request delegation from parent capability
export const requestDelegation = action({
  args: {
    parentCapabilityId: v.string(),
    forAgentId: v.string(),
    requestedTool: v.string(),
    requestedDepth: v.number(),
    requestedTtlMs: v.number(),
    constraints: v.optional(v.any()),
  },
  returns: v.object({
    capabilityId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    // Generate secure token (32 bytes hex)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const token = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const tokenHash = await hashToken(token);

    const capabilityId: string = await ctx.runMutation(internal.capabilities.delegateInternal, {
      parentCapabilityId: args.parentCapabilityId,
      forAgentId: args.forAgentId,
      requestedTool: args.requestedTool,
      requestedDepth: args.requestedDepth,
      requestedTtlMs: args.requestedTtlMs,
      constraints: args.constraints,
      tokenHash,
    });

    return { capabilityId, token };
  },
});

export const delegateInternal = internalMutation({
  args: {
    parentCapabilityId: v.string(),
    forAgentId: v.string(),
    requestedTool: v.string(),
    requestedDepth: v.number(),
    requestedTtlMs: v.number(),
    constraints: v.optional(v.any()),
    tokenHash: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const parentId = ctx.db.normalizeId("capabilities", args.parentCapabilityId);
    if (!parentId) throw new Error("Invalid parent capability ID");

    const parent = await ctx.db.get("capabilities", parentId);
    if (!parent) throw new Error("Parent capability not found");

    if (parent.status !== "active") {
      throw new Error(`Parent capability is not active (status: ${parent.status})`);
    }

    // Attenuation check: Tool must match parent or parent allow all "*"
    if (parent.toolName !== "*" && parent.toolName !== args.requestedTool) {
      throw new Error("Cannot delegate a tool not allowed by the parent capability");
    }

    // Attenuation check: Remaining depth
    if (args.requestedDepth >= parent.delegationDepth) {
      throw new Error("Requested delegation depth exceeds allowed parent depth");
    }

    // Attenuation check: Expiration time (cannot exceed parent expiry)
    const targetExpiration = Date.now() + args.requestedTtlMs;
    if (targetExpiration > parent.expirationTime) {
      throw new Error("Delegated capability expiration cannot exceed parent expiration");
    }

    // Create capability
    const capabilityId = await ctx.db.insert("capabilities", {
      agentId: args.forAgentId,
      toolName: args.requestedTool,
      constraints: args.constraints,
      expirationTime: targetExpiration,
      delegationDepth: args.requestedDepth,
      status: "active",
      parentCapabilityId: args.parentCapabilityId,
    });

    // Save token mapping
    await ctx.db.insert("agentTokens", {
      agentId: args.forAgentId,
      tokenHash: args.tokenHash,
    });

    // Schedule expiry
    const jobId = await ctx.scheduler.runAt(
      targetExpiration,
      internal.capabilities.expire,
      { capabilityId }
    );

    // Update with scheduled job
    await ctx.db.patch("capabilities", capabilityId, { scheduledExpiryJobId: jobId });

    return capabilityId;
  },
});
