import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CFA Exam Simulator',
  description: 'Prometric-style CFA exam simulation and analytics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  )
}
