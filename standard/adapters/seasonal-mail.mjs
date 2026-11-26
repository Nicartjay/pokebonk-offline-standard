// Build-time catalog review, never a grant based on guessed frame filenames.
import {parse} from "acorn";
import {nodesOf,literal,maybeName,one,edits} from "../../scripts/source.ts";
import {SEASONAL_MAIL_POLICY,currentSeason} from "../common/seasonal-mail.mjs";
const prop = (node, key) => node?.properties?.find(value => maybeName(value.key) === key)?.value;
const parseModule = source => parse(source, {ecmaVersion: "latest", sourceType: "module"});
function catalogRows(tree) {
  const avatars = one(nodesOf(tree, "ArrayExpression", node =>
    ["pioneer", "professor", "safariranger"].every(id => node.elements.some(value =>
      literal(prop(value, "id")) === id))), "seasonal trainer-avatar catalog");
  const rows = new Map();
  for (const season of SEASONAL_MAIL_POLICY.seasons.filter(season => season.gift)) {
    for (const reward of season.gift.rewards) {
      const nodes = reward.id.startsWith("tr:") ? avatars.elements.filter(node =>
        literal(prop(node, "id")) === reward.id.slice(3)) :
        nodesOf(tree, "ObjectExpression", node => literal(prop(node, "id")) === reward.id);
      const row = one(nodes, "reviewed seasonal cosmetic " + reward.id);
      if (!prop(row, "how") || !prop(row, "name")) throw Error("Unsupported seasonal reward metadata.");
      rows.set(reward.id, {row, season: season.number});
    }
  }
  // Catch newly added explicit seasonal personal rewards, instead of silently
  // shipping an incomplete "all seasons 1–4" archive after an upstream update.
  const seasonText = node => {
    const how = prop(node, "how");
    return literal(how) ?? (how?.type === "CallExpression" ? literal(how.arguments[0]) : "");
  };
  for (const row of nodesOf(tree, "ObjectExpression")) {
    const id = literal(prop(row, "id"));
    if (typeof id !== "string") continue;
    const tagged = /^(?:frame|title):s([1-9]\d*)(?:$|[a-z-])/.exec(id);
    const description = /(?:Temporada|Season) ([1-9]\d*)(?:\D|$)/.exec(seasonText(row) ?? "");
    const namedSeason = tagged ? +tagged[1] : description ? +description[1] : literal(prop(row, "season"));
    const avatar = avatars.elements.includes(row);
    const personal = avatar || /^(?:frame|title|tr|bg|look):/.test(id) ||
      ["frame", "title", "avatar", "banner", "look"].includes(literal(prop(row, "kind")));
    if (personal && Number.isInteger(namedSeason) && namedSeason > 0 &&
        namedSeason <= SEASONAL_MAIL_POLICY.archiveThrough && !rows.has(avatar ? "tr:" + id : id)) {
      throw Error(`Unreviewed Season ${namedSeason} personal cosmetic: ${id}. Extend the offline archive.`);
    }
  }
  return rows;
}
export function requireSeasonalCatalog(configSource, cosmeticsSource) {
  const tree = parseModule(configSource);
  const gate = one(nodesOf(tree, "ObjectExpression", node =>
    ["season", "maxDex", "nextDex", "biomes", "next"].every(key => prop(node, key))),
  "bundled season/content gate");
  if (literal(prop(gate, "season")) !== currentSeason().number) {
    throw Error("The bundled season changed. Review offline seasonal gifts before preparation.");
  }
  catalogRows(parseModule(cosmeticsSource));
}
export function patchSeasonalCosmeticCatalog(source) {
  const rows = catalogRows(parseModule(source));
  return edits(source, [...rows.values()].map(({row, season}) => ({
    ...prop(row, "how"),
    text: JSON.stringify(`Offline Mailbox · Season ${season} archive gift. Cosmetic only; no online rank or clan membership.`),
  })));
}
