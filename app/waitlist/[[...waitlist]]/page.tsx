import { Waitlist } from '@clerk/nextjs'

// Sign-ups are by approval. With Clerk's access mode set to Waitlist, a visitor asks
// for access here; the admin approves them in the Clerk dashboard (Waitlist page),
// and Clerk emails them an invitation to sign up. Until then they have no account,
// so nothing behind the sign-in can be reached. Public, like the sign-in page (see
// lib/public-routes.ts); <ClerkProvider waitlistUrl> in app/layout.tsx points here.
export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Waitlist signInUrl="/sign-in" />
    </div>
  )
}
