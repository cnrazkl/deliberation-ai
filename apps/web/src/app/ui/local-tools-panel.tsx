"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useState, type FormEvent } from "react";

type Connection = { id: string; label: string; endpoint: string };
type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
type ToolResult = {
  id: string;
  connectionId: string;
  connectionLabel: string;
  toolName: string;
  content: string;
  sha256: string;
  isError: boolean;
  createdAt: string;
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function LocalToolsPanel({
  selectedResultIds,
  onSelectionChange,
  retrieveRelevant,
  onRetrieveRelevantChange,
}: {
  selectedResultIds: string[];
  onSelectionChange: (ids: string[]) => void;
  retrieveRelevant: boolean;
  onRetrieveRelevantChange: (value: boolean) => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [results, setResults] = useState<ToolResult[]>([]);
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:3001/mcp");
  const [connectionId, setConnectionId] = useState("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolName, setToolName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh(): Promise<void> {
    const [connectionsResponse, resultsResponse] = await Promise.all([
      ownerFetch("/api/mcp-connections", { cache: "no-store" }),
      ownerFetch("/api/mcp-tool-results", { cache: "no-store" }),
    ]);
    if (connectionsResponse.ok) {
      const body = (await connectionsResponse.json()) as { connections: Connection[] };
      setConnections(body.connections);
      setConnectionId((current) => body.connections.some((connection) => connection.id === current)
        ? current
        : body.connections[0]?.id ?? "");
    }
    if (resultsResponse.ok) {
      const body = (await resultsResponse.json()) as { results: ToolResult[] };
      setResults(body.results);
    }
  }

  useEffect(() => {
    void Promise.all([
      ownerFetch("/api/mcp-connections", { cache: "no-store" }),
      ownerFetch("/api/mcp-tool-results", { cache: "no-store" }),
    ]).then(async ([connectionsResponse, resultsResponse]) => {
      if (connectionsResponse.ok) {
        const body = (await connectionsResponse.json()) as { connections: Connection[] };
        setConnections(body.connections);
        setConnectionId(body.connections[0]?.id ?? "");
      }
      if (resultsResponse.ok) {
        const body = (await resultsResponse.json()) as { results: ToolResult[] };
        setResults(body.results);
      }
    }).catch(() => undefined);
  }, []);

  async function saveConnection(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await ownerFetch("/api/mcp-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, endpoint }),
      });
      if (!response.ok) throw new Error(await responseError(response, "MCP bağlantısı kaydedilemedi."));
      setLabel("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP bağlantısı kaydedilemedi.");
    } finally { setPending(false); }
  }

  async function discover(): Promise<void> {
    if (!connectionId) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await ownerFetch(`/api/mcp-connections/${connectionId}/tools`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "MCP araçları alınamadı."));
      const body = (await response.json()) as { tools: Tool[] };
      setTools(body.tools);
      setToolName(body.tools[0]?.name ?? "");
    } catch (reason) {
      setTools([]);
      setError(reason instanceof Error ? reason.message : "MCP araçları alınamadı.");
    } finally { setPending(false); }
  }

  async function invoke(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const args = JSON.parse(argumentsJson) as unknown;
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Araç girdisi bir JSON nesnesi olmalı.");
      const response = await ownerFetch("/api/mcp-tool-results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId, toolName, arguments: args }),
      });
      if (!response.ok) throw new Error(await responseError(response, "MCP aracı çalıştırılamadı."));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP aracı çalıştırılamadı.");
    } finally { setPending(false); }
  }

  async function removeConnection(id: string): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await ownerFetch(`/api/mcp-connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "MCP bağlantısı kaldırılamadı."));
      const body = await response.json() as { deleted: boolean };
      if (!body.deleted) throw new Error("MCP bağlantısı bulunamadı.");
      const remaining = connections.filter((connection) => connection.id !== id);
      const removedResultIds = new Set(results.filter((result) => result.connectionId === id).map((result) => result.id));
      setConnections(remaining);
      setConnectionId((current) => current === id ? remaining[0]?.id ?? "" : current);
      setResults((current) => current.filter((result) => result.connectionId !== id));
      onSelectionChange(selectedResultIds.filter((resultId) => !removedResultIds.has(resultId)));
      setTools([]);
      setToolName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP bağlantısı kaldırılamadı.");
    } finally { setPending(false); }
  }

  async function removeResult(id: string): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await ownerFetch(`/api/mcp-tool-results?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "MCP sonucu silinemedi."));
      const body = await response.json() as { deleted: boolean };
      if (!body.deleted) throw new Error("MCP sonucu bulunamadı.");
      setResults((current) => current.filter((result) => result.id !== id));
      onSelectionChange(selectedResultIds.filter((item) => item !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP sonucu silinemedi.");
    } finally { setPending(false); }
  }

  function toggleResult(id: string, checked: boolean): void {
    if (!checked) {
      onSelectionChange(selectedResultIds.filter((item) => item !== id));
      return;
    }
    if (selectedResultIds.length >= 3) {
      setError("Bir çalışmada en fazla üç yerel araç sonucu kullanılabilir.");
      return;
    }
    onSelectionChange([...selectedResultIds, id]);
  }

  return (
    <section className="settings-card local-tools-panel" aria-label="Yerel MCP araçları">
      <div className="memory-heading">
        <div>
          <strong>Yerel MCP araçları</strong>
          <small>{connections.length} bağlantı · bu çalışma için {selectedResultIds.length}/3 sonuç seçili</small>
        </div>
      </div>
      <p className="hint">Yalnız bu bilgisayardaki HTTP loopback MCP sunucularına bağlanır. Aracı siz çalıştırırsınız; model yeni araç çağrısı başlatamaz. Seçtiğiniz sonuç donmuş, güvenilmeyen bağlam olarak konseye gider.</p>
      <label className="check-row">
        <input type="checkbox" checked={retrieveRelevant} onChange={(event) => onRetrieveRelevantChange(event.target.checked)} />
        Soruyla kelime eşleşmesine göre en alakalı yerel araç sonuçlarını otomatik getir (en fazla 3)
      </label>
      <form className="mcp-connection-form" onSubmit={saveConnection}>
        <label>Bağlantı adı<input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} required /></label>
        <label>Yerel MCP adresi<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required /></label>
        <button type="submit" disabled={pending}>Bağlantıyı kaydet</button>
      </form>
      {connections.length > 0 ? (
        <div className="mcp-runner">
          <label>Bağlantı<select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setTools([]); }}>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label} · {connection.endpoint}</option>)}
          </select></label>
          <div className="mcp-runner-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void discover()}>Araçları getir</button>
            <button type="button" className="secondary-button danger-button" disabled={pending} onClick={() => void removeConnection(connectionId)}>Bağlantıyı kaldır</button>
          </div>
          {tools.length > 0 ? <>
            <label>Araç<select value={toolName} onChange={(event) => setToolName(event.target.value)}>
              {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
            </select></label>
            <label className="mcp-arguments">Araç girdisi (JSON)<textarea rows={5} value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} /></label>
            <button type="button" disabled={pending || !toolName} onClick={() => void invoke()}>Aracı şimdi çalıştır</button>
            <pre className="mcp-schema">{JSON.stringify(tools.find((tool) => tool.name === toolName)?.inputSchema ?? {}, null, 2)}</pre>
          </> : null}
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="mcp-result-list">
        {results.map((result) => (
          <article key={result.id} className={result.isError ? "failed" : ""}>
            <label>
              <input type="checkbox" disabled={result.isError} checked={selectedResultIds.includes(result.id)} onChange={(event) => toggleResult(result.id, event.target.checked)} />
              <span><strong>{result.connectionLabel} · {result.toolName}</strong><small>{new Date(result.createdAt).toLocaleString("tr-TR")} · SHA-256 {result.sha256.slice(0, 12)}…</small></span>
            </label>
            <pre>{result.content}</pre>
            <button type="button" className="secondary-button danger-button" disabled={pending} onClick={() => void removeResult(result.id)}>Sonucu sil</button>
          </article>
        ))}
      </div>
    </section>
  );
}
