import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileSearch,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
const API = import.meta.env.VITE_API_URL || "/api";
type User = { username: string; role: string };
type Ticket = {
  id: string;
  subject: string;
  body: string;
  customer_id: string | null;
  received_at: string;
};
type Proposal = {
  id: string;
  ticket_id: string;
  order_id: string;
  amount_minor: number;
  status: string;
  explanation: string;
  external_ref?: string;
  external_operation_status?: string;
  created_by?: string;
};
type Investigation = {
  intent: string;
  outcome: string;
  explanation: string;
  evidence: any[];
  proposal?: Proposal;
  stages: any[];
  mode: string;
};
type Order = {
  id: string;
  number: string;
  customer_id: string;
  currency: string;
  total_minor: number;
  refunded_minor: number;
  pending_minor: number;
  delivered_at: string;
  version: number;
};
type Scenario = { id: string; name: string; ticket_id: string };
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("ca-token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [tab, setTab] = useState("inbox");
  const [inv, setInv] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [audit, setAudit] = useState<any[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [login, setLogin] = useState("agent");
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("");
  const [search, setSearch] = useState("");
  const [evalReport, setEvalReport] = useState<any>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [aiMode, setAiMode] = useState("FIXTURE");
  async function req(path: string, init: RequestInit = {}) {
    const r = await fetch(API + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.detail || "Request failed");
    return d;
  }
  async function signIn() {
    try {
      const d = await req("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: login, password: "demo" }),
      });
      localStorage.setItem("ca-token", d.access_token);
      setToken(d.access_token);
      setUser(d.user);
      setNotice("Demo session ready");
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function signOut() {
    try {
      await req("/auth/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem("ca-token");
    setToken("");
    setUser(null);
  }
  async function refresh() {
    try {
      const [t, p, a, u, o, pol, sc, h] = await Promise.all([
        req("/tickets"),
        req("/proposals"),
        req("/audit/events"),
        req("/auth/me"),
        req("/orders"),
        req("/policies"),
        req("/demo/scenarios"),
        req("/health"),
      ]);
      setTickets(t);
      setProposals(p);
      setAudit(a);
      setUser(u);
      setOrders(o);
      setPolicy(pol.active);
      setScenarios(sc);
      setAiMode(h.mode);
      if (!selected && t.length) setSelected(t[0]);
      if (o.length && !orderDetail) {
        setOrderDetail(await req(`/orders/${o[0].id}`));
      }
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  useEffect(() => {
    if (token) refresh();
  }, [token]);
  async function investigate(t = selected) {
    if (!t) return;
    setBusy(true);
    setInv(null);
    try {
      const d = await req(`/tickets/${t.id}/analyze`, { method: "POST" });
      setInv(d);
      await refresh();
      setTab("inbox");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(p: Proposal) {
    setBusy(true);
    try {
      await req(`/proposals/${p.id}/approve`, { method: "POST" });
      const op = await req(`/proposals/${p.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          amount_minor: p.amount_minor,
          idempotency_key: `refund-${p.id}`,
        }),
      });
      setNotice(`Refund accepted · ${op.status.toLowerCase()}`);
      setInv((v) =>
        v
          ? {
              ...v,
              proposal: {
                ...v.proposal!,
                status: "EXECUTED",
                external_ref: op.id,
              },
            }
          : v,
      );
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function rejectProposal(p: Proposal) {
    try {
      await req(`/proposals/${p.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ note: "Reviewer declined proposal" }),
      });
      setNotice("Proposal rejected");
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function cancelProposal(p: Proposal) {
    try {
      await req(`/proposals/${p.id}/cancel`, { method: "POST" });
      setNotice("Proposal cancelled");
      setInv((v) =>
        v ? { ...v, proposal: { ...v.proposal!, status: "CANCELLED" } } : v,
      );
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function settle(op: string) {
    try {
      await req(`/executions/${op}/settle`, { method: "POST" });
      setNotice("Simulated transaction settled");
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function runEval() {
    setEvalBusy(true);
    try {
      const report = await req("/evaluations/runs", { method: "POST" });
      setEvalReport(report);
      setNotice(
        `Evaluation complete · ${report.passed}/${report.total} passed`,
      );
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setEvalBusy(false);
    }
  }
  async function openOrder(id: string) {
    try {
      setOrderDetail(await req(`/orders/${id}`));
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  if (!token)
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand-mark">
            <Command size={20} />
          </div>
          <div className="eyebrow">
            ECOMMERCE SUPPORT AUTOMATION <span>DEMO ENVIRONMENT</span>
          </div>
          <h1>
            Good operations
            <br />
            start with <em>evidence.</em>
          </h1>
          <p>
            Investigate support requests, apply policy, and prepare safe
            commerce actions.
          </p>
          <label>Enter as</label>
          <select value={login} onChange={(e) => setLogin(e.target.value)}>
            <option value="agent">Support agent</option>
            <option value="reviewer">Authorized reviewer</option>
            <option value="admin">Administrator</option>
          </select>
          <button className="primary wide" onClick={signIn}>
            Enter demo workspace <ArrowUpRight size={16} />
          </button>
          <small>
            Demo password is prefilled. All financial activity is simulated.
          </small>
          {notice && <div className="notice">{notice}</div>}
        </div>
      </main>
    );
  const current =
    (selected && tickets.find((t) => t.id === selected.id)) || selected;
  const pending = proposals.filter((p) => p.status === "PENDING");
  const accepted = proposals.filter(
    (p) => p.status === "EXECUTED" && p.external_operation_status === "PENDING",
  );
  const visibleTickets = tickets.filter((t) =>
    `${t.id} ${t.subject} ${t.body} ${t.customer_id || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Command size={17} />
          </div>
          <div>
            <b>
              commerce<span>action</span>
            </b>
            <small>OPERATIONS WORKBENCH</small>
          </div>
        </div>
        <div className="workspace">
          <div className="store-dot" /> NORTHSTAR GOODS{" "}
          <ChevronDown size={13} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <button
          className={tab === "overview" ? "nav active" : "nav"}
          onClick={() => setTab("overview")}
        >
          <LayoutDashboard />
          Overview
        </button>
        <button
          className={tab === "inbox" ? "nav active" : "nav"}
          onClick={() => setTab("inbox")}
        >
          <Inbox />
          Ticket inbox <span className="count">{tickets.length}</span>
        </button>
        <button
          className={tab === "approvals" ? "nav active" : "nav"}
          onClick={() => setTab("approvals")}
        >
          <ShieldCheck />
          Approval queue <span className="count amber">{pending.length}</span>
        </button>
        <button
          className={tab === "orders" ? "nav active" : "nav"}
          onClick={() => setTab("orders")}
        >
          <Boxes />
          Orders
        </button>
        <button
          className={tab === "policy" ? "nav active" : "nav"}
          onClick={() => setTab("policy")}
        >
          <Scale />
          Policy explorer
        </button>
        <button
          className={tab === "evaluations" ? "nav active" : "nav"}
          onClick={() => setTab("evaluations")}
        >
          <FlaskConical />
          Evaluation lab
        </button>
        <button
          className={tab === "audit" ? "nav active" : "nav"}
          onClick={() => setTab("audit")}
        >
          <Activity />
          Audit trail
        </button>
        <div className="sidebar-bottom">
          <div className="mode-card">
            <div>
              <span className="pulse" /> DEMO MODE
            </div>
            <p>Commerce operations are simulated. No real payments are made.</p>
          </div>
          <div className="profile">
            <div className="avatar">
              {user?.username.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <b>{user?.username}</b>
              <small>{user?.role} · local session</small>
            </div>
            <button className="icon-btn" onClick={signOut} title="Sign out">
              <ArrowDownLeft size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header>
          <div className="crumb">
            Workspace <span>/</span>{" "}
            {tab === "inbox"
              ? "Ticket inbox"
              : tab === "approvals"
                ? "Approval queue"
                : tab === "audit"
                  ? "Audit trail"
                  : "Overview"}
          </div>
          <div className="header-right">
            <div className="live">
              <i /> Systems operational
            </div>
            <button className="icon-btn" onClick={refresh} title="Refresh">
              <RefreshCw size={16} />
            </button>
            <div className="avatar mini">{user?.username[0].toUpperCase()}</div>
          </div>
        </header>
        {notice && (
          <button className="toast" onClick={() => setNotice("")}>
            {notice} <span>×</span>
          </button>
        )}
        {tab === "inbox" && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">
                  CUSTOMER OPERATIONS <span>•</span>{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                    .format(new Date())
                    .toUpperCase()}
                </div>
                <h1>Ticket inbox</h1>
                <p>
                  Investigate requests with policy and order evidence before any
                  action.
                </p>
              </div>
              <div className="head-actions">
                <select
                  aria-label="Demo scenario"
                  value={scenarioId}
                  onChange={(e) => {
                    const chosen = scenarios.find(
                      (x) => x.id === e.target.value,
                    );
                    setScenarioId(e.target.value);
                    const ticket =
                      chosen && tickets.find((x) => x.id === chosen.ticket_id);
                    if (ticket) {
                      setSelected(ticket);
                      setInv(null);
                    }
                  }}
                >
                  <option value="">Choose demo scenario</option>
                  {scenarios.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={refresh}>
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
            </div>
            <div className="stats">
              <div>
                <span>OPEN TICKETS</span>
                <b>{tickets.length.toString().padStart(2, "0")}</b>
                <small>Across all channels</small>
              </div>
              <div>
                <span>AWAITING REVIEW</span>
                <b>{pending.length.toString().padStart(2, "0")}</b>
                <small>Human decision required</small>
              </div>
              <div>
                <span>POLICY VERSION</span>
                <b>
                  01 <small className="live-label">ACTIVE</small>
                </b>
                <small>Returns · last updated today</small>
              </div>
              <div>
                <span>AI PROVIDER</span>
                <b>
                  {aiMode.replaceAll("_", " ").replaceAll("-", " ")}{" "}
                  <span className="green-dot" />
                </b>
                <small>
                  {aiMode === "FIXTURE"
                    ? "Deterministic · no network"
                    : "Optional model provider"}
                </small>
              </div>
            </div>
            <div className="workspace-grid">
              <section className="panel ticket-panel">
                <div className="panel-head">
                  <div>
                    <h2>
                      Recent requests{" "}
                      <span className="subtle-count">
                        {visibleTickets.length}
                      </span>
                    </h2>
                    <p>Sorted by latest received</p>
                  </div>
                  <label className="filter">
                    <Search size={14} />
                    <input
                      aria-label="Search tickets"
                      placeholder="Search tickets"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="ticket-list">
                  {visibleTickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelected(t);
                        setInv(null);
                      }}
                      className={`ticket-row ${current?.id === t.id ? "selected" : ""}`}
                    >
                      <div className="ticket-icon">
                        <Inbox size={16} />
                      </div>
                      <div className="ticket-copy">
                        <div className="ticket-title">{t.subject}</div>
                        <div className="ticket-preview">{t.body}</div>
                        <div className="ticket-meta">
                          <span>{t.customer_id || "Unverified sender"}</span>
                          <span>•</span>
                          <span>{t.id}</span>
                        </div>
                      </div>
                      <div className="ticket-status">
                        <span
                          className={
                            t.id === "tic_1048"
                              ? "pill blue"
                              : t.id === "tic_3001"
                                ? "pill red"
                                : "pill gray"
                          }
                        >
                          {t.id === "tic_1048"
                            ? "REFUND"
                            : t.id === "tic_3001"
                              ? "REVIEW"
                              : "RETURN"}
                        </span>
                        <small>
                          {new Date(t.received_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel detail-panel">
                {current ? (
                  <>
                    <div className="panel-head">
                      <div>
                        <div className="eyebrow">
                          TICKET <span>{current.id}</span>
                        </div>
                        <h2>{current.subject}</h2>
                      </div>
                      <span className="pill green">OPEN</span>
                    </div>
                    <div className="message">
                      <div className="avatar customer">
                        {current.customer_id ? "MC" : "?"}
                      </div>
                      <div>
                        <div className="sender">
                          {current.customer_id === "cus_100"
                            ? "Maya Chen"
                            : current.customer_id === "cus_200"
                              ? "Omar Ali"
                              : current.customer_id === "cus_300"
                                ? "Alex Rivera"
                                : "Unknown customer"}{" "}
                          <small>· customer</small>
                        </div>
                        <p>{current.body}</p>
                      </div>
                    </div>
                    <div className="detail-actions">
                      <div>
                        <div className="eyebrow">INVESTIGATION</div>
                        <p>
                          {inv
                            ? "Investigation complete. Review each finding below."
                            : "Run a structured investigation against trusted order and policy data."}
                        </p>
                      </div>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => investigate()}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Sparkles size={15} />
                        )}{" "}
                        {busy
                          ? "Investigating…"
                          : inv
                            ? "Run again"
                            : "Start investigation"}
                      </button>
                    </div>
                    {inv && (
                      <>
                        <div className="result-banner">
                          <div
                            className={
                              inv.outcome === "ELIGIBLE"
                                ? "result-icon good"
                                : "result-icon warn"
                            }
                          >
                            {inv.outcome === "ELIGIBLE" ? (
                              <Check size={18} />
                            ) : (
                              <TriangleAlert size={18} />
                            )}
                          </div>
                          <div>
                            <div className="eyebrow">POLICY OUTCOME</div>
                            <b>{inv.outcome.replaceAll("_", " ")}</b>
                            <p>
                              {inv.intent.replaceAll("_", " ")} · {inv.mode}{" "}
                              classification
                            </p>
                          </div>
                        </div>
                        <div className="explanation">
                          <div className="section-title">
                            <FileSearch size={15} /> Evidence-backed explanation
                          </div>
                          <p>{inv.explanation}</p>
                        </div>
                        <div className="evidence">
                          <div className="section-title">
                            Evidence <span>{inv.evidence.length} records</span>
                          </div>
                          {inv.evidence.map((e: any, i: number) => (
                            <div className="evidence-row" key={i}>
                              <div className="evidence-check">
                                <Check size={11} />
                              </div>
                              <div>
                                <b>{e.type.replaceAll("_", " ")}</b>
                                <small>{String(e.value)}</small>
                              </div>
                              <span>VERIFIED</span>
                            </div>
                          ))}
                        </div>
                        {inv.proposal && (
                          <div className="proposal">
                            <div className="proposal-top">
                              <div>
                                <div className="eyebrow">PROPOSED ACTION</div>
                                <b>Partial refund</b>
                                <small>Human approval required</small>
                              </div>
                              <strong>
                                ${(inv.proposal.amount_minor / 100).toFixed(2)}{" "}
                                <small>USD</small>
                              </strong>
                            </div>
                            <p>{inv.proposal.explanation}</p>
                            {inv.proposal.status === "PENDING" &&
                              user?.role !== "AGENT" && (
                                <button
                                  className="primary wide"
                                  disabled={busy}
                                  onClick={() => approve(inv.proposal!)}
                                >
                                  <ShieldCheck size={15} /> Approve &amp;
                                  execute simulated refund
                                </button>
                              )}
                            {inv.proposal.status === "PENDING" &&
                              user?.role === "AGENT" && (
                                <div className="approval-hint">
                                  <LockKeyhole size={15} /> Switch to reviewer
                                  to authorize this operation.{" "}
                                  <button
                                    onClick={() =>
                                      cancelProposal(inv.proposal!)
                                    }
                                  >
                                    Cancel proposal
                                  </button>
                                </div>
                              )}
                            {inv.proposal.status === "EXECUTED" && (
                              <div className="approval-hint">
                                <Clock3 size={15} /> Refund accepted;
                                transaction is pending settlement.{" "}
                                <button
                                  onClick={() =>
                                    settle(inv.proposal!.external_ref!)
                                  }
                                >
                                  Settle demo transaction
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    <PackageCheck size={28} />
                    <b>Select a request</b>
                    <p>
                      Choose a ticket to inspect its message and investigation.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "approvals" && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">CONTROLLED OPERATIONS</div>
                <h1>Approval queue</h1>
                <p>
                  Review structured proposals before they reach the commerce
                  simulator.
                </p>
              </div>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Pending proposals</h2>
                  <p>Approval rechecks order version and available balance.</p>
                </div>
              </div>
              {pending.length ? (
                pending.map((p) => (
                  <div className="approval-row" key={p.id}>
                    <div className="ticket-icon">
                      <ShieldCheck size={17} />
                    </div>
                    <div>
                      <b>Partial refund · {p.ticket_id}</b>
                      <p>{p.explanation}</p>
                      <small>
                        {p.id} · order {p.order_id}
                      </small>
                    </div>
                    <strong>${(p.amount_minor / 100).toFixed(2)}</strong>
                    <div className="review-actions">
                      <button
                        className="secondary"
                        disabled={busy || user?.role === "AGENT"}
                        onClick={() => rejectProposal(p)}
                      >
                        Reject
                      </button>
                      <button
                        className="primary"
                        disabled={busy || user?.role === "AGENT"}
                        onClick={() => approve(p)}
                      >
                        {user?.role === "AGENT"
                          ? "Reviewer required"
                          : "Approve & execute"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Check size={26} />
                  <b>Queue is clear</b>
                  <p>
                    New eligible requests will appear here after investigation.
                  </p>
                </div>
              )}
              {accepted.length > 0 && (
                <>
                  <div className="panel-head">
                    <div>
                      <h2>Accepted refunds</h2>
                      <p>
                        Pending transactions require explicit settlement
                        confirmation.
                      </p>
                    </div>
                  </div>
                  {accepted.map((p) => (
                    <div className="approval-row" key={p.id}>
                      <div className="ticket-icon">
                        <Clock3 size={17} />
                      </div>
                      <div>
                        <b>Pending settlement · {p.ticket_id}</b>
                        <p>{p.external_ref} · simulated commerce operation</p>
                      </div>
                      <strong>${(p.amount_minor / 100).toFixed(2)}</strong>
                      <button
                        className="secondary"
                        onClick={() => settle(p.external_ref!)}
                      >
                        Settle demo transaction
                      </button>
                    </div>
                  ))}
                </>
              )}
            </section>
          </>
        )}
        {tab === "orders" && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">COMMERCE RECORDS</div>
                <h1>Orders</h1>
                <p>
                  Simulator snapshots with pending and settled amounts kept
                  distinct.
                </p>
              </div>
              <button className="secondary" onClick={refresh}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <div className="workspace-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Recent orders</h2>
                    <p>{orders.length} seeded records</p>
                  </div>
                </div>
                {orders.map((o) => (
                  <button
                    className={`ticket-row ${orderDetail?.id === o.id ? "selected" : ""}`}
                    key={o.id}
                    onClick={() => openOrder(o.id)}
                  >
                    <div className="ticket-icon">
                      <Boxes size={16} />
                    </div>
                    <div className="ticket-copy">
                      <div className="ticket-title">Order #{o.number}</div>
                      <div className="ticket-preview">
                        {o.customer_id} · delivered {o.delivered_at}
                      </div>
                      <div className="ticket-meta">
                        <span>v{o.version}</span>
                        <span>•</span>
                        <span>{o.currency}</span>
                      </div>
                    </div>
                    <div className="ticket-status">
                      <b>${(o.total_minor / 100).toFixed(2)}</b>
                      <small>total</small>
                    </div>
                  </button>
                ))}
              </section>
              <section className="panel detail-panel">
                {orderDetail && (
                  <>
                    <div className="panel-head">
                      <div>
                        <div className="eyebrow">
                          ORDER <span>{orderDetail.id}</span>
                        </div>
                        <h2>#{orderDetail.number}</h2>
                      </div>
                      <span className="pill green">
                        {orderDetail.customer_verified
                          ? "VERIFIED CUSTOMER"
                          : "UNVERIFIED"}
                      </span>
                    </div>
                    <div className="order-metrics">
                      <div>
                        <small>PAID</small>
                        <b>${(orderDetail.total_minor / 100).toFixed(2)}</b>
                      </div>
                      <div>
                        <small>REFUNDED · SETTLED</small>
                        <b>${(orderDetail.refunded_minor / 100).toFixed(2)}</b>
                      </div>
                      <div>
                        <small>REFUND · PENDING</small>
                        <b>${(orderDetail.pending_minor / 100).toFixed(2)}</b>
                      </div>
                      <div>
                        <small>REMAINING REFUNDABLE</small>
                        <b>
                          $
                          {(
                            orderDetail.remaining_refundable_minor / 100
                          ).toFixed(2)}
                        </b>
                      </div>
                    </div>
                    <div className="evidence">
                      <div className="section-title">
                        Line items{" "}
                        <span>{orderDetail.line_items.length} items</span>
                      </div>
                      {orderDetail.line_items.map((item: any, i: number) => (
                        <div className="evidence-row" key={i}>
                          <div className="ticket-icon">
                            <PackageCheck size={14} />
                          </div>
                          <div>
                            <b>{item.title}</b>
                            <small>
                              SKU {item.sku} · quantity {item.quantity} ·{" "}
                              {item.final_sale
                                ? "final sale"
                                : "return eligible"}
                            </small>
                          </div>
                          <strong>
                            ${(item.unit_price_minor / 100).toFixed(2)}
                          </strong>
                        </div>
                      ))}
                    </div>
                    <div className="explanation">
                      <div className="section-title">Order snapshot</div>
                      <p>
                        Customer {orderDetail.customer_name} · version{" "}
                        {orderDetail.version} · delivered{" "}
                        {orderDetail.delivered_at}. Pending amounts are reserved
                        separately and are not counted as settled refunds.
                      </p>
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "policy" && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">DETERMINISTIC RULES</div>
                <h1>Policy explorer</h1>
                <p>
                  Active merchant policy loaded from versioned YAML and applied
                  by backend code.
                </p>
              </div>
              <span className="pill green">
                VERSION {policy?.version || 1} ACTIVE
              </span>
            </div>
            <div className="stats">
              <div>
                <span>RETURN WINDOW</span>
                <b>{policy?.returns?.window_days ?? "—"} days</b>
                <small>Window starts on delivery</small>
              </div>
              <div>
                <span>HUMAN APPROVAL</span>
                <b>Required</b>
                <small>All financial mutations</small>
              </div>
              <div>
                <span>MAX PER ACTION</span>
                <b>
                  $
                  {((policy?.refunds?.max_per_action_minor || 0) / 100).toFixed(
                    2,
                  )}
                </b>
                <small>Configured minor unit cap</small>
              </div>
              <div>
                <span>SHIPPING REFUND</span>
                <b>
                  {policy?.refunds?.refund_shipping ? "Allowed" : "Excluded"}
                </b>
                <small>Merchant policy</small>
              </div>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Policy rules</h2>
                  <p>
                    {policy?.policy_id} · {policy?.timezone}
                  </p>
                </div>
              </div>
              <div className="policy-grid">
                <div className="policy-card">
                  <div className="section-title">Return conditions</div>
                  <p>Start: {policy?.returns?.window_start}</p>
                  <p>
                    Received before refund:{" "}
                    {policy?.returns?.require_return_received_before_refund
                      ? "Required"
                      : "Not required in demo"}
                  </p>
                </div>
                <div className="policy-card">
                  <div className="section-title">Exclusions</div>
                  {Object.entries(policy?.exclusions || {}).map(([k, v]) => (
                    <p key={k}>
                      {k.replaceAll("_", " ")}:{" "}
                      <b>{v ? "Excluded" : "Allowed"}</b>
                    </p>
                  ))}
                </div>
                <div className="policy-card">
                  <div className="section-title">Exceptions</div>
                  {Object.entries(policy?.exceptions || {}).map(([k, v]) => (
                    <p key={k}>
                      {k.replaceAll("_", " ")}:{" "}
                      <b>{String(v).replaceAll("_", " ")}</b>
                    </p>
                  ))}
                </div>
              </div>
            </section>
            {user?.role === "ADMIN" && (
              <section className="panel policy-preview">
                <div className="panel-head">
                  <div>
                    <h2>Publish a policy version</h2>
                    <p>
                      Changes invalidate proposals created under an older
                      version.
                    </p>
                  </div>
                </div>
                <div className="preview-actions">
                  <label>
                    Return window{" "}
                    <input
                      id="policy-window"
                      type="number"
                      min="1"
                      max="365"
                      defaultValue={policy?.returns?.window_days ?? 30}
                    />
                  </label>
                  <label>
                    Maximum refund (minor units){" "}
                    <input
                      id="policy-limit"
                      type="number"
                      min="1"
                      defaultValue={
                        policy?.refunds?.max_per_action_minor ?? 2500
                      }
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={async () => {
                      const return_window_days = Number(
                        (
                          document.getElementById(
                            "policy-window",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const max_per_action_minor = Number(
                        (
                          document.getElementById(
                            "policy-limit",
                          ) as HTMLInputElement
                        ).value,
                      );
                      try {
                        const updated = await req("/policies/activate", {
                          method: "POST",
                          body: JSON.stringify({
                            return_window_days,
                            max_per_action_minor,
                          }),
                        });
                        setPolicy(updated);
                        setNotice(`Policy v${updated.version} activated`);
                        await refresh();
                      } catch (e: any) {
                        setNotice(e.message);
                      }
                    }}
                  >
                    Activate version {Number(policy?.version || 1) + 1}
                  </button>
                </div>
              </section>
            )}
            <section className="panel policy-preview">
              <div className="panel-head">
                <div>
                  <h2>Preview an order</h2>
                  <p>
                    Run the selected order through the real policy evaluator.
                  </p>
                </div>
              </div>
              <div className="preview-actions">
                <select aria-label="Order to evaluate" id="policy-order">
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      Order #{o.number} · {o.customer_id}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  onClick={async () => {
                    const id = (
                      document.getElementById(
                        "policy-order",
                      ) as HTMLSelectElement
                    ).value;
                    try {
                      const result = await req("/policies/evaluate", {
                        method: "POST",
                        body: JSON.stringify({ order_id: id }),
                      });
                      setNotice(
                        `${result.outcome.replaceAll("_", " ")} · $${(result.eligible_amount_minor / 100).toFixed(2)} eligible`,
                      );
                    } catch (e: any) {
                      setNotice(e.message);
                    }
                  }}
                >
                  Evaluate policy
                </button>
              </div>
            </section>
          </>
        )}
        {tab === "evaluations" && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">REPEATABLE QUALITY SIGNALS</div>
                <h1>Evaluation lab</h1>
                <p>
                  Run fixture cases through the same investigation API used in
                  the ticket workflow.
                </p>
              </div>
              <button
                className="primary"
                disabled={evalBusy || user?.role === "AGENT"}
                onClick={runEval}
              >
                {evalBusy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <FlaskConical size={15} />
                )}{" "}
                {user?.role === "AGENT"
                  ? "Reviewer required"
                  : evalBusy
                    ? "Running suite…"
                    : "Run evaluation suite"}
              </button>
            </div>
            {evalReport ? (
              <>
                <div className="stats">
                  <div>
                    <span>CASES PASSED</span>
                    <b>
                      {evalReport.passed}/{evalReport.total}
                    </b>
                    <small>
                      {evalReport.failed
                        ? "Review failed cases"
                        : "All fixture cases passed"}
                    </small>
                  </div>
                  <div>
                    <span>MODE</span>
                    <b>Fixture</b>
                    <small>Deterministic · offline</small>
                  </div>
                  <div>
                    <span>SUITE</span>
                    <b>v1</b>
                    <small>{evalReport.run_id}</small>
                  </div>
                  <div>
                    <span>GENERATED</span>
                    <b>
                      {new Date(evalReport.generated_at).toLocaleTimeString(
                        [],
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </b>
                    <small>
                      {new Date(evalReport.generated_at).toLocaleDateString()}
                    </small>
                  </div>
                </div>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Case results</h2>
                      <p>
                        Expected outcomes compared against persisted
                        investigation results.
                      </p>
                    </div>
                  </div>
                  {evalReport.cases.map((c: any) => (
                    <div className="audit-row" key={c.id}>
                      <div
                        className={
                          c.passed ? "result-icon good" : "result-icon warn"
                        }
                      >
                        {c.passed ? (
                          <Check size={14} />
                        ) : (
                          <TriangleAlert size={14} />
                        )}
                      </div>
                      <div>
                        <b>{c.id.replaceAll("-", " ")}</b>
                        <p>
                          {c.expected} → {c.actual} · {c.intent} ·{" "}
                          {c.evidence_count} evidence records
                        </p>
                        <small>Investigation {c.investigation_id}</small>
                      </div>
                      <span className={c.passed ? "pill green" : "pill red"}>
                        {c.passed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  ))}
                </section>
              </>
            ) : (
              <section className="panel">
                <div className="empty">
                  <FlaskConical size={28} />
                  <b>No run yet</b>
                  <p>
                    Run the deterministic six-case suite to inspect current
                    results.
                  </p>
                </div>
              </section>
            )}
          </>
        )}
        {(tab === "audit" || tab === "overview") && (
          <>
            <div className="page-head">
              <div>
                <div className="eyebrow">TRACEABLE OPERATIONS</div>
                <h1>
                  {tab === "audit" ? "Audit trail" : "Operations overview"}
                </h1>
                <p>
                  Every investigation and financial state change is recorded.
                </p>
              </div>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Recent activity</h2>
                  <p>Append-only event records from this demo workspace.</p>
                </div>
                <button className="secondary" onClick={refresh}>
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              {audit.map((e) => (
                <div className="audit-row" key={e.id}>
                  <div className="audit-dot" />
                  <div>
                    <b>{e.event_type.replaceAll("_", " ")}</b>
                    <p>
                      {e.entity_id} · by {e.actor}
                    </p>
                    <small>{new Date(e.created_at).toLocaleString()}</small>
                  </div>
                  <code>{JSON.stringify(e.details)}</code>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
