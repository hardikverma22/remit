import { describe, expect, test } from "vitest";
import { actionGeneric, mutationGeneric, anyApi, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { GovernanceRuntime } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

const gov = new GovernanceRuntime(components.remit);

// Test endpoints exposed for the test runner to execute
export const testRegister = actionGeneric({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await gov.registerAgent(ctx, {
      name: args.name,
      metadata: { environment: "test" },
    });
  },
});

export const testVerifyToken = mutationGeneric({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await gov.verifyToken(ctx, { token: args.token });
  },
});

export const testLifecycle = mutationGeneric({
  args: { agentId: v.string(), action: v.string() },
  handler: async (ctx, args) => {
    if (args.action === "suspend") {
      await gov.suspendAgent(ctx, { agentId: args.agentId });
    } else if (args.action === "reactivate") {
      await gov.reactivateAgent(ctx, { agentId: args.agentId });
    }
    return null;
  },
});

export const testIssueCapability = actionGeneric({
  args: { agentId: v.string(), toolName: v.string() },
  handler: async (ctx, args) => {
    return await gov.issueCapability(ctx, {
      agentId: args.agentId,
      toolName: args.toolName,
      expirationTime: Date.now() + 60 * 1000,
      delegationDepth: 2,
      purpose: "test capability",
    });
  },
});

export const testVerifyCapability = mutationGeneric({
  args: { capabilityId: v.string(), toolName: v.string(), parameters: v.any() },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.remit.capabilities.verify, {
      capabilityId: args.capabilityId,
      toolName: args.toolName,
      parameters: args.parameters,
    });
  },
});

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "index.test": {
      testRegister: typeof testRegister;
      testVerifyToken: typeof testVerifyToken;
      testLifecycle: typeof testLifecycle;
      testIssueCapability: typeof testIssueCapability;
      testVerifyCapability: typeof testVerifyCapability;
    };
  }>
)["index.test"];

describe("GovernanceRuntime Client Wrapper", () => {
  test("Agent registration and active/suspended token lifecycle", async () => {
    const t = initConvexTest();

    // 1. Register agent
    const regResult = await t.action(testApi.testRegister, { name: "AuditAgent" });
    expect(regResult.agentId).toBeDefined();
    expect(regResult.token).toBeDefined();

    // 2. Verify token works and maps to agentId
    const verifiedAgentId = await t.mutation(testApi.testVerifyToken, { token: regResult.token });
    expect(verifiedAgentId).toBe(regResult.agentId);

    // 3. Suspend agent
    await t.mutation(testApi.testLifecycle, { agentId: regResult.agentId, action: "suspend" });

    // 4. Verify token fails when suspended
    const verifiedAgentIdSuspended = await t.mutation(testApi.testVerifyToken, { token: regResult.token });
    expect(verifiedAgentIdSuspended).toBeNull();

    // 5. Reactivate agent
    await t.mutation(testApi.testLifecycle, { agentId: regResult.agentId, action: "reactivate" });

    // 6. Verify token works again
    const verifiedAgentIdReactive = await t.mutation(testApi.testVerifyToken, { token: regResult.token });
    expect(verifiedAgentIdReactive).toBe(regResult.agentId);
  });

  test("Capability issuance and scope verification", async () => {
    const t = initConvexTest();

    // 1. Register agent
    const regResult = await t.action(testApi.testRegister, { name: "GovernedAgent" });

    // 2. Issue capability for tool 'send_email'
    const capResult = await t.action(testApi.testIssueCapability, {
      agentId: regResult.agentId,
      toolName: "send_email",
    });
    expect(capResult.capabilityId).toBeDefined();

    // 3. Verify tool 'send_email' is allowed
    const verifyAllowed = await t.mutation(testApi.testVerifyCapability, {
      capabilityId: capResult.capabilityId,
      toolName: "send_email",
      parameters: {},
    });
    expect(verifyAllowed.allowed).toBe(true);

    // 4. Verify tool 'transfer_money' is rejected
    const verifyRejected = await t.mutation(testApi.testVerifyCapability, {
      capabilityId: capResult.capabilityId,
      toolName: "transfer_money",
      parameters: {},
    });
    expect(verifyRejected.allowed).toBe(false);
    expect(verifyRejected.reason).toContain("is not allowed by this capability");
  });
});
