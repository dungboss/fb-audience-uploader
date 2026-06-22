import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
// 1. Import Toaster từ thư viện sonner mới cài của shadcn
import { Toaster } from "@/components/ui/sonner"; 

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Facebook Audience Sync Tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geist.className}>
        {children}
        {/* 2. Thêm thẻ Toaster vào đây, ngay dưới children */}
        <Toaster position="top-right" richColors /> 
      </body>
    </html>
  );
}