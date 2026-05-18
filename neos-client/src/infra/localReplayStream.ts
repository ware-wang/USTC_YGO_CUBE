import { sleep } from "./sleep";

const DEFAULT_REPLAY_INTERVAL_MS = 10;

class LocalReplaySocket {
  binaryType: BinaryType = "arraybuffer";
  readyState: number = WebSocket.OPEN;

  send(_data: Parameters<WebSocket["send"]>[0]) {
    return undefined;
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }
}

export class LocalReplayStream {
  public ws: WebSocket;
  stream: ReadableStream;

  constructor(
    private readonly messages: ArrayBuffer[],
    private readonly intervalMs = DEFAULT_REPLAY_INTERVAL_MS,
  ) {
    this.ws = new LocalReplaySocket() as unknown as WebSocket;
    this.stream = new ReadableStream();
  }

  async execute(onMessage: (event: MessageEvent) => Promise<void>) {
    for (const data of this.messages) {
      if (this.isClosed()) return;

      await sleep(this.intervalMs);
      if (this.isClosed()) return;

      await onMessage(new MessageEvent("message", { data }));
    }

    this.close();
  }

  close() {
    this.ws.close();
  }

  isClosed(): boolean {
    return this.ws.readyState === WebSocket.CLOSED;
  }
}
