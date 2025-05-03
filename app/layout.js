'use client';
import '@/app/global.css';
import { Inter } from 'next/font/google';
import Navbar from '@/components/Navbar';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="bg-gray-900 text-gray-100">
      <body className={inter.className}>
        <Navbar />
        <main className="flex-grow container page-content">{children}</main>
        <footer className="footer">
          <p>© {new Date().getFullYear()} TitanXUtils by KetoNatural and JukesTheGreat.</p>
        </footer>
      </body>
    </html>
  );
}