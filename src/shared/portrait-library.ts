export const portraitOptions = [
  { id: "portrait-01", label: "Dark waves and teal jacket", asset: "maya" },
  { id: "portrait-02", label: "Brown curls and glasses", asset: "ellis" },
  {
    id: "portrait-03",
    label: "Short black hair and navy jacket",
    asset: "jun",
  },
  {
    id: "portrait-04",
    label: "Silver-tipped curls and indigo jacket",
    asset: "nadine",
  },
  {
    id: "portrait-05",
    label: "Salt-and-pepper curls and glasses",
    asset: "rafi",
  },
  { id: "portrait-06", label: "Dark curls and teal scarf", asset: "sloane" },
  {
    id: "portrait-07",
    label: "Short dark bob and navy blazer",
    asset: "tessa",
  },
  {
    id: "portrait-08",
    label: "Silver pixie cut and olive jacket",
    asset: "meryl",
  },
  { id: "portrait-09", label: "Locs and teal jacket", asset: "adrian" },
  {
    id: "portrait-10",
    label: "Long dark braid and burgundy jacket",
    asset: "carmen",
  },
  {
    id: "portrait-11",
    label: "Short dark hair and charcoal jacket",
    asset: "kiran",
  },
  { id: "portrait-12", label: "Gray undercut and plum jacket", asset: "jess" },
  { id: "portrait-13", label: "Pearl", asset: "coordinator" },
  { id: "portrait-14", label: "Malik", asset: "young-tester" },
  { id: "portrait-15", label: "Nico", asset: "research" },
  { id: "portrait-16", label: "James", asset: "reliability" },
] as const;

export type PortraitId = (typeof portraitOptions)[number]["id"];

export function parsePortraitId(value: unknown): PortraitId {
  const option = portraitOptions.find(({ id }) => id === value);
  if (!option) throw new Error("Unknown portrait");
  return option.id;
}
