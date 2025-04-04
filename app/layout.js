// app/layout.js
import './layout.css';
import { Inter } from 'next/font/google';
import Navbar from '../components/Navbar'; // Adjust path if needed

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>TitanXUtils</title>
      </head>
      <body className={`${inter.className} bg-gray-900 text-white`}>
        <Navbar />
        <main className="pt-16">{children}</main>
      </body>
    </html>
  );
}