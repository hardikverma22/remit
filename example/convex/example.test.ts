import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

describe("example app governance tests", () => {
  test("end-to-end agent and capability verification flow", async () => {
    const t = initConvexTest();

    // 1. Register agent
    const regResult = await t.action(api.example.registerAgent, { name: "DemoAgent" });
    expect(regResult.agentId).toBeDefined();
    expect(regResult.token).toBeDefined();

    // 2. Issue capability for 'read_database'
    const capResult = await t.action(api.example.issueCapability, {
      agentId: regResult.agentId,
      toolName: "read_database",
      expirationTime: Date.now() + 5000,
      delegationDepth: 1,
      purpose: "Read access for demo",
    });
    expect(capResult.capabilityId).toBeDefined();

    // 3. Verify 'read_database' is allowed
    const checkAllowed = await t.mutation(api.example.verifyCapability, {
      capabilityId: capResult.capabilityId,
      toolName: "read_database",
      parameters: {},
    });
    expect(checkAllowed.allowed).toBe(true);

    // 4. Verify 'write_database' is denied
    const checkDenied = await t.mutation(api.example.verifyCapability, {
      capabilityId: capResult.capabilityId,
      toolName: "write_database",
      parameters: {},
    });
    expect(checkDenied.allowed).toBe(false);
  });
});
