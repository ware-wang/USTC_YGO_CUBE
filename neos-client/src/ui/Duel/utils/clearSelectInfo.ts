import { cardStore, matStore } from "@/stores";

export function clearSelectInfo() {
  for (const card of cardStore.inner) {
    card.selectInfo.selectable = false;
    card.selectInfo.selected = false;
    card.selectInfo.response = undefined;
  }

  matStore.selectUnselectInfo.finishable = false;
  matStore.selectUnselectInfo.cancelable = false;
  matStore.selectUnselectInfo.selectableList = [];
  matStore.selectUnselectInfo.selectedList = [];
}
