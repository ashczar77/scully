import type { WorkbenchFile } from "./PearlFileWorkbench";

export const MAX_WORKBENCH_TABS = 10;

export function addWorkbenchTab(
  current: WorkbenchFile[],
  file: WorkbenchFile,
  activeId: string,
): WorkbenchFile[] {
  const next = current.filter((item) => item.id !== file.id);
  if (next.length >= MAX_WORKBENCH_TABS) {
    const oldestInactive = next.findIndex((item) => item.id !== activeId);
    next.splice(oldestInactive < 0 ? 0 : oldestInactive, 1);
  }
  return [...next, file];
}
