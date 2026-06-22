'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { toast } from 'sonner';

// Import tương đối để tránh lỗi alias cấu hình sai đường dẫn
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Progress } from '../components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

// Hàm băm SHA-256 sử dụng Web Crypto API có sẵn của trình duyệt (Không cần cài thư viện ngoài)
async function sha256(message: string) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function Home() {
  const [audienceName, setAudienceName] = useState('Audience Demo - ' + new Date().toLocaleDateString());
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<any[]>([]);

  // Xử lý khi người dùng thả file CSV vào khung nhận diện
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setProgress(10);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        setProgress(40);
        const rawRows = results.data as string[][];
        const extractedEmails: string[] = [];

        // Duyệt qua toàn bộ ô dữ liệu để tìm chuỗi chứa ký tự '@' hợp lệ
        rawRows.forEach(row => {
          row.forEach(cell => {
            if (cell) {
              const clean = cell.trim();
              if (clean.includes('@')) {
                extractedEmails.push(clean.toLowerCase());
              }
            }
          });
        });

        if (extractedEmails.length === 0) {
          toast.error('Không tìm thấy email nào trong file CSV.');
          setProgress(0);
          return;
        }

        setEmails(extractedEmails);
        setProgress(100);
        toast.success(`Tìm thấy ${extractedEmails.length} email hợp lệ.`);
        setTimeout(() => setProgress(0), 800);
      },
      error: () => {
        toast.error('Không thể cấu trúc hoặc đọc file CSV này.');
        setProgress(0);
      }
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false
  });

  // Xử lý mã hóa SHA-256 dữ liệu hàng loạt tại Client và gọi API Route của Next.js
  const handleUploadToFacebook = async () => {
    if (emails.length === 0) return;
    setLoading(true);
    setProgress(20);

    try {
      setProgress(40);
      // Thực hiện băm SHA-256 bất đồng bộ song song cho toàn bộ danh sách
      const hashedList = await Promise.all(emails.map(email => sha256(email)));

      setProgress(60);
      // Gọi lên Route API trung gian bảo mật của chúng ta
      const res = await fetch('/api/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashedEmails: hashedList, audienceName })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Có lỗi xảy ra khi đồng bộ tệp lên Facebook');
      }

      setProgress(100);
      toast.success('Đồng bộ thành công!', {
        description: `Đã đẩy thành công ${data.numReceived} dữ liệu lên Facebook.`
      });
      
      // Cập nhật bảng ghi nhận lịch sử ngay phía dưới giao diện
      setHistory(prev => [
        {
          id: data.audienceId,
          name: audienceName,
          count: data.numReceived,
          time: new Date().toLocaleTimeString()
        },
        ...prev
      ]);
      
      // Reset trạng thái danh sách email hiện tại để chuẩn bị cho tệp mới
      setEmails([]);

    } catch (err: any) {
      toast.error(err.message || 'Lỗi bất định phát sinh.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 1000);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div className="text-center my-6 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Facebook Custom Audience Sync Tool 🚀</h1>
        <p className="text-sm text-muted-foreground">Giải pháp mã hóa bảo mật và tạo tệp đối tượng tùy chỉnh tự động từ danh sách email thô</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Cấu hình đồng bộ</CardTitle>
          <CardDescription>Nhập thông tin tên tệp đối tượng và tải danh sách file email định dạng .CSV của bạn lên.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tên tệp Custom Audience hiển thị trên Meta Ads</label>
            <Input 
              value={audienceName} 
              onChange={(e) => setAudienceName(e.target.value)} 
              placeholder="Ví dụ: Khách hàng mua hàng tháng 6"
            />
          </div>

          {/* Vùng Dropzone được bo góc nét đứt chuẩn UI Shadcn */}
          <div 
            {...getRootProps()} 
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary'}`}
          >
            <input {...getInputProps()} />
            <div className="space-y-2">
              <p className="text-base font-medium">
                {isDragActive ? "Thả file CSV vào đây ngay..." : "Kéo & thả file CSV chứa danh sách email vào đây, hoặc click để chọn file"}
              </p>
              <p className="text-xs text-muted-foreground">Hệ thống chấp nhận duy nhất định dạng .csv (Để demo chạy nhanh nhất nên dùng tệp 50 - 100 dòng)</p>
            </div>
          </div>

          {/* Thông tin số lượng email thu thập được kèm nút kích hoạt API */}
          {emails.length > 0 && (
            <div className="p-4 bg-muted/50 border rounded-md flex justify-between items-center animate-in fade-in duration-200">
              <span className="text-sm font-medium">Đã tải cấu trúc file thành công: <strong className="text-primary">{emails.length} email</strong> sẵn sàng.</span>
              <Button onClick={handleUploadToFacebook} disabled={loading}>
                {loading ? "Đang xử lý..." : "Đồng bộ lên Facebook"}
              </Button>
            </div>
          )}

          {/* Thanh Tiến trình xử lý dữ liệu động */}
          {progress > 0 && (
            <div className="space-y-1 pt-2 animate-in fade-in">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-right text-muted-foreground font-mono">Tiến độ hệ thống: {progress}%</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nhật ký hiển thị các tác vụ thành công */}
      {history.length > 0 && (
        <Card className="animate-in slide-in-from-bottom-4 duration-300">
          <CardHeader>
            <CardTitle>Lịch sử phiên làm việc</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Audience ID (Meta)</TableHead>
                  <TableHead>Tên tệp đối tượng</TableHead>
                  <TableHead className="text-right">Số lượng nhận diện</TableHead>
                  <TableHead className="text-right">Thời gian tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.id}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-semibold">{item.count}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">{item.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}