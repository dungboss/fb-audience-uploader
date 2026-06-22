import { NextResponse } from 'next/server';

// CẤU HÌNH THÔNG TIN FACEBOOK CỦA BẠN (Nên cấu hình trong file .env.local)
const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || "THAY_BANG_ACCESS_TOKEN_CUA_BAN";
const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID || "act_THAY_BANG_ID_TAI_KHOAN_QC"; 
const VERSION = "v19.0";

export async function POST(request: Request) {
  try {
    const { hashedEmails, audienceName } = await request.json();

    if (!hashedEmails || hashedEmails.length === 0) {
      return NextResponse.json({ error: 'Danh sách email trống' }, { status: 400 });
    }

    // --- BƯỚC 1: Tạo Custom Audience trống ---
    const createUrl = `https://graph.facebook.com/${VERSION}/${AD_ACCOUNT_ID}/customaudiences`;
    
    const createFormData = new URLSearchParams();
    createFormData.append('name', audienceName || 'API Email List Audience (Demo)');
    createFormData.append('subtype', 'CUSTOM');
    createFormData.append('customer_file_source', 'USER_PROVIDED_ONLY');
    createFormData.append('access_token', ACCESS_TOKEN);

    const createRes = await fetch(createUrl, {
      method: 'POST',
      body: createFormData,
    });
    const createData = await createRes.json();

    if (createData.error) {
      return NextResponse.json({ error: `Lỗi tạo Audience: ${createData.error.message}` }, { status: 400 });
    }

    const audienceId = createData.id;

    // --- BƯỚC 2: Upload dữ liệu Email đã Hash lên Audience vừa tạo ---
    const uploadUrl = `https://graph.facebook.com/${VERSION}/${audienceId}/users`;
    
    const payloadData = {
      schema: 'EMAIL_SHA256',
      data: hashedEmails
    };

    const uploadFormData = new URLSearchParams();
    uploadFormData.append('payload', JSON.stringify(payloadData));
    uploadFormData.append('access_token', ACCESS_TOKEN);

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: uploadFormData,
    });
    const uploadData = await uploadRes.json();

    return NextResponse.json({
      success: true,
      audienceId,
      numReceived: uploadData.num_received,
      details: uploadData
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Lỗi server nội bộ' }, { status: 500 });
  }
}