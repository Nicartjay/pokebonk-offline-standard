// Keep the original illustrated, keyboard/touch-navigable trainer guide.
// Its data pages are filtered before rendering, rather than hidden with CSS.
import {nodesOf, literal, maybeName, one, edits} from "../../scripts/source.ts";
const property = (node, key) => node?.properties?.find(item => maybeName(item.key) === key)?.value;
const title = node => literal(property(node, "title")?.arguments?.[0]);
const offlineCopy = new Map([
  ["**Guardar y salir** (solo en un momento tranquilo): continúas otro día, en cualquier dispositivo, hasta 14 días después.",
    "**Save and quit** preserves a Classic or Endless checkpoint on this device. Export a backup to transfer it. Relay and event challenges are one-session runs."],
  ["Sin zonas ni portales: **una horda que no para**. ¿Cuánto aguantas? Tiene su propia clasificación, por tiempo.",
    "No zones or portals: **an endless horde**. Your longest run is saved in Personal Records → Survival."],
  ["Una partida clásica con **un giro distinto cada día**, igual para todos: mismo mapa, misma semilla y su propia dificultad. Cuenta tu **mejor partida del día**.",
    "A Classic run with **different rules each day**, using an on-device daily map and seed. Earn milestone rewards and improve your own daily best."],
  ["No hace falta tener el mapa desbloqueado. Sin Mochila ni cooperativo.",
    "You do not need to unlock the map first. No Backpack; single-player only."],
  ["Eventos de temporada", "Offline events"],
  ["Comparte tus builds y prueba las de otros entrenadores.",
    "Save your own builds locally and switch plans before a run."],
  ["Los objetos de la **Mochila** se llevan a una partida y se gastan al usarlos. Los ganas en los Encargos, los logros, los clanes y los Tesoros, o los compras en la **Tienda**.",
    "**Backpack** items are consumed when taken into a run. Earn them from Tasks, achievements, event passes and Treasures, or buy them in the **Shop**."],
  ["Tu **título** se ve bajo tu nombre en el menú y en la clasificación.",
    "Choose your earned **titles**, frames and avatar in Appearance. All rewards and records stay in your local save."],
]);
export function patchGuidePages(source, owner) {
  const pages = one(nodesOf(owner, "ArrayExpression", node =>
    node.elements.some(item => property(item, "ch") && property(item, "art"))), "illustrated guide pages");
  const kept = pages.elements.filter(page => literal(property(page, "ch")) < 7 && title(page) !== "Cooperativo" ||
    title(page) === "¡Ya estás listo!");
  const replacements = [];
  const content = kept.map(page => {
    const changes = nodesOf(page, "Literal").concat(nodesOf(page, "TemplateLiteral"))
      .filter(node => offlineCopy.has(literal(node))).map(node => ({start: node.start - page.start,
        end: node.end - page.start, text: JSON.stringify(offlineCopy.get(literal(node)))}));
    if (title(page) === "¡Ya estás listo!") {
      const chapter = property(page, "ch");
      changes.push({start: chapter.start - page.start, end: chapter.end - page.start, text: "6"});
    }
    let text = source.slice(page.start, page.end);
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, change.start) + change.text + text.slice(change.end);
    }
    return text; // The complete function is parsed below, with its object context.
  });
  replacements.push({start: pages.start - owner.start, end: pages.end - owner.start, text: "[" + content.join(",") + "]"});
  return edits(source.slice(owner.start, owner.end), replacements);
}
