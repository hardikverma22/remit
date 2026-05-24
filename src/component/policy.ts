import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

// Helper to check wildcard match
function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  return pattern === value;
}

// Create a new policy rule
export const createPolicy = mutation({
  args: {
    toolPattern: v.string(),
    agentPattern: v.string(),
    effect: v.string(), // "allow" | "deny" | "require_approval"
    priority: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const policyId = await ctx.db.insert("policies", {
      toolPattern: args.toolPattern,
      agentPattern: args.agentPattern,
      effect: args.effect,
      priority: args.priority,
      version: 1,
    });
    return policyId;
  },
});

// Evaluate policy against a capability usage
export const evaluate = mutation({
  args: {
    capabilityId: v.string(),
    toolName: v.string(),
    input: v.any(),
  },
  returns: v.object({
    decision: v.string(), // "allow" | "deny" | "require_approval"
    matchedPolicyId: v.optional(v.string()),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const capId = ctx.db.normalizeId("capabilities", args.capabilityId);
    if (!capId) {
      return { decision: "deny", reason: "Invalid capability ID" };
    }

    const capability = await ctx.db.get("capabilities", capId);
    if (!capability) {
      return { decision: "deny", reason: "Capability not found" };
    }

    // Load active policies sorted by priority (highest first)
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_priority")
      .order("desc")
      .collect();

    for (const policy of policies) {
      const toolMatch = matchesPattern(policy.toolPattern, args.toolName);
      const agentMatch = matchesPattern(policy.agentPattern, capability.agentId);

      if (toolMatch && agentMatch) {
        return {
          decision: policy.effect,
          matchedPolicyId: policy._id,
          reason: `Matched policy: tool=${policy.toolPattern}, agent=${policy.agentPattern}, effect=${policy.effect}`,
        };
      }
    }

    // Default deny if no policies match
    return {
      decision: "deny",
      reason: "Default deny: no matching policy rules found",
    };
  },
});
