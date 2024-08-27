import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NexTalk Meetup",
  description: "Join us for the NexTalk Meetup!",
};

export default function Talk({ children }: { children: React.ReactNode }) {
  return { children };
}
