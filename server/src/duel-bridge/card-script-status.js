import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cardDB } from '../card-db/index.js';

const TYPE_MONSTER = 0x1;
const TYPE_NORMAL = 0x10;
const TYPE_EFFECT = 0x20;
const TYPE_FUSION = 0x40;
const TYPE_SYNCHRO = 0x2000;
const TYPE_XYZ = 0x800000;
const TYPE_PENDULUM = 0x1000000;
const TYPE_LINK = 0x4000000;
const EXTRA_DECK_TYPES = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

export function getCardScriptStatus(code, scriptPath) {
  const id = Number.parseInt(code, 10);
  const card = Number.isFinite(id) && id > 0 ? cardDB.getCardFull(id) : null;
  const hasScript = !!scriptPath && existsSync(join(scriptPath, `c${id}.lua`));
  const scriptRequired = card ? cardRequiresLuaScript(card.type) : true;

  return {
    id,
    name: card?.name || '',
    type: card?.type || 0,
    existsInDb: !!card,
    hasScript,
    scriptRequired,
    loadable: !!card && (hasScript || !scriptRequired),
  };
}

export function cardRequiresLuaScript(type = 0) {
  if (isPureMainDeckNormalMonster(type)) return false;
  return true;
}

function isPureMainDeckNormalMonster(type) {
  return (
    (type & TYPE_MONSTER) > 0 &&
    (type & TYPE_NORMAL) > 0 &&
    (type & TYPE_EFFECT) === 0 &&
    (type & TYPE_PENDULUM) === 0 &&
    (type & EXTRA_DECK_TYPES) === 0
  );
}
