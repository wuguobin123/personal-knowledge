import type { Metadata } from "next";
import { Work_Sans } from "next/font/google";
import "highlight.js/styles/github.css";
import "./globals.css";

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-work-sans",
});

export const metadata: Metadata = {
  title: "Personal Blog",
  description: "A personal blog powered by Next.js and MySQL",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={workSans.variable}>{children}</body>
    </html>
  );
}
