// Reviewed, bundled challenge entry points. "live" below is only the engine's
// availability gate, not an online event, server clock or claim window.
export const OFFLINE_EVENTS = Object.freeze([
  Object.freeze({
    id: "rush26", mode: "bossrush", biome: "newisland",
    name: "Mewtwo Strikes Back", color: "#8a3aff", icon: "rush-trophy",
    tile: "assets/ui/events/rush-card.jpg", header: "assets/ui/events/rush.jpg",
    description: "Face five cloned bosses on New Island. Preparation and combat both count: finish as quickly as you can.",
    rules: [
      "Choose a Pokémon you have earned in your League.",
      "Prepare between fights and defeat all five bosses, including Mewtwo.",
      "The original weekly boss rotation is calculated on this device.",
      "One-session challenge: this mode cannot be suspended.",
    ],
  }),
  Object.freeze({
    id: "halloween26", mode: "tower", biome: "graveyard",
    name: "Lavender Tower", color: "#9a6aff", icon: "torre",
    tile: "assets/ui/events/tower-card.jpg", header: "assets/ui/events/tower.jpg",
    description: "Climb the haunted Pokémon Tower, reveal ghosts with the Silph Scope, and continue into the endless Beyond.",
    rules: [
      "Clear three ghost waves to open the stairs on each floor.",
      "Use the Silph Scope, light candles, and choose an offering.",
      "Calm Marowak on floor six and defeat Gengar at the top.",
      "One-session challenge: this mode cannot be suspended.",
    ],
  }),
]);
export const isEventMode = mode => OFFLINE_EVENTS.some(event => event.mode === mode);
export const localEvents = () => OFFLINE_EVENTS.map(event => ({
  id: event.id, mode: event.mode, biome: event.biome, name: event.name,
  local: true, offline: true, live: true, claimable: true,
  start: 0, end: 8640000000000000,
}));
export const MODE_NAMES = Object.freeze({
  standard: "Classic", endless: "Endless", relay: "Relay",
  mutation: "Daily Mutation", bossrush: "Boss Rush", tower: "Lavender Tower",
});
export const BIOME_NAMES = Object.freeze({
  wilds:"Wild Valley",safari:"Safari Zone",
  forest: "Viridian Forest", desert: "Rocky Desert", coast: "Storm Coast",
  glacier: "Celestial Glacier", canela: "Cinnabar Island", crater: "Cinnabar Island", cave: "Cerulean Cave",
  encina: "Ilex Forest", iris: "Ecruteak City", plateado: "Mt. Silver",
  furia: "Lake of Rage", newisland: "New Island", graveyard: "Lavender Tower",
});
