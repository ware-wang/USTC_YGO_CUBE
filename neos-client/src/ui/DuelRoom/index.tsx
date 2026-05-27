/**
 * DuelRoom — lightweight auto-join entry point for cube-draft.
 *
 * Accessed via /neos/duelroom?passwd=cube_xxx&player=PlayerName
 *
 * Reads URL params, immediately connects to the ygopro server,
 * and navigates to the waitroom (which handles auto-ready).
 *
 * Features:
 *  - Error handling with manual retry
 *  - Connection timeout (15s)
 *  - Fallback manual connect form
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { connectSrvpro } from "@/ui/Match/util";
import { roomStore } from "@/stores";
import { useSnapshot } from "valtio";
import { Spin, Button, Input, Typography, Alert } from "antd";

const CONNECTION_TIMEOUT_MS = 15000;

type DuelRoomStatus = "connecting" | "timeout" | "error" | "manual";

export const Component: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { joined } = useSnapshot(roomStore);
  const [status, setStatus] = useState<DuelRoomStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [manualServer, setManualServer] = useState("");
  const [manualPasswd, setManualPasswd] = useState("");
  const [manualPlayer, setManualPlayer] = useState("");
  const connectAttempted = useRef(false);
  const connectingRef = useRef(false);

  const passwd = params.get("passwd") || "cube";
  const player = params.get("player") || "Player";
  // Default to the legacy ygopro-compatible proxy on the current host.
  // neos-ts expects a host:port target instead of a ws path, so `/ws-duel`
  // is not a valid default here.
  const hostname = window.location.hostname || "127.0.0.1";
  const defaultServer = `${hostname}:7911`;
  const server = params.get("server") || defaultServer;

  // Pre-fill manual form
  useEffect(() => {
    if (!manualServer) setManualServer(server);
    if (!manualPasswd) setManualPasswd(passwd);
    if (!manualPlayer) setManualPlayer(player);
  }, [server, passwd, player]);

  const doConnect = useCallback(async (srv: string, pwd: string, name: string) => {
    setStatus("connecting");
    setErrorMsg("");
    connectingRef.current = true;
    console.log(`[DuelRoom] Auto-joining as "${name}" with passwd "${pwd}" to ${srv}`);

    // Timeout timer
    const timeoutId = setTimeout(() => {
      if (connectingRef.current) {
        connectingRef.current = false;
        setStatus("timeout");
        setErrorMsg(`连接超时 (${srv})，请检查服务器是否正在运行`);
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      await connectSrvpro({
        ip: srv,
        player: name,
        passWd: pwd,
      });
      connectingRef.current = false;
      clearTimeout(timeoutId);
    } catch (e: any) {
      connectingRef.current = false;
      clearTimeout(timeoutId);
      setStatus("error");
      setErrorMsg(e?.message || String(e) || "连接失败");
      console.error("[DuelRoom] connectSrvpro error:", e);
    }
  }, []);

  // Auto-connect on mount (only once)
  useEffect(() => {
    if (connectAttempted.current) return;
    connectAttempted.current = true;
    doConnect(server, passwd, player);
  }, []);

  // Navigate to waitroom once joined
  useEffect(() => {
    if (joined) {
      navigate("/waitroom");
    }
  }, [joined, navigate]);

  const retry = () => {
    doConnect(manualServer || server, manualPasswd || passwd, manualPlayer || player);
  };

  // ── Render ──────────────────────────────────

  // While connecting: show spinner
  if (status === "connecting") {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        color: "#888",
        flexDirection: "column",
        gap: 16,
      }}>
        <Spin size="large" />
        <div>正在连接对战房间...</div>
        <div style={{ fontSize: "0.75rem", color: "#666" }}>
          服务器: {server} | 房间: {passwd}
        </div>
      </div>
    );
  }

  // On timeout or error: show retry UI with manual form
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      color: "#ccc",
      flexDirection: "column",
      gap: 12,
      padding: 24,
    }}>
      <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>🎮 对战场</div>

      {status === "timeout" && (
        <Alert
          type="warning"
          showIcon
          message="连接超时"
          description={errorMsg}
          style={{ maxWidth: 400, marginBottom: 8 }}
        />
      )}
      {status === "error" && (
        <Alert
          type="error"
          showIcon
          message="连接失败"
          description={errorMsg}
          style={{ maxWidth: 400, marginBottom: 8 }}
        />
      )}

      <div style={{
        background: "#1a1a1a",
        borderRadius: 8,
        padding: 20,
        maxWidth: 400,
        width: "100%",
      }}>
        <Typography.Text strong style={{ color: "#ccc", display: "block", marginBottom: 12 }}>
          手动连接
        </Typography.Text>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "0.8rem", color: "#888", marginBottom: 4 }}>服务器地址</div>
          <Input
            value={manualServer}
            onChange={(e) => setManualServer(e.target.value)}
            placeholder="localhost:7911"
            style={{ background: "#2a2a2a", color: "#ccc", borderColor: "#444" }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "0.8rem", color: "#888", marginBottom: 4 }}>房间密码</div>
          <Input
            value={manualPasswd}
            onChange={(e) => setManualPasswd(e.target.value)}
            placeholder="cube_xxx"
            style={{ background: "#2a2a2a", color: "#ccc", borderColor: "#444" }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: "0.8rem", color: "#888", marginBottom: 4 }}>玩家昵称</div>
          <Input
            value={manualPlayer}
            onChange={(e) => setManualPlayer(e.target.value)}
            placeholder="Player"
            style={{ background: "#2a2a2a", color: "#ccc", borderColor: "#444" }}
          />
        </div>

        <Button
          type="primary"
          block
          onClick={retry}
          loading={status === "connecting"}
        >
          重新连接
        </Button>

        <div style={{ marginTop: 12, fontSize: "0.75rem", color: "#666" }}>
          <p>默认会连接当前主机的 YGOPro 代理（端口 7911）。</p>
          <p>如果你改了代理端口，可在上面手动填写 `主机:端口` 后重试。</p>
        </div>
      </div>
    </div>
  );
};