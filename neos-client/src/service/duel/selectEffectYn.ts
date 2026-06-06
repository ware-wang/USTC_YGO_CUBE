import { fetchStrings, getEffectDescription, Region, type ygopro } from "@/api";
import { CardMeta, fetchCard } from "@/api/cards";
import { displayYesNoModal } from "@/ui/Duel/Message";

type MsgSelectEffectYn = ygopro.StocGameMessage.MsgSelectEffectYn;

// 这里改成了 async 不知道有没有影响
export default async (selectEffectYn: MsgSelectEffectYn) => {
  const code = selectEffectYn.code;
  const location = selectEffectYn.location;
  const effect_description = selectEffectYn.effect_description;

  const textGenerator =
    effect_description === 0 || effect_description === 221
      ? (
          desc: string,
          cardMeta: CardMeta,
          cardLocation: ygopro.CardLocation,
        ) => {
          const desc1 = desc.replace(
            `[%ls]`,
            fetchStrings(Region.System, cardLocation.zone + 1000),
          );
          const desc2 = desc1.replace(`[%ls]`, cardMeta.text.name || "[?]");
          return desc2;
        }
      : (desc: string, cardMeta: CardMeta, _: ygopro.CardLocation) => {
          const desc1 = desc.replace(`[%ls]`, cardMeta.text.name || "[?]");
          return desc1;
        };

  // TODO: 国际化文案

  const meta = fetchCard(code);
  const fallback = meta.text.name
    ? `是否发动「${meta.text.name}」的效果？`
    : "是否发动效果？";
  const desc =
    effect_description === 0
      ? fetchStrings(Region.System, 200)
      : effect_description === 221
      ? fetchStrings(Region.System, 221)
      : getEffectDescription(effect_description, fallback);
  await displayYesNoModal(textGenerator(desc, meta, location));
};
