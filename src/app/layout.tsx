import type { Metadata } from "next"
import { Montserrat } from "next/font/google"
import "./globals.css"

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
})

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
      <body className={`${montserrat.variable} h-full font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
