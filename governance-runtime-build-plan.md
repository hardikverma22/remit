# Durable Governance Runtime for Autonomous Agents
## Full Build Plan — Grounded in Actual Convex Primitives

---

## 1. What This Is, Precisely

This is not an API gateway. It is not a proxy. It is not a firewall for agents.

It is a **Capability Runtime** — a system that manages the *authority* under which autonomous agents act, makes that authority *durable* across restarts and long-running workflows, makes it *attenuating* through delegation chains, and makes it *observable* through a live reactive execution lineage.

The product is a **Convex Component** — `@agent-governance/convex` — that wraps and extends `@convex-dev/agent`. Teams that already use the Convex Agent component install this in one line and get governance without rewriting their agents.

### The Three Graphs

Everything the system tracks lives in three interconnected graphs:

```
Identity Graph           Capability Graph          Execution Graph
──────────────           ────────────────          ───────────────
human_user               root_capability           trace
    │                         │                        │
agent_orchestrator       attenuated_capability     span (step 1)
    │                         │                        │
agent_sub_1              further_attenuated        span (step 2)
    │                                                   │
agent_sub_2                                        span (step 3, approval)
```

At incident time, you join all three graphs on `traceId` and get a complete answer to: *who was authorized to do what, by whom, and what actually happened in what order*.

No existing system builds all three coherently in one transactional store. Convex's reactive DB makes this possible without stitching Kafka + Elasticsearch + Temporal together.

---

## 2. The Core Concept: Capability-Based Authority

### Why Not RBAC?

RBAC says: "Agent X has role Y, role Y allows tools A, B, C."

The problem: RBAC requires a central lookup on every call. Roles are global and static. An agent with a role can use it indefinitely, for any task, at any depth of delegation. There is no structural limit on what a sub-agent can delegate to *its* children.

### What Capability-Based Security Says Instead

A capability is an *unforgeable token of authority*. You can only exercise it if you hold it. You can only delegate a *subset* of what you hold. Children can never exceed their parent's authority. Capabilities expire. Their full lineage persists.

```
Human issues capability to Orchestrator:
  allowedTools: ["read_db", "send_email", "create_invoice"]
  maxDelegationDepth: 2
  expiresAt: now + 30min
  constraints: { send_email: { recipientDomain: "@company.com" } }

Orchestrator attenuates and issues to DataAgent:
  allowedTools: ["read_db"]     ← SUBSET ONLY — structural enforcement
  maxDelegationDepth: 1         ← decremented
  expiresAt: now + 15min        ← can only be shorter, never longer

DataAgent cannot grant "send_email" to anyone.
DataAgent cannot grant anything beyond "read_db".
This is mathematically enforced, not policy-checked.
```

This is the model. Convex's transactional mutations are the right primitive to implement it — issuing a capability, recording the delegation, decrementing the depth counter, and scheduling expiry all happen atomically.

---

## 3. How This Sits on Top of Convex's Real Primitives

After reading the actual docs, here is how each Convex primitive maps:

### `@convex-dev/agent` — Tool Approval Hook

The Agent component already has `needsApproval` on tools. This is the exact hook point the governance layer drives:

```typescript
// The Agent component's built-in approval mechanism
const governedTool = createTool({
  description: "Transfer money",
  inputSchema: z.object({ amount: v.number(), toAccount: v.string() }),
  needsApproval: async (ctx, input) => {
    // OUR POLICY ENGINE drives this — not a hardcoded boolean
    return await governance.requiresApproval(ctx, {
      tool: "transfer_money",
      parameters: input,
      capabilityId: ctx.capabilityId,  // injected by our runtime
    });
  },
  execute: async (ctx, input) => {
    // execution lineage recorded here
    await governance.recordToolExecution(ctx, { tool: "transfer_money", input });
    return actualTransfer(input);
  },
});
```

When `needsApproval` returns true, the Agent component pauses generation and persists a `tool-approval-request` in the thread. Our governance layer adds the policy intelligence that drives *when* this happens. The Agent component handles the mechanical suspension and resumption.

### `@convex-dev/workflow` — Durable Capability Sessions

A Convex Workflow is the container for a governed execution session. Each step's arguments and results are persisted. The workflow survives server restarts. This is exactly what "durable authority" means in practice:

```typescript
export const governedSession = workflow.define({
  args: { capabilityToken: v.string(), prompt: v.string() },
  handler: async (step, { capabilityToken, prompt }) => {
    // Step 1: Validate capability — result persisted
    const cap = await step.runMutation(
      internal.capabilities.validateAndActivate, { capabilityToken }
    );

    // Step 2: Create governed thread — result persisted
    const { threadId } = await step.runMutation(
      internal.lineage.openTrace, { capabilityId: cap.id }
    );

    // Step 3: Run agent — retried safely if it fails
    await step.runAction(
      internal.agents.runGovernedAgent,
      { threadId, prompt, capabilityId: cap.id },
      { retry: true }
    );

    // Step 4: Close trace — always runs, even if step 3 failed
    await step.runMutation(
      internal.lineage.closeTrace, { capabilityId: cap.id }
    );
  }
});
```

If the server dies between steps 3 and 4, the workflow resumes from step 4. The lineage is always closed. The capability is always properly retired. This durability is why Convex Workflows are the right primitive — not just for human-in-the-loop, but for the entire governance session lifecycle.

### Convex Mutations — Atomic Authority Transitions

This is the subtle but critical one. A Convex mutation that spans multiple component boundaries is fully transactional. This means:

```typescript
export const issueCapability = mutation({
  handler: async (ctx, args) => {
    // ALL of this is one atomic transaction — no partial states
    const cap = await ctx.runMutation(
      internal.capabilities.create, { ...args }
    );
    await ctx.runMutation(
      internal.identityGraph.recordDelegation, {
        from: args.parentCapabilityId,
        to: cap.id,
        depth: args.remainingDepth,
      }
    );
    await ctx.runMutation(
      internal.lineage.recordIssuance, { capabilityId: cap.id }
    );
    // Schedule expiry — also part of the same transaction
    await ctx.scheduler.runAt(
      args.expiresAt,
      internal.capabilities.expire,
      { capabilityId: cap.id }
    );
    return cap;
  }
});
```

If any of this fails, nothing is written. A capability cannot exist in a state where its issuance is not recorded in the lineage. This guarantee is what makes the audit trail trustworthy.

### Convex Reactive Queries — Live Lineage

Because every query in Convex is reactive, the lineage dashboard is not a polling dashboard — it is a live reactive tree. When an agent writes a new execution event, every subscribed client sees it immediately without any WebSocket plumbing:

```typescript
export const liveTraceTree = query({
  args: { traceId: v.string() },
  handler: async (ctx, { traceId }) => {
    const events = await ctx.db
      .query("executionEvents")
      .withIndex("by_trace", q => q.eq("traceId", traceId))
      .order("asc")
      .collect();
    return buildSpanTree(events); // recursive tree structure
  }
  // This re-runs automatically whenever executionEvents changes.
  // All subscribed dashboard clients get the update.
});
```

### Convex Scheduler — Capability Lifecycle

`ctx.scheduler.runAt()` handles time-boxed authority without cron jobs or external timers:

```typescript
// At capability issuance time, schedule its death
await ctx.scheduler.runAt(
  expiresAt,
  internal.capabilities.expire,
  { capabilityId }
);

// If the human revokes early, cancel the scheduled expiry
await ctx.scheduler.cancel(cap.scheduledJobId);
// Then immediately revoke
await ctx.db.patch(capabilityId, { status: "revoked" });
```

---

## 4. Full Data Model

```typescript
// ── IDENTITY GRAPH ──────────────────────────────────────────────────

// Registered agent identities
agents: defineTable({
  agentId:              v.string(),
  name:                 v.string(),
  description:          v.string(),
  ownerId:              v.string(),       // human who registered it
  teamId:               v.string(),
  status:               v.union(
                          v.literal("active"),
                          v.literal("suspended"),
                          v.literal("deprovisioned")
                        ),
  // The ceiling — capabilities issued to this agent can only
  // be a subset of these tools
  maxAllowedTools:      v.array(v.string()),
  maxDelegationDepth:   v.number(),       // max depth it can participate in
  createdAt:            v.number(),
})
  .index("by_agentId", ["agentId"])
  .index("by_team",    ["teamId", "status"]),

// Agent auth tokens (hashed, never raw)
agentTokens: defineTable({
  agentId:      v.string(),
  tokenHash:    v.string(),       // bcrypt — never store raw
  isRevoked:    v.boolean(),
  expiresAt:    v.number(),
  createdAt:    v.number(),
})
  .index("by_hash",   ["tokenHash"])
  .index("by_agent",  ["agentId", "isRevoked"]),


// ── CAPABILITY GRAPH ─────────────────────────────────────────────────

capabilities: defineTable({
  capabilityId:         v.string(),

  // Identity
  issuedTo:             v.string(),       // agentId receiving this
  issuedBy:             v.string(),       // agentId or userId issuing
  parentCapabilityId:   v.optional(v.string()),  // derived from what

  // Authority (strictly attenuated from parent)
  allowedTools:         v.array(v.string()),
  constraints:          v.any(),          // per-tool parameter constraints
  // { transfer_money: { maxAmount: 10000 }, send_email: { domain: "@co.com" } }

  // Delegation
  maxDelegationDepth:   v.number(),       // original max
  remainingDepth:       v.number(),       // decremented at each delegation

  // Lifecycle
  status:               v.union(
                          v.literal("pending"),     // issued, not yet activated
                          v.literal("active"),      // in use
                          v.literal("expired"),     // time expired
                          v.literal("revoked"),     // manually killed
                          v.literal("consumed"),    // single-use, used
                        ),
  expiresAt:            v.number(),
  activatedAt:          v.optional(v.number()),
  retiredAt:            v.optional(v.number()),
  scheduledJobId:       v.optional(v.id("_scheduled_functions")),

  // Lineage context
  traceId:              v.string(),
  workflowId:           v.optional(v.string()),

  // Metadata
  purpose:              v.string(),       // human-readable reason for issuance
  issuedAt:             v.number(),
})
  .index("by_capabilityId", ["capabilityId"])
  .index("by_agent",        ["issuedTo", "status"])
  .index("by_trace",        ["traceId"])
  .index("by_parent",       ["parentCapabilityId"]),

// Pending delegation requests (sub-agent requesting authority from parent)
delegationRequests: defineTable({
  requestId:            v.string(),
  fromCapabilityId:     v.string(),
  requestingAgentId:    v.string(),
  forAgentId:           v.string(),       // who will receive the capability
  requestedTools:       v.array(v.string()),
  requestedDepth:       v.number(),
  requestedTtlMs:       v.number(),
  status:               v.union(
                          v.literal("pending"),
                          v.literal("auto_approved"),
                          v.literal("human_approved"),
                          v.literal("denied"),
                        ),
  decidedBy:            v.optional(v.string()),
  decidedAt:            v.optional(v.number()),
  resultCapabilityId:   v.optional(v.string()),
  requestedAt:          v.number(),
})
  .index("by_request",        ["requestId"])
  .index("by_from_capability",["fromCapabilityId", "status"]),


// ── EXECUTION LINEAGE ────────────────────────────────────────────────

executionEvents: defineTable({
  // Span identity
  traceId:              v.string(),       // top-level — spans the full chain
  spanId:               v.string(),       // this specific event
  parentSpanId:         v.optional(v.string()),  // who caused this

  // Authority used
  capabilityId:         v.string(),
  agentId:              v.string(),
  delegationDepth:      v.number(),       // which layer of delegation

  // The call
  tool:                 v.string(),
  parameters:           v.any(),          // sanitized — constraints applied
  threadId:             v.optional(v.string()),  // agent thread if applicable
  workflowId:           v.optional(v.string()),

  // The decision
  decision:             v.union(
                          v.literal("allow"),
                          v.literal("deny"),
                          v.literal("pending_approval"),
                          v.literal("denied_constraint"),   // parameter violated constraint
                          v.literal("denied_expired"),      // capability expired
                          v.literal("denied_depth"),        // delegation too deep
                        ),
  decisionReason:       v.string(),
  constraintViolation:  v.optional(v.string()),

  // Approval (if needed — links to @convex-dev/agent approval state)
  approvalId:           v.optional(v.string()),
  approvedBy:           v.optional(v.string()),
  approvalDecidedAt:    v.optional(v.number()),

  // Outcome
  status:               v.union(
                          v.literal("running"),
                          v.literal("completed"),
                          v.literal("failed"),
                          v.literal("denied"),
                          v.literal("timeout"),
                        ),
  outputSummary:        v.optional(v.string()),  // never full output — summary only
  errorMessage:         v.optional(v.string()),

  // Timing
  startedAt:            v.number(),
  completedAt:          v.optional(v.number()),
  latencyMs:            v.optional(v.number()),
})
  .index("by_trace",      ["traceId", "startedAt"])
  .index("by_span",       ["spanId"])
  .index("by_capability", ["capabilityId", "startedAt"])
  .index("by_agent_time", ["agentId", "startedAt"])
  .index("by_decision",   ["decision", "startedAt"])
  .searchIndex("search_events", {
    searchField: "tool",
    filterFields: ["agentId", "decision", "status"],
  }),


// ── POLICY ENGINE ────────────────────────────────────────────────────

policies: defineTable({
  policyId:             v.string(),
  name:                 v.string(),

  // Scope (null = applies to all)
  agentId:              v.optional(v.string()),
  teamId:               v.optional(v.string()),

  // Rule
  priority:             v.number(),           // higher = evaluated first
  conditions: v.object({
    tools:              v.optional(v.array(v.string())),
    parameterChecks:    v.optional(v.any()),  // field-level constraint rules
    timeWindow:         v.optional(v.object({
                          startHour: v.number(),
                          endHour:   v.number(),
                          timezone:  v.string(),
                        })),
    maxDelegationDepth: v.optional(v.number()),
  }),

  // Outcome when conditions match
  effect:               v.union(v.literal("allow"), v.literal("deny")),
  onMatch:              v.union(
                          v.literal("enforce"),
                          v.literal("require_approval"),
                          v.literal("log_only"),
                        ),

  isActive:             v.boolean(),
  changeReason:         v.string(),
  changedBy:            v.string(),
  version:              v.number(),
  createdAt:            v.number(),
})
  .index("by_agent",    ["agentId", "priority"])
  .index("by_team",     ["teamId", "priority"])
  .index("by_active",   ["isActive"]),
```

---

## 5. The `GovernanceRuntime` Class — The Developer-Facing API

This is the class developers import. It wraps `@convex-dev/agent` and adds governance. The design principle: **governance is opt-in per tool, not a forklift replacement**.

```typescript
// @agent-governance/convex — main export

export class GovernanceRuntime {
  constructor(
    private components: { governance: GovernanceComponent },
  ) {}

  // ── TOOL CREATION ──────────────────────────────────────────────────

  // Wraps createTool from @convex-dev/agent with governance
  createGovernedTool<TInput>(
    toolName: string,
    config: {
      description: string;
      inputSchema: z.ZodType<TInput>;
      execute: (ctx: ActionCtx & GovernanceCtx, input: TInput) => Promise<string>;
      // Optional: override the automatic policy-based approval check
      forceApproval?: boolean;
    }
  ) {
    const gov = this;

    return createTool({
      description: config.description,
      inputSchema: config.inputSchema,

      // needsApproval is driven by our policy engine
      needsApproval: async (ctx, input) => {
        if (config.forceApproval) return true;

        const capabilityId = (ctx as GovernanceCtx).capabilityId;
        return gov.requiresApproval(ctx, { toolName, input, capabilityId });
      },

      execute: async (ctx, input) => {
        const capabilityId = (ctx as GovernanceCtx).capabilityId;

        // 1. Verify capability is still active
        const capCheck = await ctx.runMutation(
          internal.governance.capabilities.verify,
          { capabilityId, tool: toolName, parameters: input }
        );
        if (!capCheck.allowed) {
          throw new Error(`Capability denied: ${capCheck.reason}`);
        }

        // 2. Record execution start in lineage
        const spanId = await ctx.runMutation(
          internal.governance.lineage.startSpan,
          { capabilityId, tool: toolName, parameters: sanitize(input) }
        );

        // 3. Execute the actual tool
        let result: string;
        try {
          result = await config.execute(ctx, input);
        } catch (err) {
          await ctx.runMutation(
            internal.governance.lineage.failSpan,
            { spanId, error: String(err) }
          );
          throw err;
        }

        // 4. Record completion
        await ctx.runMutation(
          internal.governance.lineage.completeSpan,
          { spanId, outputSummary: summarize(result) }
        );

        return result;
      },
    });
  }

  // ── CAPABILITY MANAGEMENT ──────────────────────────────────────────

  // Issue a capability — typically called by a human or orchestrator
  async issueCapability(
    ctx: MutationCtx,
    args: {
      to: string;            // agentId
      allowedTools: string[];
      maxDelegationDepth?: number;
      expiresInMs?: number;
      constraints?: Record<string, any>;
      purpose: string;
      parentCapabilityId?: string;  // if delegating from existing capability
    }
  ): Promise<{ capabilityId: string; token: string }> {
    return ctx.runMutation(internal.governance.capabilities.issue, args);
  }

  // Sub-agent requests authority from its parent
  async requestDelegation(
    ctx: ActionCtx,
    args: {
      parentCapabilityId: string;
      forAgentId: string;
      requestedTools: string[];
      requestedDepth: number;
      requestedTtlMs: number;
    }
  ): Promise<{ requestId: string; status: "auto_approved" | "pending" }> {
    return ctx.runMutation(internal.governance.capabilities.requestDelegation, args);
  }

  // ── GOVERNED AGENT RUNNER ──────────────────────────────────────────

  // Run an agent under a specific capability
  async runWithCapability(
    ctx: ActionCtx,
    args: {
      capabilityToken: string;
      agent: Agent;           // from @convex-dev/agent
      threadId: string;
      prompt: string;
    }
  ): Promise<void> {
    // Load + validate capability
    const cap = await ctx.runMutation(
      internal.governance.capabilities.activateFromToken,
      { token: args.capabilityToken }
    );

    // Inject capability context into the agent execution
    // This flows into every tool's needsApproval and execute
    await ctx.runMutation(
      internal.governance.lineage.openTrace,
      { capabilityId: cap.id, agentId: cap.issuedTo }
    );

    await args.agent.generateText(
      { ...ctx, capabilityId: cap.id },  // inject governance ctx
      { threadId: args.threadId },
      { prompt: args.prompt }
    );
  }

  // ── POLICY ─────────────────────────────────────────────────────────

  async requiresApproval(
    ctx: ActionCtx,
    args: { toolName: string; input: any; capabilityId: string }
  ): Promise<boolean> {
    const result = await ctx.runMutation(
      internal.governance.policies.evaluate, args
    );
    return result.decision === "require_approval";
  }
}
```

---

## 6. How Delegation Works End-to-End

This is the most important flow. An orchestrator agent spawning a sub-agent with attenuated authority.

```
Human user
  │
  │  issues capability
  ▼
Orchestrator Agent (cap_A)
  allowedTools: ["read_db", "send_email", "create_invoice", "approve_payment"]
  remainingDepth: 2
  expiresAt: now + 60min
  │
  │  attenuates and requests delegation
  ▼
DataAnalyst Sub-Agent (cap_B, derived from cap_A)
  allowedTools: ["read_db"]           ← STRICT SUBSET
  remainingDepth: 1                   ← DECREMENTED
  expiresAt: now + 20min              ← SHORTER
  constraints: { read_db: { tables: ["invoices", "vendors"] } }
  │
  │  cannot delegate further (remainingDepth: 0 after one more)
  │  cannot touch send_email, create_invoice, approve_payment
  │  cannot query tables outside ["invoices", "vendors"]
  ▼
  [BLOCKED: any attempt to access other tools fails at capability check]
```

### The Delegation Mutation (Atomic)

```typescript
// internal.governance.capabilities.requestDelegation
export const requestDelegation = mutation({
  handler: async (ctx, {
    parentCapabilityId, forAgentId, requestedTools,
    requestedDepth, requestedTtlMs,
  }) => {
    // 1. Load parent capability
    const parent = await getCapability(ctx, parentCapabilityId);

    // 2. Structural enforcement — cannot exceed parent
    if (!isSubset(requestedTools, parent.allowedTools)) {
      throw new Error("Cannot delegate tools not in parent capability");
    }
    if (requestedDepth >= parent.remainingDepth) {
      throw new Error("Cannot delegate depth exceeding remaining depth");
    }
    if (Date.now() + requestedTtlMs > parent.expiresAt) {
      throw new Error("Cannot delegate beyond parent expiry");
    }

    // 3. Check policy — does this delegation need human approval?
    const policyResult = await evaluatePolicy(ctx, {
      tool: "delegate",
      agentId: parent.issuedTo,
      forAgentId,
      requestedTools,
    });

    if (policyResult.decision === "deny") {
      // Record denied delegation in lineage — atomically with the check
      await recordDeniedDelegation(ctx, { parentCapabilityId, reason: policyResult.reason });
      throw new Error(`Delegation denied: ${policyResult.reason}`);
    }

    // 4. Create the new capability — ALL atomic in this mutation
    const newCap = await ctx.db.insert("capabilities", {
      issuedTo: forAgentId,
      issuedBy: parent.issuedTo,
      parentCapabilityId,
      allowedTools: requestedTools,
      remainingDepth: requestedDepth,
      maxDelegationDepth: requestedDepth,
      status: policyResult.decision === "require_approval"
        ? "pending"
        : "active",
      expiresAt: Date.now() + requestedTtlMs,
      traceId: parent.traceId,
    });

    // 5. Schedule expiry
    const jobId = await ctx.scheduler.runAt(
      Date.now() + requestedTtlMs,
      internal.governance.capabilities.expire,
      { capabilityId: newCap }
    );
    await ctx.db.patch(newCap, { scheduledJobId: jobId });

    // 6. Record delegation in lineage — same transaction
    await ctx.db.insert("executionEvents", {
      traceId: parent.traceId,
      spanId: generateId(),
      capabilityId: newCap,
      agentId: forAgentId,
      tool: "capability_delegation",
      decision: policyResult.decision === "require_approval"
        ? "pending_approval"
        : "allow",
      status: "running",
      startedAt: Date.now(),
    });

    // All of the above commits atomically or none of it does.
    return { capabilityId: newCap, status: policyResult.decision };
  }
});
```

---

## 7. Policy Engine — How Decisions Are Made

The policy engine evaluates declarative rules to produce three outcomes: `allow`, `deny`, `require_approval`. It drives the `needsApproval` hook in `@convex-dev/agent`.

```typescript
// The evaluator — called on every tool invocation
export const evaluate = mutation({
  args: {
    capabilityId: v.string(),
    toolName:     v.string(),
    input:        v.any(),
  },
  returns: v.object({
    decision:         v.union(
                        v.literal("allow"),
                        v.literal("deny"),
                        v.literal("require_approval")
                      ),
    matchedPolicyId:  v.optional(v.string()),
    reason:           v.string(),
  }),
  handler: async (ctx, { capabilityId, toolName, input }) => {
    const cap = await getCapability(ctx, capabilityId);

    // Step 1: Capability-level check (structural, not policy)
    if (!cap.allowedTools.includes(toolName)) {
      return { decision: "deny", reason: "Tool not in capability scope" };
    }

    // Step 2: Constraint check (also structural)
    const constraintViolation = checkConstraints(
      cap.constraints[toolName], input
    );
    if (constraintViolation) {
      return { decision: "deny", reason: constraintViolation };
    }

    // Step 3: Policy evaluation (declarative rules, priority-ordered)
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_agent", q =>
        q.eq("agentId", cap.issuedTo).eq("isActive", true)
      )
      .order("desc")  // highest priority first
      .collect();

    for (const policy of policies) {
      if (matchesConditions(policy.conditions, { toolName, input, cap })) {
        if (policy.effect === "deny") {
          return {
            decision: "deny",
            matchedPolicyId: policy.policyId,
            reason: `Denied by policy "${policy.name}"`,
          };
        }
        if (policy.onMatch === "require_approval") {
          return {
            decision: "require_approval",
            matchedPolicyId: policy.policyId,
            reason: `Policy "${policy.name}" requires human approval`,
          };
        }
        // "allow" + "enforce" = allow
        return {
          decision: "allow",
          matchedPolicyId: policy.policyId,
          reason: `Permitted by policy "${policy.name}"`,
        };
      }
    }

    // Default: deny (no explicit allow = blocked)
    return { decision: "deny", reason: "No matching allow policy" };
  }
});
```

---

## 8. Human Approval — Using `@convex-dev/agent` Natively

The Agent component already handles approval state in threads. Our governance layer wraps it with:
1. Routing the approval decision through our policy engine
2. Recording it in the execution lineage
3. Notifying approvers via the governance component

```typescript
// When needsApproval returns true, the Agent component pauses
// and persists a `tool-approval-request` in the thread.
// The UI surfaces Approve/Deny buttons via useUIMessages.
// Our governance layer adds the following:

// Approver submits decision
export const submitApproval = mutation({
  args: {
    threadId:   v.string(),
    approvalId: v.string(),
    approved:   v.boolean(),
    reason:     v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);  // must be authenticated human

    // 1. Record in governance lineage — before the agent resumes
    await ctx.runMutation(internal.governance.lineage.recordApproval, {
      approvalId: args.approvalId,
      approvedBy: userId,
      decision: args.approved ? "approved" : "denied",
      reason: args.reason,
    });

    // 2. Delegate to the Agent component's native approval mechanism
    const { messageId } = args.approved
      ? await approvalAgent.approveToolCall(ctx, {
          threadId: args.threadId,
          approvalId: args.approvalId,
          reason: args.reason,
        })
      : await approvalAgent.denyToolCall(ctx, {
          threadId: args.threadId,
          approvalId: args.approvalId,
          reason: args.reason,
        });

    // 3. Both writes above are in the same transaction.
    //    The lineage is always consistent with the agent state.
    return { messageId };
  },
});
```

---

## 9. Reactive Dashboard Queries

These queries need no WebSocket infrastructure — they are reactive by default. Every subscribed client gets updates the moment execution events are written.

```typescript
// Live execution feed — auto-pushes to dashboard on every new event
export const liveExecutionFeed = query({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    const recentEvents = await ctx.db
      .query("executionEvents")
      .order("desc")
      .take(100);

    // Enrich with capability and agent names
    return Promise.all(recentEvents.map(async (event) => {
      const cap = await ctx.db
        .query("capabilities")
        .withIndex("by_capabilityId", q => q.eq("capabilityId", event.capabilityId))
        .first();
      const agent = await ctx.db
        .query("agents")
        .withIndex("by_agentId", q => q.eq("agentId", event.agentId))
        .first();
      return { ...event, capabilityPurpose: cap?.purpose, agentName: agent?.name };
    }));
  }
});

// Full trace tree — the "incident reconstruction" query
export const getTraceTree = query({
  args: { traceId: v.string() },
  handler: async (ctx, { traceId }) => {
    const events = await ctx.db
      .query("executionEvents")
      .withIndex("by_trace", q => q.eq("traceId", traceId))
      .order("asc")
      .collect();

    const caps = await ctx.db
      .query("capabilities")
      .withIndex("by_trace", q => q.eq("traceId", traceId))
      .collect();

    return {
      // Who issued what authority to whom
      capabilityChain: buildCapabilityTree(caps),
      // What each agent actually did, in order
      executionTimeline: buildSpanTree(events),
    };
  }
});

// Active capabilities — which agents are currently authorized
export const activeCapabilities = query({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    // Get all agents for this team
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_team", q => q.eq("teamId", teamId).eq("status", "active"))
      .collect();

    return Promise.all(agents.map(async (agent) => {
      const activeCaps = await ctx.db
        .query("capabilities")
        .withIndex("by_agent", q =>
          q.eq("issuedTo", agent.agentId).eq("status", "active")
        )
        .collect();

      return {
        ...agent,
        activeCapabilityCount: activeCaps.length,
        activeCaps: activeCaps.map(c => ({
          id: c.capabilityId,
          purpose: c.purpose,
          allowedTools: c.allowedTools,
          expiresAt: c.expiresAt,
          remainingDepth: c.remainingDepth,
        })),
      };
    }));
  }
});

// Pending approvals — for the human approver UI
export const pendingApprovals = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("executionEvents")
      .withIndex("by_decision", q => q.eq("decision", "pending_approval"))
      .filter(q => q.eq(q.field("status"), "running"))
      .order("asc")  // oldest first — don't let things time out
      .take(50);
  }
});
```

---

## 10. Developer Integration — The Full Story

### Installation (for teams already on Convex)

```bash
npm install @agent-governance/convex @convex-dev/agent @convex-dev/workflow
```

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import governance from "@agent-governance/convex/convex.config";

const app = defineApp();
app.use(agent);
app.use(workflow);
app.use(governance);

export default app;
```

```bash
npx convex dev   # generates all types, wires up components
```

### Registering an Agent (Admin API — run once)

```typescript
// In your Convex backend (admin function)
export const setupProcurementAgent = mutation({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    // Register the agent identity
    const { agentId, token } = await gov.registerAgent(ctx, {
      agentId: "agent_procurement_v2",
      name: "Procurement Automation Agent",
      ownerId: userId,
      teamId: "team_finance",
      maxAllowedTools: [
        "read_vendor_db",
        "create_vendor_record",
        "read_invoice",
        "approve_payment",
        "send_email",
      ],
      maxDelegationDepth: 2,
    });

    // IMPORTANT: token is returned ONCE. Store it in your secrets manager.
    // It is hashed in Convex — never recoverable.
    console.log("Store this token:", token);

    // Set policies
    await gov.setPolicy(ctx, {
      name: "High-value payment approval gate",
      agentId: "agent_procurement_v2",
      effect: "allow",
      conditions: {
        tools: ["approve_payment"],
        parameterChecks: { amount: { gt: 50000 } },
      },
      onMatch: "require_approval",
      priority: 100,
      changeReason: "SOX compliance",
    });

    await gov.setPolicy(ctx, {
      name: "No external email",
      agentId: "agent_procurement_v2",
      effect: "deny",
      conditions: {
        tools: ["send_email"],
        parameterChecks: { to: { notDomain: "@company.com" } },
      },
      onMatch: "enforce",
      priority: 200,
      changeReason: "DLP policy",
    });
  }
});
```

### Defining Governed Tools

```typescript
// convex/agents/procurement.ts
import { GovernanceRuntime } from "@agent-governance/convex";
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";

const gov = new GovernanceRuntime(components.governance);

// Define tools — governance wraps each one
const readVendorDb = gov.createGovernedTool("read_vendor_db", {
  description: "Read vendor database records",
  inputSchema: z.object({
    query: z.string(),
    tables: z.array(z.string()),
  }),
  execute: async (ctx, input) => {
    // Your actual database read logic
    return JSON.stringify(await actualVendorDbRead(input));
  },
});

const approvePayment = gov.createGovernedTool("approve_payment", {
  description: "Approve a payment request",
  inputSchema: z.object({
    invoiceId: z.string(),
    amount: z.number(),
  }),
  // No forceApproval — policy engine decides based on amount
  execute: async (ctx, { invoiceId, amount }) => {
    return await actualPaymentApproval(invoiceId, amount);
  },
});

// The agent — exactly like @convex-dev/agent but with governed tools
export const procurementAgent = new Agent(components.agent, {
  name: "Procurement Agent",
  languageModel: anthropic("claude-sonnet-4-5"),
  tools: { readVendorDb, approvePayment },
  instructions: "You are a procurement automation agent...",
  stopWhen: stepCountIs(10),
});
```

### Running the Agent Under a Capability

```typescript
// convex/tasks/processProcurement.ts

// Step 1: Human kicks off a procurement task — issues capability
export const startProcurementTask = mutation({
  args: { taskDescription: v.string() },
  handler: async (ctx, { taskDescription }) => {
    const userId = await getAuthUserId(ctx);

    // Issue a scoped, time-boxed capability for this specific task
    const { capabilityId, token } = await gov.issueCapability(ctx, {
      to: "agent_procurement_v2",
      allowedTools: ["read_vendor_db", "read_invoice"],  // task-specific scope
      maxDelegationDepth: 1,
      expiresInMs: 30 * 60 * 1000,  // 30 minutes
      constraints: {
        read_vendor_db: { tables: ["vendors", "invoices"] }
      },
      purpose: `Process procurement: ${taskDescription}`,
    });

    // Create thread for this session
    const { threadId } = await createThread(ctx, components.agent, {
      userId,
      title: taskDescription,
    });

    // Schedule the governed agent run
    await ctx.scheduler.runAfter(0, internal.tasks.runProcurement, {
      capabilityToken: token,
      threadId,
      prompt: taskDescription,
    });

    return { threadId, capabilityId };
  }
});

// Step 2: Agent runs under the capability
export const runProcurement = internalAction({
  args: {
    capabilityToken: v.string(),
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    // This one call handles:
    // - capability validation
    // - lineage trace opening
    // - governed tool execution
    // - approval gates (via needsApproval → policy engine)
    // - lineage recording at each tool call
    // - trace closure on completion
    await gov.runWithCapability(ctx, {
      capabilityToken: args.capabilityToken,
      agent: procurementAgent,
      threadId: args.threadId,
      prompt: args.prompt,
    });
  }
});
```

### The Approval UI

```tsx
// ui/ProcurementChat.tsx
import { useUIMessages } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";

function ProcurementChat({ threadId }: { threadId: string }) {
  const { results: messages } = useUIMessages(
    api.chat.listMessages, { threadId }, { stream: true }
  );
  const submitApproval = useMutation(api.governance.submitApproval);

  return (
    <div>
      {messages.map(message => (
        <MessageRenderer key={message._id} message={message}
          onApproval={({ approvalId, approved }) =>
            submitApproval({ threadId, approvalId, approved })
          }
        />
      ))}
    </div>
  );
}

// The approval card rendered for tool-approval-request state
function ApprovalCard({ toolCall, onApproval }) {
  // Shows: tool name, parameters, which policy triggered approval,
  // which capability is being used, who issued it, expiry
  return (
    <div className="approval-card">
      <h3>Approval Required: {toolCall.toolName}</h3>
      <p>The agent wants to: {describeToolCall(toolCall)}</p>
      <p>Authority: {toolCall.capabilityPurpose}</p>
      <p>Requested at: {formatTime(toolCall.requestedAt)}</p>
      <button onClick={() => onApproval({ approved: true })}>Approve</button>
      <button onClick={() => onApproval({ approved: false })}>Deny</button>
    </div>
  );
}
```

---

## 11. Package Structure

```
@agent-governance/convex/
├── convex.config.ts            ← Component definition (installs 4 sub-components)
├── src/
│   ├── GovernanceRuntime.ts    ← Main class — what developers import
│   ├── components/
│   │   ├── identity/           ← agents, tokens, registration
│   │   │   ├── schema.ts
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   ├── capabilities/       ← issuance, attenuation, delegation, lifecycle
│   │   │   ├── schema.ts
│   │   │   ├── issue.ts
│   │   │   ├── delegate.ts
│   │   │   ├── verify.ts
│   │   │   └── lifecycle.ts    ← expiry, revocation, scheduler hooks
│   │   ├── lineage/            ← execution events, trace graph
│   │   │   ├── schema.ts
│   │   │   ├── spans.ts        ← open/complete/fail spans
│   │   │   └── queries.ts      ← reactive queries for dashboard
│   │   └── policy/             ← declarative rules, evaluator
│   │       ├── schema.ts
│   │       ├── evaluate.ts
│   │       └── admin.ts        ← create/update/version policies
│   └── http.ts                 ← Optional: HTTP endpoints for non-Convex SDKs
├── react/
│   ├── useTraceTree.ts         ← Reactive trace tree hook
│   ├── useActiveCapabilities.ts
│   ├── usePendingApprovals.ts
│   └── ApprovalCard.tsx        ← Drop-in approval UI component
└── test/
    └── register.ts             ← convex-test registration helper
```

---

## 12. Build Phases

### Phase 1 — Capability Runtime (Weeks 1–5)
*This is the irreducible core. Nothing else ships until this is solid.*

- Identity component: agent registration, token hash/verify, suspension
- Capability component: issuance, attenuation enforcement, structural validation
- Delegation flow: request → structural check → approve/deny → issue child cap (atomic)
- Scheduler integration: capability expiry and revocation
- Basic lineage component: span open/complete/fail, trace graph
- `GovernanceRuntime.issueCapability()` and `runWithCapability()`
- `createGovernedTool()` wrapping `@convex-dev/agent`'s `createTool`

**Exit criteria:** An agent can run under a capability. The capability expires. A sub-agent cannot exceed its parent's scope. Every tool call writes a lineage span.

### Phase 2 — Policy Engine (Weeks 6–8)
*What drives the approval decisions.*

- Policy schema with conditions, priority, versioning
- Policy evaluator (priority-ordered first-match, default-deny)
- Policy evaluator drives `needsApproval` in governed tools
- Human approval flow wired through `@convex-dev/agent`'s `approveToolCall`/`denyToolCall`
- Approval recorded in execution lineage (same transaction)
- Admin functions: create/update/list policies with change history

**Exit criteria:** Policies control which tool calls need approval. High-value operations pause for human sign-off. Every approval is recorded in the lineage tied to the span.

### Phase 3 — Reactive Observability (Weeks 9–11)
*Make the lineage live and queryable.*

- Reactive query: live execution feed (updates all clients on every span write)
- Reactive query: full trace tree (identity graph + capability chain + execution timeline)
- Reactive query: active capabilities per agent
- Reactive query: pending approvals queue
- Minimal React dashboard using these queries
- `ApprovalCard` drop-in component using `useUIMessages` from `@convex-dev/agent/react`

**Exit criteria:** A developer can open a dashboard and watch a live running agent's execution events appear in real time with zero polling infrastructure.

### Phase 4 — Durable Workflow Governance (Weeks 12–14)
*Long-running, multi-step, multi-agent execution.*

- Workflow component integration (`@convex-dev/workflow`)
- `governedSession` workflow template: capability validate → trace open → agent run → trace close
- Multi-agent orchestration pattern: orchestrator requests delegation → waits for approval if needed → sub-agent runs with attenuated cap
- Workflow ID tracked in lineage spans (connects workflow step to execution event)
- Workpool integration for concurrency management

**Exit criteria:** A multi-step agent workflow running over 30+ minutes survives a server restart mid-execution. The lineage trace is complete and accurate regardless of which step completed before the restart.

### Phase 5 — Package and Publish (Weeks 15–17)
*Make it installable.*

- Publish `@agent-governance/convex` to npm as a proper Convex Component
- `convex-test` registration helper (same pattern as `@convex-dev/agent`)
- Documentation: quick start, capability model explainer, policy reference, lineage queries
- Example project: a full procurement agent with governed tools, policies, dashboard, and approval UI
- Log stream integration: `data.function.component_path` filtering for governance-specific logs

---

## 13. What Success Looks Like

A developer with an existing `@convex-dev/agent` project should be able to:

```bash
npm install @agent-governance/convex
```

```typescript
// convex.config.ts — add one line
app.use(governance);

// Wrap their existing tools
const myTool = gov.createGovernedTool("my_tool", { ...existing config });

// Issue a capability when a user starts a task
const cap = await gov.issueCapability(ctx, { to: agentId, allowedTools: [...], purpose: "..." });

// Run with it
await gov.runWithCapability(ctx, { capabilityToken: cap.token, agent, threadId, prompt });
```

And get, for free:
- Every tool call recorded in a lineage that persists forever
- Capability expiry enforced without manual cleanup
- Sub-agents structurally blocked from exceeding parent scope
- Human approval gates driven by declarative policies
- A live reactive dashboard showing execution in real time
- Full trace reconstruction for any incident

That is the product. That is what we build.
