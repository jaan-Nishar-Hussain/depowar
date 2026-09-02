import { Inject, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ENV } from '../common/tokens';
import type { AppEnv } from '@paymesh/config';

type Claims = { sub: string; clientId: string; email: string; iat: number; exp: number };

function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
function base64(value: string | Buffer) { return Buffer.from(value).toString('base64url'); }

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ENV) private readonly env: AppEnv) {}

  async register(email: string, password: string, organizationName: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (exists) throw new ConflictException('An account with this email already exists.');
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: normalizedEmail, passwordHash: passwordHash(password) } });
      const organization = await tx.organization.create({ data: { name: organizationName.trim(), ownerId: user.id } });
      const testClient = await tx.client.create({ data: { name: organizationName.trim(), environment: 'TEST' } });
      const liveClient = await tx.client.create({ data: { name: organizationName.trim(), environment: 'LIVE' } });
      await tx.project.create({ data: { organizationId: organization.id, name: 'Default project', clientId: testClient.id, liveClientId: liveClient.id } });
      await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
      return { user, client: testClient, organization };
    });
    return this.session(result.user.id, result.user.email, result.client.id);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !passwordMatches(password, user.passwordHash)) throw new UnauthorizedException('Invalid email or password.');
    return this.sessionForUser(user.id, user.email);
  }

  googleLoginUrl() {
    if (!this.env.GOOGLE_CLIENT_ID) throw new UnauthorizedException('Google Sign-In is not configured yet.');
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const statePayload = `${timestamp}.${nonce}`;
    const state = `${statePayload}.${base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(statePayload).digest())}`;
    const params = new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, redirect_uri: this.env.GOOGLE_CALLBACK_URL, response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account' });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  dashboardUrl() { return this.env.DASHBOARD_URL; }

  async googleCallback(code: string, state: string) {
    const [timestamp, nonce, signature] = state.split('.');
    const statePayload = `${timestamp}.${nonce}`;
    const expected = base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(statePayload).digest());
    if (!timestamp || !nonce || !signature || signature !== expected || Date.now() - Number(timestamp) > 10 * 60 * 1000) throw new UnauthorizedException('Invalid Google sign-in state.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, redirect_uri: this.env.GOOGLE_CALLBACK_URL, grant_type: 'authorization_code' }) });
    if (!tokenResponse.ok) throw new UnauthorizedException('Google sign-in could not be completed.');
    const tokens = await tokenResponse.json() as { access_token?: string };
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token ?? ''}` } });
    if (!profileResponse.ok) throw new UnauthorizedException('Google profile could not be loaded.');
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!profile.sub || !profile.email || profile.email_verified === false) throw new UnauthorizedException('A verified Google email is required.');
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user) user = await this.prisma.user.findUnique({ where: { email: profile.email.toLowerCase() } });
    if (user) {
      if (!user.googleId) user = await this.prisma.user.update({ where: { id: user.id }, data: { googleId: profile.sub } });
      return this.sessionForUser(user.id, user.email);
    }
    return { onboardingToken: this.onboardingToken(profile.sub, profile.email.toLowerCase()), email: profile.email.toLowerCase() };
  }

  async completeGoogleOnboarding(token: string, organizationName: string) {
    const pending = this.verifyOnboardingToken(token);
    const existing = await this.prisma.user.findUnique({ where: { googleId: pending.googleId } });
    if (existing) return this.sessionForUser(existing.id, existing.email);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: pending.email, googleId: pending.googleId, passwordHash: '' } });
      const organization = await tx.organization.create({ data: { name: organizationName.trim(), ownerId: user.id } });
      const testClient = await tx.client.create({ data: { name: organizationName.trim(), environment: 'TEST' } });
      const liveClient = await tx.client.create({ data: { name: organizationName.trim(), environment: 'LIVE' } });
      await tx.project.create({ data: { organizationId: organization.id, name: 'Default project', clientId: testClient.id, liveClientId: liveClient.id } });
      await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
      return { user, client: testClient, organization };
    });
    return this.session(result.user.id, result.user.email, result.client.id);
  }

  private onboardingToken(googleId: string, email: string) {
    const payload = base64(JSON.stringify({ googleId, email, exp: Math.floor(Date.now() / 1000) + 10 * 60 }));
    const signature = base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(payload).digest());
    return `${payload}.${signature}`;
  }

  private verifyOnboardingToken(token: string): { googleId: string; email: string; exp: number } {
    const [payload, signature] = token.split('.');
    const expected = payload ? base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(payload).digest()) : '';
    if (!payload || !signature || signature !== expected) throw new UnauthorizedException('Invalid Google onboarding session.');
    const result = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { googleId: string; email: string; exp: number };
    if (!result.googleId || !result.email || result.exp <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException('Google onboarding session expired.');
    return result;
  }

  verify(token: string): Claims {
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature) throw new UnauthorizedException('Invalid session token.');
    const expected = base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest());
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException('Invalid session token.');
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as Claims;
    if (claims.exp <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException('Session expired.');
    return claims;
  }

  private session(id: string, email: string, clientId: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64(JSON.stringify({ sub: id, clientId, email, iat: now, exp: now + 60 * 60 * 24 * 7 }));
    const signature = base64(createHmac('sha256', this.env.AUTH_JWT_SECRET).update(`${header}.${payload}`).digest());
    return { accessToken: `${header}.${payload}.${signature}`, user: { id, email }, clientId };
  }

  sessionForClient(id: string, email: string, clientId: string) { return this.session(id, email, clientId); }

  private async sessionForUser(id: string, email: string) {
    const project = await this.prisma.project.findFirst({ where: { organization: { ownerId: id } }, orderBy: { createdAt: 'asc' }, select: { clientId: true } });
    if (!project) throw new UnauthorizedException('No project is configured for this account.');
    return this.session(id, email, project.clientId);
  }
}
