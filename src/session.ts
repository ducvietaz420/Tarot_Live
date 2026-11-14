import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, Mode, Snapshot } from "../shared/types";

export function useSession(mode: Mode) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const clientId = useRef(crypto.randomUUID());
  const socket = useRef<WebSocket | null>(null);
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const epoch = useRef(0);
  const accept = useCallback((snapshot: Snapshot) => {
    if (snapshot.mode !== currentMode.current || !snapshot.session) return;
    setState((previous) =>
      previous?.mode === snapshot.mode &&
      previous.serverTime > snapshot.serverTime
        ? previous
        : snapshot,
    );
  }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    let dead = false;
    let retry: ReturnType<typeof setTimeout>;
    let ws: WebSocket;
    const connect = () => {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?mode=${mode}&clientId=${clientId.current}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (!dead) {
          setOnline(true);
          setError("");
        }
      };
      ws.onmessage = (event) => {
        if (dead || generation !== epoch.current) return;
        try {
          accept(JSON.parse(event.data));
        } catch {
          setError("Dữ liệu đồng bộ không hợp lệ");
        }
      };
      ws.onclose = () => {
        if (!dead) {
          setOnline(false);
          retry = setTimeout(connect, 1500);
        }
      };
      ws.onerror = () => {
        if (!dead) setOnline(false);
      };
    };
    setState(null);
    setOnline(false);
    fetch(`/api/state?mode=${mode}`)
      .then((r) => r.json())
      .then((data) => {
        if (!dead) accept(data);
      })
      .catch(() => {
        if (!dead) setError("Không thể kết nối máy chủ.");
      });
    connect();
    return () => {
      dead = true;
      clearTimeout(retry);
      ws.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [mode, accept]);
  const action = useCallback(
    async (action: Action) => {
      const target =
        action.type === "demo" || action.type === "next-phase" ? "demo" : mode;
      const generation = epoch.current;
      try {
        const response = await fetch(`/api/action?mode=${target}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Thao tác chưa thành công");
        if (generation === epoch.current && mode === currentMode.current) {
          accept(result);
          setError("");
        }
        return true;
      } catch (failure) {
        if (generation === epoch.current && mode === currentMode.current)
          setError((failure as Error).message);
        return false;
      }
    },
    [mode, accept],
  );
  return {
    state,
    action,
    error,
    setError,
    online,
    socket,
    clientId: clientId.current,
  };
}
