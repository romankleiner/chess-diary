import type { Metadata } from 'next';

// Every page under /blog asks search engines not to index it, follow its links or
// keep a copy. (next.config.js sends the same as an X-Robots-Tag header, which
// also covers anything that isn't an HTML page.) /blog is deliberately not listed
// in robots.txt: that file is public, and listing it would advertise the path.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
