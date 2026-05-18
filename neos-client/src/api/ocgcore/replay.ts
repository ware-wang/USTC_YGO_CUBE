import { YgoProPacket } from "./ocgAdapter/packet";
import { STOC_GAME_MSG } from "./ocgAdapter/protoDecl";

const RECORD_HEADER_LENGTH = 5;

interface ReplayRecord {
  func: number;
  data: ArrayBuffer;
}

export function parseYrp3dRecords(buffer: ArrayBuffer): ReplayRecord[] {
  const records: ReplayRecord[] = [];
  const dataView = new DataView(buffer);
  let offset = 0;

  while (offset < buffer.byteLength) {
    if (offset + RECORD_HEADER_LENGTH > buffer.byteLength) {
      throw new Error("Invalid yrp3d replay: incomplete record header.");
    }

    const func = dataView.getUint8(offset);
    offset += 1;

    const length = dataView.getUint32(offset, true);
    offset += 4;

    if (offset + length > buffer.byteLength) {
      throw new Error("Invalid yrp3d replay: incomplete record data.");
    }

    records.push({
      func,
      data: buffer.slice(offset, offset + length),
    });
    offset += length;
  }

  return records;
}

export function yrp3dToStocGameMsgBuffers(buffer: ArrayBuffer): ArrayBuffer[] {
  return parseYrp3dRecords(buffer)
    .map(recordToStocGameMsgPacket)
    .map((packet) => packet.serialize().buffer as ArrayBuffer);
}

function recordToStocGameMsgPacket(record: ReplayRecord): YgoProPacket {
  const exData = new Uint8Array(1 + record.data.byteLength);
  exData[0] = record.func;
  exData.set(new Uint8Array(record.data), 1);

  return new YgoProPacket(1 + exData.byteLength, STOC_GAME_MSG, exData);
}
