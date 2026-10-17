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
            {file.owner ? `${file.status} by ${file.owner}` : file.status} ·
            Read-only preview
          </p>
        </div>
      </div>
      <pre>
        <code>{file.content}</code>
      </pre>
    </section>
  );
}
