import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PearlCodePreview } from "../src/renderer/PearlCodePreview";

it("highlights common Java and Python keywords without hiding source text", () => {
  const java = renderToStaticMarkup(
    <PearlCodePreview path="Main.java" content="public class Main {}" />,
  );
  const python = renderToStaticMarkup(
    <PearlCodePreview path="main.py" content="def run(): return 1" />,
  );
  expect(java).toContain('class="pearl-token-keyword">public');
  expect(java).toContain('class="pearl-token-keyword">class');
  expect(python).toContain('class="pearl-token-keyword">def');
  expect(python).toContain('class="pearl-token-keyword">return');
});
