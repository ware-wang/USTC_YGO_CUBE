import { useConfig } from "@/config";

import { fetchCard, getCardStr } from "./cards";

let { stringsUrl } = useConfig();
export const DESCRIPTION_LIMIT = 10000;

export async function initStrings() {
  const language = localStorage.getItem("language") || "cn";

  //It currently only supports en-US, es-ES, ja-JP, ko-KR, zh-CN
  switch (language) {
    case "en":
    case "br":
    case "pt":
    case "fr":
      stringsUrl = stringsUrl.replace("zh-CN", "en-US");
      break;
    case "ja":
      stringsUrl = stringsUrl.replace("zh-CN", "ja-JP");
      break;
    case "es":
      stringsUrl = stringsUrl.replace("zh-CN", "es-ES");
      break;
    case "ko":
      stringsUrl = stringsUrl.replace("zh-CN", "ko-KR");
      break;
    default:
      break;
  }

  const response = await fetch(stringsUrl);
  if (!response.ok) {
    console.warn(`[strings] Failed to load ${stringsUrl}: ${response.status}`);
    return;
  }
  const strings = await response.text();

  const lineIter = strings.split("\n");
  for (const line of lineIter) {
    const parsed = parseStringLine(line);
    if (!parsed) continue;
    const { region, code, value } = parsed;
    try {
      localStorage.setItem(`${region}_${code}`, value);
    } catch (error) {
      alert(`set item in local storage error: ${error}`);
      break;
    }
  }
}

export enum Region {
  System = "!system",
  Victory = "!victory",
  Counter = "!counter",
}

export function fetchStrings(region: Region, id: string | number): string {
  const key = `${region}_${id}`;
  const value = localStorage.getItem(key);
  if (value && value !== "?") return value;
  return FALLBACK_STRINGS[key] ?? `系统提示 ${id}`;
}

export function getStrings(description: number): string {
  if (description < DESCRIPTION_LIMIT) {
    return fetchStrings(Region.System, description);
  } else {
    const code = description >> 4;
    const index = description & 0xf;

    return getCardStr(fetchCard(code), index) ?? "[?]";
  }
}

export function isMissingString(text?: string): boolean {
  return !text || text === "?" || text === "[?]" || text === "[:?]";
}

export function getEffectDescription(
  description?: number,
  fallback = "发动效果",
): string {
  if (!description) return fallback;
  const text = getStrings(description);
  return isMissingString(text) ? fallback : text;
}

function parseStringLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = /^(\S+)\s+(\S+)\s*(.*)$/.exec(trimmed);
  if (!match) return null;

  const [, region, code, value] = match;
  return { region, code, value };
}

const FALLBACK_STRINGS: Record<string, string> = {
  "!system_20": "抽卡阶段",
  "!system_21": "准备阶段",
  "!system_22": "主要阶段",
  "!system_24": "战斗阶段",
  "!system_26": "结束阶段",
  "!system_28": "战斗阶段开始",
  "!system_29": "战斗步骤",
  "!system_40": "伤害步骤",
  "!system_42": "伤害计算",
  "!system_60": "反面",
  "!system_61": "正面",
  "!system_102": "我方",
  "!system_103": "对方",
  "!system_200": "是否发动[%ls]的「[%ls]」的效果？",
  "!system_203": "是否发动卡片或效果？",
  "!system_212": "已选择",
  "!system_221": "是否发动[%ls]的「[%ls]」的效果？",
  "!system_556": "请选择要发动的效果",
  "!system_562": "请选择要宣言的属性",
  "!system_563": "请选择要宣言的种族",
  "!system_565": "请选择要宣言的数字",
  "!system_569": "请选择「[%ls]」要放置的位置",
  "!system_1000": "卡组",
  "!system_1001": "手牌",
  "!system_1002": "怪兽区",
  "!system_1003": "魔法与陷阱区",
  "!system_1004": "墓地",
  "!system_1005": "除外",
  "!system_1006": "额外卡组",
  "!system_1007": "场上",
  "!system_1008": "场地区",
  "!system_1009": "灵摆区",
  "!system_1010": "地",
  "!system_1011": "水",
  "!system_1012": "炎",
  "!system_1013": "风",
  "!system_1014": "光",
  "!system_1015": "暗",
  "!system_1016": "神",
  "!system_1020": "战士族",
  "!system_1021": "魔法师族",
  "!system_1022": "天使族",
  "!system_1023": "恶魔族",
  "!system_1024": "不死族",
  "!system_1025": "机械族",
  "!system_1026": "水族",
  "!system_1027": "炎族",
  "!system_1028": "岩石族",
  "!system_1029": "鸟兽族",
  "!system_1030": "植物族",
  "!system_1031": "昆虫族",
  "!system_1032": "雷族",
  "!system_1033": "龙族",
  "!system_1034": "兽族",
  "!system_1035": "兽战士族",
  "!system_1036": "恐龙族",
  "!system_1037": "鱼族",
  "!system_1038": "海龙族",
  "!system_1039": "爬虫类族",
  "!system_1040": "念动力族",
  "!system_1041": "幻神兽族",
  "!system_1042": "创造神族",
  "!system_1043": "幻龙族",
  "!system_1044": "电子界族",
  "!system_1050": "怪兽",
  "!system_1051": "魔法",
  "!system_1052": "陷阱",
  "!system_1054": "通常",
  "!system_1055": "效果",
  "!system_1056": "融合",
  "!system_1057": "仪式",
  "!system_1058": "陷阱怪兽",
  "!system_1059": "灵魂",
  "!system_1060": "同盟",
  "!system_1061": "二重",
  "!system_1062": "调整",
  "!system_1063": "同调",
  "!system_1064": "衍生物",
  "!system_1066": "速攻",
  "!system_1067": "永续",
  "!system_1068": "装备",
  "!system_1069": "场地",
  "!system_1070": "反击",
  "!system_1071": "反转",
  "!system_1072": "卡通",
  "!system_1073": "超量",
  "!system_1074": "灵摆",
  "!system_1075": "特殊召唤",
  "!system_1076": "连接",
  "!system_1150": "发动效果",
  "!system_1151": "召唤",
  "!system_1152": "特殊召唤",
  "!system_1153": "盖放",
  "!system_1154": "反转召唤",
  "!system_1157": "攻击",
  "!system_1340": "是否返回房间？",
  "!system_1390": "等待对方操作...",
  "!system_1403": "无法加入房间",
  "!system_1404": "房间已满",
  "!system_1405": "房间不存在",
  "!system_1406": "卡组不合法",
  "!system_1407": "密码错误",
  "!system_1408": "无法开始对战",
  "!system_1500": "决斗结束",
  "!system_1600": "「[?]」改变表示形式时",
  "!system_1601": "卡片盖放时",
  "!system_1602": "控制权交换时",
  "!system_1604": "召唤成功时",
  "!system_1606": "特殊召唤成功时",
  "!system_1608": "反转召唤成功时",
  "!system_1623": "投掷硬币：",
  "!system_1624": "掷骰子：",
  "!victory_0x0": "决斗胜利",
  "!victory_0x1": "对方投降",
  "!victory_0x2": "对方连接断开",
};
