import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/journal/editor";

export const Route = createFileRoute("/entry/$id")({
  component: EntryPage,
});

function EntryPage() {
  const { id } = Route.useParams();
  return <Editor entryId={id} />;
}
