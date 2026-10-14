export const portraitOptions = [
  {
    id: "portrait-01",
    label: "Dark waves and teal jacket",
    atlas: 0,
    column: 0,
  },
  { id: "portrait-02", label: "Brown curls and glasses", atlas: 0, column: 1 },
  {
    id: "portrait-03",
    label: "Short black hair and navy jacket",
    atlas: 0,
    column: 2,
  },
  {
    id: "portrait-04",
    label: "Silver-tipped curls and indigo jacket",
    atlas: 1,
    column: 0,
  },
  {
    id: "portrait-05",
    label: "Salt-and-pepper curls and glasses",
    atlas: 1,
    column: 1,
  },
  {
    id: "portrait-06",
    label: "Dark curls and teal scarf",
    atlas: 1,
    column: 2,
  },
  {
    id: "portrait-07",
    label: "Short dark bob and navy blazer",
    atlas: 2,
    column: 0,
  },
  {
    id: "portrait-08",
    label: "Silver pixie cut and olive jacket",
    atlas: 2,
    column: 1,
  },
  { id: "portrait-09", label: "Locs and teal jacket", atlas: 2, column: 2 },
  {
    id: "portrait-10",
    label: "Long dark braid and burgundy jacket",
    atlas: 3,
    column: 0,
  },
  {
    id: "portrait-11",
    label: "Short dark hair and charcoal jacket",
    atlas: 3,
    column: 1,
  },
  {
    id: "portrait-12",
    label: "Gray undercut and plum jacket",
    atlas: 3,
    column: 2,
  },
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
