// File: app/layout.js

import Navbar from '@/components/Navbar';
import '@/app/global.css'; // Target global.css in app directory
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'TitanXUtils',
  description: 'TitanX ecosystem utilities',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="bg-gray-900 text-gray-100">
      <head>
        <title>TitanXUtils</title>
      </head>
      <body className={inter.className}>
        <Navbar />
        <main className="flex-grow container page-content">{children}</main>
        <footer className="footer">
          <p>© {new Date().getFullYear()} TitanXUtils. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}