import type { Metadata } from "next";
import { HelpGuide } from "../ui/help-guide";

export const metadata: Metadata = { title: "Yardım ve kullanım kılavuzu · DeliberationAI", description: "İlk sohbetinizden API bağlantıları, bilgi kaynakları ve zamanlayıcıya kadar DeliberationAI kullanım kılavuzu." };
export default function HelpPage() { return <HelpGuide />; }
