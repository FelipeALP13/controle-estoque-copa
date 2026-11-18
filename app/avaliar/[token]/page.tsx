import type { Metadata } from "next";
import SurveyClient from "../../survey-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Avalie o atendimento",
  robots: { index: false, follow: false },
};

/** Página pública (sem login) para o cliente avaliar o atendimento de um chamado. */
export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SurveyClient token={token} />;
}
