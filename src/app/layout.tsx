import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "BYU–Hawaii Financial Aid Assistant",
  description:
    "AI-powered assistant for BYU–Hawaii financial aid questions — scholarships, FAFSA, tuition, iWork, grants, and deadlines.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  )
}
