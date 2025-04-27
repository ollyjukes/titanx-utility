import './global.css';
import Navbar from '@/components/Navbar';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'TitanXUtils',
  description: 'NFT tracking and management platform for TitanX ecosystem',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
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