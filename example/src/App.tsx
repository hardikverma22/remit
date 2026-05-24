import "./App.css";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

type Agent = {
  _id: string;
  name: string;
  status: string;
  metadata?: any;
};

type CapabilityToken = {
  capabilityId: string;
  token: string;
  agentId: string;
  agentName: string;
  toolName: string;
  purpose: string;
  expirationTime: number;
};

function App() {
  const agents = useQuery(api.example.listAgents) as Agent[] | undefined;
  const executionEvents = useQuery(api.example.liveExecutionFeed);

  const registerAgentAction = useAction(api.example.registerAgent);
  const suspendAgentMutation = useMutation(api.example.suspendAgent);
  const reactivateAgentMutation = useMutation(api.example.reactivateAgent);
  
  const issueCapabilityAction = useAction(api.example.issueCapability);
  const simulateExecutionAction = useAction(api.example.simulateToolExecution);

  // Form states
  const [newAgentName, setNewAgentName] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [agentToken, setAgentToken] = useState<{ agentId: string; token: string } | null>(null);

  // Capability form states
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedTool, setSelectedTool] = useState("send_email");
  const [ttlMinutes, setTtlMinutes] = useState(10);
  const delegationDepth = 1;
  const [purpose, setPurpose] = useState("Generate finance summaries");
  const [isIssuingCap, setIsIssuingCap] = useState(false);
  const [issuedCaps, setIssuedCaps] = useState<CapabilityToken[]>([]);

  // Simulation states
  const [selectedCapIndex, setSelectedCapIndex] = useState<number>(-1);
  const [simParams, setSimParams] = useState('{"amount": 4200, "recipient": "finance@company.com"}');
  const [simSuccess, setSimSuccess] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);

  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;
    setIsRegistering(true);
    try {
      const res = await registerAgentAction({ name: newAgentName });
      setAgentToken(res);
      setNewAgentName("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleIssueCapability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId) return;
    setIsIssuingCap(true);
    try {
      const expirationTime = Date.now() + ttlMinutes * 60 * 1000;
      const res = await issueCapabilityAction({
        agentId: selectedAgentId,
        toolName: selectedTool,
        expirationTime,
        delegationDepth,
        purpose,
      });

      const selectedAgent = agents?.find((a) => a._id === selectedAgentId);
      const newCap: CapabilityToken = {
        capabilityId: res.capabilityId,
        token: res.token,
        agentId: selectedAgentId,
        agentName: selectedAgent?.name || "Unknown Agent",
        toolName: selectedTool,
        purpose,
        expirationTime,
      };

      setIssuedCaps([newCap, ...issuedCaps]);
      setSelectedCapIndex(0);
    } catch (err) {
      console.error(err);
    } finally {
      setIsIssuingCap(false);
    }
  };

  const handleSimulateExecution = async () => {
    if (selectedCapIndex === -1 || !issuedCaps[selectedCapIndex]) return;
    const cap = issuedCaps[selectedCapIndex];
    setIsSimulating(true);
    setSimulationResult(null);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(simParams);
      } catch {
        // Fallback to plain string if invalid JSON
        parsedParams = { rawInput: simParams };
      }

      const traceId = cap.capabilityId; // capId represents trace ID for demo

      const spanId = await simulateExecutionAction({
        capabilityId: cap.capabilityId,
        agentId: cap.agentId,
        toolName: cap.toolName,
        parameters: parsedParams,
        traceId,
        success: simSuccess,
      });

      setSimulationResult(`Simulation finished! Trace ID: ${traceId}, Span ID: ${spanId}`);
    } catch (err: any) {
      setSimulationResult(`Simulation failed: ${err.message || err}`);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="governance-dashboard" style={{
      maxWidth: "1400px",
      margin: "0 auto",
      padding: "2rem",
      color: "#F3F4F6",
      backgroundColor: "#0B0F19",
      minHeight: "100vh",
      fontFamily: "'Outfit', 'Inter', system-ui, sans-serif"
    }}>
      {/* Header */}
      <header style={{
        marginBottom: "3rem",
        textAlign: "center",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        paddingBottom: "1.5rem"
      }}>
        <h1 style={{
          fontSize: "2.8rem",
          fontWeight: 800,
          background: "linear-gradient(135deg, #6366F1 0%, #A855F7 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          margin: "0 0 0.5rem 0",
          letterSpacing: "-0.025em"
        }}>🛡️ Durable Governance Runtime</h1>
        <p style={{
          fontSize: "1.1rem",
          color: "#9CA3AF",
          margin: 0
        }}>Capability-based authority and live lineage monitoring for autonomous agents</p>
      </header>

      {/* Main Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
        gap: "2rem",
        marginBottom: "3rem"
      }}>
        {/* Column 1: Identity & Agents */}
        <section style={{
          background: "#161F30",
          borderRadius: "16px",
          padding: "1.5rem",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
        }}>
          <h2 style={{ fontSize: "1.4rem", marginTop: 0, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            👤 Agent Identity Manager
          </h2>

          <form onSubmit={handleRegisterAgent} style={{ marginBottom: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#9CA3AF" }}>Register New Agent Name</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="e.g. FinanceAgent"
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  backgroundColor: "#0F172A",
                  color: "#FFF",
                  outline: "none"
                }}
              />
              <button
                type="submit"
                disabled={isRegistering}
                style={{
                  padding: "0.75rem 1.25rem",
                  borderRadius: "8px",
                  backgroundColor: "#6366F1",
                  color: "#FFF",
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {isRegistering ? "Registering..." : "Register"}
              </button>
            </div>
          </form>

          {agentToken && (
            <div style={{
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              padding: "1rem",
              borderRadius: "8px",
              marginBottom: "2rem"
            }}>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "#10B981" }}>✓ Agent Registered Successfully!</h4>
              <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8rem", color: "#A7F3D0" }}>
                <strong>Save this token.</strong> It is hashed on the server and cannot be retrieved again:
              </p>
              <code style={{
                display: "block",
                padding: "0.5rem",
                backgroundColor: "#0F172A",
                borderRadius: "4px",
                fontSize: "0.85rem",
                wordBreak: "break-all"
              }}>{agentToken.token}</code>
            </div>
          )}

          <h3 style={{ fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "0.5rem" }}>Registered Agents</h3>
          {agents && agents.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {agents.map((agent) => (
                <li key={agent._id} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.75rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.03)"
                }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{agent.name}</span>
                    <span style={{
                      marginLeft: "0.75rem",
                      fontSize: "0.7rem",
                      padding: "0.15rem 0.4rem",
                      borderRadius: "12px",
                      backgroundColor: agent.status === "active" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      color: agent.status === "active" ? "#10B981" : "#EF4444"
                    }}>
                      ● {agent.status}
                    </span>
                    <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: "0.15rem" }}>ID: {agent._id}</div>
                  </div>
                  <div>
                    {agent.status === "active" ? (
                      <button
                        onClick={() => suspendAgentMutation({ agentId: agent._id })}
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.3rem 0.6rem",
                          borderRadius: "4px",
                          backgroundColor: "rgba(239, 68, 68, 0.1)",
                          color: "#EF4444",
                          border: "1px solid rgba(239, 68, 68, 0.2)"
                        }}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => reactivateAgentMutation({ agentId: agent._id })}
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.3rem 0.6rem",
                          borderRadius: "4px",
                          backgroundColor: "rgba(16, 185, 129, 0.1)",
                          color: "#10B981",
                          border: "1px solid rgba(16, 185, 129, 0.2)"
                        }}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "#6B7280", fontStyle: "italic", fontSize: "0.9rem" }}>No agents registered yet.</p>
          )}
        </section>

        {/* Column 2: Capability Studio */}
        <section style={{
          background: "#161F30",
          borderRadius: "16px",
          padding: "1.5rem",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
        }}>
          <h2 style={{ fontSize: "1.4rem", marginTop: 0, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            🔑 Capability Studio
          </h2>

          <form onSubmit={handleIssueCapability} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "#9CA3AF" }}>Select Target Agent</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  backgroundColor: "#0F172A",
                  color: "#FFF",
                  outline: "none"
                }}
              >
                <option value="">-- Choose Agent --</option>
                {agents?.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "#9CA3AF" }}>Allowed Tool</label>
                <select
                  value={selectedTool}
                  onChange={(e) => setSelectedTool(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    backgroundColor: "#0F172A",
                    color: "#FFF",
                    outline: "none"
                  }}
                >
                  <option value="send_email">send_email</option>
                  <option value="approve_payment">approve_payment</option>
                  <option value="read_vendor_db">read_vendor_db</option>
                  <option value="*">All (*)</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "#9CA3AF" }}>TTL (Minutes)</label>
                <input
                  type="number"
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(parseInt(e.target.value))}
                  min={1}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.75rem",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    backgroundColor: "#0F172A",
                    color: "#FFF",
                    outline: "none"
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "#9CA3AF" }}>Purpose / Scope Context</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Generate reports"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  backgroundColor: "#0F172A",
                  color: "#FFF",
                  outline: "none"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isIssuingCap || !selectedAgentId}
              style={{
                width: "100%",
                padding: "0.8rem",
                borderRadius: "8px",
                backgroundColor: "#A855F7",
                color: "#FFF",
                border: "none",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {isIssuingCap ? "Issuing Capability..." : "Issue Scoped Capability"}
            </button>
          </form>

          <h3 style={{ fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "0.5rem" }}>Active Capability Tokens</h3>
          {issuedCaps.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: "250px", overflowY: "auto" }}>
              {issuedCaps.map((cap, i) => (
                <li key={cap.capabilityId} onClick={() => setSelectedCapIndex(i)} style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  backgroundColor: selectedCapIndex === i ? "rgba(168, 85, 247, 0.15)" : "transparent",
                  border: selectedCapIndex === i ? "1px solid #A855F7" : "1px solid transparent",
                  cursor: "pointer",
                  marginBottom: "0.5rem",
                  transition: "all 0.2s"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600 }}>{cap.agentName}</span>
                    <span style={{ fontSize: "0.8rem", color: "#A855F7" }}>{cap.toolName}</span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: "0.25rem" }}>Purpose: {cap.purpose}</div>
                  <div style={{ fontSize: "0.7rem", color: "#6B7280", wordBreak: "break-all", marginTop: "0.25rem" }}>Token: {cap.token.substring(0, 15)}...</div>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "#6B7280", fontStyle: "italic", fontSize: "0.9rem" }}>No active capabilities issued yet.</p>
          )}
        </section>

        {/* Column 3: Simulator */}
        <section style={{
          background: "#161F30",
          borderRadius: "16px",
          padding: "1.5rem",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
        }}>
          <h2 style={{ fontSize: "1.4rem", marginTop: 0, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            🤖 Lineage Simulator
          </h2>

          {selectedCapIndex !== -1 && issuedCaps[selectedCapIndex] ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ backgroundColor: "#0F172A", padding: "1rem", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "#9CA3AF" }}>Selected Context:</span>
                <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#A855F7" }}>
                  {issuedCaps[selectedCapIndex].agentName} → {issuedCaps[selectedCapIndex].toolName}
                </div>
                <div style={{ fontSize: "0.8rem", color: "#9CA3AF" }}>Purpose: {issuedCaps[selectedCapIndex].purpose}</div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "#9CA3AF" }}>Simulation Parameters (JSON)</label>
                <textarea
                  value={simParams}
                  onChange={(e) => setSimParams(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.5rem",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    backgroundColor: "#0F172A",
                    color: "#FFF",
                    fontFamily: "monospace",
                    outline: "none"
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  id="simSuccess"
                  checked={simSuccess}
                  onChange={(e) => setSimSuccess(e.target.checked)}
                />
                <label htmlFor="simSuccess" style={{ fontSize: "0.9rem", userSelect: "none" }}>Simulate Successful Execution</label>
              </div>

              <button
                onClick={handleSimulateExecution}
                disabled={isSimulating}
                style={{
                  width: "100%",
                  padding: "0.8rem",
                  borderRadius: "8px",
                  backgroundColor: "#EC4899",
                  color: "#FFF",
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {isSimulating ? "Executing..." : "Run Governed Tool Call"}
              </button>

              {simulationResult && (
                <div style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  fontSize: "0.85rem",
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  {simulationResult}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              textAlign: "center",
              padding: "3rem 1rem",
              color: "#6B7280",
              border: "2px dashed rgba(255,255,255,0.05)",
              borderRadius: "12px"
            }}>
              💡 Please select an **Active Capability Token** in the middle column to trigger the simulator.
            </div>
          )}
        </section>
      </div>

      {/* Row 4: Lineage Audit Trail */}
      <section style={{
        background: "#161F30",
        borderRadius: "16px",
        padding: "1.5rem",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
      }}>
        <h2 style={{ fontSize: "1.4rem", marginTop: 0, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          📜 Live Lineage Audit Feed
        </h2>
        <p style={{ color: "#9CA3AF", fontSize: "0.9rem", marginTop: 0, marginBottom: "1.5rem" }}>
          Reactive telemetry trail showing unforgeable execution events joined on Trace IDs.
        </p>

        {executionEvents && executionEvents.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: "0.9rem"
            }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(255, 255, 255, 0.08)", color: "#9CA3AF" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Timestamp</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Event Type</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Agent ID</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Trace ID</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Span Details</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {executionEvents.map((event) => {
                  let statusBadge = null;
                  let details = "";

                  if (event.type === "trace_open") {
                    statusBadge = <span style={{ color: "#3B82F6", backgroundColor: "rgba(59, 130, 246, 0.15)", padding: "0.2rem 0.5rem", borderRadius: "12px", fontSize: "0.75rem" }}>Trace Opened</span>;
                    details = "Root execution trace initiated.";
                  } else if (event.type === "span_start") {
                    statusBadge = <span style={{ color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.15)", padding: "0.2rem 0.5rem", borderRadius: "12px", fontSize: "0.75rem" }}>Running</span>;
                    details = `Call: ${event.data.tool} | Parameters: ${JSON.stringify(event.data.parameters)}`;
                  } else if (event.type === "span_complete") {
                    statusBadge = <span style={{ color: "#10B981", backgroundColor: "rgba(16, 185, 129, 0.15)", padding: "0.2rem 0.5rem", borderRadius: "12px", fontSize: "0.75rem" }}>Completed</span>;
                    details = `Result: ${event.data.outputSummary} | Latency: ${event.data.latencyMs}ms`;
                  } else if (event.type === "span_fail") {
                    statusBadge = <span style={{ color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.15)", padding: "0.2rem 0.5rem", borderRadius: "12px", fontSize: "0.75rem" }}>Failed</span>;
                    details = `Error: ${event.data.errorMessage} | Latency: ${event.data.latencyMs}ms`;
                  }

                  return (
                    <tr key={event._id} style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      backgroundColor: event.type === "span_fail" ? "rgba(239, 68, 68, 0.02)" : "transparent"
                    }}>
                      <td style={{ padding: "0.75rem 1rem", color: "#9CA3AF", whiteSpace: "nowrap" }}>
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>
                        {event.type}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "#9CA3AF" }}>
                        {event.agentId.substring(0, 10)}...
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "#9CA3AF", fontFamily: "monospace" }}>
                        {event.traceId.substring(0, 12)}...
                      </td>
                      <td style={{ padding: "0.75rem 1rem", maxWidth: "400px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {details}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {statusBadge}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "#6B7280", fontStyle: "italic", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>
            No audit events written yet. Register an agent, issue a capability, and trigger a simulation above!
          </p>
        )}
      </section>
    </div>
  );
}

export default App;
