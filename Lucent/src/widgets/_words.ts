export const WORDS: string[] = `
serendipity ephemeral luminous petrichor sonder eloquent ubiquitous quixotic mellifluous ineffable
labyrinth solitude resilient ethereal halcyon nefarious pragmatic sycophant vicarious zenith
anomaly benevolent cacophony debonair efficacious fastidious gregarious hubris idyllic juxtapose
kismet languid magnanimous nostalgia obfuscate pensive quintessential reverie surreptitious tenacious
umbra vivacious whimsical xenial yearn zealous alacrity brevity candor diligent ebullient
facetious garrulous harbinger imminent jubilant kindle lethargic meticulous nebulous oblivion
paradigm quagmire resplendent solace trepidation unwavering verdant wistful exemplary placid
ardent bucolic capricious deft enigma fortitude gossamer heirloom incandescent jovial
lucid mirth nuance opulent panacea quell raconteur sagacious tranquil usurp
venerable wanderlust yonder zephyr aplomb beguile cogent dulcet effervescent felicity
gambol hallowed iconoclast jocund kaleidoscope lilt mercurial nonchalant ostensible perspicacious
quaint ruminate sanguine taciturn unctuous vindicate winsome exuberant yore zeitgeist
abstruse bellwether circumspect denouement equanimity forthright gallivant harangue impetuous judicious
laconic mendacious nadir ominous perfunctory querulous recalcitrant stoic truculent ulterior
vexatious wry xenophile yoke zany acumen bombastic clandestine dichotomy erudite
fervent grandiloquent histrionic insidious jargon kudos lugubrious maverick nonpareil obstinate
paragon quixotic redolent salient timorous unfathomable vestige wane axiom boisterous
cryptic dormant elusive florid glib hapless inscrutable jaunty keen lavish
morose nimble obsolete placate quip rancor staunch tenuous upbeat vigilant
whet yen zest amiable brazen cajole dapper earnest frugal gaudy hearty
indolent jilt knack loquacious mundane naive oblique plucky quirk rustic
serene tedious undulate vapid wily yield zany ample blithe candid
dismal elate flippant genial hardy infer jocose kinetic limpid mellow
nascent ornate prudent quiver robust sleek tawdry unruly vivid wield
anecdote brisk crisp dwindle eerie frail glimmer hush idle jest
kernel linger murmur nestle ponder quaver ripple shimmer thrive unravel
valiant wither yearning zigzag adorn bask cradle dazzle embark flourish
gleam hover inkling jumble kin lull meander nudge oasis perch
quest rustle savor tinge unfurl vista whisper wander yawn zeal
`.split(/\s+/).filter(Boolean).filter((w, i, a) => a.indexOf(w) === i);

export const dayNumber = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86_400_000);
export const wordOf = (d = new Date()) => WORDS[((dayNumber(d) % WORDS.length) + WORDS.length) % WORDS.length];
