import { NextResponse, NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    console.error('OAuth Callback: Code query parameter is missing');
    return NextResponse.redirect(new URL('/?error=missing_code', request.url));
  }

  try {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

    console.log(`OAuth Callback: Forwarding code coordinates to backend callback: ${API_URL}/auth/google/callback`);
    
    const res = await fetch(`${API_URL}/auth/google/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Backend callback failed: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    
    // Create Response to redirect back to home page
    const response = NextResponse.redirect(new URL('/', request.url));
    
    // Set session cookie in response (matches authMiddleware parser)
    response.cookies.set('token', data.token, {
      httpOnly: false, // Set to false so client JS context can read it or use for header fallback, but standard cookies apply
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    });

    console.log('OAuth Callback: Successfully established session cookie. Redirecting.');
    return response;

  } catch (err) {
    console.error('OAuth Callback: Error exchanging coordinates:', err);
    return NextResponse.redirect(
      new URL(`/?error=auth_failed&details=${encodeURIComponent((err as Error).message)}`, request.url)
    );
  }
}
