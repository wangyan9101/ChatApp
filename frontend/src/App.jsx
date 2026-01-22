import React, { useEffect, useMemo, useRef, useState } from "react";

const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const DEFAULT_AVATARS = [
  { id: "a1", label: "蓝色", color: "#3B82F6" },
  { id: "a2", label: "紫色", color: "#8B5CF6" },
  { id: "a3", label: "绿色", color: "#10B981" },
  { id: "a4", label: "橙色", color: "#F59E0B" },
];

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function Avatar({ color = "#3B82F6", size = 32, label = "" }) {
  return (
    <div
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: "999px",
        background: color,
        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
        flex: "0 0 auto",
      }}
    />
  );
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div style={styles.modalOverlay} onMouseDown={onClose}>
      <div style={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

/**
 * 用 fetch 读 SSE（不依赖 EventSource，因为我们要 POST body）
 */
async function ssePost(url, body, handlers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const emitEvent = (rawEvent) => {
    // rawEvent is like:
    // event: delta
    // data: {"text":"..."}
    let event = "message";
    let dataLine = "";
    rawEvent.split("\n").forEach((line) => {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLine += line.slice(5).trim();
    });
    if (!dataLine) return;
    let data;
    try {
      data = JSON.parse(dataLine);
    } catch {
      data = { raw: dataLine };
    }
    handlers?.onEvent?.(event, data);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events end with \n\n
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (rawEvent) emitEvent(rawEvent);
    }
  }

  handlers?.onClose?.();
}

export default function App() {
  // 用户配置
  const [user, setUser] = useState({ name: "User", avatarId: DEFAULT_AVATARS[0].id });
  const avatar = useMemo(
    () => DEFAULT_AVATARS.find((a) => a.id === user.avatarId) || DEFAULT_AVATARS[0],
    [user.avatarId]
  );
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  // 模型列表来自后端
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setModelsLoading(true);
        setModelsError("");
        const r = await fetch("/api/models");
        const data = await r.json();
        setModels(data);
      } catch (e) {
        setModelsError(String(e?.message || e));
      } finally {
        setModelsLoading(false);
      }
    })();
  }, []);

  // 会话列表
  const [sessions, setSessions] = useState(() => {
    const s1 = {
      id: uid(),
      title: "新对话",
      modelId: "mock-1",
      updatedAt: Date.now(),
      messages: [],
    };
    return [s1];
  });
  const [activeId, setActiveId] = useState(sessions[0]?.id);
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) || sessions[0],
    [sessions, activeId]
  );

  // 输入区
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const assistantMsgIdRef = useRef(null);

  const activeModelName = useMemo(() => {
    const m = models.find((x) => x.id === activeSession?.modelId);
    return m?.name || activeSession?.modelId || "-";
  }, [models, activeSession?.modelId]);

  // 模型下拉：若后端模型列表返回了，默认把当前会话 modelId 对齐到第一个可用
  useEffect(() => {
    if (!models.length) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s;
        const exists = models.some((m) => m.id === s.modelId);
        return exists ? s : { ...s, modelId: models[0].id, updatedAt: Date.now() };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length]);

  function newChat() {
    const created = {
      id: uid(),
      title: "新对话",
      modelId: models[0]?.id || "mock-1",
      updatedAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [created, ...prev]);
    setActiveId(created.id);
    setInput("");
  }

  function setSessionModel(modelId) {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, modelId, updatedAt: Date.now() } : s))
    );
  }

  function renameSessionIfNeeded(text) {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s;
        if (s.title !== "新对话") return s;
        const t = text.trim().slice(0, 16) || "新对话";
        return { ...s, title: t, updatedAt: Date.now() };
      })
    );
  }

  function appendMessage(role, text) {
    const msg = { id: uid(), role, text, ts: Date.now() };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() } : s
      )
    );
    return msg.id;
  }

  function updateMessage(id, patch) {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s;
        return {
          ...s,
          messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          updatedAt: Date.now(),
        };
      })
    );
  }

  async function send() {
    if (sending) return;
    const text = input.trim();
    if (!text) return;

    renameSessionIfNeeded(text);
    appendMessage("user", text);
    setInput("");

    // 先插入一个 assistant 空消息，后面流式往里追加
    const assistantId = appendMessage("assistant", "");
    assistantMsgIdRef.current = assistantId;

    const payload = {
      model: activeSession?.modelId || (models[0]?.id ?? "mock-1"),
      messages: [
        ...(activeSession?.messages || []).map((m) => ({
          role: m.role,
          content: m.text,
        })),
        { role: "user", content: text },
      ],
      stream: true,
    };

    setSending(true);
    try {
      await ssePost("/api/chat/stream", payload, {
        onEvent: (event, data) => {
          if (event === "delta") {
            const chunk = data?.text ?? "";
            if (!chunk) return;
            const id = assistantMsgIdRef.current;
            if (!id) return;
            // 追加 chunk
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== activeId) return s;
                return {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === id ? { ...m, text: (m.text || "") + chunk } : m
                  ),
                  updatedAt: Date.now(),
                };
              })
            );
          } else if (event === "error") {
            const id = assistantMsgIdRef.current;
            updateMessage(id, { text: `【错误】${data?.message || "unknown error"}` });
          }
        },
      });
    } catch (e) {
      const id = assistantMsgIdRef.current;
      updateMessage(id, { text: `【请求失败】${String(e?.message || e)}` });
    } finally {
      setSending(false);
      assistantMsgIdRef.current = null;
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <button style={styles.primaryBtn} onClick={newChat}>
            ＋ 新建对话
          </button>
          <div style={styles.sidebarTitle}>历史记录</div>
        </div>

        <div style={styles.sessionList}>
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            const modelName = models.find((m) => m.id === s.modelId)?.name || s.modelId;
            return (
              <button
                key={s.id}
                style={{ ...styles.sessionItem, ...(isActive ? styles.sessionItemActive : null) }}
                onClick={() => setActiveId(s.id)}
              >
                <div style={styles.sessionRow}>
                  <div style={styles.sessionTitle}>{s.title}</div>
                  <div style={styles.sessionTime}>{formatTime(s.updatedAt)}</div>
                </div>
                <div style={styles.sessionMeta}>{modelName}</div>
              </button>
            );
          })}
        </div>

        <div style={styles.sidebarBottom}>
          <button style={styles.userBtn} onClick={() => setAvatarModalOpen(true)} title="用户头像配置">
            <Avatar color={avatar.color} size={28} label={avatar.label} />
            <div style={{ minWidth: 0 }}>
              <div style={styles.userName}>{user.name}</div>
              <div style={styles.userHint}>头像配置</div>
            </div>
            <span style={{ marginLeft: "auto", opacity: 0.7 }}>⚙</span>
          </button>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.topbar}>
          <div style={styles.topbarLeft}>
            <div style={styles.chatTitle}>聊天</div>
            <div style={styles.chatSubtitle}>
              当前会话：{activeSession?.title || "-"} / 模型：{activeModelName}
            </div>
            {modelsLoading ? (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>模型加载中…</div>
            ) : modelsError ? (
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                模型加载失败：{modelsError}
              </div>
            ) : null}
          </div>

          <div style={styles.topbarRight}>
            <label style={styles.label}>模型</label>
            <select
              style={styles.select}
              value={activeSession?.modelId || models[0]?.id || "mock-1"}
              onChange={(e) => setSessionModel(e.target.value)}
              disabled={!models.length}
            >
              {(models.length ? models : [{ id: "mock-1", name: "Mock Stream" }]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={styles.chatBody}>
          {activeSession?.messages?.length ? (
            activeSession.messages.map((m) => (
              <div
                key={m.id}
                style={{
                  ...styles.msgRow,
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {m.role !== "user" && <Avatar color={"#111827"} size={26} label="Assistant" />}
                <div
                  style={{
                    ...styles.bubble,
                    ...(m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant),
                  }}
                >
                  <div style={styles.bubbleText}>
                    {String(m.text || "")
                      .split("\n")
                      .map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                  </div>
                  <div style={styles.bubbleTime}>{formatTime(m.ts)}</div>
                </div>
                {m.role === "user" && <Avatar color={avatar.color} size={26} label={avatar.label} />}
              </div>
            ))
          ) : (
            <div style={styles.empty}>
              <div style={styles.emptyTitle}>开始一个新对话</div>
              <div style={styles.emptyHint}>右上角选择模型，输入消息后按 Enter 发送。</div>
            </div>
          )}
        </div>

        <div style={styles.composer}>
          <textarea
            style={styles.textarea}
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
          />
          <button style={styles.sendBtn} onClick={send} disabled={sending}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </main>

      <Modal open={avatarModalOpen} title="用户头像配置" onClose={() => setAvatarModalOpen(false)}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 140 }}>
            <div style={styles.label}>昵称</div>
            <input
              style={styles.input}
              value={user.name}
              onChange={(e) => setUser((u) => ({ ...u, name: e.target.value }))}
              placeholder="你的昵称"
            />
          </div>

          <div style={{ flex: 1 }}>
            <div style={styles.label}>头像颜色</div>
            <div style={styles.avatarGrid}>
              {DEFAULT_AVATARS.map((a) => {
                const selected = a.id === user.avatarId;
                return (
                  <button
                    key={a.id}
                    style={{
                      ...styles.avatarChoice,
                      outline: selected ? "2px solid #111827" : "2px solid transparent",
                    }}
                    onClick={() => setUser((u) => ({ ...u, avatarId: a.id }))}
                    title={a.label}
                  >
                    <Avatar color={a.color} size={28} label={a.label} />
                    <span style={{ fontSize: 12, opacity: 0.8 }}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button style={styles.primaryBtn} onClick={() => setAvatarModalOpen(false)}>
            完成
          </button>
        </div>
      </Modal>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    width: "100%",
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    background: "#0B1020",
    color: "#E5E7EB",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  },

  sidebar: {
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    backdropFilter: "blur(10px)",
  },
  sidebarTop: { padding: 14, paddingBottom: 10 },
  sidebarTitle: { marginTop: 12, fontSize: 12, opacity: 0.75, letterSpacing: 1 },
  sessionList: { padding: 10, paddingTop: 0, overflow: "auto", flex: 1 },
  sessionItem: {
    width: "100%",
    textAlign: "left",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    borderRadius: 12,
    padding: 10,
    cursor: "pointer",
    marginBottom: 10,
    color: "#E5E7EB",
  },
  sessionItemActive: {
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.06)",
  },
  sessionRow: { display: "flex", gap: 10, alignItems: "center" },
  sessionTitle: {
    fontWeight: 650,
    fontSize: 13,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
  },
  sessionTime: { fontSize: 11, opacity: 0.65, flex: "0 0 auto" },
  sessionMeta: { marginTop: 6, fontSize: 12, opacity: 0.75 },

  sidebarBottom: { padding: 12, borderTop: "1px solid rgba(255,255,255,0.08)" },
  userBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    cursor: "pointer",
    color: "#E5E7EB",
  },
  userName: {
    fontWeight: 700,
    fontSize: 13,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  userHint: { fontSize: 12, opacity: 0.7 },

  main: { display: "flex", flexDirection: "column", minWidth: 0 },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
  },
  topbarLeft: { minWidth: 0 },
  chatTitle: { fontWeight: 800, fontSize: 16 },
  chatSubtitle: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 720,
  },
  topbarRight: { display: "flex", alignItems: "center", gap: 8 },
  label: { fontSize: 12, opacity: 0.75 },
  select: {
    height: 34,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#E5E7EB",
    padding: "0 10px",
    outline: "none",
    cursor: "pointer",
  },

  chatBody: { flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  msgRow: { display: "flex", gap: 10, alignItems: "flex-end" },
  bubble: {
    maxWidth: "min(760px, 80%)",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    whiteSpace: "pre-wrap",
  },
  bubbleUser: { background: "rgba(59,130,246,0.16)", border: "1px solid rgba(59,130,246,0.25)" },
  bubbleAssistant: { background: "rgba(255,255,255,0.04)" },
  bubbleText: { fontSize: 14, lineHeight: 1.45 },
  bubbleTime: { marginTop: 6, fontSize: 11, opacity: 0.65 },

  composer: {
    padding: 14,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    gap: 10,
    alignItems: "flex-end",
    background: "rgba(255,255,255,0.02)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    minHeight: 44,
    maxHeight: 160,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "#E5E7EB",
    padding: "10px 12px",
    outline: "none",
    lineHeight: 1.4,
  },

  primaryBtn: {
    height: 36,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#E5E7EB",
    padding: "0 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  sendBtn: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.20)",
    color: "#E5E7EB",
    padding: "0 14px",
    cursor: "pointer",
    fontWeight: 800,
  },

  iconBtn: {
    height: 32,
    width: 32,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#E5E7EB",
    cursor: "pointer",
  },

  empty: { margin: "auto", textAlign: "center", opacity: 0.85 },
  emptyTitle: { fontSize: 18, fontWeight: 800, marginBottom: 6 },
  emptyHint: { fontSize: 13, opacity: 0.75 },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(640px, 95vw)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(17,24,39,0.92)",
    backdropFilter: "blur(10px)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.40)",
    overflow: "hidden",
  },
  modalHeader: {
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  modalBody: { padding: 14 },

  input: {
    width: "100%",
    height: 34,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#E5E7EB",
    padding: "0 10px",
    outline: "none",
  },
  avatarGrid: {
    marginTop: 8,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  avatarChoice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    color: "#E5E7EB",
    cursor: "pointer",
  },
};
