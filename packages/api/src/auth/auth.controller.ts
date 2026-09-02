import { Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './decorators';
import { ZodPipe } from '../common/zod.pipe';
import { z } from 'zod';
import { AuthService } from './auth.service';

const RegisterSchema = z.object({ email: z.string().email(), password: z.string().min(8), organizationName: z.string().min(2).max(80) });
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const GoogleCompleteSchema = z.object({ onboardingToken: z.string().min(1), organizationName: z.string().min(2).max(80) });
type RegisterDto = z.infer<typeof RegisterSchema>;
type LoginDto = z.infer<typeof LoginSchema>;
type GoogleCompleteDto = z.infer<typeof GoogleCompleteSchema>;

@Public()
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('google') google(@Res() response: Response) { return response.redirect(this.auth.googleLoginUrl()); }
  @Get('google/callback') async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() response: Response) { const result = await this.auth.googleCallback(code, state); const params = 'accessToken' in result ? `auth_token=${encodeURIComponent(result.accessToken)}&auth_email=${encodeURIComponent(result.user.email)}` : `onboarding_token=${encodeURIComponent(result.onboardingToken)}&auth_email=${encodeURIComponent(result.email)}`; return response.redirect(`${this.auth.dashboardUrl()}/#${params}`); }
  @Post('google/complete') completeGoogle(@Body(new ZodPipe(GoogleCompleteSchema)) dto: GoogleCompleteDto) { return this.auth.completeGoogleOnboarding(dto.onboardingToken, dto.organizationName); }
  @Post('register') register(@Body(new ZodPipe(RegisterSchema)) dto: RegisterDto) { return this.auth.register(dto.email, dto.password, dto.organizationName); }
  @Post('login') login(@Body(new ZodPipe(LoginSchema)) dto: LoginDto) { return this.auth.login(dto.email, dto.password); }
}
