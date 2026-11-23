import { BillSahiApp } from "@/components/BillSahiApp";

export default function Home() {
  return <BillSahiApp repoUrl={process.env.NEXT_PUBLIC_REPO_URL ?? null} />;
}
