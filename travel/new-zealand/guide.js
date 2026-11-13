// I'M HERE Travel Desk · New Zealand field guide (EFB-style panel). Text-only cards: no photos yet (licences could not be
// verified from the build sandbox; add { photo: { src, credit, licence, href } } per species once they are).
// Te reo Māori names are given alongside English where they are the standard names in New Zealand.
// Facts: Department of Conservation (DOC, doc.govt.nz), New Zealand Threat Classification System.
export const SPECIES = {
  kea: {
    name: 'Kea', sci: 'Nestor notabilis', kind: 'Bird', status: 'Nationally Endangered',
    text: 'The world\'s only alpine parrot: olive-green, with flame-orange under the wings that flashes in flight. Kea are famously curious and clever, and will happily pull apart wipers and rubber seals on cars. Predators such as stoats and lead from old buildings threaten them; please do not feed them.',
    look: 'Lookouts on the Milford Road near the Homer Tunnel, Aoraki / Mount Cook Village, alpine passes.',
  },
  kekeno: {
    name: 'New Zealand fur seal · kekeno', sci: 'Arctocephalus forsteri', kind: 'Mammal',
    text: 'Sealers hunted them close to extinction for their skins in the early 1800s; under protection they are common again around the coast. Unlike true seals they have small external ears and can walk on all four flippers.',
    look: 'Rocks along the fiords and at their mouths: near Stirling Falls in Milford Sound, the outer islands of Doubtful Sound.',
  },
  bottlenose: {
    name: 'Bottlenose dolphin', sci: 'Tursiops truncatus', kind: 'Mammal', status: 'Nationally Endangered',
    text: 'Fiordland\'s bottlenose dolphins are among the southernmost of their kind, large and well insulated for the cold water. Doubtful Sound has a small resident pod of about 70 that rarely leaves the fiord. Fewer of its calves now survive, so boats there follow a code of conduct around them.',
    look: 'Doubtful Sound / Patea and Milford Sound, often riding bow waves.',
  },
  dusky: {
    name: 'Dusky dolphin', sci: 'Lagenorhynchus obscurus', kind: 'Mammal',
    text: 'A small, acrobatic dolphin that leaps, spins and somersaults, often in large groups. Most are seen off the east coast, at Kaikōura, but they sometimes visit the Fiordland sounds.',
    look: 'Occasional visitors in Milford and Doubtful Sounds.',
  },
  tawaki: {
    name: 'Fiordland crested penguin · tawaki', sci: 'Eudyptes pachyrhynchus', kind: 'Bird',
    text: 'A crested penguin with a bright yellow stripe above each eye, and one of the rarest penguins. Unusually, it nests in winter and spring, in dense rainforest and caves along the Fiordland coast, then heads far out into the Southern Ocean to feed.',
    look: 'Shores and rocks near the fiord mouths, from July to November; Doubtful Sound is a breeding site.',
  },
  takahe: {
    name: 'Takahē', sci: 'Porphyrio hochstetteri', kind: 'Bird', status: 'Rare · about 500 birds',
    text: 'A big, flightless rail with deep blue and green feathers and a heavy red bill. Twice thought extinct, it was rediscovered in Fiordland\'s Murchison Mountains on 20 November 1948 by Geoffrey Orbell. Careful recovery work has brought it to about 500 birds (2023).',
    look: 'The Murchison Mountains are closed to visitors; see takahē at the bird sanctuary in Te Anau, on the way to Doubtful Sound.',
  },
  kereru: {
    name: 'Kererū', sci: 'Hemiphaga novaeseelandiae', kind: 'Bird',
    text: 'The New Zealand pigeon: big, with shimmering green and purple feathers and a white chest; you often hear its heavy wingbeats first. It is the only native bird left that can swallow the largest forest fruits whole, so many trees depend on it to spread their seeds.',
    look: 'Native forest along the Milford Road and around the fiords.',
  },
  kaki: {
    name: 'Black stilt · kakī', sci: 'Himantopus novaezelandiae', kind: 'Bird', status: 'Critically Endangered',
    text: 'An all-black stilt with long pink legs, and one of the rarest wading birds in the world. It breeds only in the braided rivers of the Mackenzie Basin. DOC raises chicks in captivity near Twizel and releases them into the wild.',
    look: 'Braided riverbeds and wetlands of the Mackenzie Basin, around Lakes Tekapo and Pukaki.',
  },
};
export const SPECIES_ORDER = ['kea', 'kekeno', 'bottlenose', 'dusky', 'tawaki', 'takahe', 'kereru', 'kaki'];
