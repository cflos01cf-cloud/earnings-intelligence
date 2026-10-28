import { NextResponse, type NextRequest } from 'next/server';
import { basicAuthOk } from '@/lib/auth';

/** Protege toda la app con contraseña cuando APP_PASSWORD está definida (producción). En tu PC, sin APP_PASSWORD, no pide nada. */
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  if (basicAuthOk(req.headers.get('authorization'), password)) return NextResponse.next();
  return new NextResponse('Se requiere contraseña', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Earnings Intelligence", charset="UTF-8"' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
