import { EmbedAskBox } from "@/components/EmbedAskBox";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ creator?: string }>;
};

export default async function EmbedPage({ searchParams }: Props) {
  const { creator = "" } = await searchParams;
  return <EmbedAskBox creator={creator} />;
}
