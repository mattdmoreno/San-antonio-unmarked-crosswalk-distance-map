import './globals.css';

export const metadata = {
  title: 'Pedestrian Sketchiness Map',
  description: 'Seattle basemap + overlays from PMTiles',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
