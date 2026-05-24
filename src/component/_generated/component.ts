/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    capabilities: {
      activateFromToken: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null | {
          _id: string;
          agentId: string;
          status: string;
          toolName: string;
        },
        Name
      >;
      issueCapability: FunctionReference<
        "action",
        "internal",
        {
          agentId: string;
          constraints?: any;
          delegationDepth: number;
          expirationTime: number;
          parentCapabilityId?: string;
          purpose: string;
          toolName: string;
        },
        { capabilityId: string; token: string },
        Name
      >;
      requestDelegation: FunctionReference<
        "action",
        "internal",
        {
          constraints?: any;
          forAgentId: string;
          parentCapabilityId: string;
          requestedDepth: number;
          requestedTool: string;
          requestedTtlMs: number;
        },
        { capabilityId: string; token: string },
        Name
      >;
      revoke: FunctionReference<
        "mutation",
        "internal",
        { capabilityId: string },
        null,
        Name
      >;
      verify: FunctionReference<
        "mutation",
        "internal",
        { capabilityId: string; parameters: any; toolName: string },
        { allowed: boolean; reason?: string },
        Name
      >;
    };
    identity: {
      getAgent: FunctionReference<
        "query",
        "internal",
        { agentId: string },
        null | {
          _creationTime: number;
          _id: string;
          metadata?: any;
          name: string;
          status: string;
        },
        Name
      >;
      listAgents: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _creationTime: number;
          _id: string;
          metadata?: any;
          name: string;
          status: string;
        }>,
        Name
      >;
      reactivateAgent: FunctionReference<
        "mutation",
        "internal",
        { agentId: string },
        null,
        Name
      >;
      registerAgent: FunctionReference<
        "action",
        "internal",
        { metadata?: any; name: string },
        { agentId: string; token: string },
        Name
      >;
      suspendAgent: FunctionReference<
        "mutation",
        "internal",
        { agentId: string },
        null,
        Name
      >;
      verifyToken: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null | string,
        Name
      >;
    };
    lineage: {
      completeSpan: FunctionReference<
        "mutation",
        "internal",
        { outputSummary?: string; spanId: string },
        null,
        Name
      >;
      failSpan: FunctionReference<
        "mutation",
        "internal",
        { error: string; spanId: string },
        null,
        Name
      >;
      getTraceTree: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          agentId: string;
          data: any;
          parentSpanId?: string;
          spanId: string;
          timestamp: number;
          traceId: string;
          type: string;
        }>,
        Name
      >;
      liveExecutionFeed: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _creationTime: number;
          _id: string;
          agentId: string;
          data: any;
          parentSpanId?: string;
          spanId: string;
          timestamp: number;
          traceId: string;
          type: string;
        }>,
        Name
      >;
      openTrace: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; traceId: string },
        string,
        Name
      >;
      recordApproval: FunctionReference<
        "mutation",
        "internal",
        {
          approvedBy: string;
          decision: string;
          reason?: string;
          spanId: string;
        },
        null,
        Name
      >;
      startSpan: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          capabilityId: string;
          parameters: any;
          parentSpanId?: string;
          spanId: string;
          tool: string;
          traceId: string;
        },
        string,
        Name
      >;
    };
    policy: {
      createPolicy: FunctionReference<
        "mutation",
        "internal",
        {
          agentPattern: string;
          effect: string;
          priority: number;
          toolPattern: string;
        },
        string,
        Name
      >;
      evaluate: FunctionReference<
        "mutation",
        "internal",
        { capabilityId: string; input: any; toolName: string },
        { decision: string; matchedPolicyId?: string; reason: string },
        Name
      >;
    };
  };
