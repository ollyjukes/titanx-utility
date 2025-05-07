// app/layout.js
import './layout.css';
import { Inter } from 'next/font/google';
import Navbar from '@/client/components/Navbar';
import ClientProvider from './ClientProvider';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>TitanXUtils</title>
      </head>
      <body className={`${inter.className} bg-gray-900 text-white`}>
        <ClientProvider>
          <Navbar />
          <main className="pt-16">{children}</main>
        </ClientProvider>
        <footer className="footer">
          <p>© {new Date().getFullYear()} TitanXUtils. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}