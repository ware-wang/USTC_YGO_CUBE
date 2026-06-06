import { ygopro } from "@/api";
import { Container } from "@/container";
import { showWaiting } from "@/ui/Duel/Message";
import { clearSelectInfo } from "@/ui/Duel/utils";

export default (
  container: Container,
  _wait: ygopro.StocGameMessage.MsgWait,
) => {
  clearSelectInfo();
  for (const card of container.context.cardStore.inner) {
    card.idleInteractivities = [];
  }
  showWaiting(true);
};
