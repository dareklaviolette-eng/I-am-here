// I'M HERE Travel Desk · Yosemite field guide (EFB-style panel). Text-only cards: no photos yet (Wikimedia Commons
// licences could not be verified from the build sandbox; add { photo: { src, credit, licence, href } } per species once
// they are). Facts: National Park Service (nps.gov/yose), US Fish & Wildlife Service, California Dept. of Fish and Wildlife.
export const SPECIES = {
  'black-bear': {
    name: 'American black bear', sci: 'Ursus americanus', kind: 'Mammal',
    text: 'The only bear in Yosemite; despite the name, many are brown or cinnamon. The park estimates 300 to 500 live here. Bears that get human food become bold, so food storage is required.',
    look: 'Meadow edges and forests, from the valley to the high country.',
  },
  'mule-deer': {
    name: 'Mule deer', sci: 'Odocoileus hemionus', kind: 'Mammal',
    text: 'The large mammal visitors see most, named for its big, mule-like ears. Deer graze the meadows at dawn and dusk and move upslope in summer.',
    look: 'Valley meadows (Cook\'s and El Capitan Meadows), Tuolumne Meadows.',
  },
  peregrine: {
    name: 'Peregrine falcon', sci: 'Falco peregrinus', kind: 'Bird',
    text: 'The fastest animal on Earth, diving at more than 200 mph. The pesticide DDT nearly wiped peregrines out of Yosemite by the 1970s; after the ban and recovery work, pairs nest on the big walls again. Climbing routes near nests close in spring and summer.',
    look: 'High cliffs: El Capitan, Glacier Point, Taft Point.',
  },
  bighorn: {
    name: 'Sierra Nevada bighorn sheep', sci: 'Ovis canadensis sierrae', kind: 'Mammal', status: 'Endangered (federal, since 2000)',
    text: 'One of the rarest mammals in North America. Biologists reintroduced a herd to Yosemite\'s Cathedral Range in 2015 and track the sheep with GPS collars. They live high on rocky slopes, above the trees.',
    look: 'The Sierra crest east of Tuolumne Meadows, near Tioga Pass.',
  },
  'stellers-jay': {
    name: 'Steller\'s jay', sci: 'Cyanocitta stelleri', kind: 'Bird',
    text: 'A loud, crested, deep-blue jay with a black head. It mimics other birds, including the red-tailed hawk, and is quick to visit picnic tables.',
    look: 'Conifer forests and campgrounds throughout the park.',
  },
  'fence-lizard': {
    name: 'Western fence lizard', sci: 'Sceloporus occidentalis', kind: 'Reptile',
    text: 'The "blue-belly": males flash blue patches on the belly and do push-ups on warm rocks. A protein in its blood kills the Lyme disease bacterium in ticks that feed on it.',
    look: 'Sunny rocks and logs at low and middle elevations.',
  },
  pika: {
    name: 'American pika', sci: 'Ochotona princeps', kind: 'Mammal',
    text: 'A small, round-eared relative of rabbits. Pikas do not hibernate: all summer they gather grass into "haypiles" to eat in winter. They are sensitive to heat, so they live high, among cool rocks.',
    look: 'Talus (rock piles) above about 8,000 feet: Tuolumne, Tioga Pass. Listen for a sharp "eeep".',
  },
  sequoia: {
    name: 'Giant sequoia', sci: 'Sequoiadendron giganteum', kind: 'Tree',
    text: 'The largest trees on Earth by volume, growing naturally only on the western slope of the Sierra Nevada. Thick, spongy bark resists fire, and fire helps their cones open and clears the soil for seedlings.',
    look: 'Yosemite\'s three groves: Mariposa, Tuolumne and Merced.',
  },
};
export const SPECIES_ORDER = ['black-bear', 'mule-deer', 'peregrine', 'bighorn', 'stellers-jay', 'fence-lizard', 'pika', 'sequoia'];
