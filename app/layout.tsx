import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Chess Diary',
  description: 'Track your chess thoughts and analyze your games',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="min-h-screen">
          <header className="bg-gray-800 text-white p-4">
            <div className="container mx-auto flex justify-between items-center">
              <Link href="/" className="text-2xl font-bold hover:text-gray-300">
                Chess Diary
              </Link>
              <nav className="flex gap-6">
                <Link href="/journal" className="hover:text-gray-300">
                  Journal
                </Link>
                <Link href="/games" className="hover:text-gray-300">
                  Games
                </Link>
                <Link href="/settings" className="hover:text-gray-300">
                  Settings
                </Link>
              </nav>
            </div>
          </header>
          <main className="container mx-auto p-4">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
