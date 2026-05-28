import { useConfig } from "@/config";

const {
  preReleaseResource: { config },
} = useConfig();

interface SuperPreInfo {
  /* only use id currently, other fields see:
   * https://cdn02.moecube.com:444/ygopro-super-pre/data/test-release-v2.json
   * */
  id: number;
}

let superPreList: SuperPreInfo[] = [];

export async function initSuperPrerelease() {
  const json = await (await fetch(config)).text();
  const parsed = JSON.parse(json);
  superPreList = Array.isArray(parsed) ? parsed : [];
}

export function isSuperReleaseCard(code: number): boolean {
  if (!Array.isArray(superPreList) || superPreList.length === 0)
    console.warn("Super pre release config has not been initialized!");
  return Array.isArray(superPreList) && superPreList.find(({ id }) => id === code) !== undefined;
}
