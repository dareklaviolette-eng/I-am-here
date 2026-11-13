// I'M HERE Travel Desk · Swiss Alps field guide (EFB-style panel). Text-only cards: no photos yet (licences could not be
// verified from the build sandbox; add { photo: { src, credit, licence, href } } per species once they are).
// Facts: Swiss National Park, Vulture Conservation Foundation, swissinfo.ch, Swiss Ornithological Institute.
export const SPECIES = {
  ibex: {
    name: 'Alpine ibex', sci: 'Capra ibex', kind: 'Mammal', status: 'Reintroduced',
    text: 'The wild goat of the high rock. Males carry long, ridged horns that curve back over the shoulders. The last Swiss ibex was shot in Valais in 1809; from 1906 young ibex were smuggled in from Italy to start new herds, and about 17,000 live in Switzerland today.',
    look: 'Rocky slopes above the trees: around Gornergrat and Zermatt, the Jungfrau region in summer.',
  },
  chamois: {
    name: 'Chamois', sci: 'Rupicapra rupicapra', kind: 'Mammal',
    text: 'A nimble goat-antelope with short, hooked horns on both sexes and a dark coat in winter. Chamois run up near-vertical slopes and ledges, and in hot weather they rest on snowfields to keep cool.',
    look: 'Steep forest edges, cliffs and screes: the Lauterbrunnen walls, above Lake Oeschinen.',
  },
  marmot: {
    name: 'Alpine marmot', sci: 'Marmota marmota', kind: 'Mammal',
    text: 'A large ground squirrel that lives in family burrows in alpine meadows. Marmots hibernate for about half the year, huddled together underground. A sentry whistles a sharp alarm when an eagle or a fox comes near.',
    look: 'Meadows above about 1,800 m: around Gornergrat and Riffelalp, the trails above Kandersteg. Listen for the whistle.',
  },
  'golden-eagle': {
    name: 'Golden eagle', sci: 'Aquila chrysaetos', kind: 'Bird',
    text: 'The great hunter of the Alps, dark brown with a golden nape. A pair holds a large territory and hunts marmots, young chamois and hares. Each pair usually has several nests on cliff ledges and uses them in turn.',
    look: 'Soaring along ridges and valley walls anywhere on the tour.',
  },
  'bearded-vulture': {
    name: 'Bearded vulture', sci: 'Gypaetus barbatus', kind: 'Bird', status: 'Reintroduced',
    text: 'With a wingspan of nearly 3 m, it lives mainly on bones, dropping big ones onto rocks to break them. Adults turn rusty orange by bathing in iron-rich water. Hunted out of the Alps (the last was shot in 1913), it came back through releases from 1986; about 300 now fly over the Alps.',
    look: 'Over high valleys in Valais and the Bernese Oberland: watch the skies above Zermatt and the Aletsch.',
  },
  chough: {
    name: 'Alpine chough', sci: 'Pyrrhocorax graculus', kind: 'Bird',
    text: 'A glossy black crow with a yellow bill and red legs, and an acrobat in the updrafts. Flocks gather at summit stations, waiting for crumbs. It nests higher than almost any other bird, in cliffs and crevices.',
    look: 'Jungfraujoch, Gornergrat and the Eiger: anywhere people picnic high up.',
  },
};
export const SPECIES_ORDER = ['ibex', 'chamois', 'marmot', 'golden-eagle', 'bearded-vulture', 'chough'];
