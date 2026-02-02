import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'

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
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">
          <div className="min-h-screen">
            <header className="bg-gray-800 text-white p-4">
              <div className="container mx-auto flex justify-between items-center">
                <Link href="/" className="text-2xl font-bold hover:text-gray-300">
                  Chess Diary
                </Link>
                <nav className="flex gap-6 items-center">
                  <SignedIn>
                    <Link href="/journal" className="hover:text-gray-300">
                      Journal
                    </Link>
                    <Link href="/games" className="hover:text-gray-300">
                      Games
                    </Link>
                    <Link href="/settings" className="hover:text-gray-300">
                      Settings
                    </Link>
                    <div className="ml-2">
                      <UserButton 
                        afterSignOutUrl="/sign-in"
                        appearance={{
                          elements: {
                            avatarBox: "w-10 h-10"
                          }
                        }}
                      />
                    </div>
                  </SignedIn>
                  <SignedOut>
                    <Link href="/sign-in" className="hover:text-gray-300">
                      Sign In
                    </Link>
                  </SignedOut>
                </nav>
              </div>
            </header>
            <main className="container mx-auto p-4">
              {children}
            </main>
          </div>
        </body>
      </html>
    </ClerkProvider>
  )
}
