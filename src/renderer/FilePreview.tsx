import { ArrowLeft, FileText } from "lucide-react";
import type { ProjectFilePreview } from "./RoomConversation";

export function FilePreview({
  file,
  onBack,
}: {
  file: ProjectFilePreview;
  onBack: () => void;
}) {
  return (
    <section className="project-file-preview" aria-label="File preview">
      <div className="project-file-preview-header">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <span className="eyebrow">PROJECT FILE</span>
          <h1>
            <FileText size={24} /> {file.path}
          </h1>
          <p>
            {file.owner ? `${file.owner} · ${file.status}` : file.status} ·
            {file.revision ? ` checkpoint ${file.revision.slice(0, 12)} ·` : ""}{" "}
            Read-only preview
          </p>
        </div>
      </div>
      <pre>
        <code>{file.content}</code>
      </pre>
      {file.before !== undefined && file.before !== file.content && (
        <details>
          <summary>Compare with local snapshot</summary>
          <div className="diff-columns">
            <section>
              <h2>Before</h2>
              <pre>{file.before ?? "(New file)"}</pre>
            </section>
            <section>
              <h2>At this checkpoint</h2>
              <pre>{file.content}</pre>
            </section>
          </div>
        </details>
      )}
    </section>
  );
}
