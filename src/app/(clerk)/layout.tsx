import { ClerkProvider } from "@clerk/nextjs";

export default function ClerkAuth({ children }: { children: React.ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
