import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BabelTalk",
  description:
    "An AI-assisted real-time communication platform with for small to medium-sized teams to increase your productivity.",
};

import "./globals.css";
import { cn } from "@/lib/utils";
import Providers from "@/lib/Provider";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          inter.className,
          `bg-lightbg text-black dark:bg-darkbg dark:text-white`
        )}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
