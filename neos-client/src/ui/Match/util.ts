import { initStrings, initSuperPrerelease } from "@/api";
import { getUIContainer, initUIContainer } from "@/container/compat";
import { WebSocketStream } from "@/infra";
import { initReplaySocket, initSocket } from "@/middleware/socket";
import {
  pollSocketLooper,
  pollSocketLooperWithAgent,
} from "@/service/executor";
import { resetDuel } from "@/stores";

import { initSqlite } from "../Layout/utils";

// 连接SRVPRO服务
export const connectSrvpro = async (params: {
  ip: string;
  player: string;
  passWd: string;
  enableKuriboh?: boolean;
  replay?: boolean;
  replayData?: ArrayBuffer;
  reconnect?: boolean;
  customOnConnected?: (conn: WebSocketStream) => void;
}) => {
  // 初始化sqlite
  await initSqlite();

  // 初始化I18N文案
  await initStrings();

  // 初始化超先行配置
  await initSuperPrerelease();

  if (params.replay && params.replayData) {
    // initialize replay from local yrp3d data
    const conn = initReplaySocket({
      data: params.replayData,
    });

    // initialize the UI Container
    initUIContainer(conn);

    // execute the event looper
    pollSocketLooper(getUIContainer());
  } else {
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const startSocket = (isReconnect: boolean) => {
      if (isReconnect) {
        resetDuel();
      }

      const conn = initSocket({
        ...params,
        customOnConnected: (conn) => {
          reconnectAttempt = 0;
          params.customOnConnected?.(conn);
        },
        suppressErrorAlert: params.reconnect,
        onClose: (closedConn, ev) => {
          if (!params.reconnect) return;
          if (closedConn.isClosedByClient() || ev.code === 1000) return;
          if (reconnectTimer !== undefined) return;

          const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = undefined;
            reconnectAttempt += 1;
            console.info(`[connectSrvpro] reconnecting to ${params.ip}, attempt=${reconnectAttempt}`);
            startSocket(true);
          }, delay);
        },
      });

      // initialize the UI Container
      initUIContainer(conn);

      // execute the event looper
      const container = getUIContainer();
      if (params.enableKuriboh) {
        container.setEnableKuriboh(true);
        pollSocketLooperWithAgent(container);
      } else {
        pollSocketLooper(container);
      }

      return conn;
    };

    startSocket(false);
  }
};
