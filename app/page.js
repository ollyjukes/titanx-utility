import ClientWrapper from './ClientWrapper';

console.log('Page: Server-side execution');

export default function Home() {
  console.log('Page: Home rendering (server)');
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-gray-800 to-gray-900">
      <ClientWrapper />
    </main>
  );
}