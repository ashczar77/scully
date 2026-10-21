export type TextEdit = { oldText: string; newText: string };
export type PatchHunk = { line: number; removed: string; added: string };

export function applyTextPatch(
  before: string,
  edits: TextEdit[],
): { content: string; hunks: PatchHunk[] } {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 20)
    throw new Error("Invalid patch edit count");
  const matches = edits.map((edit) => {
    if (
      !edit ||
      typeof edit.oldText !== "string" ||
      !edit.oldText ||
      edit.oldText.length > 20_000 ||
      typeof edit.newText !== "string" ||
      edit.newText.length > 20_000
    )
      throw new Error("Invalid patch edit");
    if (edit.oldText === edit.newText)
      throw new Error("Patch edit makes no change");
    const start = before.indexOf(edit.oldText);
    if (start < 0 || before.indexOf(edit.oldText, start + 1) >= 0)
      throw new Error("Patch edit requires exactly one matching occurrence");
    return { start, end: start + edit.oldText.length, edit };
  });
  matches.sort((left, right) => left.start - right.start);
  for (let index = 1; index < matches.length; index++)
    if (matches[index].start < matches[index - 1].end)
      throw new Error("Patch edits overlap");
  const hunks = matches.map(({ start, edit }) => ({
    line: before.slice(0, start).split("\n").length,
    removed: edit.oldText,
    added: edit.newText,
  }));
  let content = before;
  for (const { start, end, edit } of [...matches].reverse())
    content = content.slice(0, start) + edit.newText + content.slice(end);
  if (content.length > 1_000_000)
    throw new Error("Patched file exceeds the write limit");
  return { content, hunks };
}
