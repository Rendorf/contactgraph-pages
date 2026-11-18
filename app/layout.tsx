import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./auth-context";
import { Toaster } from "@/components/ui/sonner";
import { AppearanceProvider } from "./appearance";

export const metadata: Metadata = {
  title: "ContactGraph",
  description: "Your private, searchable contact network.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><AppearanceProvider><AuthProvider>{children}</AuthProvider><Toaster position="top-right" richColors closeButton duration={6000} /></AppearanceProvider></body>
    </html>
  );
}
