import type {
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDataModel,
} from "convex/server";
import { createTool } from "@convex-dev/agent";
import type { ComponentApi } from "../component/_generated/component.js";
import { z } from "zod";

type RunActionCtx = {
  runAction: GenericActionCtx<GenericDataModel>["runAction"];
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};

type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};

type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};

export class GovernanceRuntime {
  constructor(private component: ComponentApi) {}

  // ── Identity Module ──
  async registerAgent(
    ctx: RunActionCtx,
    args: { name: string; metadata?: any }
  ): Promise<{ agentId: string; token: string }> {
    return await ctx.runAction(this.component.identity.registerAgent, args);
  }

  async verifyToken(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<string | null> {
    return await ctx.runMutation(this.component.identity.verifyToken, args);
  }

  async suspendAgent(
    ctx: RunMutationCtx,
    args: { agentId: string }
  ): Promise<null> {
    return await ctx.runMutation(this.component.identity.suspendAgent, args);
  }

  async reactivateAgent(
    ctx: RunMutationCtx,
    args: { agentId: string }
  ): Promise<null> {
    return await ctx.runMutation(this.component.identity.reactivateAgent, args);
  }

  async getAgent(
    ctx: RunQueryCtx,
    args: { agentId: string }
  ) {
    return await ctx.runQuery(this.component.identity.getAgent, args);
  }

  async listAgents(ctx: RunQueryCtx) {
    return await ctx.runQuery(this.component.identity.listAgents, {});
  }

  // ── Capability Management ──
  async issueCapability(
    ctx: RunActionCtx,
    args: {
      agentId: string;
      toolName: string;
      constraints?: any;
      expirationTime: number;
      delegationDepth: number;
      parentCapabilityId?: string;
      purpose: string;
    }
  ): Promise<{ capabilityId: string; token: string }> {
    return await ctx.runAction(this.component.capabilities.issueCapability, args);
  }

  async revokeCapability(
    ctx: RunMutationCtx,
    args: { capabilityId: string }
  ): Promise<null> {
    return await ctx.runMutation(this.component.capabilities.revoke, args);
  }

  async requestDelegation(
    ctx: RunActionCtx,
    args: {
      parentCapabilityId: string;
      forAgentId: string;
      requestedTool: string;
      requestedDepth: number;
      requestedTtlMs: number;
      constraints?: any;
    }
  ): Promise<{ capabilityId: string; token: string }> {
    return await ctx.runAction(this.component.capabilities.requestDelegation, args);
  }

  // ── Policy Management ──
  async createPolicy(
    ctx: RunMutationCtx,
    args: {
      toolPattern: string;
      agentPattern: string;
      effect: string; // "allow" | "deny" | "require_approval"
      priority: number;
    }
  ): Promise<string> {
    return await ctx.runMutation(this.component.policy.createPolicy, args);
  }

  async requiresApproval(
    ctx: RunMutationCtx,
    args: { capabilityId: string; toolName: string; input: any }
  ): Promise<boolean> {
    const res = await ctx.runMutation(this.component.policy.evaluate, args);
    return res.decision === "require_approval";
  }

  // ── Lineage / Observability ──
  async submitApproval(
    ctx: RunMutationCtx,
    args: { spanId: string; approvedBy: string; decision: string; reason?: string }
  ): Promise<null> {
    return await ctx.runMutation(this.component.lineage.recordApproval, args);
  }

  // ── Governed Tool Creation ──
  createGovernedTool<INPUT, OUTPUT>(
    toolName: string,
    config: {
      description: string;
      inputSchema: z.ZodType<INPUT>;
      execute: (ctx: any, input: INPUT) => Promise<OUTPUT>;
    }
  ): any {
    return createTool<INPUT, OUTPUT, any>({
      description: config.description,
      inputSchema: config.inputSchema as any,
      needsApproval: (async (ctx: any, input: any) => {
        const capabilityId = ctx.capabilityId;
        if (!capabilityId) return true;
        return await this.requiresApproval(ctx, {
          capabilityId,
          toolName,
          input,
        });
      }) as any,
      execute: (async (ctx: any, input: INPUT) => {
        const capabilityId = ctx.capabilityId;
        const traceId = ctx.traceId;
        const agentId = ctx.agentId;
        const parentSpanId = ctx.spanId;

        if (!capabilityId) {
          throw new Error("No capability context found for governed tool execution");
        }

        // 1. Verify capability
        const verification = await ctx.runMutation(this.component.capabilities.verify, {
          capabilityId,
          toolName,
          parameters: input,
        });

        if (!verification.allowed) {
          throw new Error(`Execution blocked: ${verification.reason}`);
        }

        // 2. Start lineage span
        const spanId = `span_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await ctx.runMutation(this.component.lineage.startSpan, {
          traceId,
          spanId,
          parentSpanId,
          capabilityId,
          agentId,
          tool: toolName,
          parameters: input,
        });

        try {
          // 3. Execute
          const result = await config.execute({ ...ctx, spanId }, input);

          // 4. Complete span
          await ctx.runMutation(this.component.lineage.completeSpan, {
            spanId,
            outputSummary: typeof result === "string" ? result : JSON.stringify(result),
          });

          return result;
        } catch (error: any) {
          // 4. Fail span
          await ctx.runMutation(this.component.lineage.failSpan, {
            spanId,
            error: error.message || String(error),
          });
          throw error;
        }
      }) as any,
    });
  }

  // ── Governed Agent Run ──
  async runWithCapability(
    ctx: RunActionCtx,
    args: {
      capabilityToken: string;
      agent: any;
      threadId: string;
      prompt: string;
    }
  ): Promise<any> {
    const cap = await ctx.runMutation(this.component.capabilities.activateFromToken, {
      token: args.capabilityToken,
    });
    if (!cap) {
      throw new Error("Invalid or inactive capability token");
    }

    const traceId = cap._id;
    const agentId = cap.agentId;

    await ctx.runMutation(this.component.lineage.openTrace, {
      traceId,
      agentId,
    });

    const governedCtx = {
      ...ctx,
      capabilityId: cap._id,
      traceId,
      agentId,
      spanId: traceId,
    };

    const { thread } = await args.agent.continueThread(governedCtx, {
      threadId: args.threadId,
    });

    return await thread.generateText({
      prompt: args.prompt,
    });
  }
}
