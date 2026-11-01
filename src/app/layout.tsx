import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { AnalyticsConsentBanner } from '@/components/common/AnalyticsConsentBanner';
import '../index.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined;

export const metadata: Metadata = {
  metadataBase: baseUrl,
  title: {
    default: "King's Platter | Restaurant in Sivakasi, Tamil Nadu",
    template: "%s | King's Platter",
  },
  description: "Explore King's Platter in Sivakasi, Tamil Nadu. Browse the menu featuring biryani, mandi, Indian favourites, Chinese & Continental dishes, noodles, pasta, seafood and more.",
  keywords: ["King's Platter", "Restaurant in Sivakasi", "Biryani in Sivakasi", "Mandi in Sivakasi", "Sivakasi Restaurant", "Digital Menu", "QR Menu", "Virudhunagar Restaurant", "Tamil Nadu Dining"],
  authors: [{ name: "King's Platter" }],
  creator: "King's Platter",
  publisher: "King's Platter",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon1.png', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
  openGraph: {
    title: "KING'S PLATTER — QR Digital Restaurant Menu",
    description: "Great Food | Royal Experience at King's Platter RESTAURANT. Browse our digital menu instantly.",
    type: 'website',
    locale: 'en_US',
    siteName: "King's Platter",
    images: [
      {
        url: '/kings_platter_logo.jpg',
        width: 800,
        height: 800,
        alt: "King's Platter Logo",
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: "KING'S PLATTER — QR Digital Restaurant Menu",
    description: "Great Food | Royal Experience at King's Platter RESTAURANT.",
    images: ['/kings_platter_logo.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <head>
        <meta name="apple-mobile-web-app-title" content="Kings Platter" />
        <meta name="theme-color" content="#0D0D10" />
      </head>
      <body className="bg-[#0D0D10] text-[#E8E8ED] antialiased font-sans">
        {children}
        <AnalyticsConsentBanner />
      </body>
    </html>
  );
}
