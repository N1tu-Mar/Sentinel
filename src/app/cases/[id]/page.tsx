import { CaseView } from "@/ui/case-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseView id={id} />;
}
