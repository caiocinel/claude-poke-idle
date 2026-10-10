// Items, the Poké Mart, gift Pokémon, gyms and trainer classes.

// kind: ball | heal | status | revive | candy | evo | rod | key
export const ITEMS = {
  'poke-ball': { n: 'Poké Ball', kind: 'ball', bonus: 1, price: 200, badge: 0, d: 'A basic ball for catching wild Pokémon.' },
  'great-ball': { n: 'Great Ball', kind: 'ball', bonus: 1.5, price: 600, badge: 1, d: 'Better catch rate than a Poké Ball.' },
  'ultra-ball': { n: 'Ultra Ball', kind: 'ball', bonus: 2, price: 1200, badge: 3, d: 'High catch rate.' },
  'master-ball': { n: 'Master Ball', kind: 'ball', bonus: 0, price: 0, badge: 99, d: 'Catches any wild Pokémon without fail. Reward for the Champion.' },
  potion: { n: 'Potion', kind: 'heal', heal: 20, price: 300, badge: 0, d: 'Restores 20 HP.' },
  'super-potion': { n: 'Super Potion', kind: 'heal', heal: 50, price: 700, badge: 1, d: 'Restores 50 HP.' },
  'hyper-potion': { n: 'Hyper Potion', kind: 'heal', heal: 200, price: 1500, badge: 3, d: 'Restores 200 HP.' },
  'max-potion': { n: 'Max Potion', kind: 'heal', heal: 9999, price: 2500, badge: 5, d: 'Fully restores HP.' },
  'full-heal': { n: 'Full Heal', kind: 'status', price: 600, badge: 1, d: 'Cures any status problem.' },
  'full-restore': { n: 'Full Restore', kind: 'heal', heal: 9999, cure: true, price: 3000, badge: 6, d: 'Fully restores HP and cures status.' },
  revive: { n: 'Revive', kind: 'revive', price: 1500, badge: 2, d: 'Revives a fainted Pokémon with half its HP.' },
  'rare-candy': { n: 'Rare Candy', kind: 'candy', price: 4800, badge: 2, d: 'Raises a Pokémon by one level.' },
  'fire-stone': { n: 'Fire Stone', kind: 'evo', price: 2100, badge: 2, d: 'Evolves certain Pokémon.' },
  'water-stone': { n: 'Water Stone', kind: 'evo', price: 2100, badge: 2, d: 'Evolves certain Pokémon.' },
  'thunder-stone': { n: 'Thunder Stone', kind: 'evo', price: 2100, badge: 2, d: 'Evolves certain Pokémon.' },
  'leaf-stone': { n: 'Leaf Stone', kind: 'evo', price: 2100, badge: 2, d: 'Evolves certain Pokémon.' },
  'moon-stone': { n: 'Moon Stone', kind: 'evo', price: 3000, badge: 1, d: 'Evolves certain Pokémon.' },
  'link-cable': { n: 'Link Cable', kind: 'evo', price: 5000, badge: 4, d: 'Simulates a trade: evolves Kadabra, Machoke, Graveler and Haunter.' },
  'old-rod': { n: 'Old Rod', kind: 'rod', price: 1000, badge: 1, once: true, d: 'Lets your team fish in zones with water.' },
  'good-rod': { n: 'Good Rod', kind: 'rod', price: 5000, badge: 3, once: true, d: 'Fish for better Pokémon.' },
  'super-rod': { n: 'Super Rod', kind: 'rod', price: 15000, badge: 5, once: true, d: 'Fish for the best Pokémon.' },
  'exp-all': { n: 'Exp. All', kind: 'key', price: 25000, badge: 2, once: true, d: 'Benched party members get all the experience, not a third.' },
  'amulet-coin': { n: 'Amulet Coin', kind: 'key', price: 20000, badge: 3, once: true, d: 'Doubles the money won in battles.' },
}

// Gift and trade Pokémon that the wild never offers in Red/Blue
export const GIFT_SHOP = [
  { s: 1, lv: 5, price: 10000, badge: 1, from: "Prof. Oak's lab" },
  { s: 4, lv: 5, price: 10000, badge: 1, from: "Prof. Oak's lab" },
  { s: 7, lv: 5, price: 10000, badge: 1, from: "Prof. Oak's lab" },
  { s: 122, lv: 15, price: 3000, badge: 1, from: 'Trade on Route 2' },
  { s: 83, lv: 15, price: 2000, badge: 2, from: 'Trade in Vermilion' },
  { s: 124, lv: 20, price: 5000, badge: 2, from: 'Trade in Cerulean' },
  { s: 138, lv: 30, price: 6000, badge: 3, from: 'Helix Fossil' },
  { s: 140, lv: 30, price: 6000, badge: 3, from: 'Dome Fossil' },
  { s: 133, lv: 25, price: 5000, badge: 3, from: 'Celadon Mansion' },
  { s: 147, lv: 18, price: 4600, badge: 4, from: 'Game Corner' },
  { s: 137, lv: 18, price: 9999, badge: 4, from: 'Game Corner' },
  { s: 108, lv: 20, price: 4000, badge: 4, from: 'Trade on Route 18' },
  { s: 106, lv: 30, price: 8000, badge: 5, from: 'Fighting Dojo' },
  { s: 107, lv: 30, price: 8000, badge: 5, from: 'Fighting Dojo' },
  { s: 131, lv: 15, price: 8000, badge: 5, from: 'Silph Co.' },
  { s: 142, lv: 30, price: 9000, badge: 6, from: 'Old Amber' },
  { s: 151, lv: 30, price: 99999, badge: 9, from: 'A mysterious truck' },
]

// The eight gyms, then the Elite Four and the Champion as the ninth challenge.
// Each trainer: [name, prize per level, [[species, level], ...]]
export const GYMS = [
  { badge: 'Boulder Badge', city: 'Pewter City', trainers: [['Brock', 99, [[74, 12], [95, 14]]]] },
  { badge: 'Cascade Badge', city: 'Cerulean City', trainers: [['Misty', 99, [[120, 18], [121, 21]]]] },
  { badge: 'Thunder Badge', city: 'Vermilion City', trainers: [['Lt. Surge', 99, [[100, 21], [25, 18], [26, 24]]]] },
  { badge: 'Rainbow Badge', city: 'Celadon City', trainers: [['Erika', 99, [[71, 29], [114, 24], [45, 29]]]] },
  { badge: 'Soul Badge', city: 'Fuchsia City', trainers: [['Koga', 99, [[109, 37], [89, 39], [109, 37], [110, 43]]]] },
  { badge: 'Marsh Badge', city: 'Saffron City', trainers: [['Sabrina', 99, [[64, 38], [122, 37], [49, 38], [65, 43]]]] },
  { badge: 'Volcano Badge', city: 'Cinnabar Island', trainers: [['Blaine', 99, [[58, 42], [77, 40], [78, 42], [59, 47]]]] },
  { badge: 'Earth Badge', city: 'Viridian City', trainers: [['Giovanni', 99, [[111, 45], [51, 42], [31, 44], [34, 45], [112, 50]]]] },
  {
    badge: 'Champion',
    city: 'Indigo Plateau',
    trainers: [
      ['Lorelei', 99, [[87, 54], [91, 53], [80, 54], [124, 56], [131, 56]]],
      ['Bruno', 99, [[95, 53], [107, 55], [106, 55], [95, 56], [68, 58]]],
      ['Agatha', 99, [[94, 56], [42, 56], [93, 55], [24, 58], [94, 60]]],
      ['Lance', 99, [[130, 58], [148, 56], [148, 56], [142, 60], [149, 62]]],
      ['Blue', 99, [[18, 61], [65, 59], [112, 61], [59, 61], [103, 61], [9, 65]]],
    ],
  },
]

export const TRAINER_CLASSES = [
  ['Youngster', 15], ['Bug Catcher', 10], ['Lass', 15], ['Hiker', 35], ['Camper', 20],
  ['Picnicker', 20], ['Super Nerd', 25], ['Gentleman', 70], ['Biker', 20], ['Cooltrainer', 35],
  ['Black Belt', 25], ['Rocket Grunt', 30], ['Channeler', 30], ['Swimmer', 5], ['Fisherman', 35],
]

// What the team finds after a win, by badges earned: [item, weight]
export const PICKUP = [
  ['poke-ball', 30, 0], ['potion', 30, 0], ['great-ball', 15, 2], ['super-potion', 15, 2],
  ['revive', 6, 2], ['full-heal', 8, 1], ['rare-candy', 4, 0], ['moon-stone', 3, 1],
  ['fire-stone', 2, 3], ['water-stone', 2, 3], ['thunder-stone', 2, 3], ['leaf-stone', 2, 3],
  ['ultra-ball', 8, 4], ['hyper-potion', 6, 4], ['max-potion', 3, 6], ['full-restore', 2, 7],
]
