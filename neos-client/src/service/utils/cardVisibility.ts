import { type CardMeta, ygopro } from "@/api";
import { type CardType, isMe } from "@/stores";

const { DECK, EXTRA, HAND, MZONE, REMOVED, SZONE, TZONE } = ygopro.CardZone;
const { FACEDOWN, FACEDOWN_ATTACK, FACEDOWN_DEFENSE } = ygopro.CardPosition;

const HIDDEN_META: CardMeta = {
  id: 0,
  data: {},
  text: {
    name: "",
    desc: "",
  },
};

interface CardLike
  extends Partial<Pick<CardType, "code" | "location" | "meta" | "revealed">> {}

export function isCardVisibleToCurrentPlayer(card: CardLike): boolean {
  const location = card.location;
  if (!location) return true;
  if (card.revealed) return true;
  if (isMe(location.controller)) return true;

  if (location.zone === HAND || location.zone === DECK) return false;
  if (location.zone === EXTRA && isFaceDown(location.position)) return false;
  if (location.zone === REMOVED && isFaceDown(location.position)) return false;

  if (
    (location.zone === MZONE ||
      location.zone === SZONE ||
      location.zone === TZONE) &&
    isFaceDown(location.position)
  ) {
    return false;
  }

  return true;
}

export function getVisibleCardMeta(card: CardLike): CardMeta {
  if (!isCardVisibleToCurrentPlayer(card)) return HIDDEN_META;
  return card.meta ?? HIDDEN_META;
}

export function getVisibleCardId(card: CardLike): number {
  if (!isCardVisibleToCurrentPlayer(card)) return 0;
  return card.code || card.meta?.id || 0;
}

function isFaceDown(position?: ygopro.CardPosition): boolean {
  return (
    position === FACEDOWN ||
    position === FACEDOWN_ATTACK ||
    position === FACEDOWN_DEFENSE
  );
}
