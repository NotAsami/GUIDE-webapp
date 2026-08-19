/**
 * THE icon palette. One list, every editor.
 *
 * There used to be eight of these — the feature editor offered 69 glyphs, the
 * shop editor 12, and the class, race, item, effect, spell and shard editors
 * their own arrays in between. Authoring a class and authoring a feature are
 * the same act with the same vocabulary, so a picker that changes depending on
 * which tab you happen to be in is drift, not design.
 *
 * FONT AWESOME ONLY, deliberately. game-icons.net has a far better fantasy
 * vocabulary, but it ships SVGs rather than an icon font: adopting it means a
 * sprite asset, a second render path everywhere `fa-solid ${icon}` appears, and
 * a prefix migration on every icon value already stored in the catalogs. Logged
 * in docs/GUIDE_Codex_Deferred.md rather than half-done here.
 *
 * Every name below is verified present in the Font Awesome 6 Free SOLID face
 * that index.html loads — checked against the live stylesheet, not from memory.
 * Adding one that only exists in Pro would render an empty box, which looks
 * exactly like a styling bug.
 *
 * Grouped so the picker can show sections; `ICONS` is the flat list for anyone
 * who just wants all of them. Order within a group is by kind, not alphabet —
 * a DM scanning for "a weapon" should find the weapons together.
 */

export type IconGroup = { label: string; icons: readonly string[] }

export const ICON_GROUPS: readonly IconGroup[] = [
  {
    label: 'Combat',
    icons: [
      'fa-shield', 'fa-shield-halved', 'fa-shield-heart', 'fa-shield-cat', 'fa-shield-dog',
      'fa-shield-virus', 'fa-khanda', 'fa-gavel', 'fa-hammer', 'fa-hand-fist', 'fa-hand-back-fist',
      'fa-burst', 'fa-explosion', 'fa-bomb', 'fa-crosshairs', 'fa-bullseye', 'fa-helmet-safety',
      'fa-dumbbell', 'fa-skull-crossbones', 'fa-hands-bound', 'fa-gun', 'fa-person-falling-burst',
      'fa-chess-rook', 'fa-chess-knight', 'fa-chess-king', 'fa-chess-queen', 'fa-chess-pawn',
      'fa-chess-bishop', 'fa-trophy', 'fa-medal', 'fa-award', 'fa-ranking-star',
    ],
  },
  {
    label: 'Magic',
    icons: [
      'fa-hat-wizard', 'fa-wand-sparkles', 'fa-wand-magic', 'fa-wand-magic-sparkles',
      'fa-hand-sparkles', 'fa-fire', 'fa-fire-flame-curved', 'fa-fire-flame-simple',
      'fa-fire-extinguisher', 'fa-bolt', 'fa-bolt-lightning', 'fa-meteor', 'fa-star',
      'fa-star-of-life', 'fa-scroll', 'fa-book', 'fa-book-open', 'fa-book-bible', 'fa-book-skull',
      'fa-book-journal-whills', 'fa-book-atlas', 'fa-book-medical', 'fa-atom', 'fa-flask',
      'fa-flask-vial', 'fa-vial', 'fa-vials', 'fa-mortar-pestle', 'fa-dna', 'fa-brain',
      'fa-eye', 'fa-eye-slash', 'fa-ghost', 'fa-skull', 'fa-spider', 'fa-dragon',
      'fa-hands-praying', 'fa-place-of-worship', 'fa-cross', 'fa-star-and-crescent',
      'fa-star-of-david', 'fa-yin-yang', 'fa-om', 'fa-jedi', 'fa-peace', 'fa-ankh',
      'fa-staff-snake', 'fa-wind', 'fa-tornado', 'fa-cloud-bolt', 'fa-snowflake', 'fa-icicles',
      'fa-droplet', 'fa-water',
    ],
  },
  {
    label: 'Gear',
    icons: [
      'fa-shirt', 'fa-shoe-prints', 'fa-mitten', 'fa-hat-cowboy', 'fa-glasses', 'fa-ring',
      'fa-gem', 'fa-crown', 'fa-key', 'fa-lock', 'fa-lock-open', 'fa-unlock', 'fa-bag-shopping',
      'fa-briefcase', 'fa-suitcase', 'fa-box', 'fa-box-open', 'fa-boxes-stacked', 'fa-sack-dollar',
      'fa-coins', 'fa-money-bill', 'fa-gift', 'fa-toolbox', 'fa-screwdriver-wrench', 'fa-wrench',
      'fa-gear', 'fa-gears', 'fa-anchor', 'fa-compass', 'fa-compass-drafting', 'fa-map',
      'fa-map-location-dot', 'fa-binoculars', 'fa-lightbulb', 'fa-bell', 'fa-drum', 'fa-guitar',
      'fa-music', 'fa-masks-theater', 'fa-palette', 'fa-paintbrush', 'fa-pen-nib', 'fa-feather',
      'fa-feather-pointed', 'fa-scissors', 'fa-puzzle-piece', 'fa-stamp', 'fa-certificate',
    ],
  },
  {
    label: 'Food & Medicine',
    icons: [
      'fa-utensils', 'fa-drumstick-bite', 'fa-bread-slice', 'fa-apple-whole', 'fa-carrot',
      'fa-cheese', 'fa-egg', 'fa-fish', 'fa-bacon', 'fa-pizza-slice', 'fa-mug-hot',
      'fa-wine-bottle', 'fa-wine-glass', 'fa-beer-mug-empty', 'fa-whiskey-glass',
      'fa-bottle-droplet', 'fa-jar', 'fa-prescription-bottle', 'fa-capsules', 'fa-pills',
      'fa-syringe', 'fa-bandage', 'fa-kit-medical', 'fa-heart', 'fa-heart-pulse', 'fa-lungs',
      'fa-bone', 'fa-tooth', 'fa-hand-holding-heart',
    ],
  },
  {
    label: 'Creatures & People',
    icons: [
      'fa-crow', 'fa-dove', 'fa-paw', 'fa-cat', 'fa-dog', 'fa-horse', 'fa-horse-head',
      'fa-fish-fins', 'fa-shrimp', 'fa-frog', 'fa-hippo', 'fa-otter', 'fa-kiwi-bird', 'fa-worm',
      'fa-mosquito', 'fa-locust', 'fa-bugs', 'fa-bug', 'fa-cow', 'fa-virus', 'fa-bacteria',
      'fa-user', 'fa-users', 'fa-user-secret', 'fa-user-tie', 'fa-user-ninja',
      'fa-user-astronaut', 'fa-user-shield', 'fa-people-group', 'fa-child', 'fa-person',
      'fa-person-running', 'fa-person-walking', 'fa-robot', 'fa-mask',
    ],
  },
  {
    label: 'Places & Nature',
    icons: [
      'fa-mountain', 'fa-mountain-sun', 'fa-volcano', 'fa-hill-rockslide', 'fa-tree',
      'fa-tree-city', 'fa-seedling', 'fa-leaf', 'fa-clover', 'fa-house', 'fa-house-chimney',
      'fa-building', 'fa-building-columns', 'fa-church', 'fa-mosque', 'fa-synagogue',
      'fa-vihara', 'fa-torii-gate', 'fa-gopuram', 'fa-hotel', 'fa-shop', 'fa-store',
      'fa-warehouse', 'fa-industry', 'fa-city', 'fa-igloo', 'fa-tent', 'fa-campground',
      'fa-dungeon', 'fa-archway', 'fa-monument', 'fa-landmark', 'fa-ship', 'fa-sailboat',
      'fa-road', 'fa-door-open', 'fa-door-closed', 'fa-stairs', 'fa-tower-observation',
      'fa-globe', 'fa-earth-americas', 'fa-moon', 'fa-sun', 'fa-cloud', 'fa-cloud-moon',
      'fa-cloud-sun', 'fa-rainbow',
    ],
  },
  {
    label: 'States & Conditions',
    icons: [
      'fa-biohazard', 'fa-radiation', 'fa-triangle-exclamation', 'fa-circle-exclamation',
      'fa-ban', 'fa-clock', 'fa-stopwatch', 'fa-hourglass-half', 'fa-hourglass-start',
      'fa-hourglass-end', 'fa-bed', 'fa-volume-xmark', 'fa-ear-deaf', 'fa-ear-listen',
      'fa-hand', 'fa-link', 'fa-link-slash', 'fa-temperature-high', 'fa-temperature-low',
      'fa-weight-hanging', 'fa-gauge', 'fa-gauge-high', 'fa-battery-full', 'fa-battery-half',
      'fa-battery-empty', 'fa-signal', 'fa-wave-square', 'fa-arrows-rotate', 'fa-arrows-spin',
      'fa-shuffle', 'fa-arrow-up-right-dots', 'fa-arrow-down-short-wide', 'fa-angles-up',
      'fa-angles-down', 'fa-arrow-trend-up', 'fa-arrow-trend-down', 'fa-power-off',
    ],
  },
  {
    label: 'Marks & Signals',
    icons: [
      'fa-dice-d20', 'fa-dice-d6', 'fa-dice', 'fa-dice-six', 'fa-diamond', 'fa-circle',
      'fa-square', 'fa-fingerprint', 'fa-id-card', 'fa-address-book', 'fa-envelope',
      'fa-comment', 'fa-comments', 'fa-quote-left', 'fa-bullhorn', 'fa-microphone',
      'fa-microscope', 'fa-magnifying-glass', 'fa-tower-broadcast', 'fa-satellite',
      'fa-satellite-dish', 'fa-cube', 'fa-cubes', 'fa-layer-group', 'fa-network-wired',
      'fa-sitemap', 'fa-diagram-project', 'fa-code-branch', 'fa-terminal', 'fa-microchip',
      'fa-server', 'fa-database', 'fa-hard-drive', 'fa-memory', 'fa-plug', 'fa-handshake',
      'fa-hand-holding', 'fa-hands-holding', 'fa-scale-balanced', 'fa-flag',
      'fa-flag-checkered', 'fa-location-arrow', 'fa-location-dot', 'fa-map-pin', 'fa-route',
      'fa-signs-post',
    ],
  },
] as const

/** Every icon, flat. What a plain picker wants. */
export const ICONS: readonly string[] = ICON_GROUPS.flatMap(g => g.icons)

/* ---------- game-icons.net ---------- */

export const GI_PREFIX = 'gi:'

/** Is this a game-icons value rather than a Font Awesome class? */
export const isGameIcon = (name: string | undefined): boolean => !!name?.startsWith(GI_PREFIX)

/** `gi:lorc/aura` → `/icons/lorc/aura.svg`. Encoded per segment: a couple of
 *  contributor folders and names contain characters that must survive a URL. */
export function gameIconUrl(name: string): string {
  const path = name.slice(GI_PREFIX.length)
  return `/icons/${path.split('/').map(encodeURIComponent).join('/')}.svg`
}

/** The contributor a game icon came from — the credit the licence asks for. */
export const gameIconAuthor = (name: string): string =>
  isGameIcon(name) ? name.slice(GI_PREFIX.length).split('/')[0] ?? '' : ''

/** The bare glyph name, for tooltips and search. */
export const iconLabel = (name: string): string =>
  isGameIcon(name)
    ? (name.slice(GI_PREFIX.length).split('/')[1] ?? '').replace(/-/g, ' ')
    : name.replace(/^fa-/, '').replace(/-/g, ' ')
