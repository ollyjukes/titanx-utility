// app/layout.js
'use client'

import './global.css';
import { Inter } from 'next/font/google';
import Navbar  from '@/components/Navbar';
import ClientProvider from './ClientProvider';
import ShootingStars from '@/components/ShootingStars';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter'
});

export default function RootLayout({ children }) {
  const handleDMLink = (username, e) => {
    e.preventDefault();
    const appLink = `x://messages/compose?screen_name=${username}`;
    const webLink = `https://x.com/direct_messages/create/${username}`;
    window.location = appLink;
    setTimeout(() => {
      window.open(webLink, '_blank', 'noopener,noreferrer');
    }, 500);
  };

  return (
    <html lang="en">
      <head>
        <title>TitanXUtils</title>
        <link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.variable} bg-gray-900 text-white font-inter`}>
        <ClientProvider>
          <Navbar />
          <ShootingStars />
          <main className="main-content">{children}</main>
          <footer className="footer bg-gray-800 py-4 text-center text-gray-400 fixed bottom-0 left-0 w-full z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row justify-between items-center">
              <p className="hidden sm:block">
                © {new Date().getFullYear()} TitanXUtils by{' '}
                <a
                  href="#"
                  onClick={(e) => handleDMLink('KetoNatural1970', e)}
                  className="text-gray-400 hover:text-orange-400 hover:underline transition-colors duration-200"
                  title="Send a DM to @KetoNatural1970 on X"
                >
                  KetoNatural1970
                </a>{' '}
                and{' '}
                <a
                  href="#"
                  onClick={(e) => handleDMLink('JukesTheGreat', e)}
                  className="text-gray-400 hover:text-orange-400 hover:underline transition-colors duration-200"
                  title="Send a DM to @JukesTheGreat on X"
                >
                  JukesTheGreat
                </a>
              </p>
              <div className="flex flex-row items-center gap-4">
                <a
                  href="https://titanxhub.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-semibold text-white hover:text-orange-400 transition-colors duration-200"
                  title="Visit TitanXHub"
                >
                  TitanXHub.com
                </a>
                <a
                  href="https://titanxinfo.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-semibold text-white hover:text-orange-400 transition-colors duration-200"
                  title="Visit TitanXInfo"
                >
                  TitanXInfo.com
                </a>
              </div>
            </div>
          </footer>
        </ClientProvider>
      </body>
    </html>
  );
}