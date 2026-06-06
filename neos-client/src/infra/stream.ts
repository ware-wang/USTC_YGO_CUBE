// web平台上websocket的消息到达是保序的，但是不能保证对这些消息的逻辑处理是保序的。
// 现在我们有这样一个需求：需要保证每次只处理一个消息，在上一个消息处理完后，再进行下一个消息的处理。
//
// 因此封装了一个`WebSocketStream`类，当每次Websocket连接中有消息到达时，往流中添加event，

// 同时执行器会不断地从流中获取event进行处理。
export type WebSocketStreamOptions = {
  onClose?: (conn: WebSocketStream, ev: CloseEvent) => void;
  onError?: (conn: WebSocketStream, ev: Event) => void;
  suppressErrorAlert?: boolean;
};

export class WebSocketStream {
  public ws: WebSocket;
  stream: ReadableStream;
  private closedByClient = false;

  constructor(
    ip: string,
    onWsOpen?: (conn: WebSocketStream, ev: Event) => any,
    options: WebSocketStreamOptions = {},
  ) {
    const target = resolveWebSocketTarget(ip);
    this.ws = new WebSocket(target);
    if (onWsOpen) {
      this.ws.onopen = (e) => onWsOpen(this, e);
    }
    this.ws.onerror = (e) => {
      options.onError?.(this, e);
      if (!options.suppressErrorAlert) {
        if (e instanceof ErrorEvent) {
          alert(`websocket error: ${e.message}`);
        } else {
          alert(`websocket connect to ${ip} error`);
        }
      }
    };

    const ws = this.ws;
    const conn = this;
    this.stream = new ReadableStream({
      start(controller) {
        // 当Websocket有数据到达时，加入队列
        ws.onmessage = (event) => {
          controller.enqueue(event);
        };
        ws.onclose = (ev) => {
          // 后续可能根据断线原因做处理，先暴露出来
          console.info("Websocket closed.", ev);
          try {
            controller.close();
          } catch (_) {
            // The stream may already be closed if the browser reports close twice.
          }
          options.onClose?.(conn, ev);
        };
      },
      pull(_) {
        // currently not really need
      },
      cancel() {
        // currently not
      },
    });
  }

  // 异步地从Websocket中获取数据并处理
  async execute(onMessage: (event: MessageEvent) => Promise<void>) {
    const reader: ReadableStreamDefaultReader<MessageEvent> =
      this.stream.getReader();
    const ws = this.ws;

    reader.read().then(async function process({ done, value }): Promise<void> {
      if (done) {
        if (ws.readyState === WebSocket.CLOSED) {
          // websocket connection has been closed
          console.info("WebSocket closed, stream complete.");

          return;
        } else {
          // websocket not closed, handle next message from server
          await reader.read().then(process);
        }
      }

      if (value) {
        // wait some time, and then handle message from server
        //
        // but now it seems that we don't need wait any more,
        // so comment the following line and check if it's ok without it.
        //
        await onMessage(value);
      } else {
        console.warn("value from ReadableStream is undefined!");
      }

      // read some more, and call process function again
      await reader.read().then(process);
    });
  }

  // 关闭流
  close() {
    this.closedByClient = true;
    this.ws.close(1000);
  }

  isClosed(): boolean {
    return this.ws.readyState === WebSocket.CLOSED;
  }

  isClosedByClient(): boolean {
    return this.closedByClient;
  }
}

function resolveWebSocketTarget(ip: string): string {
  if (/^wss?:\/\//i.test(ip)) {
    return ip;
  }

  const scheme = window.location.protocol === "https:" ? "wss://" : "ws://";
  return `${scheme}${ip}`;
}
