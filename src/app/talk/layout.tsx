import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BabelTalk Meetup",
  description: "Join us for the BabelTalk Meetup!",
};

export default function Talk({ children }: { children: React.ReactNode }) {
  return { children };
}
