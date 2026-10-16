import { providerCitationSchema, type ProviderCitation } from "@deliberation-ai/contracts";

export function ProviderCitationLink({ citation }: { citation: ProviderCitation }) {
  if (!providerCitationSchema.shape.url.safeParse(citation.url).success) {
    return <span style={{ overflowWrap: "anywhere" }}>{citation.title ? `${citation.title} · ` : ""}{citation.url}</span>;
  }
  return <a href={citation.url} target="_blank" rel="noreferrer">{citation.title ?? citation.url}</a>;
}
