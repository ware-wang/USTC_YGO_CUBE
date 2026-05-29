import { fetchCard, ygopro } from "@/api";
import MsgPosChange = ygopro.StocGameMessage.MsgPosChange;
import { Container } from "@/container";
import { callCardMove } from "@/ui/Duel/PlayMat/Card";

import { fetchEsHintMeta } from "./util";

export default async (container: Container, posChange: MsgPosChange) => {
  const context = container.context;
  const { location, controller, sequence } = posChange.card_info;

  const target = context.cardStore.at(location, controller, sequence);
  if (target) {
    if (posChange.card_info.code > 0) {
      target.code = posChange.card_info.code;
      target.meta = fetchCard(posChange.card_info.code);
    }
    target.location.position = posChange.cur_position;
    target.revealed =
      posChange.card_info.code > 0 && isFaceUp(posChange.cur_position);

    // TODO: 暂时用`Move`动画，后续可以单独实现一个改变表示形式的动画
    await callCardMove(target.uuid);
  } else {
    console.warn(`<PosChange>target from ${posChange.card_info} is null`);
  }

  fetchEsHintMeta({
    context,
    originMsg: 1600,
  });
};

function isFaceUp(position: ygopro.CardPosition): boolean {
  return (
    position === ygopro.CardPosition.FACEUP ||
    position === ygopro.CardPosition.FACEUP_ATTACK ||
    position === ygopro.CardPosition.FACEUP_DEFENSE
  );
}
