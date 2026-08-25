import AiDocumentDraftClient from "@/components/documents/AiDocumentDraftClient";
import DocsTabs from "@/components/documents/DocsTabs";

export const dynamic = "force-dynamic";

export default function DocumentNewPage() {
  return (
    <div className="p-4 sm:p-6">
      <DocsTabs />
      <AiDocumentDraftClient />
    </div>
  );
}
